'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createP2PStore } = require('../p2p/store');

const TOKEN = 'p2p-test-token-that-is-long-enough';

test('P2P store handles concurrent text and file items without a shared index', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'meshuttle-p2p-store-'));
  const store = createP2PStore({ dataDir: root, token: TOKEN, retentionMs: 60_000, cleanupIntervalMs: 60_000 });
  const server = http.createServer(store.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    store.stopCleanupTimer();
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  });
  const port = server.address().port;

  const created = await Promise.all([
    request(port, 'POST', '/api/text', { json: { text: '第一台电脑' } }),
    request(port, 'POST', '/api/text', { json: { text: '第二台电脑' } })
  ]);
  assert.notEqual(created[0].item.id, created[1].item.id);

  const content = Buffer.from('跨设备文件内容', 'utf8');
  const uploaded = await request(port, 'POST', '/api/files', {
    body: content,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name-B64': Buffer.from('测试.txt', 'utf8').toString('base64')
    }
  });
  const list = await request(port, 'GET', '/api/items');
  assert.equal(list.items.length, 3);
  assert.equal(list.items.find((item) => item.id === uploaded.item.id).name, '测试.txt');

  const downloaded = await request(port, 'GET', `/api/files/${uploaded.item.id}`, { raw: true });
  assert.deepEqual(downloaded, content);

  const itemDirectories = fs.readdirSync(path.join(root, 'items')).filter((name) => /^[0-9a-f-]{36}$/.test(name));
  assert.equal(itemDirectories.length, 3);
});

test('P2P store removes expired item directories', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'meshuttle-p2p-expiry-'));
  const store = createP2PStore({ dataDir: root, token: TOKEN, retentionMs: 1000, cleanupIntervalMs: 60_000 });
  t.after(async () => {
    store.stopCleanupTimer();
    await fsp.rm(root, { recursive: true, force: true });
  });

  const item = await store.listItems();
  assert.equal(item.length, 0);
  const server = http.createServer(store.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;
  await request(port, 'POST', '/api/text', { json: { text: '很快过期' } });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(await store.cleanupExpired(), 1);
  assert.equal((await store.listItems()).length, 0);
});

function request(port, method, route, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.json ? Buffer.from(JSON.stringify(options.json)) : options.body;
    const headers = { Authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) };
    if (options.json) headers['Content-Type'] = 'application/json';
    if (body) headers['Content-Length'] = body.length;
    const req = http.request({ host: '127.0.0.1', port, method, path: route, headers }, async (res) => {
      const chunks = [];
      for await (const chunk of res) chunks.push(chunk);
      const result = Buffer.concat(chunks);
      if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(result.toString('utf8')));
      if (options.raw) return resolve(result);
      resolve(JSON.parse(result.toString('utf8')));
    });
    req.on('error', reject);
    req.end(body);
  });
}
