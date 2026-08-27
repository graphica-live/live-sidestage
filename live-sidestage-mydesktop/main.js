'use strict';

const { app, BrowserWindow, ipcMain, screen: electronScreen } = require('electron');
const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');

const TIKEFFECT_URL = 'http://localhost:38100';
const SETTINGS_VERSION = 1;
const SCREEN_COUNT = 10;
const DEFAULT_WINDOW_SIZE = { width: 480, height: 320 };

const DEFAULT_SETTINGS = {
    version: SETTINGS_VERSION,
    watchedScreen: 1,
    screenOffsets: {},
    windowBounds: null
};

// ---- 単一インスタンスロック ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
    process.exit(0);
}

let mainWindow = null;

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

// ---- userData ディレクトリ(初回起動でも例外にならないよう事前にmkdir) ----
const userDataDir = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'MyDesktop');
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath('userData', userDataDir);

const settingsPath = path.join(userDataDir, 'settings.json');

// ---- 設定の読み書き(atomic write, 破損時はデフォルトへ復旧) ----
function loadSettings() {
    try {
        const raw = fs.readFileSync(settingsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || parsed.version !== SETTINGS_VERSION) {
            return { ...DEFAULT_SETTINGS };
        }
        return {
            version: SETTINGS_VERSION,
            watchedScreen: normalizeScreen(parsed.watchedScreen),
            screenOffsets: normalizeScreenOffsets(parsed.screenOffsets),
            windowBounds: normalizeWindowBounds(parsed.windowBounds)
        };
    } catch (err) {
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings) {
    const tmpPath = settingsPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tmpPath, settingsPath);
}

function normalizeScreen(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1 || n > SCREEN_COUNT) return DEFAULT_SETTINGS.watchedScreen;
    return n;
}

function normalizeOffsetSeconds(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
}

function normalizeScreenOffsets(value) {
    const result = {};
    if (value && typeof value === 'object') {
        for (const [key, val] of Object.entries(value)) {
            const screenNum = normalizeScreen(key);
            result[String(screenNum)] = normalizeOffsetSeconds(val);
        }
    }
    return result;
}

function normalizeWindowBounds(value) {
    if (!value || typeof value !== 'object') return null;
    const { x, y, width, height } = value;
    if ([x, y, width, height].some((n) => !Number.isFinite(n))) return null;
    return { x, y, width, height };
}

let settings = loadSettings();

function getScreenOffset(screenNum) {
    return settings.screenOffsets[String(screenNum)] || 0;
}

// ---- ウィンドウ位置の可視領域クランプ ----
function clampBoundsToVisibleDisplay(bounds) {
    if (!bounds) return null;
    const displays = electronScreen.getAllDisplays();
    const fitsAnyDisplay = displays.some((display) => {
        const area = display.workArea;
        return (
            bounds.x >= area.x - bounds.width &&
            bounds.x <= area.x + area.width &&
            bounds.y >= area.y - bounds.height &&
            bounds.y <= area.y + area.height
        );
    });
    return fitsAnyDisplay ? bounds : null;
}

// ---- 接続状態・最新イベントのキャッシュ(main→renderer取りこぼし対策) ----
let connectionState = 'disconnected';
const latestByScreen = {};

function safeSend(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// ---- socket.io-client: TikEffect(常駐アプリ)への片方向接続 ----
const socket = io(TIKEFFECT_URL, {
    reconnection: true,
    reconnectionDelay: 1000
});

socket.on('connect', () => {
    connectionState = 'connected';
    safeSend('mydesktop:connection-state', { state: connectionState });
});

socket.on('disconnect', () => {
    connectionState = 'disconnected';
    safeSend('mydesktop:connection-state', { state: connectionState });
});

socket.on('connect_error', () => {
    connectionState = 'reconnecting';
    safeSend('mydesktop:connection-state', { state: connectionState });
});

socket.on('effects:video-playing', (payload) => {
    if (!payload || typeof payload.screen !== 'number') return;
    const minimal = {
        screen: payload.screen,
        videoUrl: typeof payload.videoUrl === 'string' ? payload.videoUrl : '',
        playbackId: payload.playbackId || null
    };
    latestByScreen[minimal.screen] = minimal;
    safeSend('mydesktop:video-playing', minimal);
});

// ---- IPC ----
ipcMain.handle('mydesktop:renderer-ready', () => {
    return {
        connectionState,
        settings: {
            watchedScreen: settings.watchedScreen,
            screenOffsets: settings.screenOffsets
        },
        latestForWatchedScreen: latestByScreen[settings.watchedScreen] || null
    };
});

ipcMain.handle('mydesktop:get-settings', () => ({
    watchedScreen: settings.watchedScreen,
    screenOffsets: settings.screenOffsets
}));

ipcMain.handle('mydesktop:set-watched-screen', (_event, screenNum) => {
    settings = { ...settings, watchedScreen: normalizeScreen(screenNum) };
    saveSettings(settings);
    return {
        watchedScreen: settings.watchedScreen,
        screenOffsets: settings.screenOffsets,
        latestForWatchedScreen: latestByScreen[settings.watchedScreen] || null
    };
});

ipcMain.handle('mydesktop:set-screen-offset', (_event, screenNum, seconds) => {
    const normalizedScreen = normalizeScreen(screenNum);
    settings = {
        ...settings,
        screenOffsets: {
            ...settings.screenOffsets,
            [String(normalizedScreen)]: normalizeOffsetSeconds(seconds)
        }
    };
    saveSettings(settings);
    return { watchedScreen: settings.watchedScreen, screenOffsets: settings.screenOffsets };
});

// ---- ウィンドウ ----
function createMainWindow() {
    const restoredBounds = clampBoundsToVisibleDisplay(settings.windowBounds);

    mainWindow = new BrowserWindow({
        width: restoredBounds ? restoredBounds.width : DEFAULT_WINDOW_SIZE.width,
        height: restoredBounds ? restoredBounds.height : DEFAULT_WINDOW_SIZE.height,
        x: restoredBounds ? restoredBounds.x : undefined,
        y: restoredBounds ? restoredBounds.y : undefined,
        minWidth: 320,
        minHeight: 220,
        title: 'MyDesktop',
        icon: path.join(__dirname, 'assets', 'windows', 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    if (process.env.MYDESKTOP_DEBUG_CONSOLE) {
        mainWindow.webContents.on('console-message', (_event, _level, message) => {
            console.log('[renderer]', message);
        });
    }

    let persistTimer = null;
    const schedulePersistBounds = () => {
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            settings = { ...settings, windowBounds: mainWindow.getBounds() };
            saveSettings(settings);
        }, 500);
    };
    mainWindow.on('resize', schedulePersistBounds);
    mainWindow.on('move', schedulePersistBounds);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
    app.quit();
});
