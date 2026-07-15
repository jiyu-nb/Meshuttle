'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  INVITE_SCHEMA,
  createInvitePayload,
  decodeDeviceName,
  encodeDeviceName,
  inviteProof,
  parseInvite
} = require('../p2p/group');

const deviceId = 'AAAAAAA-BBBBBBB-CCCCCCC-DDDDDDD-EEEEEEE-FFFFFFF-GGGGGGG-2222222';

test('Meshuttle device display names and join proofs round-trip', () => {
  const proof = inviteProof('a'.repeat(48), deviceId);
  const encoded = encodeDeviceName('办公室电脑', proof);
  const decoded = decodeDeviceName(encoded);
  assert.equal(decoded.displayName, '办公室电脑');
  assert.equal(decoded.proof, proof);
  assert.match(encoded, /^MSH1\|/);
});

test('Meshuttle invitations reject tampering and expiration', () => {
  const settings = {
    groupId: 'ms-test-group',
    groupName: '我的设备组',
    deviceName: '创建者电脑',
    retentionHours: 72
  };
  const invite = createInvitePayload(settings, deviceId, 'b'.repeat(48), new Date(Date.now() + 60_000));
  assert.equal(invite.schema, INVITE_SCHEMA);
  assert.equal(parseInvite(JSON.stringify(invite)).groupName, settings.groupName);

  assert.throws(() => parseInvite({ ...invite, groupName: '被篡改的设备组' }), /校验失败/);
  const expired = createInvitePayload(settings, deviceId, 'c'.repeat(48), new Date(Date.now() - 1));
  assert.throws(() => parseInvite(expired), /过期/);
});
