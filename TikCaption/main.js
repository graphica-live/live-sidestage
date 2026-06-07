'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

// getUserMedia triggers Chromium to register a Windows Communications audio session,
// causing OS-level ducking of other streams. Keep audio service in-process to avoid it.
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess,AudioServiceSandbox');

const CAPTION_PORT = 38200;
const LOADER_PORT = 38201;

const DEVICE_ID_PATH = path.join(process.env.APPDATA || os.homedir(), '.tikcaption', 'device.env');

function loadOrCreateDeviceId() {
  try {
    const content = fs.readFileSync(DEVICE_ID_PATH, 'utf8');
    const match = content.match(/TIKTOK_DEVICE_ID=(\d{19})/);
    if (match) return match[1];
  } catch {}
  const id = Array.from({ length: 19 }, () => Math.floor(Math.random() * 10)).join('');
  try {
    fs.mkdirSync(path.dirname(DEVICE_ID_PATH), { recursive: true });
    fs.writeFileSync(DEVICE_ID_PATH, `TIKTOK_DEVICE_ID=${id}\n`, 'utf8');
  } catch {}
  return id;
}

const DEVICE_ID = loadOrCreateDeviceId();

const isLoaderOnly = process.argv.includes('--loader-only');

// Prevent second instance from launching (would conflict on ports 38200/38201)
if (!isLoaderOnly) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    process.exit(0);
  }
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
    }
  });
}

// Ctrl+C in terminal → graceful shutdown (triggers before-quit + renderer beforeunload)
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());

let mainWin = null;
let overlayWin = null;
let tray = null;
let asrProc = null;
let asrStatus = { status: 'idle', message: '' };
let _asrExpectExit = false;
let _lastAsrError = null;

// ── TTS (TikTok Live + VOICEVOX) ─────────────────────────────────────────────
const RECONNECT_DELAY_MS = 10000;
const OFFLINE_RECONNECT_DELAY_MS = 30000;

let ttsConn = null;
let ttsStatus = { status: 'stopped', message: '停止中' };
let ttsUserId = '';
let ttsReconnectTimer = null;
let ttsStopped = false; // true = user explicitly stopped, no auto-reconnect
let ttsAcceptingComments = false;
let ttsConnectedAt = 0; // ms timestamp when connect() resolved
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
  const sec = delay / 1000;
  const msgMap = {
    user_offline:           `@${ttsUserId} はオフライン — ${sec}秒後に再試行`,
    stream_end:             `@${ttsUserId} の配信が終了 — 再開を待機中 (${sec}秒)`,
    disconnected:           `接続が切れました — ${sec}秒後に再接続`,
    room_info_error:        `ルーム情報の取得に失敗 — ${sec}秒後に再試行`,
    ws_upgrade_unavailable: `接続方式を変更して再試行 (${sec}秒)`,
  };
  const msg = msgMap[reason] ?? `エラーが発生しました — ${sec}秒後に再接続`;
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
    webClientParams: { app_language: 'ja', device_platform: 'web', browser_language: 'ja', device_id: DEVICE_ID },
    webClientHeaders: {
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    wsClientParams: { app_language: 'ja', device_platform: 'web', browser_language: 'ja', device_id: DEVICE_ID },
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
    // Discard comments older than the connection time (TikTok replays recent history on connect)
    if (data.createTime && data.createTime < ttsConnectedAt) return;
    const comment = {
      uniqueId: data.uniqueId || '',
      nickname: data.nickname || data.uniqueId || '',
      comment: data.comment || '',
      profilePictureUrl: data.profilePictureUrl || '',
      emotes: (data.emotes || []).map(e => ({ emoteId: e.emoteId, emoteImageUrl: e.emoteImageUrl })),
    };
    if (mainWin) mainWin.webContents.send('tts-comment', comment);
    require('./server').getIO().emit('tts:comment', comment);
  });

  ttsConn.on('emote', (data) => {
    if (!ttsAcceptingComments) return;
    const emotes = (data.emotes || []).map(e => ({ emoteId: e.emoteId, emoteImageUrl: e.emoteImageUrl }));
    if (emotes.length > 0 && mainWin) mainWin.webContents.send('tts-emote', { emotes });
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
    ttsConnectedAt = Date.now();
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
      emitTtsStatus({ status: 'error', message: `接続に失敗しました。ユーザーIDを確認してください。` });
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
  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[loader] port ${LOADER_PORT} already in use, skipping loader server`);
    } else {
      console.error('[loader] server error:', err);
    }
  });
  return srv;
}

// ── ASR process ──────────────────────────────────────────────────────────────

function isPython310Plus(exe) {
  try {
    const out = execSync(`"${exe}" -c "import sys; print(sys.version_info[:2])"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = out.match(/\((\d+),\s*(\d+)\)/);
    if (!m) return false;
    const [major, minor] = [parseInt(m[1]), parseInt(m[2])];
    return major > 3 || (major === 3 && minor >= 10);
  } catch (_) {
    return false;
  }
}

function findPython() {
  const local = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python');
  const candidates = [];
  if (fs.existsSync(local)) {
    for (const dir of fs.readdirSync(local)) {
      candidates.push(path.join(local, dir, 'python.exe'));
    }
  }
  for (const exe of candidates) {
    if (isPython310Plus(exe)) return exe;
  }
  for (const bin of ['python3.12', 'python3.11', 'python3.10', 'python', 'py', 'python3']) {
    if (isPython310Plus(bin)) return bin;
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

function installVcRedist() {
  return new Promise((resolve) => {
    asrStatus = { status: 'installing', message: 'Visual C++ Redistributable をインストール中...' };
    if (mainWin) mainWin.webContents.send('asr-status', asrStatus);

    const proc = spawn('winget', [
      'install', 'Microsoft.VCRedist.2015+.x64',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const onLine = (data) => {
      const line = data.toString().trim().split('\n').filter(Boolean).pop() || '';
      if (line) {
        asrStatus = { status: 'installing', message: `VC++: ${line.slice(0, 60)}` };
        if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
      }
    };
    proc.stdout.on('data', onLine);
    proc.stderr.on('data', onLine);

    proc.on('exit', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

function ensurePythonDeps(python) {
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
        resolve(true);
        return;
      }

      asrStatus = { status: 'installing', message: `初回セットアップ中... 数GB のダウンロードが発生します（目安: 10〜30分）。このまま待機してください。` };
      if (mainWin) mainWin.webContents.send('asr-status', asrStatus);

      const reqPath = app.isPackaged
        ? path.join(process.resourcesPath, 'requirements.txt')
        : path.join(__dirname, 'requirements.txt');
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

function hasVcRedist() {
  const dll = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'MSVCP140.dll');
  return fs.existsSync(dll);
}

async function spawnASR(settings) {
  if (!hasVcRedist()) {
    const ok = await installVcRedist();
    if (!ok) {
      asrStatus = { status: 'error', message: 'VC++ インストール失敗。microsoft.com から Visual C++ Redistributable 2015-2022 x64 を手動インストールしてください' };
      if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
      return;
    }
  }

  if (await checkPort(CAPTION_PORT)) {
    asrStatus = { status: 'error', message: `ポート ${CAPTION_PORT} が他のアプリに使用されています。競合するアプリを終了してから再起動してください。` };
    if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
    return;
  }

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
      asrStatus = { status: 'error', message: 'Pythonが見つかりません。アプリを再起動してください' };
      if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
      dialog.showMessageBox(mainWin, {
        type: 'info',
        title: 'TikCaption — 再起動が必要です',
        message: 'Pythonのインストールが完了しました。\nTikCaptionを再起動してください。',
        buttons: ['今すぐ再起動', '後で'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) app.relaunch(), app.quit();
      });
      return;
    }
  }

  const ok = await ensurePythonDeps(python);
  if (!ok) return;

  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'caption_server.py')
    : path.join(__dirname, 'caption_server.py');
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

  _lastAsrError = null;

  asrProc.stdout.on('data', (data) => {
    const lines = data.toString('utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'status' || msg.type === 'loading' || msg.type === 'error') {
          if (msg.type === 'error') _lastAsrError = msg.message;
          asrStatus = { status: msg.type, message: msg.message };
          if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
        }
      } catch (_) {}
    }
  });

  asrProc.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) _lastAsrError = text;
    console.error('[ASR]', text);
  });

  asrProc.on('exit', (code) => {
    const wasExpected = _asrExpectExit;
    _asrExpectExit = false;
    if (code !== 0 && _lastAsrError && /DLL load failed/i.test(_lastAsrError)) {
      asrProc = null;
      installVcRedist().then((ok) => {
        const { loadSettings } = require('./server');
        if (ok) {
          asrStatus = { status: 'installing', message: 'VC++ インストール完了。再起動中...' };
        } else {
          asrStatus = { status: 'error', message: 'VC++ インストール失敗。microsoft.com から Visual C++ Redistributable 2015-2022 x64 を手動インストールしてください' };
        }
        if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
        if (ok) setTimeout(() => spawnASR(loadSettings()), 2000);
      });
      return;
    } else if (code !== 0 && _lastAsrError) {
      asrStatus = { status: 'error', message: _lastAsrError };
    } else {
      asrStatus = { status: 'stopped', message: code === 0 ? '停止しました' : `プロセス終了 (code ${code})` };
    }
    if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
    asrProc = null;
    if (!wasExpected && code !== 0) {
      const { loadSettings } = require('./server');
      setTimeout(() => spawnASR(loadSettings()), 3000);
    }
  });
}

function killASR() {
  if (asrProc) {
    _asrExpectExit = true;
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
    serverModule.setPaused(false);
    asrStatus = { status: 'stopped', message: '停止しました' };
    if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
    return { ok: true };
  });

  ipcMain.handle('pause-asr', () => {
    const paused = !serverModule.isPaused();
    serverModule.setPaused(paused);
    if (mainWin) mainWin.webContents.send('asr-paused', paused);
    return { paused };
  });

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
  });

  // ── TTS IPC ────────────────────────────────────────────────────────────────
  ipcMain.handle('tts-get-status', () => ttsStatus);
  ipcMain.handle('check-voicevox', () => new Promise((resolve) => {
    const req = http.get('http://localhost:50021/version', { timeout: 2000 }, (res) => {
      resolve(res.statusCode < 400);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  }));
  ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
  ipcMain.handle('open-audio-ducking-settings', () => execSync('control.exe mmsys.cpl,,3'));

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
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  startLoaderServer();

  if (isLoaderOnly) return;

  const serverModule = require('./server');
  const { startServer, loadSettings, saveSettings } = serverModule;

  const SETTINGS_PATH = path.join(os.homedir(), '.tikcaption-settings.json');
  const isFirstRun = !fs.existsSync(SETTINGS_PATH);

  const controlHandlers = {
    startASR: () => { if (!asrProc) spawnASR(loadSettings()); return { ok: true }; },
    stopASR: () => {
      killASR();
      serverModule.setPaused(false);
      asrStatus = { status: 'stopped', message: '停止しました' };
      if (mainWin) mainWin.webContents.send('asr-status', asrStatus);
      return { ok: true };
    },
    pauseASR: () => {
      serverModule.setPaused(true);
      if (mainWin) mainWin.webContents.send('asr-paused', true);
      return { ok: true };
    },
    resumeASR: () => {
      serverModule.setPaused(false);
      if (mainWin) mainWin.webContents.send('asr-paused', false);
      return { ok: true };
    },
    getCaptionStatus: () => ({
      status: asrProc ? (serverModule.isPaused() ? 'paused' : 'running') : 'idle',
    }),
    startTTS: async () => {
      const uid = (loadSettings().ttsUserId || '').trim().replace(/^@/, '');
      if (!uid) {
        emitTtsStatus({ status: 'error', message: 'ユーザーIDを設定してください' });
        return { ok: false };
      }
      ttsUserId = uid;
      ttsStopped = false;
      if (ttsReconnectTimer) { clearTimeout(ttsReconnectTimer); ttsReconnectTimer = null; }
      await connectTikTokLive(uid);
      return { ok: true };
    },
    stopTTS: async () => {
      ttsStopped = true;
      if (ttsReconnectTimer) { clearTimeout(ttsReconnectTimer); ttsReconnectTimer = null; }
      if (ttsConn) {
        ttsConn.removeAllListeners?.();
        try { await Promise.resolve(ttsConn.disconnect?.()); } catch (_) {}
        ttsConn = null;
      }
      emitTtsStatus({ status: 'stopped', message: '停止中' });
      return { ok: true };
    },
    pauseTTS: () => {
      ttsAcceptingComments = false;
      if (mainWin) mainWin.webContents.send('tts-paused', true);
      return { ok: true };
    },
    resumeTTS: () => {
      ttsAcceptingComments = true;
      if (mainWin) mainWin.webContents.send('tts-paused', false);
      return { ok: true };
    },
    toggleCaptionPause: () => {
      const paused = !serverModule.isPaused();
      serverModule.setPaused(paused);
      if (mainWin) mainWin.webContents.send('asr-paused', paused);
      return { paused };
    },
    toggleTtsPause: () => {
      ttsAcceptingComments = !ttsAcceptingComments;
      const paused = !ttsAcceptingComments;
      if (mainWin) mainWin.webContents.send('tts-paused', paused);
      return { paused };
    },
    getTtsStatus: () => ({ ...ttsStatus, paused: !ttsAcceptingComments }),
  };

  await startServer(CAPTION_PORT, controlHandlers).catch((err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[main] port ${CAPTION_PORT} already in use — another instance may be running`);
    } else {
      throw err;
    }
  });

  try {
    execSync(
      'reg add "HKCU\\Software\\Microsoft\\Multimedia\\Audio" /v UserDuckingPreference /t REG_DWORD /d 3 /f',
      { stdio: 'ignore' }
    );
  } catch (_) {}

  createMainWindow();
  createTray();
  registerIPC();

  if (app.isPackaged) {
    mainWin.webContents.once('did-finish-load', () => setupAutoUpdater());
  }

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
