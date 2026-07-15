'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const DEFAULT_RETENTION_MS = 72 * 60 * 60 * 1000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;

function createDropServer(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const filesDir = path.join(dataDir, 'files');
  const metadataPath = path.join(dataDir, 'items.json');
  const token = String(options.token || process.env.ACCESS_TOKEN || '');
  const retentionMs = Number(options.retentionMs || process.env.RETENTION_MS || DEFAULT_RETENTION_MS);
  const maxFileBytes = Number(options.maxFileBytes || process.env.MAX_FILE_BYTES || DEFAULT_MAX_FILE_BYTES);
  const cleanupIntervalMs = Number(options.cleanupIntervalMs || 60 * 60 * 1000);

  if (token.length < 24) {
    throw new Error('ACCESS_TOKEN 至少需要 24 个字符');
  }
  if (!Number.isFinite(retentionMs) || retentionMs < 1000) {
    throw new Error('RETENTION_MS 必须大于等于 1000');
  }
  if (!Number.isFinite(maxFileBytes) || maxFileBytes < 1) {
    throw new Error('MAX_FILE_BYTES 必须为正数');
  }

  fs.mkdirSync(filesDir, { recursive: true });
  let items = loadItems(metadataPath);
  let saveQueue = Promise.resolve();
  let cleanupTimer = null;

  function persistItems() {
    const snapshot = JSON.stringify(items, null, 2);
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const tempPath = `${metadataPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fsp.writeFile(tempPath, snapshot, { encoding: 'utf8', mode: 0o600 });
      await fsp.rename(tempPath, metadataPath);
    });
    return saveQueue;
  }

  async function cleanupExpired(now = Date.now()) {
    const expired = items.filter((item) => Date.parse(item.expiresAt) <= now);
    if (expired.length === 0) return 0;

    const expiredIds = new Set(expired.map((item) => item.id));
    items = items.filter((item) => !expiredIds.has(item.id));
    await persistItems();
    await Promise.all(expired
      .filter((item) => item.type === 'file' && item.storedName)
      .map((item) => fsp.rm(path.join(filesDir, item.storedName), { force: true }).catch(() => {})));
    return expired.length;
  }

  async function handler(req, res) {
    setCommonHeaders(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, serverTime: new Date().toISOString() });
    }
    if (!isAuthorized(req, token)) {
      return sendJson(res, 401, { error: '访问密钥无效' });
    }

    try {
      await cleanupExpired();

      if (req.method === 'GET' && url.pathname === '/api/items') {
        const publicItems = items
          .slice()
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .map(toPublicItem);
        return sendJson(res, 200, { items: publicItems, retentionHours: retentionMs / 3600000 });
      }

      if (req.method === 'POST' && url.pathname === '/api/text') {
        const body = await readJson(req, MAX_TEXT_BYTES);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) return sendJson(res, 400, { error: '文字不能为空' });
        const item = makeBaseItem('text', retentionMs);
        item.text = text;
        items.push(item);
        await persistItems();
        return sendJson(res, 201, { item: toPublicItem(item) });
      }

      if (req.method === 'POST' && url.pathname === '/api/files') {
        return await receiveFile(req, res);
      }

      const fileMatch = url.pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/i);
      if (req.method === 'GET' && fileMatch) {
        const item = items.find((entry) => entry.id === fileMatch[1] && entry.type === 'file');
        if (!item) return sendJson(res, 404, { error: '文件不存在或已过期' });
        const filePath = path.join(filesDir, item.storedName);
        let stat;
        try {
          stat = await fsp.stat(filePath);
        } catch {
          return sendJson(res, 404, { error: '文件不存在或已过期' });
        }
        res.writeHead(200, {
          'Content-Type': item.contentType || 'application/octet-stream',
          'Content-Length': stat.size,
          'Content-Disposition': contentDisposition(item.name),
          'Cache-Control': 'private, no-store'
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      const deleteMatch = url.pathname.match(/^\/api\/items\/([0-9a-f-]{36})$/i);
      if (req.method === 'DELETE' && deleteMatch) {
        const index = items.findIndex((entry) => entry.id === deleteMatch[1]);
        if (index < 0) return sendJson(res, 404, { error: '内容不存在' });
        const [removed] = items.splice(index, 1);
        await persistItems();
        if (removed.type === 'file' && removed.storedName) {
          await fsp.rm(path.join(filesDir, removed.storedName), { force: true }).catch(() => {});
        }
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: '接口不存在' });
    } catch (error) {
      if (error && error.statusCode) return sendJson(res, error.statusCode, { error: error.message });
      console.error(new Date().toISOString(), error);
      return sendJson(res, 500, { error: '服务器内部错误' });
    }
  }

  async function receiveFile(req, res) {
    const encodedName = String(req.headers['x-file-name-b64'] || '');
    let originalName;
    try {
      originalName = Buffer.from(encodedName, 'base64').toString('utf8').trim();
    } catch {
      originalName = '';
    }
    originalName = path.basename(originalName).replace(/[\u0000-\u001f]/g, '').slice(0, 240);
    if (!originalName) return sendJson(res, 400, { error: '缺少有效文件名' });

    const declaredSize = Number(req.headers['content-length']);
    if (!Number.isFinite(declaredSize) || declaredSize < 0) {
      return sendJson(res, 411, { error: '需要提供文件大小' });
    }
    if (declaredSize > maxFileBytes) {
      return sendJson(res, 413, { error: `文件超过上限 ${formatBytes(maxFileBytes)}` });
    }

    const id = crypto.randomUUID();
    const storedName = `${id}.bin`;
    const partPath = path.join(filesDir, `${storedName}.part`);
    const finalPath = path.join(filesDir, storedName);
    let received = 0;

    try {
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(partPath, { flags: 'wx', mode: 0o600 });
        req.on('data', (chunk) => {
          received += chunk.length;
          if (received > maxFileBytes) {
            const error = new Error(`文件超过上限 ${formatBytes(maxFileBytes)}`);
            error.statusCode = 413;
            req.destroy(error);
            output.destroy(error);
          }
        });
        req.on('aborted', () => reject(Object.assign(new Error('上传被中断'), { statusCode: 400 })));
        req.on('error', reject);
        output.on('error', reject);
        output.on('finish', resolve);
        req.pipe(output);
      });
      if (received !== declaredSize) {
        throw Object.assign(new Error('收到的文件大小不完整'), { statusCode: 400 });
      }
      await fsp.rename(partPath, finalPath);
    } catch (error) {
      await fsp.rm(partPath, { force: true }).catch(() => {});
      if (!res.headersSent) return sendJson(res, error.statusCode || 500, { error: error.message || '上传失败' });
      return;
    }

    const item = makeBaseItem('file', retentionMs);
    item.id = id;
    item.name = originalName;
    item.storedName = storedName;
    item.size = received;
    item.contentType = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120);
    items.push(item);
    await persistItems();
    return sendJson(res, 201, { item: toPublicItem(item) });
  }

  function startCleanupTimer() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => cleanupExpired().catch((error) => console.error('清理过期文件失败', error)), cleanupIntervalMs);
    cleanupTimer.unref();
  }

  function stopCleanupTimer() {
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  startCleanupTimer();
  cleanupExpired().catch((error) => console.error('启动清理失败', error));

  return { handler, cleanupExpired, stopCleanupTimer, dataDir };
}

function makeBaseItem(type, retentionMs) {
  const createdAt = new Date();
  return {
    id: crypto.randomUUID(),
    type,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + retentionMs).toISOString()
  };
}

function loadItems(metadataPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('读取内容索引失败，将使用空索引', error);
    return [];
  }
}

function toPublicItem(item) {
  const result = {
    id: item.id,
    type: item.type,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt
  };
  if (item.type === 'text') result.text = item.text;
  if (item.type === 'file') {
    result.name = item.name;
    result.size = item.size;
    result.contentType = item.contentType;
  }
  return result;
}

function isAuthorized(req, expectedToken) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function setCommonHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name-B64');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
}

function sendJson(res, statusCode, body) {
  if (res.headersSent) return;
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store'
  });
  res.end(data);
}

async function readJson(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('内容过大'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON 格式无效'), { statusCode: 400 });
  }
}

function contentDisposition(fileName) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function runFromEnvironment() {
  const app = createDropServer();
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || 8443);
  const certPath = process.env.TLS_CERT;
  const keyPath = process.env.TLS_KEY;
  const server = certPath && keyPath
    ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app.handler)
    : http.createServer(app.handler);
  server.requestTimeout = 30 * 60 * 1000;
  server.headersTimeout = 30 * 1000;
  server.listen(port, host, () => {
    console.log(`织梭服务已监听 ${certPath ? 'https' : 'http'}://${host}:${port}`);
  });
}

if (require.main === module) runFromEnvironment();

module.exports = { createDropServer };
