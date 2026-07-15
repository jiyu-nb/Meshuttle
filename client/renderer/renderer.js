'use strict';

const $ = (selector) => document.querySelector(selector);
const feed = $('#feed');
const empty = $('#empty');
const connection = $('#connection');
const dropZone = $('#dropZone');
const textInput = $('#textInput');
const sendText = $('#sendText');
const progress = $('#progress');
const selectedIds = new Set();
let currentItems = [];
let loading = false;
let toastTimer;
let setupMode = 'remote';

function showToast(message, isError = false, duration = 3200) {
  const toast = $('#toast');
  toast.textContent = String(message || (isError ? '操作失败' : '操作完成'));
  toast.classList.toggle('error', isError);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}

function setConnection(online, label) {
  connection.className = `connection ${online ? 'online' : 'offline'}`;
  connection.querySelector('b').textContent = label || (online ? '已连接' : '连接失败');
  const side = document.querySelector('.side-status');
  side.className = `side-status ${online ? 'online' : 'offline'}`;
  $('#sideStatus').textContent = label || (online ? '已连接' : '连接失败');
}

function formatSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function timeLeft(expiresAt) {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '即将清理';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.max(1, Math.floor((ms % 3600000) / 60000));
  if (hours >= 24) return `剩余 ${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
  return hours > 0 ? `剩余 ${hours} 小时 ${minutes} 分` : `剩余 ${minutes} 分钟`;
}

function formatCreatedAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function actionButton(label, className, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  if (className) element.className = className;
  element.addEventListener('click', async () => {
    const original = element.textContent;
    element.disabled = true;
    element.textContent = '处理中…';
    try { await action(); } catch (error) { showToast(error.message, true, 5000); }
    finally { element.disabled = false; element.textContent = original; }
  });
  return element;
}

function updateBatchControls() {
  const selected = currentItems.filter((item) => selectedIds.has(item.id));
  const selectedFiles = selected.filter((item) => item.type === 'file');
  $('#selectAll').disabled = currentItems.length === 0;
  $('#selectAll').textContent = selected.length === currentItems.length && currentItems.length > 0 ? '取消全选' : '全选内容';
  $('#downloadSelected').disabled = selectedFiles.length === 0;
  $('#downloadSelected').textContent = selectedFiles.length ? `下载所选文件 (${selectedFiles.length})` : '下载所选文件';
  $('#deleteSelected').disabled = selected.length === 0;
  $('#deleteSelected').textContent = selected.length ? `删除所选 (${selected.length})` : '删除所选';
  $('#selectionInfo').hidden = selected.length === 0;
  $('#selectionInfo').textContent = `已选择 ${selected.length} 项`;
}

function itemCheckbox(item, card) {
  const label = document.createElement('label');
  label.className = 'item-check';
  label.title = `选择${item.type === 'file' ? '文件' : '文字'} ${item.name || ''}`.trim();
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('aria-label', label.title);
  input.checked = selectedIds.has(item.id);
  input.addEventListener('change', () => {
    if (input.checked) selectedIds.add(item.id);
    else selectedIds.delete(item.id);
    card.classList.toggle('selected', input.checked);
    updateBatchControls();
  });
  const mark = document.createElement('span');
  label.append(input, mark);
  return label;
}

function render(items) {
  currentItems = Array.isArray(items) ? items : [];
  const validIds = new Set(currentItems.map((item) => item.id));
  for (const id of selectedIds) if (!validIds.has(id)) selectedIds.delete(id);
  feed.replaceChildren();
  feed.setAttribute('aria-busy', 'false');
  empty.hidden = currentItems.length !== 0;
  $('#itemCount').textContent = `共 ${currentItems.length} 项`;

  for (const item of currentItems) {
    const card = document.createElement('article');
    card.className = `item${selectedIds.has(item.id) ? ' selected' : ''}`;
    const head = document.createElement('div');
    head.className = 'item-head';
    const main = document.createElement('div');
    main.className = 'item-main';
    main.append(itemCheckbox(item, card));

    const kind = document.createElement('div');
    kind.className = 'kind';
    kind.textContent = item.type === 'file' ? '文件' : '文字';
    const labels = document.createElement('div');
    labels.className = 'item-labels';
    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = item.type === 'file' ? item.name : '文字投递';
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    const parts = item.type === 'file' ? [formatSize(item.size)] : [];
    const created = formatCreatedAt(item.createdAt);
    if (created) parts.push(created);
    parts.push(timeLeft(item.expiresAt));
    meta.textContent = parts.join(' · ');
    labels.append(title, meta);
    main.append(kind, labels);

    const actions = document.createElement('div');
    actions.className = 'item-actions';
    if (item.type === 'file') {
      actions.append(actionButton('下载文件', '', async () => {
        const result = await window.meshuttle.downloadItem(item);
        if (!result.canceled) showToast('文件下载完成');
      }));
    } else {
      actions.append(actionButton('复制文字', '', async () => {
        await navigator.clipboard.writeText(item.text);
        showToast('文字已复制');
      }));
    }
    actions.append(actionButton('删除', 'delete', async () => {
      if (!window.confirm(`确定删除这项${item.type === 'file' ? '文件' : '文字'}吗？此操作会同步到其他设备。`)) return;
      await window.meshuttle.deleteItem(item.id);
      selectedIds.delete(item.id);
      await refresh();
      showToast('内容已删除');
    }));
    head.append(main, actions);
    card.append(head);

    if (item.type === 'text') {
      const content = document.createElement('pre');
      content.className = 'text-content';
      content.textContent = item.text;
      card.append(content);
    }
    feed.append(card);
  }
  updateBatchControls();
}

async function refresh(silent = false) {
  if (loading) return;
  loading = true;
  $('#refresh').disabled = true;
  try {
    const result = await window.meshuttle.listItems();
    render(result.items || []);
    if (result.retentionHours) {
      const hours = Number(result.retentionHours);
      $('#retentionCopy').textContent = `内容会同步到在线设备，并在 ${hours % 24 === 0 ? `${hours / 24} 天` : `${hours} 小时`}后自动清理`;
    }
    if (setupMode === 'p2p') {
      try {
        const status = await window.meshuttle.getP2PStatus();
        const online = status.members.filter((member) => member.connected).length;
        setConnection(true, `${online} 台设备在线`);
        $('#modeDescription').textContent = `${status.groupName} · 无固定主机设备组`;
      } catch {
        setConnection(true, '设备组已连接');
      }
    } else if (setupMode === 'host') {
      setConnection(true, '本机服务已启动');
      $('#modeDescription').textContent = '这台电脑正在托管局域网投递箱';
    } else {
      setConnection(true, '服务器已连接');
      $('#modeDescription').textContent = '内容由已配置的远程服务器托管';
    }
  } catch (error) {
    setConnection(false, '连接失败');
    $('#itemCount').textContent = '暂时无法加载';
    if (!silent) showToast(error.message, true, 5000);
  } finally {
    loading = false;
    $('#refresh').disabled = false;
  }
}

async function submitText(text) {
  const value = String(text || '').trim();
  if (!value) { showToast('请先输入要发送的文字', true); textInput.focus(); return; }
  sendText.disabled = true;
  sendText.textContent = '发送中…';
  try {
    await window.meshuttle.createText(value);
    textInput.value = '';
    await refresh();
    showToast('文字已发送');
  } catch (error) {
    showToast(error.message, true, 5000);
  } finally {
    sendText.disabled = false;
    sendText.textContent = '发送文字';
  }
}

async function upload(fileList) {
  const files = Array.from(fileList || []);
  const paths = files.map((file) => window.meshuttle.getPathForFile(file)).filter(Boolean);
  if (paths.length === 0) return;
  progress.hidden = false;
  progress.textContent = `准备发送 ${paths.length} 个文件…`;
  $('#chooseFile').disabled = true;
  try {
    await window.meshuttle.uploadFiles(paths);
    await refresh();
    showToast(`${paths.length} 个文件已发送`);
  } catch (error) {
    showToast(error.message, true, 5000);
  } finally {
    progress.hidden = true;
    $('#chooseFile').disabled = false;
    $('#fileInput').value = '';
  }
}

window.meshuttle.onUploadProgress(({ index, total, name }) => { progress.textContent = `正在发送 ${index + 1}/${total}：${name}`; });
window.meshuttle.onDownloadProgress(({ index, total, name }) => { showToast(`正在下载 ${index + 1}/${total}：${name}`, false, 30000); });

for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); if (eventName === 'drop' || event.relatedTarget === null) dropZone.classList.remove('dragging'); });
dropZone.addEventListener('drop', (event) => {
  if (event.dataTransfer.files.length > 0) upload(event.dataTransfer.files);
  else submitText(event.dataTransfer.getData('text/plain'));
});

$('#addText').addEventListener('click', () => { $('#textComposer').scrollIntoView({ behavior: 'smooth', block: 'center' }); textInput.focus(); });
$('#chooseFile').addEventListener('click', () => $('#fileInput').click());
$('#emptyChoose').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', (event) => upload(event.target.files));
sendText.addEventListener('click', () => submitText(textInput.value));
textInput.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submitText(textInput.value); } });
$('#refresh').addEventListener('click', () => refresh());
$('#settings').addEventListener('click', () => window.meshuttle.openSettings());
$('#openLicenses').addEventListener('click', () => window.meshuttle.openLicenses());
$('#openGroup').addEventListener('click', () => window.meshuttle.openSettings('p2p'));
$('#selectAll').addEventListener('click', () => {
  const allSelected = currentItems.length > 0 && currentItems.every((item) => selectedIds.has(item.id));
  for (const item of currentItems) allSelected ? selectedIds.delete(item.id) : selectedIds.add(item.id);
  render(currentItems);
});
$('#downloadSelected').addEventListener('click', async () => {
  const button = $('#downloadSelected');
  const files = currentItems.filter((item) => item.type === 'file' && selectedIds.has(item.id));
  if (!files.length) { showToast('请先选择要下载的文件', true); return; }
  button.disabled = true;
  button.textContent = '下载中…';
  try {
    const result = await window.meshuttle.downloadItems(files);
    if (!result.canceled) showToast(`已下载 ${result.count} 个文件`);
  } catch (error) { showToast(error.message, true, 5000); }
  finally { updateBatchControls(); }
});
$('#deleteSelected').addEventListener('click', async () => {
  const selected = currentItems.filter((item) => selectedIds.has(item.id));
  if (!selected.length) return;
  if (!window.confirm(`确定删除所选 ${selected.length} 项内容吗？删除会同步到其他设备。`)) return;
  const button = $('#deleteSelected');
  button.disabled = true;
  button.textContent = '删除中…';
  try {
    for (const item of selected) await window.meshuttle.deleteItem(item.id);
    selectedIds.clear();
    await refresh();
    showToast(`已删除 ${selected.length} 项内容`);
  } catch (error) { showToast(error.message, true, 5000); }
  finally { updateBatchControls(); }
});

window.meshuttle.getSetup().then((current) => {
  setupMode = current.mode || 'remote';
  $('#versionText').textContent = `v${current.version || '1.1.0'}`;
}).catch(() => {}).finally(() => refresh());
setInterval(() => refresh(true), 4000);
