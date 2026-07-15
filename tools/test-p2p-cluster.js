'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { createP2PStore } = require('../client/p2p/store');
const { SyncthingController } = require('../client/p2p/syncthing');
const { encodeDeviceName, inviteProof } = require('../client/p2p/group');

const root = path.resolve(__dirname, '..', '.tmp', 'p2p-cluster-integration');
const syncthingExecutable = process.platform === 'win32' ? 'syncthing.exe' : 'syncthing';
const binaryPath = path.resolve(__dirname, '..', 'client', 'vendor', 'syncthing', syncthingExecutable);
const folderId = `ms-integration-${Date.now()}`;
const token = 'integration-local-api-token-long-enough';
const nodes = [];
const stores = [];

async function main() {
  await fsp.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  await fsp.mkdir(root, { recursive: true });
  try {
    progress('启动三个独立 Syncthing 节点');
    for (const name of ['母机 A', '子机 B', '子机 C']) {
      const slug = name.slice(-1);
      const controller = new SyncthingController({
        binaryPath,
        homeDir: path.join(root, slug, 'syncthing')
      });
      await controller.start();
      const syncPort = await findFreePort();
      const syncAddress = `tcp://127.0.0.1:${syncPort}`;
      await controller.api('PATCH', '/rest/config/options', {
        listenAddresses: [syncAddress],
        globalAnnounceEnabled: false,
        localAnnounceEnabled: false,
        relaysEnabled: false,
        natEnabled: false
      });
      await delay(500);
      nodes.push({ name, slug, controller, syncAddress, dataDir: path.join(root, slug, 'shared') });
    }

    const [mother, childB, childC] = nodes;
    const inviteB = crypto.randomBytes(32).toString('base64url');
    const inviteC = crypto.randomBytes(32).toString('base64url');
    await mother.controller.configureLocalDevice(encodeDeviceName(mother.name, 'owner'));
    await childB.controller.configureLocalDevice(encodeDeviceName(childB.name, inviteProof(inviteB, childB.controller.deviceId)));
    await childC.controller.configureLocalDevice(encodeDeviceName(childC.name, inviteProof(inviteC, childC.controller.deviceId)));

    await mother.controller.ensureFolder({ folderId, label: 'Meshuttle 集成测试', path: mother.dataDir, deviceIds: [] });
    for (const child of [childB, childC]) {
      await child.controller.ensureDevice({
        deviceId: mother.controller.deviceId,
        name: encodeDeviceName(mother.name, 'owner'),
        addresses: [mother.syncAddress],
        introducer: true,
        skipIntroductionRemovals: true
      });
      await child.controller.ensureFolder({
        folderId,
        label: 'Meshuttle 集成测试',
        path: child.dataDir,
        deviceIds: [mother.controller.deviceId]
      });
    }

    progress('等待母机收到两个带邀请码证明的待加入设备');
    const pending = await waitFor(async () => {
      const values = await mother.controller.pendingDevices();
      return values.length >= 2 ? values : null;
    }, 90_000, '母机没有收到子机加入请求');
    const proofs = new Map([
      [childB.controller.deviceId, inviteProof(inviteB, childB.controller.deviceId)],
      [childC.controller.deviceId, inviteProof(inviteC, childC.controller.deviceId)]
    ]);
    const childAddresses = new Map([
      [childB.controller.deviceId, childB.syncAddress],
      [childC.controller.deviceId, childC.syncAddress]
    ]);
    for (const entry of pending) {
      if (!proofs.has(entry.deviceId)) continue;
      if (!String(entry.name).endsWith(proofs.get(entry.deviceId))) throw new Error(`邀请码证明不匹配：${entry.deviceId}`);
      await mother.controller.ensureDevice({
        deviceId: entry.deviceId,
        name: entry.name,
        addresses: [childAddresses.get(entry.deviceId)],
        skipIntroductionRemovals: true
      });
      await mother.controller.shareFolder(folderId, entry.deviceId);
    }

    for (const node of nodes) {
      const store = createP2PStore({
        dataDir: node.dataDir,
        token,
        originDeviceId: node.controller.deviceId,
        retentionMs: 60_000,
        onChange: () => node.controller.scan(folderId)
      });
      stores.push(store);
    }

    progress('从母机投递内容并等待两个子机完整复制');
    const first = await stores[0].createText('母机创建的内容');
    await mother.controller.scan(folderId);
    await waitFor(async () => {
      const [itemsB, itemsC] = await Promise.all([stores[1].listItems(), stores[2].listItems()]);
      return itemsB.some((item) => item.id === first.id) && itemsC.some((item) => item.id === first.id);
    }, 90_000, '子机没有收到母机内容');

    progress('等待介绍者把两个子机互相加入完整网状连接');
    await waitFor(async () => {
      const [statusB, statusC] = await Promise.all([
        childB.controller.groupStatus(folderId),
        childC.controller.groupStatus(folderId)
      ]);
      const bKnowsC = statusB.members.some((member) => member.deviceId === childC.controller.deviceId);
      const cKnowsB = statusC.members.some((member) => member.deviceId === childB.controller.deviceId);
      return bKnowsC && cKnowsB;
    }, 90_000, '子机没有通过介绍者互相发现');

    progress('关闭母机，验证剩余子机仍能直接同步');
    await mother.controller.stop();
    const afterFailover = await stores[1].createText('母机退出后的内容');
    await childB.controller.scan(folderId);
    await waitFor(async () => {
      const itemsC = await stores[2].listItems();
      return itemsC.some((item) => item.id === afterFailover.id);
    }, 90_000, '母机退出后子机之间未能继续同步');

    const finalStatus = await childC.controller.groupStatus(folderId);
    const peer = finalStatus.members.find((member) => member.deviceId === childB.controller.deviceId);
    console.log(JSON.stringify({
      ok: true,
      folderId,
      replicatedBeforeFailure: true,
      replicatedAfterMotherStopped: true,
      childPeerConnected: Boolean(peer?.connected),
      childConnectionType: peer?.connectionType || ''
    }, null, 2));
  } finally {
    for (const store of stores) store.stopCleanupTimer();
    await Promise.all(nodes.map((node) => node.controller.stop().catch(() => {})));
  }
  await fsp.rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

async function waitFor(check, timeoutMs, errorMessage) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${errorMessage}${lastError ? `：${lastError.message}` : ''}`);
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function progress(message) {
  console.log(`[P2P TEST] ${message}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
