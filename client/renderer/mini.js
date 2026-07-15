'use strict';

const $ = (selector) => document.querySelector(selector);
const connection = $('#connection');
const dropZone = $('#dropZone');
const textInput = $('#textInput');
const sendText = $('#sendText');
const activity = $('#activity');
let activityTimer;

function showActivity(message, isError = false, duration = 2800) {
  activity.textContent = String(message || (isError ? '操作失败' : '操作完成'));
  activity.classList.toggle('error', isError);
  activity.hidden = false;
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => { activity.hidden = true; }, duration);
}

function setConnection(online, label) {
  connection.className = `connection ${online ? 'online' : 'offline'}`;
  connection.querySelector('b').textContent = label || (online ? '设备组已连接' : '当前离线');
}

async function checkConnection() {
  try {
    await window.meshuttle.listItems();
    setConnection(true, '投递箱已连接');
  } catch { setConnection(false, '当前离线，正在重试'); }
}

async function submitText(value) {
  const text = String(value || '').trim();
  if (!text) { showActivity('请先输入要发送的文字', true); textInput.focus(); return; }
  sendText.disabled = true;
  sendText.textContent = '发送中';
  try {
    await window.meshuttle.createText(text);
    textInput.value = '';
    setConnection(true, '投递箱已连接');
    showActivity('文字已发送到投递箱');
  } catch (error) {
    setConnection(false, '发送失败');
    showActivity(error.message, true, 4500);
  } finally { sendText.disabled = false; sendText.textContent = '发送'; }
}

async function upload(fileList) {
  const paths = Array.from(fileList || []).map((file) => window.meshuttle.getPathForFile(file)).filter(Boolean);
  if (paths.length === 0) return;
  $('#chooseFileMini').disabled = true;
  showActivity(`准备发送 ${paths.length} 个文件…`, false, 30000);
  try {
    await window.meshuttle.uploadFiles(paths);
    setConnection(true, '投递箱已连接');
    showActivity(`${paths.length} 个文件已发送`);
  } catch (error) {
    setConnection(false, '发送失败');
    showActivity(error.message, true, 4500);
  } finally { $('#chooseFileMini').disabled = false; $('#miniFileInput').value = ''; }
}

for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, (event) => { event.preventDefault(); if (eventName === 'drop' || event.relatedTarget === null) dropZone.classList.remove('dragging'); });
dropZone.addEventListener('drop', (event) => {
  if (event.dataTransfer.files.length > 0) upload(event.dataTransfer.files);
  else submitText(event.dataTransfer.getData('text/plain'));
});

sendText.addEventListener('click', () => submitText(textInput.value));
textInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submitText(textInput.value); } });
$('#focusText').addEventListener('click', () => textInput.focus());
$('#chooseFileMini').addEventListener('click', () => $('#miniFileInput').click());
$('#miniFileInput').addEventListener('change', (event) => upload(event.target.files));
$('#openMain').addEventListener('click', () => window.meshuttle.openMainWindow());
$('#settings').addEventListener('click', () => window.meshuttle.openSettings());
$('#minimize').addEventListener('click', () => window.meshuttle.minimizeFloat());
$('#quit').addEventListener('click', () => window.meshuttle.quitApp());

window.meshuttle.onUploadProgress(({ index, total, name }) => { showActivity(`正在发送 ${index + 1}/${total}：${name}`, false, 30000); });
checkConnection();
setInterval(checkConnection, 5000);
