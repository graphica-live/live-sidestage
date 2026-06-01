'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

const CAPTION_PORT = 38200;
const LOADER_PORT = 38201;

const isLoaderOnly = process.argv.includes('--loader-only');

let mainWin = null;
let overlayWin = null;
let tray = null;
let asrProc = null;
let asrStatus = { status: 'idle', message: '' };

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

// ── IPC ──────────────────────────────────────────────────────────────────────

function registerIPC() {
  const serverModule = require('./server');

  ipcMain.handle('get-settings', () => serverModule.loadSettings());

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

  const { startServer, loadSettings } = require('./server');
  await startServer(CAPTION_PORT);

  createMainWindow();
  createTray();
  registerIPC();

  const s = loadSettings();
  updateLoginItem(s.launchOnBoot);
});

app.on('before-quit', () => {
  killASR();
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});
