'use strict';

const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');

const PORT = 38100;
const APP_URL = `http://localhost:${PORT}/`;
const SETUP_URL = `http://localhost:${PORT}/setup`;
const TIKTOK_LOGIN_URL = 'https://www.tiktok.com/login';
const TIKTOK_DESKTOP_USER_AGENT = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'AppleWebKit/537.36 (KHTML, like Gecko)',
    'Chrome/135.0.0.0',
    'Safari/537.36'
].join(' ');
const TIKTOK_AUTH_ALLOWED_PATH_PREFIXES = [
    '/login',
    '/logout',
    '/signup',
    '/passport/',
    '/falcon/',
    '/captcha/',
    '/verify',
    '/legal/',
    '/about/'
];

function buildTikTokLoginPartition() {
    return `tiktok-login-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeTikTokHostname(value) {
    return String(value || '').toLowerCase();
}

function isTikTokHostname(hostname) {
    const normalized = normalizeTikTokHostname(hostname);
    return normalized === 'tiktok.com' || normalized.endsWith('.tiktok.com');
}

function isAllowedTikTokAuthUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        if (!isTikTokHostname(url.hostname)) {
            return false;
        }

        return TIKTOK_AUTH_ALLOWED_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
    } catch {
        return false;
    }
}

function isBlockedPostLoginTikTokUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        return isTikTokHostname(url.hostname) && !isAllowedTikTokAuthUrl(rawUrl);
    } catch {
        return false;
    }
}

// index.js がブラウザ自動起動や process.exit を呼ぶのを抑制するフラグ
process.env.ELECTRON_RUN = '1';

// backend サーバーをインプロセスで起動
const server = require('../backend/index.js');

let mainWindow = null;
let tray = null;
let loginWindow = null;

const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'TikEffect.ico')
    : path.join(__dirname, '..', 'assets', 'windows', 'TikEffect.ico');

const MAIN_WINDOW_BOUNDS = {
    width: 960,
    height: 760,
    minWidth: 880,
    minHeight: 680
};

function createMainWindow(initialUrl = APP_URL) {
    mainWindow = new BrowserWindow({
        ...MAIN_WINDOW_BOUNDS,
        title: 'TikEffect',
        icon: iconPath,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadURL(initialUrl);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 外部リンクはシステムブラウザで開く
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!url.startsWith(`http://localhost:${PORT}`)) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
}

function showMainWindow(targetUrl = APP_URL) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (typeof targetUrl === 'string' && targetUrl) {
            mainWindow.loadURL(targetUrl);
        }

        mainWindow.show();
        mainWindow.focus();
        return;
    }

    createMainWindow(targetUrl);
}

function createTray() {
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('TikEffect');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: '管理画面を開く',
            click: () => {
                showMainWindow(APP_URL);
            }
        },
        {
            label: 'セットアップ',
            click: () => {
                showMainWindow(SETUP_URL);
            }
        },
        { type: 'separator' },
        {
            label: '終了',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        } else {
            createMainWindow();
        }
    });
}

// TikTok ログインウィンドウを開き、Cookie を取得して認証情報を注入する
function openTikTokLoginWindow(options = {}) {
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.focus();
        return;
    }

    const switchMode = Boolean(options.switchMode);
    const currentBroadcasterId = typeof options.currentBroadcasterId === 'string'
        ? options.currentBroadcasterId.trim().toLowerCase()
        : null;

    const loginPartition = buildTikTokLoginPartition();
    let cachedSessionId = null;
    let cachedTtTargetIdc = null;

    function updateCookieCache(cookie, removed = false) {
        if (!cookie || !isTikTokHostname(cookie.domain || cookie.hostOnly ? cookie.domain : '')) {
            return;
        }

        if (cookie.name === 'sessionid') {
            cachedSessionId = removed ? null : (cookie.value || null);
        }

        if (cookie.name === 'tt-target-idc') {
            cachedTtTargetIdc = removed ? null : (cookie.value || null);
        }
    }

    function hasAuthCookies() {
        return Boolean(cachedSessionId && cachedTtTargetIdc);
    }

    function closeLoginWindowAndFocusMain() {
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.focus();
        }
    }

    loginWindow = new BrowserWindow({
        width: 500,
        height: 720,
        title: 'TikTok にログイン',
        icon: iconPath,
        parent: mainWindow || undefined,
        modal: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: loginPartition
        }
    });

    loginWindow.webContents.setUserAgent(TIKTOK_DESKTOP_USER_AGENT);

    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isBlockedPostLoginTikTokUrl(url) && hasAuthCookies()) {
            closeLoginWindowAndFocusMain();
            return { action: 'deny' };
        }

        if (!isAllowedTikTokAuthUrl(url)) {
            shell.openExternal(url);
            return { action: 'deny' };
        }

        return { action: 'allow' };
    });

    async function handleBlockedNavigation(targetUrl) {
        if (!hasAuthCookies() || !isBlockedPostLoginTikTokUrl(targetUrl)) {
            return false;
        }

        await checkCookies();
        closeLoginWindowAndFocusMain();
        return true;
    }

    loginWindow.webContents.on('will-navigate', (event, targetUrl) => {
        if (hasAuthCookies() && isBlockedPostLoginTikTokUrl(targetUrl)) {
            event.preventDefault();
            handleBlockedNavigation(targetUrl).catch(() => {
                closeLoginWindowAndFocusMain();
            });
        }
    });

    loginWindow.webContents.on('will-redirect', (event, targetUrl) => {
        if (hasAuthCookies() && isBlockedPostLoginTikTokUrl(targetUrl)) {
            event.preventDefault();
            handleBlockedNavigation(targetUrl).catch(() => {
                closeLoginWindowAndFocusMain();
            });
        }
    });

    loginWindow.loadURL(TIKTOK_LOGIN_URL);

    // Cookie の変化を監視して sessionid + tt-target-idc を取得
    const cookieSession = loginWindow.webContents.session;
    let isResolvingAuthenticatedSession = false;

    async function checkCookies() {
        if (isResolvingAuthenticatedSession) {
            return;
        }

        const cookies = await cookieSession.cookies.get({ domain: '.tiktok.com' });
        const sessionId = cookies.find((c) => c.name === 'sessionid')?.value || null;
        const ttTargetIdc = cookies.find((c) => c.name === 'tt-target-idc')?.value || null;

        cachedSessionId = sessionId;
        cachedTtTargetIdc = ttTargetIdc;

        if (sessionId && ttTargetIdc) {
            isResolvingAuthenticatedSession = true;

            let authResult = null;

            try {
                if (typeof server.injectAuthenticatedTikTokSession === 'function') {
                    authResult = await server.injectAuthenticatedTikTokSession(sessionId, ttTargetIdc);
                } else if (typeof server.injectWsCredentials === 'function') {
                    server.injectWsCredentials(sessionId, ttTargetIdc);
                }
            } finally {
                isResolvingAuthenticatedSession = false;
            }

            const resolvedBroadcasterId = typeof authResult?.broadcasterId === 'string'
                ? authResult.broadcasterId.trim().toLowerCase()
                : null;

            if (switchMode && currentBroadcasterId && resolvedBroadcasterId === currentBroadcasterId) {
                closeLoginWindowAndFocusMain();
                return;
            }

            closeLoginWindowAndFocusMain();
        }
    }

    checkCookies().catch(() => {
        // Initial cookie sync is best-effort only.
    });

    cookieSession.cookies.on('changed', (event, cookie, cause, removed) => {
        updateCookieCache(cookie, removed);

        if (!removed && (cookie.name === 'sessionid' || cookie.name === 'tt-target-idc')) {
            checkCookies();
        }
    });

    loginWindow.on('closed', () => {
        loginWindow = null;
    });
}

// index.js の serverEvents 経由でログイン要求を受け取る
if (server.serverEvents) {
    server.serverEvents.on('tiktok-login-start', (options) => {
        openTikTokLoginWindow(options);
    });
}

app.whenReady().then(() => {
    createTray();
    createMainWindow();
});

app.on('window-all-closed', () => {
    // ウィンドウが全部閉じられてもトレイが残るので終了しない
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

app.on('before-quit', () => {
    // Graceful shutdown: Express サーバーに終了を通知
    if (server.shutdownServer) {
        server.shutdownServer();
    }
});
