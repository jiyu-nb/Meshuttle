'use strict';

const { app, BrowserWindow, dialog, ipcMain, safeStorage, screen } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { createDropServer } = require('meshuttle-server');
const { createP2PStore } = require('./p2p/store');
const { SyncthingController, validateDeviceId, validateFolderId } = require('./p2p/syncthing');
const {
  clampRetentionHours,
  createInvitePayload,
  decodeDeviceName,
  encodeDeviceName,
  inviteProof,
  parseInvite,
  readLatestGroupSettings,
  writeGroupSettings
} = require('./p2p/group');

let mainWindow;
let miniWindow;
let setupWindow;
let config;
let settings;
let embeddedApp;
let embeddedServer;
let p2pStore;
let p2pServer;
let p2pController;
let p2pSettingsTimer;
let effectiveRetentionHours = 72;
let isQuitting = false;
let pendingAccessToken = crypto.randomBytes(24).toString('base64url');

app.setName('织梭 Meshuttle');

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function protectToken(token) {
  if (safeStorage.isEncryptionAvailable()) {
    return `encrypted:${safeStorage.encryptString(token).toString('base64')}`;
  }
  return `plain:${token}`;
}

function unprotectToken(value) {
  if (typeof value !== 'string') return '';
  if (value.startsWith('encrypted:')) {
    try { return safeStorage.decryptString(Buffer.from(value.slice(10), 'base64')); } catch { return ''; }
  }
  return value.startsWith('plain:') ? value.slice(6) : value;
}

function normalizeSettings(raw) {
  if (!raw || !['remote', 'host', 'p2p'].includes(raw.mode)) return null;
  const accessToken = String(raw.accessToken || unprotectToken(raw.accessTokenProtected) || '');
  if (accessToken.length < 24) return null;
  if (raw.mode === 'p2p') {
    try {
      const groupId = validateFolderId(raw.groupId);
      const parentDeviceId = raw.parentDeviceId ? validateDeviceId(raw.parentDeviceId) : '';
      return {
        mode: 'p2p',
        accessToken,
        groupId,
        groupName: String(raw.groupName || '织梭设备组').trim().slice(0, 64),
        deviceName: String(raw.deviceName || os.hostname()).trim().slice(0, 24),
        syncthingName: String(raw.syncthingName || '').slice(0, 64),
        retentionHours: clampRetentionHours(raw.retentionHours),
        parentDeviceId,
        parentName: String(raw.parentName || '').slice(0, 24)
      };
    } catch {
      return null;
    }
  }
  if (raw.mode === 'host') {
    return {
      mode: 'host',
      accessToken,
      port: clampInteger(raw.port, 1024, 65535, 8787),
      retentionDays: clampInteger(raw.retentionDays, 1, 30, 3)
    };
  }
  if (!/^https?:\/\//i.test(String(raw.serverUrl || ''))) return null;
  return {
    mode: 'remote',
    serverUrl: String(raw.serverUrl).replace(/\/+$/, ''),
    accessToken,
    caFile: raw.caFile ? path.resolve(String(raw.caFile)) : ''
  };
}

function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('读取设置失败', error);
  }
  return tryLegacySettings();
}

function tryLegacySettings() {
  const baseDir = app.isPackaged ? process.resourcesPath : __dirname;
  const legacyPath = path.join(baseDir, 'deployment-config.json');
  try {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    const migrated = normalizeSettings({
      mode: 'remote',
      serverUrl: legacy.serverUrl,
      accessToken: legacy.accessToken,
      caFile: legacy.caFile ? path.join(baseDir, path.basename(legacy.caFile)) : ''
    });
    if (migrated) saveSettings(migrated);
    return migrated;
  } catch {
    return null;
  }
}

function saveSettings(nextSettings) {
  const stored = { ...nextSettings, accessTokenProtected: protectToken(nextSettings.accessToken) };
  delete stored.accessToken;
  const destination = settingsPath();
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, destination);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function webPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  };
}

function createMainWindow(show = false) {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#0b0d10',
    title: '织梭 Meshuttle',
    autoHideMenuBar: true,
    show,
    webPreferences: webPreferences()
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('close', (event) => {
    if (!isQuitting && miniWindow && !miniWindow.isDestroyed()) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function positionMiniWindow() {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [windowWidth, windowHeight] = miniWindow.getSize();
  miniWindow.setPosition(x + width - windowWidth - 22, y + height - windowHeight - 22, false);
}

function createMiniWindow() {
  miniWindow = new BrowserWindow({
    width: 360,
    height: 286,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    minimizable: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0b0d10',
    show: false,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    title: '织梭悬浮窗',
    webPreferences: webPreferences()
  });
  miniWindow.setAlwaysOnTop(true, 'floating');
  miniWindow.loadFile(path.join(__dirname, 'renderer', 'mini.html'));
  miniWindow.once('ready-to-show', () => {
    positionMiniWindow();
    miniWindow.show();
  });
  miniWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      miniWindow.minimize();
    }
  });
  miniWindow.on('closed', () => { miniWindow = null; });
}

function createAppWindows() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(false);
  if (!miniWindow || miniWindow.isDestroyed()) createMiniWindow();
}

function createSetupWindow(errorMessage = '', preferredMode = '') {
  if (setupWindow && !setupWindow.isDestroyed()) {
    if (['remote', 'host', 'p2p'].includes(preferredMode)) setupWindow.webContents.send('setup:select-mode', preferredMode);
    setupWindow.show();
    setupWindow.focus();
    return;
  }
  setupWindow = new BrowserWindow({
    width: 740,
    height: 760,
    minWidth: 620,
    minHeight: 620,
    backgroundColor: '#0b0d10',
    title: settings ? '织梭连接设置' : '欢迎使用织梭',
    autoHideMenuBar: true,
    webPreferences: webPreferences()
  });
  setupWindow.loadFile(path.join(__dirname, 'renderer', 'setup.html'), {
    query: {
      ...(errorMessage ? { error: errorMessage } : {}),
      ...(['remote', 'host', 'p2p'].includes(preferredMode) ? { mode: preferredMode } : {})
    }
  });
  setupWindow.on('closed', () => {
    setupWindow = null;
    if (!settings && !isQuitting) app.quit();
  });
}

function publicSettings() {
  const current = settings || { mode: 'remote', serverUrl: '', accessToken: '' };
  return {
    mode: current.mode,
    serverUrl: current.serverUrl || '',
    accessToken: settings ? current.accessToken : '',
    port: current.port || 8787,
    retentionDays: current.retentionDays || 3,
    retentionHours: current.retentionHours || 72,
    groupId: current.groupId || '',
    groupName: current.groupName || '',
    deviceName: current.deviceName || os.hostname(),
    p2pConfigured: current.mode === 'p2p',
    caConfigured: Boolean(current.caFile),
    lanUrls: current.mode === 'host' ? getLanUrls(current.port) : [],
    version: app.getVersion(),
    author: '集御'
  };
}

function getLanUrls(port) {
  const addresses = [];
  for (const values of Object.values(os.networkInterfaces())) {
    for (const entry of values || []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        addresses.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return [...new Set(addresses)];
}

function p2pRoot(groupId) {
  return path.join(app.getPath('userData'), 'p2p', validateFolderId(groupId));
}

function p2pDataDir(groupId) {
  return path.join(p2pRoot(groupId), 'shared');
}

function syncthingHomeDir(groupId) {
  return path.join(p2pRoot(groupId), 'syncthing');
}

function syncthingBinaryPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'syncthing', 'syncthing.exe')
    : path.join(__dirname, 'vendor', 'syncthing', 'syncthing.exe');
}

async function stopP2PRuntime() {
  if (p2pSettingsTimer) clearInterval(p2pSettingsTimer);
  p2pSettingsTimer = null;
  if (p2pStore) p2pStore.stopCleanupTimer();
  p2pStore = null;
  if (p2pServer) {
    await new Promise((resolve) => p2pServer.close(() => resolve()));
    p2pServer = null;
  }
  if (p2pController) {
    await p2pController.stop();
    p2pController = null;
  }
}

async function startP2PRuntime(nextSettings) {
  await stopP2PRuntime();
  try {
  const binaryPath = syncthingBinaryPath();
  await fsp.access(binaryPath).catch(() => {
    throw new Error('缺少 Syncthing 同步引擎，请先运行 npm run fetch:syncthing');
  });
  const dataDir = p2pDataDir(nextSettings.groupId);
  p2pController = new SyncthingController({
    binaryPath,
    homeDir: syncthingHomeDir(nextSettings.groupId),
    logger: console
  });
  await p2pController.start();
  if (nextSettings.pendingJoinToken) {
    nextSettings.syncthingName = encodeDeviceName(
      nextSettings.deviceName,
      inviteProof(nextSettings.pendingJoinToken, p2pController.deviceId)
    );
    delete nextSettings.pendingJoinToken;
  }
  if (!nextSettings.syncthingName) nextSettings.syncthingName = encodeDeviceName(nextSettings.deviceName, 'owner');
  await p2pController.configureLocalDevice(nextSettings.syncthingName);
  if (nextSettings.parentDeviceId) {
    await p2pController.ensureDevice({
      deviceId: nextSettings.parentDeviceId,
      name: encodeDeviceName(nextSettings.parentName || '邀请设备', 'owner'),
      introducer: true,
      skipIntroductionRemovals: true
    });
  }
  await p2pController.ensureFolder({
    folderId: nextSettings.groupId,
    label: nextSettings.groupName,
    path: dataDir,
    deviceIds: nextSettings.parentDeviceId ? [nextSettings.parentDeviceId] : []
  });

  const latest = readLatestGroupSettings(dataDir, nextSettings.groupId);
  effectiveRetentionHours = latest ? clampRetentionHours(latest.retentionHours) : nextSettings.retentionHours;
  if (!latest && !nextSettings.parentDeviceId) {
    await writeGroupSettings(dataDir, {
      groupId: nextSettings.groupId,
      groupName: nextSettings.groupName,
      retentionHours: nextSettings.retentionHours,
      actor: p2pController.deviceId
    });
  }

  p2pStore = createP2PStore({
    dataDir,
    token: nextSettings.accessToken,
    originDeviceId: p2pController.deviceId,
    getRetentionMs: () => effectiveRetentionHours * 60 * 60 * 1000,
    cleanupIntervalMs: 60 * 60 * 1000,
    onChange: () => p2pController?.scan(nextSettings.groupId)
  });
  p2pServer = http.createServer(p2pStore.handler);
  p2pServer.requestTimeout = 30 * 60 * 1000;
  await new Promise((resolve, reject) => {
    p2pServer.once('error', reject);
    p2pServer.listen(0, '127.0.0.1', resolve);
  });
  const localPort = p2pServer.address().port;
  p2pSettingsTimer = setInterval(() => {
    const remote = readLatestGroupSettings(dataDir, nextSettings.groupId);
    if (remote) {
      effectiveRetentionHours = clampRetentionHours(remote.retentionHours);
      nextSettings.retentionHours = effectiveRetentionHours;
      nextSettings.groupName = remote.groupName || nextSettings.groupName;
    }
  }, 3000);
  p2pSettingsTimer.unref();
  await p2pController.scan(nextSettings.groupId);
  return {
    serverUrl: `http://127.0.0.1:${localPort}`,
    accessToken: nextSettings.accessToken,
    caPath: ''
  };
  } catch (error) {
    await stopP2PRuntime();
    throw error;
  }
}

function invitationsPath() {
  return path.join(app.getPath('userData'), 'p2p-invitations.json');
}

function loadInvitations() {
  try {
    const values = JSON.parse(fs.readFileSync(invitationsPath(), 'utf8'));
    return Array.isArray(values)
      ? values.filter((entry) => Number.isFinite(Date.parse(entry.expiresAt)) && Date.parse(entry.expiresAt) > Date.now())
      : [];
  } catch {
    return [];
  }
}

function saveInvitations(values) {
  const destination = invitationsPath();
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, destination);
}

function matchPendingInvite(deviceId, rawName) {
  const parsed = decodeDeviceName(rawName);
  for (const invitation of loadInvitations()) {
    const token = unprotectToken(invitation.tokenProtected);
    if (!token) continue;
    const expected = inviteProof(token, deviceId);
    const supplied = String(parsed.proof || '');
    if (supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return { verified: true, invitationId: invitation.id, displayName: parsed.displayName };
    }
  }
  return { verified: false, invitationId: '', displayName: parsed.displayName };
}

async function p2pStatus() {
  if (!settings || settings.mode !== 'p2p' || !p2pController) throw new Error('当前没有运行设备组');
  const result = await p2pController.groupStatus(settings.groupId);
  const pending = await p2pController.pendingDevices();
  const latest = readLatestGroupSettings(p2pDataDir(settings.groupId), settings.groupId);
  return {
    groupId: settings.groupId,
    groupName: latest?.groupName || settings.groupName,
    retentionHours: latest?.retentionHours || effectiveRetentionHours,
    localDeviceId: result.localDeviceId,
    members: result.members.map((member) => ({ ...member, displayName: decodeDeviceName(member.name).displayName })),
    pending: pending.map((entry) => ({ ...entry, ...matchPendingInvite(entry.deviceId, entry.name) }))
  };
}

async function createP2PInvite() {
  if (!settings || settings.mode !== 'p2p' || !p2pController) throw new Error('当前没有运行设备组');
  const token = crypto.randomBytes(32).toString('base64url');
  const invitation = {
    id: crypto.randomUUID(),
    tokenProtected: protectToken(token),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };
  const invitations = loadInvitations();
  invitations.push(invitation);
  saveInvitations(invitations);
  const payload = createInvitePayload(settings, p2pController.deviceId, token, invitation.expiresAt);
  const safeGroupName = settings.groupName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 40) || '设备组';
  const chosen = await dialog.showSaveDialog(setupWindow || mainWindow, {
    title: '保存子程序邀请文件',
    defaultPath: `Meshuttle-${safeGroupName}-邀请.tdjoin`,
    filters: [{ name: 'Meshuttle 设备邀请', extensions: ['tdjoin'] }]
  });
  if (chosen.canceled || !chosen.filePath) return { canceled: true };
  await fsp.writeFile(chosen.filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { canceled: false, filePath: chosen.filePath, expiresAt: invitation.expiresAt };
}

async function approveP2PDevice(deviceId) {
  if (!settings || settings.mode !== 'p2p' || !p2pController) throw new Error('当前没有运行设备组');
  const safeDeviceId = validateDeviceId(deviceId);
  const pending = (await p2pController.pendingDevices()).find((entry) => entry.deviceId === safeDeviceId);
  if (!pending) throw new Error('待加入设备已经离线或不存在');
  const match = matchPendingInvite(safeDeviceId, pending.name);
  if (!match.verified) throw new Error('该设备没有有效的邀请码证明，已拒绝加入');
  await p2pController.ensureDevice({
    deviceId: safeDeviceId,
    name: pending.name,
    introducer: false,
    skipIntroductionRemovals: true
  });
  await p2pController.shareFolder(settings.groupId, safeDeviceId);
  saveInvitations(loadInvitations().filter((entry) => entry.id !== match.invitationId));
  return { ok: true, deviceId: safeDeviceId, displayName: match.displayName };
}

async function stopEmbeddedServer() {
  if (embeddedApp) embeddedApp.stopCleanupTimer();
  embeddedApp = null;
  if (embeddedServer) {
    await new Promise((resolve) => embeddedServer.close(() => resolve()));
    embeddedServer = null;
  }
}

async function startEmbeddedServer(hostSettings) {
  await stopEmbeddedServer();
  embeddedApp = createDropServer({
    dataDir: path.join(app.getPath('userData'), 'host-data'),
    token: hostSettings.accessToken,
    retentionMs: hostSettings.retentionDays * 24 * 60 * 60 * 1000,
    cleanupIntervalMs: 60 * 60 * 1000
  });
  embeddedServer = http.createServer(embeddedApp.handler);
  embeddedServer.requestTimeout = 30 * 60 * 1000;
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    embeddedServer.once('error', onError);
    embeddedServer.listen(hostSettings.port, '0.0.0.0', () => {
      embeddedServer.removeListener('error', onError);
      resolve();
    });
  });
  return {
    serverUrl: `http://127.0.0.1:${hostSettings.port}`,
    accessToken: hostSettings.accessToken,
    caPath: ''
  };
}

async function initializeRuntime(nextSettings) {
  if (nextSettings.mode === 'host') {
    await stopP2PRuntime();
    return startEmbeddedServer(nextSettings);
  }
  if (nextSettings.mode === 'p2p') {
    await stopEmbeddedServer();
    return startP2PRuntime(nextSettings);
  }
  await Promise.all([stopEmbeddedServer(), stopP2PRuntime()]);
  return {
    serverUrl: nextSettings.serverUrl,
    accessToken: nextSettings.accessToken,
    caPath: nextSettings.caFile || ''
  };
}

function transportRequest(runtimeConfig, method, route, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(route, `${runtimeConfig.serverUrl}/`);
    const client = target.protocol === 'https:' ? https : http;
    const headers = { Authorization: `Bearer ${runtimeConfig.accessToken}`, ...options.headers };
    const requestOptions = { method, headers, timeout: options.timeout || 30_000 };
    if (target.protocol === 'https:' && runtimeConfig.caPath) {
      requestOptions.ca = fs.readFileSync(runtimeConfig.caPath);
      requestOptions.rejectUnauthorized = true;
    }
    const req = client.request(target, requestOptions, (res) => {
      if (options.streamResponse) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          collectResponse(res).then(({ message }) => reject(new Error(message))).catch(reject);
        } else resolve(res);
        return;
      }
      collectResponse(res).then(({ data, message }) => {
        if (res.statusCode < 200 || res.statusCode >= 300) reject(new Error(message));
        else resolve(data);
      }).catch(reject);
    });
    req.on('timeout', () => req.destroy(new Error('连接服务器超时')));
    req.on('error', reject);
    if (options.body) options.body.pipe ? options.body.pipe(req) : req.end(options.body);
    else req.end();
  });
}

function request(method, route, options) {
  if (!config) return Promise.reject(new Error('尚未配置服务器'));
  return transportRequest(config, method, route, options);
}

async function collectResponse(res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error('服务器响应过大');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw || '服务器响应无效' }; }
  return { data, message: data.error || `服务器返回 ${res.statusCode}` };
}

function safeId(value) {
  const id = String(value || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('内容编号无效');
  return id;
}

async function downloadFile(item, filePath) {
  const id = safeId(item && item.id);
  const response = await request('GET', `/api/files/${id}`, { streamResponse: true, timeout: 30 * 60 * 1000 });
  const partial = `${filePath}.meshuttle-part`;
  try {
    await pipeline(response, fs.createWriteStream(partial));
    await fsp.rm(filePath, { force: true });
    await fsp.rename(partial, filePath);
  } catch (error) {
    await fsp.rm(partial, { force: true }).catch(() => {});
    throw error;
  }
}

async function uniqueDestination(directory, fileName) {
  const safeName = path.basename(String(fileName || 'download'));
  const extension = path.extname(safeName);
  const baseName = path.basename(safeName, extension);
  for (let index = 0; index < 10000; index += 1) {
    const suffix = index === 0 ? '' : ` (${index})`;
    const candidate = path.join(directory, `${baseName}${suffix}${extension}`);
    try { await fsp.access(candidate); } catch { return candidate; }
  }
  throw new Error(`无法为 ${safeName} 生成可用文件名`);
}

async function importCaFile(sourcePath) {
  if (!sourcePath) return '';
  const source = path.resolve(String(sourcePath));
  const content = await fsp.readFile(source, 'utf8');
  if (!content.includes('BEGIN CERTIFICATE')) throw new Error('选择的文件不是 PEM 证书');
  const destination = path.join(app.getPath('userData'), 'server-ca.pem');
  await fsp.writeFile(destination, content, { encoding: 'utf8', mode: 0o600 });
  return destination;
}

async function applySetup(payload) {
  const mode = payload && payload.mode;
  if (!['remote', 'host', 'p2p'].includes(mode)) throw new Error('请选择服务器模式');

  if (mode === 'p2p') {
    const action = payload.p2pAction;
    const deviceName = String(payload.deviceName || os.hostname()).trim().slice(0, 24);
    if (!deviceName) throw new Error('请填写设备名称');
    let next;
    if (action === 'create') {
      const groupName = String(payload.groupName || '').trim().slice(0, 64);
      if (!groupName) throw new Error('请填写设备组名称');
      next = {
        mode: 'p2p',
        accessToken: crypto.randomBytes(32).toString('base64url'),
        groupId: `ms-${crypto.randomBytes(10).toString('hex')}`,
        groupName,
        deviceName,
        syncthingName: encodeDeviceName(deviceName, 'owner'),
        retentionHours: clampRetentionHours(payload.retentionHours),
        parentDeviceId: '',
        parentName: ''
      };
    } else if (action === 'join') {
      if (!payload.invitePath) throw new Error('请选择设备组邀请文件');
      const invitePath = path.resolve(String(payload.invitePath || ''));
      const invite = parseInvite(await fsp.readFile(invitePath, 'utf8'));
      next = {
        mode: 'p2p',
        accessToken: crypto.randomBytes(32).toString('base64url'),
        groupId: invite.groupId,
        groupName: invite.groupName,
        deviceName,
        syncthingName: '',
        retentionHours: invite.retentionHours,
        parentDeviceId: invite.parentDeviceId,
        parentName: invite.parentName,
        pendingJoinToken: invite.token
      };
    } else {
      throw new Error('请选择创建或加入设备组');
    }
    await stopEmbeddedServer();
    const nextConfig = await startP2PRuntime(next);
    delete next.pendingJoinToken;
    const normalized = normalizeSettings(next);
    if (!normalized) throw new Error('设备组设置无效');
    settings = normalized;
    config = nextConfig;
    saveSettings(settings);
  } else if (mode === 'host') {
    const next = normalizeSettings({
      mode,
      accessToken: payload.accessToken,
      port: Number(payload.port),
      retentionDays: Number(payload.retentionDays)
    });
    if (!next) throw new Error('本机服务器设置无效，访问码至少需要 24 位');
    await stopP2PRuntime();
    const nextConfig = await startEmbeddedServer(next);
    settings = next;
    config = nextConfig;
    saveSettings(settings);
  } else {
    const caFile = payload.caSourcePath ? await importCaFile(payload.caSourcePath) : (settings?.caFile || '');
    const next = normalizeSettings({
      mode,
      serverUrl: payload.serverUrl,
      accessToken: payload.accessToken,
      caFile
    });
    if (!next) throw new Error('服务器地址或访问码无效');
    const candidate = { serverUrl: next.serverUrl, accessToken: next.accessToken, caPath: next.caFile || '' };
    await transportRequest(candidate, 'GET', '/api/items');
    await Promise.all([stopEmbeddedServer(), stopP2PRuntime()]);
    settings = next;
    config = candidate;
    saveSettings(settings);
  }

  pendingAccessToken = settings.accessToken;
  createAppWindows();
  if (['remote', 'p2p'].includes(mode) && setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
  return publicSettings();
}

function registerIpc() {
  ipcMain.handle('items:list', () => request('GET', '/api/items'));

  ipcMain.handle('text:create', (_event, text) => {
    const body = Buffer.from(JSON.stringify({ text: String(text || '') }), 'utf8');
    return request('POST', '/api/text', {
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
      body
    });
  });

  ipcMain.handle('files:upload', async (event, filePaths) => {
    const paths = Array.isArray(filePaths) ? filePaths.slice(0, 100) : [];
    if (paths.length === 0) throw new Error('没有可上传的文件');
    const results = [];
    for (let index = 0; index < paths.length; index += 1) {
      const filePath = path.resolve(String(paths[index]));
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) continue;
      event.sender.send('upload:progress', { index, total: paths.length, name: path.basename(filePath) });
      const result = await request('POST', '/api/files', {
        timeout: 30 * 60 * 1000,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
          'X-File-Name-B64': Buffer.from(path.basename(filePath), 'utf8').toString('base64')
        },
        body: fs.createReadStream(filePath)
      });
      results.push(result.item);
    }
    return { items: results };
  });

  ipcMain.handle('item:delete', (_event, id) => request('DELETE', `/api/items/${safeId(id)}`));

  ipcMain.handle('item:download', async (_event, item) => {
    const suggestedName = path.basename(String(item && item.name || 'download'));
    const chosen = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName });
    if (chosen.canceled || !chosen.filePath) return { canceled: true };
    await downloadFile(item, chosen.filePath);
    return { canceled: false, filePath: chosen.filePath };
  });

  ipcMain.handle('items:download-many', async (event, items) => {
    const files = Array.isArray(items) ? items.slice(0, 100) : [];
    if (files.length === 0) throw new Error('请先选择文件');
    const chosen = await dialog.showOpenDialog(mainWindow, {
      title: '选择批量下载文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    if (chosen.canceled || chosen.filePaths.length === 0) return { canceled: true, count: 0 };
    const directory = chosen.filePaths[0];
    for (let index = 0; index < files.length; index += 1) {
      const item = files[index];
      event.sender.send('download:progress', { index, total: files.length, name: item.name });
      const destination = await uniqueDestination(directory, item.name);
      await downloadFile(item, destination);
    }
    return { canceled: false, count: files.length, directory };
  });

  ipcMain.handle('setup:get', () => publicSettings());
  ipcMain.handle('setup:save', (_event, payload) => applySetup(payload));
  ipcMain.handle('p2p:status', () => p2pStatus());
  ipcMain.handle('p2p:create-invite', () => createP2PInvite());
  ipcMain.handle('p2p:approve-device', (_event, deviceId) => approveP2PDevice(deviceId));
  ipcMain.handle('p2p:update-retention', async (_event, retentionHours) => {
    if (!settings || settings.mode !== 'p2p' || !p2pController) throw new Error('当前没有运行设备组');
    const value = clampRetentionHours(retentionHours);
    const event = await writeGroupSettings(p2pDataDir(settings.groupId), {
      groupId: settings.groupId,
      groupName: settings.groupName,
      retentionHours: value,
      actor: p2pController.deviceId
    });
    effectiveRetentionHours = value;
    settings.retentionHours = value;
    saveSettings(settings);
    await p2pController.scan(settings.groupId);
    return { retentionHours: event.retentionHours };
  });

  ipcMain.handle('window:open-main', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(true);
    else { mainWindow.show(); mainWindow.focus(); }
    return { ok: true };
  });
  ipcMain.handle('window:open-settings', (_event, preferredMode) => { createSetupWindow('', preferredMode); return { ok: true }; });
  ipcMain.handle('window:close-setup', () => {
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
    return { ok: true };
  });
  ipcMain.handle('window:minimize-float', () => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.minimize();
    return { ok: true };
  });
  ipcMain.handle('window:quit', () => { isQuitting = true; app.quit(); });
}

app.whenReady().then(async () => {
  registerIpc();
  settings = loadSettings();
  if (!settings) {
    createSetupWindow();
    return;
  }
  try {
    config = await initializeRuntime(settings);
    createAppWindows();
  } catch (error) {
    console.error('初始化服务器失败', error);
    createSetupWindow(error.message);
  }
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  if (embeddedApp) embeddedApp.stopCleanupTimer();
  if (embeddedServer) embeddedServer.close();
  if (p2pSettingsTimer) clearInterval(p2pSettingsTimer);
  if (p2pStore) p2pStore.stopCleanupTimer();
  if (p2pServer) p2pServer.close();
  if (p2pController) p2pController.stopNow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (!settings) createSetupWindow();
  else if (!miniWindow || miniWindow.isDestroyed()) createMiniWindow();
  else { miniWindow.restore(); miniWindow.show(); }
});
