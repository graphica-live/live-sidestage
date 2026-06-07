'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  saveSettingsSync: (data) => ipcRenderer.sendSync('save-settings-sync', data),
  getASRStatus: () => ipcRenderer.invoke('get-asr-status'),
  restartASR: () => ipcRenderer.invoke('restart-asr'),
  getDevices: () => ipcRenderer.invoke('get-devices'),
  startASR: () => ipcRenderer.invoke('start-asr'),
  stopASR: () => ipcRenderer.invoke('stop-asr'),
  pauseASR: () => ipcRenderer.invoke('pause-asr'),
  onASRStatus: (cb) => {
    ipcRenderer.on('asr-status', (_e, data) => cb(data));
  },
  onASRPaused: (cb) => {
    ipcRenderer.on('asr-paused', (_e, paused) => cb(paused));
  },
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('update-available', (_e, info) => cb(info));
  },
  onUpdateDownloaded: (cb) => {
    ipcRenderer.on('update-downloaded', (_e, info) => cb(info));
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),
  // TTS
  startTts: (userId) => ipcRenderer.invoke('tts-start', userId),
  stopTts: () => ipcRenderer.invoke('tts-stop'),
  getTtsStatus: () => ipcRenderer.invoke('tts-get-status'),
  onTtsStatus: (cb) => { ipcRenderer.on('tts-status', (_e, data) => cb(data)); },
  onTtsComment: (cb) => { ipcRenderer.on('tts-comment', (_e, data) => cb(data)); },
  onTtsPaused: (cb) => { ipcRenderer.on('tts-paused', (_e, paused) => cb(paused)); },
  onTtsEmote: (cb) => { ipcRenderer.on('tts-emote', (_e, data) => cb(data)); },
  checkVoicevox: () => ipcRenderer.invoke('check-voicevox'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openAudioDuckingSettings: () => ipcRenderer.invoke('open-audio-ducking-settings'),
});
