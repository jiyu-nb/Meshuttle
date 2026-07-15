'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { validateDeviceId, validateFolderId } = require('./syncthing');

const INVITE_SCHEMA = 'meshuttle.join.v1';

function encodeDeviceName(displayName, proof = 'member') {
  const clean = String(displayName || '我的电脑').trim().slice(0, 24);
  const encoded = Buffer.from(clean, 'utf8').toString('base64url').slice(0, 40);
  return `MSH1|${encoded}|${String(proof).slice(0, 20)}`.slice(0, 64);
}

function decodeDeviceName(value) {
  const raw = String(value || '');
  const match = raw.match(/^MSH1\|([A-Za-z0-9_-]+)\|([A-Za-z0-9_-]+)$/);
  if (!match) return { displayName: raw || '未知设备', proof: '' };
  let displayName = '未知设备';
  try { displayName = Buffer.from(match[1], 'base64url').toString('utf8') || displayName; } catch {}
  return { displayName, proof: match[2] };
}

function inviteProof(token, deviceId) {
  return crypto.createHmac('sha256', String(token)).update(validateDeviceId(deviceId)).digest('base64url').slice(0, 20);
}

function createInvitePayload(settings, parentDeviceId, token, expiresAt) {
  const payload = {
    schema: INVITE_SCHEMA,
    version: 1,
    groupId: validateFolderId(settings.groupId),
    groupName: String(settings.groupName || '织梭设备组').slice(0, 64),
    parentDeviceId: validateDeviceId(parentDeviceId),
    parentName: String(settings.deviceName || '邀请设备').slice(0, 24),
    retentionHours: clampRetentionHours(settings.retentionHours),
    token: String(token),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(expiresAt).toISOString()
  };
  payload.checksum = checksumPayload(payload);
  return payload;
}

function parseInvite(input) {
  const payload = typeof input === 'string' ? JSON.parse(input) : input;
  if (!payload || payload.schema !== INVITE_SCHEMA || payload.version !== 1) throw new Error('不是有效的 Meshuttle 邀请文件');
  validateFolderId(payload.groupId);
  validateDeviceId(payload.parentDeviceId);
  if (String(payload.token || '').length < 32) throw new Error('邀请密钥无效');
  if (checksumPayload(payload) !== payload.checksum) throw new Error('邀请文件校验失败');
  if (!Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) <= Date.now()) throw new Error('邀请已经过期，请重新生成');
  return {
    ...payload,
    groupName: String(payload.groupName || '织梭设备组').slice(0, 64),
    parentName: String(payload.parentName || '邀请设备').slice(0, 24),
    retentionHours: clampRetentionHours(payload.retentionHours)
  };
}

function checksumPayload(payload) {
  const fields = [
    payload.schema,
    payload.version,
    payload.groupId,
    payload.groupName,
    payload.parentDeviceId,
    payload.parentName,
    payload.retentionHours,
    payload.token,
    payload.createdAt,
    payload.expiresAt
  ];
  return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('base64url');
}

function clampRetentionHours(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 24 * 365) return 72;
  return number;
}

async function writeGroupSettings(dataDir, value) {
  const directory = path.join(path.resolve(dataDir), 'control', 'settings');
  await fsp.mkdir(directory, { recursive: true });
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const event = {
    schema: 'meshuttle.settings.v1',
    id,
    groupId: validateFolderId(value.groupId),
    groupName: String(value.groupName || '织梭设备组').slice(0, 64),
    retentionHours: clampRetentionHours(value.retentionHours),
    actor: String(value.actor || ''),
    createdAt: new Date().toISOString()
  };
  const temporary = path.join(directory, `.incoming-${id}.json`);
  const destination = path.join(directory, `${id}.json`);
  await fsp.writeFile(temporary, `${JSON.stringify(event, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fsp.rename(temporary, destination);
  return event;
}

function readLatestGroupSettings(dataDir, expectedGroupId) {
  const directory = path.join(path.resolve(dataDir), 'control', 'settings');
  try {
    const events = [];
    for (const name of fs.readdirSync(directory)) {
      if (!/^\d+-[0-9a-f-]{36}\.json$/i.test(name)) continue;
      try {
        const event = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        if (event.schema === 'meshuttle.settings.v1' && event.groupId === expectedGroupId) events.push(event);
      } catch {}
    }
    events.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    return events[0] || null;
  } catch {
    return null;
  }
}

module.exports = {
  INVITE_SCHEMA,
  clampRetentionHours,
  createInvitePayload,
  decodeDeviceName,
  encodeDeviceName,
  inviteProof,
  parseInvite,
  readLatestGroupSettings,
  writeGroupSettings
};
