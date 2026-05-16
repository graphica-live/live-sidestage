'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

const PORT = 38100;
const APP_URL = `http://localhost:${PORT}/`;
const COMMENT_READ_ALOUD_SCREEN_URL = `http://localhost:${PORT}/overlays/effects/1?readAloudOnly=1`;
const SETUP_URL = `http://localhost:${PORT}/setup`;
const VOICEVOX_API_BASE_URL = 'http://127.0.0.1:50021';
const COEIROINK_API_BASE_URL = 'http://127.0.0.1:50032/v1';
const DEFAULT_AUTO_UPDATE_URL = 'https://update.graphica-produce.com/tikeffect/win';
const AUTO_UPDATE_CHECK_DELAY_MS = 0;
const AUTO_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VOICEVOX_TERMS_FALLBACK_URL = 'https://voicevox.hiroshiba.jp/term/';
const EXCLUDED_VOICEVOX_SPEAKERS = new Set(['青山龍星', 'ぞん子']);
const VOICEVOX_PRODUCT_PATH_BY_SPEAKER = {
    '四国めたん': 'shikoku_metan',
    'ずんだもん': 'zundamon',
    '春日部つむぎ': 'kasukabe_tsumugi',
    '雨晴はう': 'amehare_hau',
    '波音リツ': 'namine_ritsu',
    '玄野武宏': 'kurono_takehiro',
    '白上虎太郎': 'shirakami_kotarou',
    '青山龍星': 'aoyama_ryusei',
    '冥鳴ひまり': 'meimei_himari',
    '九州そら': 'kyushu_sora',
    'もち子さん': 'mochikosan',
    '剣崎雌雄': 'kenzaki_mesuo',
    'WhiteCUL': 'white_cul',
    '後鬼': 'goki',
    'No.7': 'number_seven',
    'ちび式じい': 'chibishikiji',
    '櫻歌ミコ': 'ouka_miko',
    '小夜/SAYO': 'sayo',
    'ナースロボ＿タイプＴ': 'nurserobo_typet',
    '†聖騎士 紅桜†': 'horinaito_benizakura',
    '雀松朱司': 'wakamatsu_akashi',
    '麒ヶ島宗麟': 'kigashima_sourin',
    '春歌ナナ': 'haruka_nana',
    '猫使アル': 'nekotsuka_aru',
    '猫使ビィ': 'nekotsuka_bi',
    '中国うさぎ': 'chugoku_usagi',
    '栗田まろん': 'kurita_maron',
    'あいえるたん': 'aierutan',
    '満別花丸': 'manbetsu_hanamaru',
    '琴詠ニア': 'kotoyomi_nia',
    'Voidoll': 'voidoll',
    'ぞん子': 'zonko',
    '中部つるぎ': 'chubu_tsurugi',
    '離途': 'rito',
    '黒沢冴白': 'kurosawa_kohaku',
    'ユーレイちゃん': 'yureichan',
    '東北ずん子': 'tohoku_zunko',
    '東北きりたん': 'tohoku_kiritan',
    '東北イタコ': 'tohoku_itako',
    'あんこもん': 'ankomon',
    '夜語トバリ': 'yogatari_tobari',
    '暁記ミタマ': 'akatsuki_mitama',
    '里石ユカ': 'satoishi_yuka'
};

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
    app.quit();
}

function normalizeVoiceVoxSpeakerName(value) {
    return String(value || '').trim().replace(/\s*\([^)]*\)\s*$/u, '');
}

function getVoiceVoxTermsUrl(speakerName) {
    const normalizedSpeakerName = normalizeVoiceVoxSpeakerName(speakerName);
    const productPath = VOICEVOX_PRODUCT_PATH_BY_SPEAKER[normalizedSpeakerName];
    return productPath
        ? `https://voicevox.hiroshiba.jp/product/${productPath}/`
        : VOICEVOX_TERMS_FALLBACK_URL;
}

// --loader-only モード: Windows スタートアップから起動されるローダーサーバー専用プロセス
// このプロセスは TikEffect 本体とは独立して常時稼働し、ポート 38099 で待機する
if (process.argv.includes('--loader-only')) {
    app.on('window-all-closed', () => {});
    app.whenReady().then(() => {
        require('../loader-server/index.js');
    });
    return; // CommonJS モジュールのトップレベル return: 以降の実行を停止
}

// index.js がブラウザ自動起動や process.exit を呼ぶのを抑制するフラグ
process.env.ELECTRON_RUN = '1';
process.env.ELECTRON_APP_PACKAGED = app.isPackaged ? '1' : '0';

// backend サーバーをインプロセスで起動
const server = require('../backend/index.js');

// loader-server（ポート 38099）が未起動の場合のみ起動
{
    const net = require('net');
    const LOADER_PORT = 38099;
    const probe = new net.Socket();
    probe.setTimeout(200);
    const startLoader = () => require('../loader-server/index.js');
    probe.once('connect', () => { probe.destroy(); /* 既に起動中 */ });
    probe.once('error',   () => { probe.destroy(); startLoader(); });
    probe.once('timeout', () => { probe.destroy(); startLoader(); });
    probe.connect(LOADER_PORT, '127.0.0.1');
}

let mainWindow = null;
let tray = null;
let loginWindow = null;
let commentReadAloudWindow = null;
let readAloudProcess = null;
let readAloudQueue = [];
let autoUpdateCheckTimer = null;
let autoUpdateCheckInterval = null;
let hasScheduledAutoUpdateCheck = false;
let isAppQuitting = false;
let isFinalAppExit = false;
let quitPromise = null;
let readAloudVoicesCache = {
    expiresAt: 0,
    voices: [],
    pending: null
};

app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }

        mainWindow.show();
        mainWindow.focus();
        return;
    }

    createMainWindow();
});

const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'TikEffect.ico')
    : path.join(__dirname, '..', 'assets', 'windows', 'TikEffect.ico');

const MAIN_WINDOW_BOUNDS = {
    width: 1280,
    height: 760,
    minWidth: 1280,
    minHeight: 680
};

function resolveAutoUpdateUrl() {
    const configuredUrl = process.env.TIKEFFECT_AUTO_UPDATE_URL || DEFAULT_AUTO_UPDATE_URL;

    if (typeof configuredUrl !== 'string') {
        return null;
    }

    const normalizedUrl = configuredUrl.trim().replace(/\/+$/u, '');
    return normalizedUrl || null;
}

function logAutoUpdate(message, error) {
    if (error) {
        console.error(`[auto-update] ${message}`, error);
        return;
    }

    console.log(`[auto-update] ${message}`);
}

function showAutoUpdateNotification(body) {
    if (!Notification.isSupported()) {
        return;
    }

    try {
        new Notification({
            title: 'TikEffect',
            body,
            silent: true
        }).show();
    } catch (error) {
        logAutoUpdate('通知の表示に失敗しました。', error);
    }
}

function configureAutoUpdater() {
    if (!app.isPackaged) {
        logAutoUpdate('開発環境のため自動更新を無効化しました。');
        return;
    }

    if (hasScheduledAutoUpdateCheck) {
        return;
    }

    const updateUrl = resolveAutoUpdateUrl();

    if (updateUrl && typeof autoUpdater.setFeedURL === 'function') {
        autoUpdater.setFeedURL({
            provider: 'generic',
            url: updateUrl
        });
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;

    autoUpdater.on('checking-for-update', () => {
        logAutoUpdate('更新を確認しています。');
    });

    autoUpdater.on('update-available', (info) => {
        const version = info?.version ? ` ${info.version}` : '';
        logAutoUpdate(`更新${version} が見つかりました。バックグラウンドでダウンロードします。`);
        showAutoUpdateNotification('更新をバックグラウンドでダウンロードしています。');
    });

    autoUpdater.on('update-not-available', () => {
        logAutoUpdate('利用可能な更新はありません。');
    });

    autoUpdater.on('error', (error) => {
        logAutoUpdate('自動更新でエラーが発生しました。', error);
    });

    autoUpdater.on('update-downloaded', (info) => {
        const version = info?.version ? ` ${info.version}` : '';
        logAutoUpdate(`更新${version} のダウンロードが完了しました。アプリ内バナーで通知します。`);
        if (typeof server.notifyUpdateReady === 'function') {
            server.notifyUpdateReady(info);
        }
    });

    const checkForUpdates = () => autoUpdater.checkForUpdates().catch((error) => {
        logAutoUpdate('更新確認に失敗しました。', error);
    });

    autoUpdateCheckTimer = setTimeout(checkForUpdates, AUTO_UPDATE_CHECK_DELAY_MS);
    autoUpdateCheckInterval = setInterval(checkForUpdates, AUTO_UPDATE_CHECK_INTERVAL_MS);

    if (typeof autoUpdateCheckTimer.unref === 'function') {
        autoUpdateCheckTimer.unref();
    }

    if (typeof autoUpdateCheckInterval.unref === 'function') {
        autoUpdateCheckInterval.unref();
    }

    hasScheduledAutoUpdateCheck = true;
}

function createMainWindow(initialUrl = APP_URL) {
    mainWindow = new BrowserWindow({
        ...MAIN_WINDOW_BOUNDS,
        useContentSize: true,
        title: 'TikEffect',
        icon: iconPath,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.setMenuBarVisibility(false);

    mainWindow.loadURL(initialUrl);

    mainWindow.on('close', (event) => {
        if (isAppQuitting) {
            return;
        }

        isAppQuitting = true;
        event.preventDefault();
        app.quit();
    });

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

function escapePowerShellString(value) {
    return String(value || '').replace(/'/g, "''");
}

function parseReadAloudVoiceToken(value) {
    const normalized = String(value || '').trim();

    if (!normalized) {
        return { provider: 'system', voiceName: '' };
    }

    if (normalized.startsWith('screen1:')) {
        return {
            provider: 'screen1',
            voiceName: normalized.slice('screen1:'.length).trim()
        };
    }

    if (normalized.startsWith('browser:')) {
        return {
            provider: 'screen1',
            voiceName: normalized.slice('browser:'.length).trim()
        };
    }

    if (normalized.startsWith('voicevox:')) {
        const styleId = Number.parseInt(normalized.slice('voicevox:'.length), 10);

        if (Number.isInteger(styleId) && styleId > 0) {
            return { provider: 'voicevox', styleId };
        }
    }

    if (normalized.startsWith('coeiroink:')) {
        const [speakerUuid, rawStyleId] = normalized.slice('coeiroink:'.length).split(':');
        const styleId = Number.parseInt(rawStyleId, 10);

        if (speakerUuid && Number.isInteger(styleId) && styleId >= 0) {
            return {
                provider: 'coeiroink',
                speakerUuid: speakerUuid.trim(),
                styleId
            };
        }
    }

    return { provider: 'system', voiceName: normalized };
}

async function fetchVoiceVoxJson(url, init) {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000), ...init });

    if (!response.ok) {
        throw new Error(`VOICEVOX request failed: ${response.status}`);
    }

    return response.json();
}

async function fetchCoeiroInkJson(url, init) {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000), ...init });

    if (!response.ok) {
        throw new Error(`COEIROINK request failed: ${response.status}`);
    }

    return response.json();
}

async function loadVoiceVoxVoices() {
    try {
        const speakers = await fetchVoiceVoxJson(`${VOICEVOX_API_BASE_URL}/speakers`);

        if (!Array.isArray(speakers)) {
            return [];
        }

        return speakers.flatMap((speaker) => {
            const speakerName = String(speaker?.name || '').trim();
            const styles = Array.isArray(speaker?.styles) ? speaker.styles : [];

            if (!speakerName || EXCLUDED_VOICEVOX_SPEAKERS.has(speakerName)) {
                return [];
            }

            return styles
                .map((style) => {
                    const styleId = Number.parseInt(style?.id, 10);
                    const styleName = String(style?.name || '').trim();

                    if (!speakerName || !Number.isInteger(styleId)) {
                        return null;
                    }

                    return {
                        value: `voicevox:${styleId}`,
                        name: styleName ? `${speakerName} (${styleName})` : speakerName,
                        lang: 'ja-JP',
                        gender: '',
                        provider: 'voicevox',
                        termsUrl: getVoiceVoxTermsUrl(speakerName)
                    };
                })
                .filter(Boolean);
        });
    } catch {
        return [];
    }
}

async function loadCoeiroInkVoices() {
    try {
        const speakers = await fetchCoeiroInkJson(`${COEIROINK_API_BASE_URL}/speakers`);

        if (!Array.isArray(speakers)) {
            return [];
        }

        return speakers.flatMap((speaker) => {
            const speakerName = String(speaker?.speakerName || '').trim();
            const speakerUuid = String(speaker?.speakerUuid || '').trim();
            const styles = Array.isArray(speaker?.styles) ? speaker.styles : [];

            return styles
                .map((style) => {
                    const styleId = Number.parseInt(style?.styleId, 10);
                    const styleName = String(style?.styleName || '').trim();

                    if (!speakerName || !speakerUuid || !Number.isInteger(styleId) || styleId < 0) {
                        return null;
                    }

                    return {
                        value: `coeiroink:${speakerUuid}:${styleId}`,
                        name: styleName ? `${speakerName} (${styleName})` : speakerName,
                        lang: 'ja-JP',
                        gender: '',
                        provider: 'coeiroink'
                    };
                })
                .filter(Boolean);
        });
    } catch {
        return [];
    }
}

async function loadScreenReadAloudVoices() {
    return [];
}

function runPowerShellCommand(command, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-Command', command
        ], {
            windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { child.kill(); } catch {}
            reject(new Error('PowerShell command timed out'));
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
        child.on('exit', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code && code !== 0) {
                reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
                return;
            }

            resolve(stdout.trim());
        });
    });
}

async function loadInstalledReadAloudVoices(options = {}) {
    const forceRefresh = options?.forceRefresh === true;
    const now = Date.now();

    if (!forceRefresh && readAloudVoicesCache.expiresAt > now && Array.isArray(readAloudVoicesCache.voices)) {
        return readAloudVoicesCache.voices;
    }

    if (!forceRefresh && readAloudVoicesCache.pending) {
        return readAloudVoicesCache.pending;
    }

    readAloudVoicesCache.pending = Promise.all([
        runPowerShellCommand([
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        'Add-Type -AssemblyName System.Speech',
        '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        "$voices = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Select-Object Name, @{Name='Culture';Expression={ $_.Culture.Name }}, @{Name='Gender';Expression={ $_.Gender.ToString() }}",
        "if ($voices) { $voices | ConvertTo-Json -Compress } else { '[]' }"
    ].join('; ')).catch(() => '[]'),
        loadScreenReadAloudVoices(),
        loadVoiceVoxVoices(),
        loadCoeiroInkVoices()
    ])
        .then(([raw, screenVoices, voiceVoxVoices, coeiroInkVoices]) => {
            const parsed = raw ? JSON.parse(raw) : [];
            const systemVoices = (Array.isArray(parsed) ? parsed : [parsed])
                .map((voice) => ({
                    value: String(voice?.Name || '').trim(),
                    name: String(voice?.Name || '').trim(),
                    lang: String(voice?.Culture || '').trim(),
                    gender: String(voice?.Gender || '').trim(),
                    provider: 'system'
                }))
                .filter((voice) => voice.name);

            const list = [...systemVoices, ...screenVoices, ...voiceVoxVoices, ...coeiroInkVoices]
                .filter((voice, index, voices) => voices.findIndex((item) => item.value === voice.value) === index);

            readAloudVoicesCache = {
                expiresAt: Date.now() + 60000,
                voices: list,
                pending: null
            };
            return list;
        })
        .catch((error) => {
            readAloudVoicesCache = {
                expiresAt: Date.now() + 10000,
                voices: [],
                pending: null
            };
            console.error('[read-aloud] インストール済み音声の取得に失敗しました。', error);
            return [];
        });

    return readAloudVoicesCache.pending;
}

function processReadAloudQueue() {
    if (readAloudProcess || !readAloudQueue.length) {
        return;
    }

    const payload = readAloudQueue.shift();
    const text = String(payload?.text || '').trim();

    if (!text) {
        processReadAloudQueue();
        return;
    }

    const voiceName = String(payload?.voiceName || '').trim();
    const volume = Number.isFinite(Number(payload?.volume))
        ? Math.max(0, Math.min(100, Number(payload.volume)))
        : 100;
    const command = [
        "Add-Type -AssemblyName System.Speech",
        "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
        `$synth.Volume = ${volume}`,
        voiceName
            ? `$voice = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Where-Object { $_.Name -eq '${escapePowerShellString(voiceName)}' } | Select-Object -First 1`
            : '$voice = $null',
        "if ($voice) { $synth.SelectVoice($voice.Name) }",
        `$synth.Speak('${escapePowerShellString(text)}')`
    ].join('; ');

    readAloudProcess = spawn('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', command
    ], {
        windowsHide: true
    });

    readAloudProcess.on('error', (error) => {
        console.error('[read-aloud] 音声読み上げの起動に失敗しました。', error);
    });

    readAloudProcess.on('exit', (code) => {
        if (code && code !== 0) {
            console.error(`[read-aloud] 音声読み上げが終了コード ${code} で失敗しました。`);
        }

        readAloudProcess = null;
        processReadAloudQueue();
    });
}

function stopReadAloud() {
    readAloudQueue = [];

    if (readAloudProcess && !readAloudProcess.killed) {
        readAloudProcess.kill();
    }

    readAloudProcess = null;
}

function enqueueReadAloud(payload) {
    if (!payload || !payload.text) {
        return;
    }

    readAloudQueue.push(payload);
    processReadAloudQueue();
}

function ensureCommentReadAloudWindow() {
    if (commentReadAloudWindow && !commentReadAloudWindow.isDestroyed()) {
        return commentReadAloudWindow;
    }

    commentReadAloudWindow = new BrowserWindow({
        width: 320,
        height: 180,
        show: false,
        frame: false,
        transparent: true,
        skipTaskbar: true,
        focusable: false,
        title: 'TikEffect Screen1 Read Aloud',
        icon: iconPath,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false
        }
    });

    commentReadAloudWindow.setMenuBarVisibility(false);
    commentReadAloudWindow.loadURL(COMMENT_READ_ALOUD_SCREEN_URL);
    commentReadAloudWindow.on('closed', () => {
        commentReadAloudWindow = null;
    });

    return commentReadAloudWindow;
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
                isAppQuitting = true;
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

if (server.serverEvents) {
    server.serverEvents.on('install-update-requested', () => {
        logAutoUpdate('アプリ内からアップデートのインストールが要求されました。');
        try {
            autoUpdater.quitAndInstall(false, true);
        } catch (error) {
            logAutoUpdate('quitAndInstall に失敗しました。', error);
        }
    });

    server.serverEvents.on('pick-directory-request', async (resolve) => {
        const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const result = await dialog.showOpenDialog(parentWindow, {
            properties: ['openDirectory'],
            title: 'フォルダを選択'
        });
        resolve(result.canceled ? null : (result.filePaths[0] || null));
    });
}

if (typeof server.setCommentReadAloudVoiceProvider === 'function') {
    server.setCommentReadAloudVoiceProvider((options) => loadInstalledReadAloudVoices(options));
}

if (typeof server.setCommentReadAloudAudioProvider === 'function') {
    server.setCommentReadAloudAudioProvider(async (payload, target) => {
        if (!target?.filePath || !target?.url) {
            return null;
        }

        const text = String(payload?.text || '').trim();

        if (!text) {
            return null;
        }

        const selectedVoice = parseReadAloudVoiceToken(payload?.voiceName);
        const volume = Number.isFinite(Number(payload?.volume))
            ? Math.max(0, Math.min(100, Number(payload.volume)))
            : 100;

        if (selectedVoice.provider === 'screen1') {
            return null;
        }

        if (selectedVoice.provider === 'voicevox') {
            const queryResponse = await fetch(
                `${VOICEVOX_API_BASE_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${selectedVoice.styleId}`,
                { method: 'POST' }
            );

            if (!queryResponse.ok) {
                throw new Error(`VOICEVOX audio_query failed: ${queryResponse.status}`);
            }

            const audioQuery = await queryResponse.json();

            // 高速化: 前後の無音をカット、サンプリングレートを下げ、モノラル化することで
            // 合成処理時間・WAVサイズ・ディスク書き込み・再生開始待機を短縮する。
            if (audioQuery && typeof audioQuery === 'object') {
                audioQuery.prePhonemeLength = 0;
                audioQuery.postPhonemeLength = 0;
                audioQuery.outputSamplingRate = 24000;
                audioQuery.outputStereo = false;
                audioQuery.volumeScale = volume / 100;
            }

            const synthesisResponse = await fetch(
                `${VOICEVOX_API_BASE_URL}/synthesis?speaker=${selectedVoice.styleId}&enable_interrogative_upspeak=false`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'audio/wav'
                    },
                    body: JSON.stringify(audioQuery)
                }
            );

            if (!synthesisResponse.ok) {
                throw new Error(`VOICEVOX synthesis failed: ${synthesisResponse.status}`);
            }

            const audioBuffer = Buffer.from(await synthesisResponse.arrayBuffer());

            return {
                url: `data:audio/wav;base64,${audioBuffer.toString('base64')}`,
                mimeType: 'audio/wav'
            };
        }

        if (selectedVoice.provider === 'coeiroink') {
            const synthesisResponse = await fetch(
                `${COEIROINK_API_BASE_URL}/synthesis`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        speakerUuid: selectedVoice.speakerUuid,
                        styleId: selectedVoice.styleId,
                        text,
                        speedScale: 1,
                        volumeScale: volume / 100,
                        pitchScale: 0,
                        intonationScale: 1,
                        prePhonemeLength: 0,
                        postPhonemeLength: 0,
                        outputSamplingRate: 24000
                    })
                }
            );

            if (!synthesisResponse.ok) {
                throw new Error(`COEIROINK synthesis failed: ${synthesisResponse.status}`);
            }

            const audioBuffer = Buffer.from(await synthesisResponse.arrayBuffer());

            return {
                url: `data:audio/wav;base64,${audioBuffer.toString('base64')}`,
                mimeType: 'audio/wav'
            };
        }

        await runPowerShellCommand([
            'Add-Type -AssemblyName System.Speech',
            '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
            `$synth.Volume = ${volume}`,
            selectedVoice.voiceName
                ? `$voice = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo } | Where-Object { $_.Name -eq '${escapePowerShellString(selectedVoice.voiceName)}' } | Select-Object -First 1`
                : '$voice = $null',
            'if ($voice) { $synth.SelectVoice($voice.Name) }',
            `$synth.SetOutputToWaveFile('${escapePowerShellString(target.filePath)}')`,
            `$synth.Speak('${escapePowerShellString(text)}')`,
            '$synth.Dispose()'
        ].join('; '));

        return {
            url: target.url,
            mimeType: 'audio/wav'
        };
    });
}

app.whenReady().then(() => {
    // パッケージ済みインストールの場合、ローダーサーバーを Windows スタートアップに登録する
    // これにより次回 Windows 起動時からポート 38099 が常時稼働する
    if (app.isPackaged) {
        app.setLoginItemSettings({
            openAtLogin: true,
            name: 'TikEffectLoader',
            args: ['--loader-only']
        });
    }

    Menu.setApplicationMenu(null);
    console.log('[DEBUG] createTray...');
    createTray();
    console.log('[DEBUG] createMainWindow...');
    createMainWindow();
    console.log('[DEBUG] configureAutoUpdater...');
    configureAutoUpdater();
    console.log('[DEBUG] whenReady done');
}).catch((err) => {
    console.error('❌ app.whenReady failed:', err);
});

app.on('window-all-closed', () => {
    // ウィンドウが全部閉じられてもトレイが残るので終了しない
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

app.on('before-quit', (event) => {
    if (isFinalAppExit) {
        return;
    }

    event.preventDefault();

    if (quitPromise) {
        return;
    }

    isAppQuitting = true;
    stopReadAloud();

    if (autoUpdateCheckTimer) {
        clearTimeout(autoUpdateCheckTimer);
        autoUpdateCheckTimer = null;
    }

    if (autoUpdateCheckInterval) {
        clearInterval(autoUpdateCheckInterval);
        autoUpdateCheckInterval = null;
    }

    quitPromise = Promise.resolve()
        .then(() => (typeof server.shutdownServer === 'function' ? server.shutdownServer() : null))
        .catch((error) => {
            console.error('❌ Failed to shutdown backend during app quit:', error);
        })
        .finally(() => {
            isFinalAppExit = true;

            try {
                if (loginWindow && !loginWindow.isDestroyed()) {
                    loginWindow.destroy();
                }

                if (commentReadAloudWindow && !commentReadAloudWindow.isDestroyed()) {
                    commentReadAloudWindow.destroy();
                }

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.destroy();
                }

                if (tray) {
                    tray.destroy();
                    tray = null;
                }
            } catch (error) {
                console.error('❌ Failed to destroy Electron resources during quit:', error);
            }

            app.exit(0);
        });
});
