'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tikEffectWindow', {
    minimize() { ipcRenderer.send('control-window:minimize'); },
    toggleMax() { ipcRenderer.send('control-window:toggle-max'); },
    close() { ipcRenderer.send('control-window:close'); }
});
