'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mydesktop', {
    rendererReady: () => ipcRenderer.invoke('mydesktop:renderer-ready'),
    getSettings: () => ipcRenderer.invoke('mydesktop:get-settings'),
    setWatchedScreen: (screenNum) => ipcRenderer.invoke('mydesktop:set-watched-screen', screenNum),
    setScreenOffset: (screenNum, seconds) => ipcRenderer.invoke('mydesktop:set-screen-offset', screenNum, seconds),

    onConnectionState: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('mydesktop:connection-state', listener);
        return () => ipcRenderer.removeListener('mydesktop:connection-state', listener);
    },
    onVideoPlaying: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('mydesktop:video-playing', listener);
        return () => ipcRenderer.removeListener('mydesktop:video-playing', listener);
    }
});
