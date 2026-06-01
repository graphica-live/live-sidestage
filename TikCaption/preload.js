'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  getASRStatus: () => ipcRenderer.invoke('get-asr-status'),
  restartASR: () => ipcRenderer.invoke('restart-asr'),
  getDevices: () => ipcRenderer.invoke('get-devices'),
  onASRStatus: (cb) => {
    ipcRenderer.on('asr-status', (_e, data) => cb(data));
  },
});
