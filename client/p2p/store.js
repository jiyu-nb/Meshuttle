'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_RETENTION_MS = 72 * 60 * 60 * 1000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;

function createP2PStore(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || ''));
  const itemsDir = path.join(dataDir, 'items');
  const token = String(options.token || '');
  const maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
  const cleanupIntervalMs = Number(options.cleanupIntervalMs || 60 * 60 * 1000);
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const getRetentionMs = typeof options.getRetentionMs === 'function'
    ? options.getRetentionMs
    : () => Number(options.retentionMs || DEFAULT_RETENTION_MS);

  if (!dataDir) throw new Error('P2P 数据目录不能为空');
  if (token.length < 24) throw new Error('本地访问码至少需要 24 个字符');
  if (!Number.isFinite(maxFileBytes) || maxFileBytes < 1) throw new Error('文件大小上限无效');

  fs.mkdirSync(itemsDir, { recursive: true });
  ensureIgnoreFile(dataDir);
  let cleanupTimer = null;

  function retentionMs() {
    const value = Number(getRetentionMs());
    return Number.isFinite(value) && value >= 1000 ? value : DEFAULT_RETENTION_MS;
  }

  async function listItems() {
    await cleanupExpired();
    const entries = await fsp.readdir(itemsDir, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isItemId(entry.name)) continue;
      const item = await readItem(entry.name);
      if (item) items.push(toPublicItem(item));
    }
    items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return items;
  }

  async function readItem(id) {
    try {
      const itemDir = path.join(itemsDir, id);
      const item = JSON.parse(await fsp.readFile(path.join(itemDir, 'meta.json'), 'utf8'));
      if (!item || item.id !== id || !['text', 'file'].includes(item.type)) return null;
      if (!Number.isFinite(Date.parse(item.createdAt)) || !Number.isFinite(Date.parse(item.expiresAt))) return null;
      if (item.type === 'text' && typeof item.text !== 'string') return null;
      if (item.type === 'file') {
        if (!item.name || !Number.isFinite(item.size) || item.size < 0) return null;
        const stat = await fsp.stat(path.join(itemDir, 'payload.bin'));
        if (!stat.isFile() || stat.size !== item.size) return null;
      }
      return item;
    } catch {
      return null;
    }
  }

  async function createText(text) {
    const value = String(text || '').trim();
    if (!value) throw statusError(400, '文字不能为空');
    if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) throw statusError(413, '文字内容过大');
    const item = makeBaseItem('text', retentionMs(), options.originDeviceId);
    item.text = value;
    await writeItemDirectory(item, async () => {});
    changed();
    return toPublicItem(item);
  }

  async function receiveFile(req) {
    const name = decodeFileName(req.headers['x-file-name-b64']);
    if (!name) throw statusError(400, '缺少有效文件名');
    const declaredSize = Number(req.headers['content-length']);
    if (!Number.isFinite(declaredSize) || declaredSize < 0) throw statusError(411, '需要提供文件大小');
    if (declaredSize > maxFileBytes) throw statusError(413, `文件超过上限 ${formatBytes(maxFileBytes)}`);

    const item = makeBaseItem('file', retentionMs(), options.originDeviceId);
    item.name = name;
    item.size = declaredSize;
    item.contentType = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120);

    await writeItemDirectory(item, async (temporaryDir) => {
      const destination = path.join(temporaryDir, 'payload.bin');
      let received = 0;
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
        req.on('data', (chunk) => {
          received += chunk.length;
          if (received > maxFileBytes) {
            const error = statusError(413, `文件超过上限 ${formatBytes(maxFileBytes)}`);
            req.destroy(error);
            output.destroy(error);
          }
        });
        req.on('aborted', () => reject(statusError(400, '上传被中断')));
        req.on('error', reject);
        output.on('error', reject);
        output.on('finish', resolve);
        req.pipe(output);
      });
      if (received !== declaredSize) throw statusError(400, '收到的文件大小不完整');
    });
    changed();
    return toPublicItem(item);
  }

  async function writeItemDirectory(item, writePayload) {
    const temporaryDir = path.join(itemsDir, `.incoming-${item.id}-${process.pid}`);
    const finalDir = path.join(itemsDir, item.id);
    await fsp.mkdir(temporaryDir, { recursive: false, mode: 0o700 });
    try {
      await writePayload(temporaryDir);
      await fsp.writeFile(path.join(temporaryDir, 'meta.json'), `${JSON.stringify(item, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx'
      });
      await fsp.rename(temporaryDir, finalDir);
    } catch (error) {
      await fsp.rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function deleteItem(id) {
    const safeId = validateItemId(id);
    const itemDir = path.join(itemsDir, safeId);
    const item = await readItem(safeId);
    if (!item) throw statusError(404, '内容不存在');
    await fsp.rm(itemDir, { recursive: true, force: true });
    changed();
  }

  async function cleanupExpired(now = Date.now()) {
    const entries = await fsp.readdir(itemsDir, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !isItemId(entry.name)) continue;
      const item = await readItem(entry.name);
      if (item && Date.parse(item.expiresAt) <= now) {
        await fsp.rm(path.join(itemsDir, entry.name), { recursive: true, force: true });
        removed += 1;
      }
    }
    if (removed > 0) changed();
    return removed;
  }

  function changed() {
    Promise.resolve().then(() => onChange()).catch((error) => console.error('触发 P2P 同步失败', error));
  }

  async function handler(req, res) {
    setCommonHeaders(res);
    if (req.method === 'OPTIONS') return endJson(res, 204, {});
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return endJson(res, 200, { ok: true, mode: 'p2p' });
    }
    if (!isAuthorized(req, token)) return endJson(res, 401, { error: '访问密钥无效' });

    try {
      if (req.method === 'GET' && url.pathname === '/api/items') {
        return endJson(res, 200, { items: await listItems(), retentionHours: retentionMs() / 3600000 });
      }
      if (req.method === 'POST' && url.pathname === '/api/text') {
        const body = await readJson(req, MAX_TEXT_BYTES);
        return endJson(res, 201, { item: await createText(body.text) });
      }
      if (req.method === 'POST' && url.pathname === '/api/files') {
        return endJson(res, 201, { item: await receiveFile(req) });
      }
      const fileMatch = url.pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/i);
      if (req.method === 'GET' && fileMatch) {
        const item = await readItem(fileMatch[1]);
        if (!item || item.type !== 'file') return endJson(res, 404, { error: '文件不存在或尚未同步完成' });
        const filePath = path.join(itemsDir, item.id, 'payload.bin');
        res.writeHead(200, {
          'Content-Type': item.contentType || 'application/octet-stream',
          'Content-Length': item.size,
          'Content-Disposition': contentDisposition(item.name),
          'Cache-Control': 'private, no-store'
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      const deleteMatch = url.pathname.match(/^\/api\/items\/([0-9a-f-]{36})$/i);
      if (req.method === 'DELETE' && deleteMatch) {
        await deleteItem(deleteMatch[1]);
        return endJson(res, 200, { ok: true });
      }
      return endJson(res, 404, { error: '接口不存在' });
    } catch (error) {
      return endJson(res, error.statusCode || 500, { error: error.message || '本地存储错误' });
    }
  }

  function startCleanupTimer() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => cleanupExpired().catch((error) => console.error('P2P 到期清理失败', error)), cleanupIntervalMs);
    cleanupTimer.unref();
  }

  function stopCleanupTimer() {
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  startCleanupTimer();
  return { handler, listItems, createText, deleteItem, cleanupExpired, stopCleanupTimer, dataDir, itemsDir };
}

function ensureIgnoreFile(dataDir) {
  const ignorePath = path.join(dataDir, '.stignore');
  if (!fs.existsSync(ignorePath)) fs.writeFileSync(ignorePath, 'items/.incoming-*\n', 'utf8');
}

function makeBaseItem(type, retentionMs, originDeviceId) {
  const createdAt = new Date();
  return {
    id: crypto.randomUUID(),
    type,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + retentionMs).toISOString(),
    originDeviceId: originDeviceId || ''
  };
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

function decodeFileName(encoded) {
  try {
    return path.basename(Buffer.from(String(encoded || ''), 'base64').toString('utf8').trim())
      .replace(/[\u0000-\u001f]/g, '')
      .slice(0, 240);
  } catch {
    return '';
  }
}

function isItemId(value) {
  return /^[0-9a-f-]{36}$/i.test(String(value || ''));
}

function validateItemId(value) {
  const id = String(value || '');
  if (!isItemId(id)) throw statusError(400, '内容编号无效');
  return id;
}

function statusError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
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
}

function endJson(res, statusCode, body) {
  if (res.headersSent) return;
  if (statusCode === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
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
    if (size > limit) throw statusError(413, '内容过大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw statusError(400, 'JSON 格式无效');
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

module.exports = { createP2PStore };
