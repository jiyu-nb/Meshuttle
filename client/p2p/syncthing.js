'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

class SyncthingController {
  constructor(options) {
    this.binaryPath = path.resolve(options.binaryPath);
    this.homeDir = path.resolve(options.homeDir);
    this.logger = options.logger || console;
    this.process = null;
    this.apiPort = 0;
    this.apiKey = '';
    this.deviceId = '';
    this.logTail = [];
  }

  async start() {
    if (this.process && !this.process.killed) return this.status();
    await fsp.mkdir(this.homeDir, { recursive: true });
    this.apiPort = await findFreePort();
    this.apiKey = crypto.randomBytes(32).toString('base64url');
    const args = [
      'serve',
      `--home=${this.homeDir}`,
      '--no-browser',
      '--no-restart',
      '--no-upgrade',
      '--no-console',
      `--gui-address=http://127.0.0.1:${this.apiPort}`,
      `--gui-apikey=${this.apiKey}`,
      '--log-level=WARN',
      '--log-file=-'
    ];
    this.process = spawn(this.binaryPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, STVERSIONEXTRA: 'Meshuttle' }
    });
    this.process.stdout.on('data', (chunk) => this.captureLog(chunk));
    this.process.stderr.on('data', (chunk) => this.captureLog(chunk));
    this.process.on('error', (error) => this.captureLog(error.message));
    await this.waitUntilReady();
    const status = await this.api('GET', '/rest/system/status');
    this.deviceId = status.myID;
    return status;
  }

  captureLog(chunk) {
    const lines = String(chunk || '').split(/\r?\n/).filter(Boolean);
    this.logTail.push(...lines);
    if (this.logTail.length > 40) this.logTail.splice(0, this.logTail.length - 40);
  }

  async waitUntilReady() {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (this.process && this.process.exitCode !== null) {
        throw new Error(`Syncthing 提前退出：${this.logTail.join(' | ') || this.process.exitCode}`);
      }
      try {
        await requestJson(this.apiPort, '', 'GET', '/rest/noauth/health');
        return;
      } catch {
        await delay(250);
      }
    }
    throw new Error(`Syncthing 启动超时：${this.logTail.join(' | ')}`);
  }

  api(method, route, body) {
    return requestJson(this.apiPort, this.apiKey, method, route, body);
  }

  async status() {
    return this.api('GET', '/rest/system/status');
  }

  async configureLocalDevice(name) {
    const status = await this.status();
    this.deviceId = status.myID;
    await this.api('PATCH', `/rest/config/devices/${encodeURIComponent(this.deviceId)}`, {
      name: String(name || '').slice(0, 64),
      addresses: ['dynamic']
    });
    await this.api('PATCH', '/rest/config/options', {
      startBrowser: false,
      globalAnnounceEnabled: true,
      localAnnounceEnabled: true,
      relaysEnabled: true,
      natEnabled: true,
      urAccepted: -1,
      crashReportingEnabled: false,
      unackedNotificationIDs: []
    });
    return this.deviceId;
  }

  async ensureDevice(device) {
    const deviceId = validateDeviceId(device.deviceId);
    const devices = await this.api('GET', '/rest/config/devices');
    const existing = devices.find((entry) => entry.deviceID === deviceId);
    const changes = {
      deviceID: deviceId,
      name: String(device.name || '').slice(0, 64),
      addresses: ['dynamic'],
      introducer: Boolean(device.introducer),
      skipIntroductionRemovals: Boolean(device.skipIntroductionRemovals),
      autoAcceptFolders: false,
      paused: false
    };
    if (existing) {
      await this.api('PATCH', `/rest/config/devices/${encodeURIComponent(deviceId)}`, changes);
    } else {
      const template = await this.api('GET', '/rest/config/defaults/device');
      await this.api('POST', '/rest/config/devices', { ...template, ...changes });
    }
  }

  async ensureFolder(folder) {
    const folderId = validateFolderId(folder.folderId);
    await fsp.mkdir(path.resolve(folder.path), { recursive: true });
    const devices = unique([this.deviceId, ...(folder.deviceIds || [])]).map((deviceID) => ({
      deviceID: validateDeviceId(deviceID),
      introducedBy: '',
      encryptionPassword: ''
    }));
    const folders = await this.api('GET', '/rest/config/folders');
    const existing = folders.find((entry) => entry.id === folderId);
    if (existing) {
      const mergedDevices = unique([...existing.devices.map((entry) => entry.deviceID), ...devices.map((entry) => entry.deviceID)])
        .map((deviceID) => ({ deviceID, introducedBy: '', encryptionPassword: '' }));
      await this.api('PATCH', `/rest/config/folders/${encodeURIComponent(folderId)}`, {
        label: String(folder.label || '织梭设备组').slice(0, 64),
        path: path.resolve(folder.path),
        devices: mergedDevices,
        type: 'sendreceive',
        fsWatcherEnabled: true,
        fsWatcherDelayS: 1,
        rescanIntervalS: 60,
        ignoreDelete: false,
        paused: false
      });
      return;
    }
    const template = await this.api('GET', '/rest/config/defaults/folder');
    await this.api('POST', '/rest/config/folders', {
      ...template,
      id: folderId,
      label: String(folder.label || '织梭设备组').slice(0, 64),
      path: path.resolve(folder.path),
      devices,
      type: 'sendreceive',
      fsWatcherEnabled: true,
      fsWatcherDelayS: 1,
      rescanIntervalS: 60,
      ignoreDelete: false,
      maxConflicts: 0,
      paused: false
    });
  }

  async shareFolder(folderId, deviceId) {
    const safeFolderId = validateFolderId(folderId);
    const safeDeviceId = validateDeviceId(deviceId);
    const folder = await this.api('GET', `/rest/config/folders/${encodeURIComponent(safeFolderId)}`);
    if (folder.devices.some((entry) => entry.deviceID === safeDeviceId)) return;
    folder.devices.push({ deviceID: safeDeviceId, introducedBy: '', encryptionPassword: '' });
    await this.api('PATCH', `/rest/config/folders/${encodeURIComponent(safeFolderId)}`, { devices: folder.devices });
  }

  async scan(folderId) {
    try {
      await this.api('POST', `/rest/db/scan?folder=${encodeURIComponent(validateFolderId(folderId))}`);
    } catch (error) {
      this.logger.warn('请求 Syncthing 扫描失败', error.message);
    }
  }

  async pendingDevices() {
    const pending = await this.api('GET', '/rest/cluster/pending/devices');
    return Object.entries(pending || {}).map(([deviceId, value]) => ({ deviceId, ...value }));
  }

  async groupStatus(folderId) {
    const status = await this.status();
    const devices = await this.api('GET', '/rest/config/devices');
    const connectionResult = await this.api('GET', '/rest/system/connections');
    const connections = connectionResult.connections || {};
    let completion = null;
    try {
      completion = await this.api('GET', `/rest/db/completion?folder=${encodeURIComponent(folderId)}&device=${encodeURIComponent(status.myID)}`);
    } catch {
      completion = null;
    }
    return {
      localDeviceId: status.myID,
      localName: devices.find((device) => device.deviceID === status.myID)?.name || status.myID,
      members: devices.map((device) => ({
        deviceId: device.deviceID,
        name: device.name,
        local: device.deviceID === status.myID,
        connected: device.deviceID === status.myID || Boolean(connections[device.deviceID]?.connected),
        connectionType: connections[device.deviceID]?.type || '',
        introducer: Boolean(device.introducer)
      })),
      completion
    };
  }

  async stop() {
    const child = this.process;
    this.process = null;
    if (!child || child.exitCode !== null) return;
    try { await this.api('POST', '/rest/system/shutdown'); } catch {}
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(5000)
    ]);
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(5000)
      ]);
    }
  }

  stopNow() {
    const child = this.process;
    this.process = null;
    if (child && child.exitCode === null) child.kill();
  }
}

function requestJson(port, apiKey, method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {};
    if (apiKey) headers['X-API-Key'] = apiKey;
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: route,
      headers,
      timeout: 10_000
    }, async (res) => {
      const chunks = [];
      for await (const chunk of res) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');
      let parsed = {};
      try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { message: raw }; }
      if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
      else reject(new Error(parsed.message || parsed.error || `Syncthing API 返回 ${res.statusCode}`));
    });
    req.on('timeout', () => req.destroy(new Error('Syncthing API 超时')));
    req.on('error', reject);
    req.end(data || undefined);
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function validateDeviceId(value) {
  const id = String(value || '').toUpperCase();
  if (!/^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/.test(id)) throw new Error('Syncthing 设备编号无效');
  return id;
}

function validateFolderId(value) {
  const id = String(value || '');
  if (!/^[a-zA-Z0-9._-]{4,64}$/.test(id)) throw new Error('设备组编号无效');
  return id;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { SyncthingController, validateDeviceId, validateFolderId };
