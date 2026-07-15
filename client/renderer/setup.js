'use strict';

const $ = (selector) => document.querySelector(selector);
let activeMode = 'remote';
let p2pAction = 'create';
let caSourcePath = '';
let invitePath = '';
let p2pConfigured = false;
let statusTimer;

function showStatus(message, isError = false) {
  const status = $('#status');
  status.textContent = String(message || (isError ? '操作失败' : '操作完成'));
  status.classList.toggle('error', isError);
  status.hidden = false;
}

function setMode(mode) {
  if (!['remote', 'host', 'p2p'].includes(mode)) return;
  activeMode = mode;
  for (const button of document.querySelectorAll('[data-mode]')) {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  $('#remoteForm').hidden = mode !== 'remote';
  $('#hostForm').hidden = mode !== 'host';
  $('#p2pPanel').hidden = mode !== 'p2p';
  $('#status').hidden = true;
  if (mode === 'p2p' && p2pConfigured) refreshP2PStatus(false);
}

function setP2PAction(action) {
  p2pAction = action;
  for (const button of document.querySelectorAll('[data-p2p-action]')) {
    const active = button.dataset.p2pAction === action;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  $('#p2pCreateFields').hidden = action !== 'create';
  $('#p2pJoinFields').hidden = action !== 'join';
  $('#p2pGroupName').required = action === 'create';
  $('#p2pRetentionDays').required = action === 'create';
  $('#p2pSubmit').textContent = action === 'create' ? '创建设备组' : '加入设备组';
}

function randomAccessToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function initialize() {
  const current = await window.meshuttle.getSetup();
  $('#serverUrl').value = current.serverUrl || '';
  $('#remoteToken').value = current.accessToken || '';
  $('#hostToken').value = current.accessToken || randomAccessToken();
  $('#hostPort').value = current.port || 8787;
  $('#retentionDays').value = current.retentionDays || 3;
  $('#p2pDeviceName').value = current.deviceName || '';
  $('#p2pGroupName').value = current.groupName || '';
  $('#p2pRetentionDays').value = Math.max(1, Math.round((current.retentionHours || 72) / 24));
  p2pConfigured = Boolean(current.p2pConfigured);
  $('#p2pOnboarding').hidden = p2pConfigured;
  $('#p2pManager').hidden = !p2pConfigured;
  if (current.caConfigured) $('#certName').value = '已保存服务器证书';
  if (current.lanUrls && current.lanUrls.length > 0) renderLanUrls(current.lanUrls);
  setP2PAction('create');
  const params = new URLSearchParams(location.search);
  const preferredMode = params.get('mode');
  setMode(['remote', 'host', 'p2p'].includes(preferredMode) ? preferredMode : (current.mode || 'remote'));
  if (p2pConfigured) {
    await refreshP2PStatus(false);
    statusTimer = setInterval(() => { if (activeMode === 'p2p') refreshP2PStatus(true); }, 3000);
  }
  if (params.get('error')) showStatus(params.get('error'), true);
}

function renderLanUrls(urls) {
  $('#lanBox').hidden = false;
  $('#lanUrls').replaceChildren(...urls.map((url) => {
    const code = document.createElement('code');
    code.textContent = url;
    return code;
  }));
}

function deviceRow(member) {
  const row = document.createElement('div');
  row.className = 'device-row';
  const dot = document.createElement('span');
  dot.className = `device-dot ${member.connected ? 'online' : ''}`;
  const copy = document.createElement('div');
  copy.className = 'device-copy';
  const name = document.createElement('b');
  name.textContent = `${member.displayName || member.name}${member.local ? '（本机）' : ''}`;
  const detail = document.createElement('span');
  detail.textContent = member.local ? '本机完整副本' : (member.connected ? `在线 · ${connectionLabel(member.connectionType)}` : '离线 · 上线后自动补齐');
  copy.append(name, detail);
  row.append(dot, copy);
  return row;
}

function pendingRow(pending) {
  const row = document.createElement('div');
  row.className = 'device-row';
  const dot = document.createElement('span');
  dot.className = `device-dot ${pending.verified ? 'online' : ''}`;
  const copy = document.createElement('div');
  copy.className = 'device-copy';
  const name = document.createElement('b');
  name.textContent = pending.displayName || pending.name || '未知设备';
  const detail = document.createElement('span');
  detail.textContent = pending.verified ? '邀请验证通过，等待你的批准' : '没有有效邀请证明，禁止加入';
  copy.append(name, detail);
  const approve = document.createElement('button');
  approve.type = 'button';
  approve.textContent = pending.verified ? '允许加入' : '未通过验证';
  approve.disabled = !pending.verified;
  approve.addEventListener('click', async () => {
    if (!window.confirm(`允许“${pending.displayName || pending.name || '未知设备'}”加入并读取设备组内容吗？`)) return;
    approve.disabled = true;
    approve.textContent = '正在批准…';
    try {
      await window.meshuttle.approveP2PDevice(pending.deviceId);
      showStatus(`${pending.displayName || '新设备'}已加入设备组`);
      await refreshP2PStatus(false);
    } catch (error) { showStatus(error.message, true); approve.disabled = false; approve.textContent = '允许加入'; }
  });
  row.append(dot, copy, approve);
  return row;
}

function connectionLabel(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('relay')) return '加密公共中继';
  if (value.includes('quic')) return 'QUIC 直连';
  if (value.includes('tcp')) return 'TCP 直连';
  return '已连接';
}

async function refreshP2PStatus(silent) {
  if (!p2pConfigured) return;
  try {
    const result = await window.meshuttle.getP2PStatus();
    $('#currentGroupName').textContent = result.groupName;
    $('#currentGroupId').textContent = result.groupId;
    $('#memberList').replaceChildren(...result.members.map(deviceRow));
    $('#pendingSection').hidden = result.pending.length === 0;
    $('#pendingList').replaceChildren(...result.pending.map(pendingRow));
    const hours = Number(result.retentionHours || 72);
    if (hours % 24 === 0) { $('#p2pRetentionUnit').value = '24'; $('#p2pRetentionAmount').value = hours / 24; }
    else { $('#p2pRetentionUnit').value = '1'; $('#p2pRetentionAmount').value = hours; }
  } catch (error) { if (!silent) showStatus(error.message, true); }
}

for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => setMode(button.dataset.mode));
for (const button of document.querySelectorAll('[data-p2p-action]')) button.addEventListener('click', () => setP2PAction(button.dataset.p2pAction));
$('#randomToken').addEventListener('click', () => { $('#hostToken').value = randomAccessToken(); showStatus('已生成新的随机访问码'); });
$('#chooseCert').addEventListener('click', () => $('#certInput').click());
$('#certInput').addEventListener('change', (event) => { const file = event.target.files[0]; if (!file) return; caSourcePath = window.meshuttle.getPathForFile(file); $('#certName').value = file.name; });
$('#chooseInvite').addEventListener('click', () => $('#p2pInviteInput').click());
$('#p2pInviteInput').addEventListener('change', (event) => { const file = event.target.files[0]; if (!file) return; invitePath = window.meshuttle.getPathForFile(file); $('#p2pInviteName').value = file.name; });

$('#remoteForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true; button.textContent = '正在验证…'; showStatus('正在验证服务器地址和访问码…');
  try { await window.meshuttle.saveSetup({ mode:'remote', serverUrl:$('#serverUrl').value.trim(), accessToken:$('#remoteToken').value.trim(), caSourcePath }); }
  catch (error) { showStatus(error.message, true); button.disabled = false; button.textContent = '验证并保存连接'; }
});

$('#hostForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  if (button.dataset.started === 'true') return window.meshuttle.closeSetup();
  button.disabled = true; button.textContent = '正在启动…'; showStatus('正在启动本机服务器…');
  try {
    const result = await window.meshuttle.saveSetup({ mode:'host', port:Number($('#hostPort').value), retentionDays:Number($('#retentionDays').value), accessToken:$('#hostToken').value.trim() });
    renderLanUrls(result.lanUrls); showStatus('本机服务器已启动，请把地址和访问码填到其他电脑。'); button.textContent = '完成并关闭设置'; button.dataset.started = 'true'; button.disabled = false;
  } catch (error) { showStatus(error.message, true); button.disabled = false; button.textContent = '启动本机服务器'; }
});

$('#p2pForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  if (p2pAction === 'join' && !invitePath) { showStatus('请先选择现有设备生成的 .tdjoin 邀请文件', true); return; }
  button.disabled = true; button.textContent = p2pAction === 'create' ? '正在创建…' : '正在加入…';
  showStatus(p2pAction === 'create' ? '正在创建设备组和本机身份…' : '正在加入设备组并连接邀请设备…');
  try { await window.meshuttle.saveSetup({ mode:'p2p', p2pAction, deviceName:$('#p2pDeviceName').value.trim(), groupName:$('#p2pGroupName').value.trim(), retentionHours:Number($('#p2pRetentionDays').value) * 24, invitePath }); }
  catch (error) { showStatus(error.message, true); button.disabled = false; button.textContent = p2pAction === 'create' ? '创建设备组' : '加入设备组'; }
});

$('#createInvite').addEventListener('click', async () => {
  const button = $('#createInvite'); button.disabled = true; button.textContent = '正在生成邀请…';
  try { const result = await window.meshuttle.createP2PInvite(); if (!result.canceled) showStatus(`邀请已保存：${result.filePath}`); }
  catch (error) { showStatus(error.message, true); }
  finally { button.disabled = false; button.textContent = '生成新设备邀请'; }
});

$('#saveRetention').addEventListener('click', async () => {
  const button = $('#saveRetention'); button.disabled = true; button.textContent = '正在保存…';
  try { const hours = Number($('#p2pRetentionAmount').value) * Number($('#p2pRetentionUnit').value); const result = await window.meshuttle.updateP2PRetention(hours); showStatus(`新内容留存时长已更新为 ${result.retentionHours} 小时`); }
  catch (error) { showStatus(error.message, true); }
  finally { button.disabled = false; button.textContent = '保存留存时长'; }
});

$('#finishP2P').addEventListener('click', () => window.meshuttle.closeSetup());
window.meshuttle.onSetupMode((mode) => setMode(mode));
window.addEventListener('beforeunload', () => { if (statusTimer) clearInterval(statusTimer); });
initialize().catch((error) => showStatus(error.message, true));
