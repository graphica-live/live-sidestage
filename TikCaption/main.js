'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

const CAPTION_PORT = 38200;
const LOADER_PORT = 38201;

const isLoaderOnly = process.argv.includes('--loader-only');

// Ctrl+C in terminal → graceful shutdown (triggers before-quit + renderer beforeunload)
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());

let mainWin = null;
let overlayWin = null;
let tray = null;
let asrProc = null;
let asrStatus = { status: 'idle', message: '' };

// ── TTS (TikTok Live + VOICEVOX) ─────────────────────────────────────────────
const RECONNECT_DELAY_MS = 10000;
const OFFLINE_RECONNECT_DELAY_MS = 30000;

let ttsConn = null;
let ttsStatus = { status: 'stopped', message: '停止中' };
let ttsUserId = '';
let ttsReconnectTimer = null;
let ttsStopped = false; // true = user explicitly stopped, no auto-reconnect
let ttsAcceptingComments = false;
let ttsConnecting = false; // true while connect() promise is pending — suppress event-driven reconnects

function emitTtsStatus(s) {
  ttsStatus = s;
  if (mainWin) mainWin.webContents.send('tts-status', s);
}

function isUserOfflineError(error) {
  const candidates = [error, error?.exception, error?.cause, error?.response?.data, error?.error].filter(Boolean);
  const detailText = candidates.map((c) =>
    typeof c?.message === 'string' ? c.message : typeof c?.info === 'string' ? c.info : String(c || '')
  ).join('\n');
  const hasOfflineName = candidates.some((c) => c?.name === 'UserOfflineError');
  return hasOfflineName || /isn't online|user.+offline|requested user.+online/i.test(detailText);
}

function isRecoverableRoomInfoError(error) {
  const text = [error?.message, error?.info, error?.exception?.message, error?.cause?.message]
    .filter(Boolean).join('\n');
  return /Failed to retrieve Room ID from main page|SIGI_STATE|falling back to API source|blocked by TikTok/i.test(text);
}

function isNoWSUpgradeError(error) {
  return error?.name === 'NoWSUpgradeError';
}

function scheduleTtsReconnect(reason) {
  if (ttsStopped || ttsReconnectTimer) return;
  const delay = reason === 'user_offline' ? OFFLINE_RECONNECT_DELAY_MS : RECONNECT_DELAY_MS;
  const msg = reason === 'user_offline'
    ? `配信開始待ち — ${delay / 1000}秒後に再試行`
    : `切断 (${reason}) — ${delay / 1000}秒後に再接続`;
  emitTtsStatus({ status: 'retrying', message: msg });
  ttsReconnectTimer = setTimeout(() => {
    ttsReconnectTimer = null;
    if (!ttsStopped) connectTikTokLive(ttsUserId);
  }, delay);
}

async function connectTikTokLive(userId) {
  if (!userId) return;

  ttsAcceptingComments = false;

  // Tear down previous connection
  if (ttsConn) {
    ttsConn.removeAllListeners?.();
    try { await Promise.resolve(ttsConn.disconnect?.()); } catch (_) {}
    ttsConn = null;
  }

  const { WebcastPushConnection, TikTokWebClient } = require('tiktok-live-connector');

  ttsConn = new WebcastPushConnection(userId, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
    enableExtendedGiftInfo: false,
    enableWebsocketUpgrade: true,
    enableRequestPolling: false,
    disableEulerFallbacks: false,
    sessionId: undefined,
    authenticateWs: false,
    webClientParams: { app_language: 'ja', device_platform: 'web', browser_language: 'ja' },
    webClientHeaders: {
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    wsClientParams: { app_language: 'ja', device_platform: 'web', browser_language: 'ja' },
    wsClientHeaders: {
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signedWebSocketProvider: async (params) => {
      const webClient = new TikTokWebClient({
        customHeaders: { 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8' },
        axiosOptions: {},
        clientParams: { app_language: 'ja' },
        authenticateWs: false,
      });
      return webClient.fetchSignedWebSocketFromEuler(params);
    },
  });

  ttsConn.on('disconnected', () => {
    if (!ttsStopped && !ttsConnecting) scheduleTtsReconnect('disconnected');
  });

  ttsConn.on('streamEnd', () => {
    if (!ttsStopped && !ttsConnecting) scheduleTtsReconnect('stream_end');
  });

  ttsConn.on('error', (err) => {
    if (ttsStopped || ttsConnecting) return;
    scheduleTtsReconnect(isUserOfflineError(err) ? 'user_offline' : 'error');
  });

  ttsConn.on('chat', (data) => {
    if (!ttsAcceptingComments) return;
    const comment = {
      uniqueId: data.uniqueId || '',
      nickname: data.nickname || data.uniqueId || '',
      comment: data.comment || '',
    };
    if (mainWin) mainWin.webContents.send('tts-comment', comment);
    require('./server').getIO().emit('tts:comment', comment);
  });

  // Reset room params so each connect gets a fresh room ID
  if (ttsConn.clientParams) {
    ttsConn.clientParams.room_id = '';
    ttsConn.clientParams.cursor = '';
    ttsConn.clientParams.internal_ext = '';
  }

  emitTtsStatus({ status: 'connecting', message: `接続中: @${userId}` });

  ttsConnecting = true;
  try {
    await ttsConn.connect();
    ttsConnecting = false;
    ttsAcceptingComments = true;
    emitTtsStatus({ status: 'connected', message: `接続済み: @${userId}` });
  } catch (err) {
    ttsConnecting = false;
    ttsConn = null;
    if (ttsStopped) return;
    if (isUserOfflineError(err)) {
      scheduleTtsReconnect('user_offline');
    } else if (isRecoverableRoomInfoError(err)) {
      scheduleTtsReconnect('room_info_error');
    } else if (isNoWSUpgradeError(err)) {
      scheduleTtsReconnect('ws_upgrade_unavailable');
    } else {
      emitTtsStatus({ status: 'error', message: `接続失敗: ${err?.message || err}` });
    }
  }
}

// ── Loader server ────────────────────────────────────────────────────────────

const POLLING_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: transparent; color: rgba(255,255,255,0.6);
    font-family: sans-serif; display: flex; align-items: center;
    justify-content: center; height: 100vh; }
</style>
</head>
<body>
<span id="msg">TikCaption 起動待機中...</span>
<script>
let inFlight = false;
async function poll() {
  if (inFlight) return;
  inFlight = true;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(location.href, { cache: 'no-store', redirect: 'manual', signal: ctrl.signal });
    clearTimeout(tid);
    if (res.type === 'opaqueredirect') { location.reload(); return; }
  } catch(e) {}
  inFlight = false;
}
setInterval(poll, 2000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
</script>
</body>
</html>`;

function checkPort(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port });
    sock.setTimeout(200);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

function startLoaderServer() {
  const srv = http.createServer(async (req, res) => {
    const alive = await checkPort(CAPTION_PORT);
    if (alive) {
      const host = req.headers.host ? req.headers.host.replace(String(LOADER_PORT), String(CAPTION_PORT)) : `localhost:${CAPTION_PORT}`;
      res.writeHead(302, { Location: `http://${host}${req.url}` });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(POLLING_HTML);
    }
  });
  srv.listen(LOADER_PORT, '0.0.0.0');
  return srv;
}

// ── ASR process ──────────────────────────────────────────────────────────────

function findPython() {
  const local = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python');
  const candidates = [];
  if (fs.existsSync(local)) {
    for (const dir of fs.readdirSync(local)) {
      candidates.push(path.join(local, dir, 'python.exe'));
    }
  }
  for (const exe of candidates) {
    try {
      execSync(`"${exe}" --version`, { stdio: 'ignore' });
      return exe;
    } catch (_) {}
  }
  for (const bin of ['python3.12', 'python3.11', 'python3.10', 'python', 'py', 'python3']) {
    try {
      execSync(`${bin} --version`, { stdio: 'ignore' });
      return bin;
    } catch (_) {}
  }
  return null;
}

function installPython() {
  return new Promise((resolve) => {
    asrStatus = { status: 'installing', message: 'Pythonをインストール中 (数分かかります)...' };
    if (mainWin) mainWin.webContents.send('asr-status', asrStatus);

    const proc = spawn('winget', [
      'install', 'Python.Python.3.12',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const onLine = (data) => {
      const line = data.toString().trim().split('\n').filter(Boolean).pop() || '';
      if (line) {
        asrStatus = { status: 'installing', message: `Python: ${line.slice(0, 60)}` };
        if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
      }
    };
    proc.stdout.on('data', onLine);
    proc.stderr.on('data', onLine);

    proc.on('exit', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

const DEPS_CACHE_PATH = path.join(os.homedir(), '.tikcaption-deps-ok');

function ensurePythonDeps(python) {
  // Skip check if already verified in a previous run
  if (fs.existsSync(DEPS_CACHE_PATH)) {
    console.log('[ASR] deps cache hit, skipping check');
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const checkCode = [
      'import importlib.util, sys',
      'pkgs = ["numpy","requests","sounddevice","soundfile","torch","nemo"]',
      'missing = [p for p in pkgs if importlib.util.find_spec(p) is None]',
      'sys.exit(1 if missing else 0)',
    ].join(';');

    console.log('[ASR] using python:', python);
    const check = spawn(python, ['-c', checkCode], { stdio: 'ignore' });
    check.on('exit', (code) => {
      if (code === 0) {
        try { fs.writeFileSync(DEPS_CACHE_PATH, python, 'utf8'); } catch (_) {}
        resolve(true);
        return;
      }

      asrStatus = { status: 'installing', message: `インストール中... (${python})` };
      if (mainWin) mainWin.webContents.send('asr-status', asrStatus);

      const reqPath = path.join(__dirname, 'requirements.txt');
      const lastLines = [];
      const inst = spawn(python, ['-m', 'pip', 'install', '-r', reqPath, '--progress-bar', 'off'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const onLine = (data) => {
        const line = data.toString().trim().split('\n').filter(Boolean).pop() || '';
        if (line) {
          lastLines.push(line);
          if (lastLines.length > 10) lastLines.shift();
          asrStatus = { status: 'installing', message: `インストール中: ${line.slice(0, 60)}` };
          if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
        }
      };
      inst.stdout.on('data', onLine);
      inst.stderr.on('data', onLine);

      inst.on('exit', (c) => {
        if (c === 0) {
          try { fs.writeFileSync(DEPS_CACHE_PATH, python, 'utf8'); } catch (_) {}
          asrStatus = { status: 'ready', message: 'パッケージインストール完了' };
        } else {
          const detail = lastLines.filter(l => /error|Error|failed/i.test(l)).pop()
            || lastLines.pop() || '';
          console.error('[ASR] pip failed. Last lines:\n', lastLines.join('\n'));
          asrStatus = {
            status: 'error',
            message: `インストール失敗 (${python}): ${detail.slice(0, 80)}`,
          };
        }
        if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
        resolve(c === 0);
      });
    });
  });
}

async function spawnASR(settings) {
  let python = findPython();
  if (!python) {
    const installed = await installPython();
    if (!installed) {
      asrStatus = { status: 'error', message: 'Pythonのインストールに失敗しました。python.orgから手動インストールしてください' };
      if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
      return;
    }
    python = findPython();
    if (!python) {
      asrStatus = { status: 'error', message: 'Pythonが見つかりません。再起動してください' };
      if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
      return;
    }
  }

  const ok = await ensurePythonDeps(python);
  if (!ok) return;

  const scriptPath = path.join(__dirname, 'caption_server.py');
  const args = [
    scriptPath,
    '--port', String(CAPTION_PORT),
    '--vad-threshold', String(settings.vadThreshold),
    '--silence-dur', String(settings.vadSilenceMs / 1000),
    '--min-speech-dur', String(settings.vadMinSpeechMs / 1000),
    '--padding-dur', String(settings.vadPaddingMs / 1000),
  ];

  if (settings.deviceId) {
    args.push('--device-label', settings.deviceId);
  }

  asrProc = spawn(python, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

  asrProc.stdout.on('data', (data) => {
    const lines = data.toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'status' || msg.type === 'loading' || msg.type === 'error') {
          asrStatus = { status: msg.type, message: msg.message };
          if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
        }
      } catch (_) {}
    }
  });

  asrProc.stderr.on('data', (data) => {
    console.error('[ASR]', data.toString());
  });

  asrProc.on('exit', (code) => {
    asrStatus = { status: 'stopped', message: `プロセス終了 (code ${code})` };
    if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
    asrProc = null;
  });
}

function killASR() {
  if (asrProc) {
    try { asrProc.kill(); } catch (_) {}
    asrProc = null;
  }
}

function restartASR() {
  killASR();
  const { loadSettings } = require('./server');
  setTimeout(() => spawnASR(loadSettings()), 500);
}

// ── Windows ──────────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 560,
    height: 800,
    resizable: true,
    minWidth: 480,
    minHeight: 600,
    title: 'TikCaption',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWin.loadFile(path.join(__dirname, 'public', 'app.html'));

  mainWin.on('close', (e) => {
    e.preventDefault();
    mainWin.hide();
  });
}

function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  overlayWin = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    show: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWin.once('ready-to-show', () => overlayWin.show());
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.loadFile(path.join(__dirname, 'public', 'overlay.html'));
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('TikCaption');

  const menu = Menu.buildFromTemplate([
    {
      label: '設定を開く',
      click: () => {
        mainWin.show();
        mainWin.focus();
      },
    },
    {
      label: 'オーバーレイ表示',
      click: () => {
        if (overlayWin) overlayWin.show();
      },
    },
    { type: 'separator' },
    {
      label: '終了',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    mainWin.show();
    mainWin.focus();
  });
}

// ── Auto updater ─────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (mainWin) mainWin.webContents.send('update-available', info);
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWin) mainWin.webContents.send('update-downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err.message);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] check failed:', err.message);
  });
}

// ── IPC ──────────────────────────────────────────────────────────────────────

function registerIPC() {
  const serverModule = require('./server');

  ipcMain.handle('get-settings', () => serverModule.loadSettings());

  ipcMain.on('save-settings-sync', (e, data) => {
    serverModule.saveSettings(data);
    e.returnValue = null;
  });

  ipcMain.handle('save-settings', (e, data) => {
    const prev = serverModule.loadSettings();
    serverModule.saveSettings(data);
    const next = serverModule.loadSettings();
    serverModule.getIO().emit('caption:config', next);

    const vadKeys = ['vadThreshold', 'vadSilenceMs', 'vadMinSpeechMs', 'vadPaddingMs', 'deviceId'];
    const needRestart = vadKeys.some((k) => k in data && data[k] !== prev[k]);
    if (needRestart) restartASR();

    if ('launchOnBoot' in data) updateLoginItem(data.launchOnBoot);

    return next;
  });

  ipcMain.handle('get-asr-status', () => asrStatus);

  ipcMain.handle('restart-asr', () => {
    restartASR();
    return { ok: true };
  });

  ipcMain.handle('start-asr', () => {
    if (!asrProc) spawnASR(serverModule.loadSettings());
    return { ok: true };
  });

  ipcMain.handle('stop-asr', () => {
    killASR();
    asrStatus = { status: 'stopped', message: '停止しました' };
    if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
    return { ok: true };
  });

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
  });

  // ── TTS IPC ────────────────────────────────────────────────────────────────
  ipcMain.handle('tts-get-status', () => ttsStatus);

  ipcMain.handle('tts-start', async (_e, userId) => {
    const uid = (userId || '').trim().replace(/^@/, '');
    if (!uid) {
      emitTtsStatus({ status: 'error', message: 'ユーザーIDを設定してください' });
      return { ok: false };
    }
    ttsUserId = uid;
    ttsStopped = false;
    if (ttsReconnectTimer) { clearTimeout(ttsReconnectTimer); ttsReconnectTimer = null; }
    await connectTikTokLive(uid);
    return { ok: true };
  });

  ipcMain.handle('tts-stop', async () => {
    ttsStopped = true;
    if (ttsReconnectTimer) { clearTimeout(ttsReconnectTimer); ttsReconnectTimer = null; }
    if (ttsConn) {
      ttsConn.removeAllListeners?.();
      try { await Promise.resolve(ttsConn.disconnect?.()); } catch (_) {}
      ttsConn = null;
    }
    emitTtsStatus({ status: 'stopped', message: '停止中' });
    return { ok: true };
  });

  ipcMain.handle('get-devices', async () => {
    const python = findPython();
    if (!python) return [];
    return new Promise((resolve) => {
      const proc = spawn(python, ['-c', `
import json, sounddevice as sd
devs = sd.query_devices()
result = [{"index": i, "name": d["name"]} for i, d in enumerate(devs) if d["max_input_channels"] > 0]
print(json.dumps(result))
`], { stdio: ['ignore', 'pipe', 'pipe'] });

      let out = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.on('exit', () => {
        try { resolve(JSON.parse(out)); } catch (_) { resolve([]); }
      });
      proc.on('error', () => resolve([]));
    });
  });
}

// ── Startup registration ─────────────────────────────────────────────────────

function updateLoginItem(enabled) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    name: 'TikCaptionLoader',
    args: ['--loader-only'],
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  startLoaderServer();

  if (isLoaderOnly) return;

  const { startServer, loadSettings, saveSettings } = require('./server');

  const SETTINGS_PATH = path.join(os.homedir(), '.tikcaption-settings.json');
  const isFirstRun = !fs.existsSync(SETTINGS_PATH);

  await startServer(CAPTION_PORT);

  createMainWindow();
  createTray();
  registerIPC();

  if (app.isPackaged) setupAutoUpdater();

  const s = loadSettings();
  if (isFirstRun) {
    saveSettings({ launchOnBoot: true });
    updateLoginItem(true);
  } else {
    updateLoginItem(s.launchOnBoot);
  }
});

app.on('before-quit', () => {
  killASR();
  ttsStopped = true;
  if (ttsReconnectTimer) { clearTimeout(ttsReconnectTimer); ttsReconnectTimer = null; }
  if (ttsConn) { try { ttsConn.disconnect?.(); } catch (_) {} ttsConn = null; }
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
