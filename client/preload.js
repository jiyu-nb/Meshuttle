'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('meshuttle', {
  listItems: () => ipcRenderer.invoke('items:list'),
  createText: (text) => ipcRenderer.invoke('text:create', text),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  uploadFiles: (paths) => ipcRenderer.invoke('files:upload', paths),
  downloadItem: (item) => ipcRenderer.invoke('item:download', { id: item.id, name: item.name }),
  downloadItems: (items) => ipcRenderer.invoke('items:download-many', items.map((item) => ({ id: item.id, name: item.name }))),
  deleteItem: (id) => ipcRenderer.invoke('item:delete', id),
  getSetup: () => ipcRenderer.invoke('setup:get'),
  saveSetup: (payload) => ipcRenderer.invoke('setup:save', payload),
  getP2PStatus: () => ipcRenderer.invoke('p2p:status'),
  createP2PInvite: () => ipcRenderer.invoke('p2p:create-invite'),
  approveP2PDevice: (deviceId) => ipcRenderer.invoke('p2p:approve-device', deviceId),
  updateP2PRetention: (retentionHours) => ipcRenderer.invoke('p2p:update-retention', retentionHours),
  openMainWindow: () => ipcRenderer.invoke('window:open-main'),
  openSettings: (preferredMode) => ipcRenderer.invoke('window:open-settings', preferredMode),
  closeSetup: () => ipcRenderer.invoke('window:close-setup'),
  minimizeFloat: () => ipcRenderer.invoke('window:minimize-float'),
  quitApp: () => ipcRenderer.invoke('window:quit'),
  onUploadProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('upload:progress', listener);
    return () => ipcRenderer.removeListener('upload:progress', listener);
  },
  onDownloadProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('download:progress', listener);
    return () => ipcRenderer.removeListener('download:progress', listener);
  },
  onSetupMode: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on('setup:select-mode', listener);
    return () => ipcRenderer.removeListener('setup:select-mode', listener);
  }
});
