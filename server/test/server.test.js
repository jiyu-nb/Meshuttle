'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDropServer } = require('../src/server');

const TOKEN = 'test-token-that-is-at-least-24-characters';

async function startTestServer(options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meshuttle-'));
  const app = createDropServer({ dataDir, token: TOKEN, cleanupIntervalMs: 60_000, ...options });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    app,
    dataDir,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      app.stopCleanupTimer();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  };
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

test('拒绝未授权请求，并可创建、读取和删除文字', async (t) => {
  const ctx = await startTestServer();
  t.after(ctx.close);

  const unauthorized = await fetch(`${ctx.baseUrl}/api/items`);
  assert.equal(unauthorized.status, 401);

  const created = await fetch(`${ctx.baseUrl}/api/text`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text: '三台电脑都能看到' })
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();

  const listed = await fetch(`${ctx.baseUrl}/api/items`, { headers: authHeaders() });
  const listBody = await listed.json();
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].text, '三台电脑都能看到');
  assert.equal('storedName' in listBody.items[0], false);

  const deleted = await fetch(`${ctx.baseUrl}/api/items/${createdBody.item.id}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  assert.equal(deleted.status, 200);
});

test('支持中文文件名上传与下载', async (t) => {
  const ctx = await startTestServer();
  t.after(ctx.close);
  const content = Buffer.from('文件内容 123');
  const name = '测试资料.txt';

  const uploaded = await fetch(`${ctx.baseUrl}/api/files`, {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'text/plain',
      'Content-Length': String(content.length),
      'X-File-Name-B64': Buffer.from(name).toString('base64')
    }),
    body: content
  });
  assert.equal(uploaded.status, 201);
  const body = await uploaded.json();
  assert.equal(body.item.name, name);

  const downloaded = await fetch(`${ctx.baseUrl}/api/files/${body.item.id}`, { headers: authHeaders() });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), content);
});

test('内容到期后自动从列表和磁盘清理', async (t) => {
  const ctx = await startTestServer({ retentionMs: 1000 });
  t.after(ctx.close);

  await fetch(`${ctx.baseUrl}/api/text`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text: '短期内容' })
  });
  await new Promise((resolve) => setTimeout(resolve, 1050));
  await ctx.app.cleanupExpired();

  const listed = await fetch(`${ctx.baseUrl}/api/items`, { headers: authHeaders() });
  assert.equal((await listed.json()).items.length, 0);
});
