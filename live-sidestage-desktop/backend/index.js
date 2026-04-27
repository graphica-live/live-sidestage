const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const express = require('express');
const multer = require('multer');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection, TikTokWebClient } = require('tiktok-live-connector');
const { createDbStore } = require('./lib/db/store');
const { renderContributorsOverlayHtml } = require('../overlays/contributors/render');

const APP_NAME = 'TikEffect';
const FIXED_PORT = 38100;
const DEFAULT_APP_START_PATH = '/';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BACKEND_ROOT = __dirname;
const APP_ROOT = PROJECT_ROOT;
const SHUTDOWN_FORCE_TIMEOUT_MS = 10000;

loadEnvFile(path.join(APP_ROOT, '.env'));

const USER_DATA_DIRECTORY = resolveUserDataDirectory();
const APPDATA_AUTH_ENV_PATH = path.join(USER_DATA_DIRECTORY, '.auth.env');

loadEnvFile(path.join(USER_DATA_DIRECTORY, '.env'));
loadPersistedAuthEnv(APPDATA_AUTH_ENV_PATH);

const REQUESTED_PORT = FIXED_PORT;

function buildPortInUseMessage(port) {
    return `ポート ${port} は既に使用中です。該当アプリを終了してから TikEffect を再起動してください。`;
}

function getTikTokSignServerHost() {
    const signServerUrl = process.env.SIGN_API_URL || 'https://tiktok.eulerstream.com';
    return new URL(signServerUrl).host;
}

function firstDefinedString(values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return null;
}

function extractAuthenticatedBroadcasterId(accountInfo) {
    const data = accountInfo?.data || accountInfo || {};

    return normalizeBroadcasterId(firstDefinedString([
        data.username,
        data.unique_id,
        data.uniqueId,
        data.display_id,
        data.displayId,
        data.screen_name,
        data.screenName,
        data.user?.username,
        data.user?.unique_id,
        data.user?.uniqueId,
        data.user?.display_id,
        data.user?.displayId,
        data.user?.screen_name,
        data.user?.screenName,
        data.account?.username,
        data.account?.unique_id,
        data.account?.uniqueId,
        data.account?.display_id,
        data.account?.displayId,
        data.account?.screen_name,
        data.account?.screenName
    ]));
}

async function fetchAuthenticatedTikTokAccountInfo(sessionId, ttTargetIdc) {
    const webClient = new TikTokWebClient({
        customHeaders: {
            ...TIKTOK_JA_LOCALE_HEADERS
        },
        axiosOptions: {},
        clientParams: {
            ...TIKTOK_JA_LOCALE_CLIENT_PARAMS
        },
        authenticateWs: Boolean(sessionId && ttTargetIdc)
    });

    if (typeof webClient.cookieJar?.setSession === 'function') {
        webClient.cookieJar.setSession(sessionId, ttTargetIdc);
    }

    return webClient.getJsonObjectFromTikTokApi('passport/web/account/info/');
}

const TIME_ZONE = 'Asia/Tokyo';
const BROADCASTER_ID_STATE_KEY = 'tiktok_broadcaster_id';
const DISPLAY_STATE_KEY = 'active_day_key';
const CONTRIBUTORS_DISPLAY_RANGE_STATE_KEY = 'contributors_display_range';
const CONTRIBUTORS_SESSION_STARTED_AT_STATE_KEY = 'contributors_session_started_at';
const CONTRIBUTORS_SESSION_ENDED_AT_STATE_KEY = 'contributors_session_ended_at';
const DISPLAY_THRESHOLD_STATE_KEY = 'display_threshold';
const GOAL_COUNT_STATE_KEY = 'display_goal_count';
const DISPLAY_AVATAR_VISIBILITY_STATE_KEY = 'display_avatar_visibility';
const DISPLAY_FONT_FAMILY_STATE_KEY = 'display_font_family';
const DISPLAY_COLOR_THEME_STATE_KEY = 'display_color_theme';
const DISPLAY_STROKE_WIDTH_STATE_KEY = 'display_stroke_width';
const COMMENT_SETTINGS_STATE_KEY = 'comment_feed_settings';
const EFFECT_EVENTS_STATE_KEY = 'effect_events';
const EFFECT_TRIGGERS_STATE_KEY = 'effect_triggers';
const WIDGET_TOP_GIFT_SETTINGS_STATE_KEY = 'widget_top_gift_settings';
const WIDGET_GOAL_GIFTS_STATE_KEY = 'widget_goal_gifts';
const WIDGET_GOAL_GIFTS_FONT_STATE_KEY = 'widget_goal_gifts_font';
const WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY = 'widget_goal_gifts_text_style';
const WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY = 'widget_goal_gifts_stroke_width';
const WIDGET_GOAL_GIFT_ACTIVITY_COUNTS_STATE_KEY = 'widget_goal_gift_activity_counts';
const EFFECT_SCREEN_COUNT = 10;
const DEFAULT_DISPLAY_THRESHOLD = 1000;
const DEFAULT_GOAL_COUNT = 10;
const DEFAULT_CONTRIBUTORS_DISPLAY_RANGE = 'today';
const DEFAULT_DISPLAY_SORT_ORDER = 'qualified_at_asc';
const DEFAULT_DISPLAY_AVATAR_VISIBILITY = 'show';
const DEFAULT_DISPLAY_FONT_FAMILY = 'default';
const DEFAULT_DISPLAY_COLOR_THEME = 'gold-night';
const DEFAULT_DISPLAY_STROKE_WIDTH = 4;
const MAX_DISPLAY_STROKE_WIDTH = 12;
const TIKTOK_GIFT_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_GOAL_GIFT_WIDGET_ITEMS = 10;
const DEFAULT_WIDGET_TOP_GIFT_SETTINGS = {
    title: '本日最高ギフト',
    senderDisplayMode: 'latest'
};
const DEFAULT_GOAL_GIFT_WIDGET_ITEM = {
    enabled: false,
    giftId: '',
    giftName: '',
    displayName: '',
    note: '',
    giftImage: '',
    targetCount: 1,
    currentCountOffset: 0,
    resetAtMidnight: false,
    currentCountOffsetDayKey: ''
};
const DEFAULT_GOAL_GIFT_WIDGET_FONT_KEY = 'default';
const DEFAULT_GOAL_GIFT_WIDGET_TEXT_STYLE_KEY = 'gold-night';
const DEFAULT_GOAL_GIFT_WIDGET_STROKE_WIDTH = 3;
const MAX_GOAL_GIFT_WIDGET_STROKE_WIDTH = 24;
const GOAL_GIFT_SYSTEM_IDS = {
    like: '__system__:like',
    follow: '__system__:follow'
};
const GOAL_GIFT_SYSTEM_LABELS = {
    [GOAL_GIFT_SYSTEM_IDS.like]: 'タップ',
    [GOAL_GIFT_SYSTEM_IDS.follow]: 'フォロー'
};
const TIKTOK_JA_LOCALE_CLIENT_PARAMS = {
    app_language: 'ja',
    browser_language: 'ja-JP',
    webcast_language: 'ja',
    priority_region: 'JP',
    region: 'JP',
    tz_name: 'Asia/Tokyo'
};
const TIKTOK_JA_LOCALE_HEADERS = {
    'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8'
};
const RECONNECT_DELAY_MS = 30000;
const BROADCASTER_ID_RESOLUTION_RETRY_DELAY_MS = RECONNECT_DELAY_MS;
const RAW_EVENT_BATCH_SIZE = 100;
const RAW_EVENT_FLUSH_DELAY_MS = 250;
const RAW_EVENT_RETRY_DELAY_MS = 1000;
const LIVE_COMMENT_HISTORY_LIMIT = 100;
const COMMENT_FEED_EVENT_DEFINITIONS = [
    { type: 'chat', label: 'コメント', system: false },
    { type: 'member', label: '入室', system: true },
    { type: 'like', label: 'いいね', system: true },
    { type: 'social', label: 'ソーシャル', system: true },
    { type: 'follow', label: 'フォロー', system: true },
    { type: 'share', label: 'シェア', system: true },
    { type: 'questionNew', label: '質問', system: true },
    { type: 'roomUser', label: '視聴者数', system: true },
    { type: 'subscribe', label: 'サブスク', system: true },
    { type: 'emote', label: 'エモート', system: true },
    { type: 'envelope', label: '宝箱', system: true },
    { type: 'liveIntro', label: 'ライブ紹介', system: true },
    { type: 'streamEnd', label: '配信終了', system: true },
    { type: 'goalUpdate', label: 'ゴール更新', system: true },
    { type: 'roomMessage', label: 'ルームメッセージ', system: true },
    { type: 'captionMessage', label: '字幕', system: true },
    { type: 'imDelete', label: '削除', system: true },
    { type: 'unauthorizedMember', label: '制限メンバー', system: true },
    { type: 'inRoomBanner', label: 'ルームバナー', system: true },
    { type: 'rankUpdate', label: 'ランキング更新', system: true },
    { type: 'pollMessage', label: '投票', system: true },
    { type: 'rankText', label: 'ランキング表示', system: true },
    { type: 'oecLiveShopping', label: 'ライブショッピング', system: true },
    { type: 'msgDetect', label: 'メッセージ検知', system: true },
    { type: 'linkMessage', label: 'リンクメッセージ', system: true },
    { type: 'roomVerify', label: 'ルーム認証', system: true },
    { type: 'linkLayer', label: 'リンクレイヤー', system: true },
    { type: 'roomPin', label: '固定メッセージ', system: true }
];
const IS_ELECTRON = Boolean(process.env.ELECTRON_RUN);
const serverEvents = new EventEmitter();
const ENV_TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.trim() || '';
let TIKTOK_SESSION_ID = process.env.TIKTOK_SESSION_ID?.trim() || null;
let TIKTOK_TT_TARGET_IDC = process.env.TIKTOK_TT_TARGET_IDC?.trim() || null;
let HAS_TIKTOK_WS_AUTH = Boolean(TIKTOK_SESSION_ID && TIKTOK_TT_TARGET_IDC);
const AUTO_OPEN_BROWSER = !IS_ELECTRON && normalizeBooleanEnv(process.env.AUTO_OPEN_BROWSER, process.platform === 'win32');
const APP_START_PATH = normalizeStartPath(process.env.APP_START_PATH);
const PUBLIC_DIRECTORY = path.join(BACKEND_ROOT, 'public');
const DB_STATIC_DIRECTORY = path.join(PUBLIC_DIRECTORY, 'db');
const EFFECT_MEDIA_ROOT_DIRECTORY = path.join(USER_DATA_DIRECTORY, 'effects-media');

let currentBroadcasterId = null;
let tiktokLiveConnection = null;
let activeTikTokUsername = null;
let cachedTikTokGiftCatalog = {
    broadcasterId: null,
    fetchedAt: 0,
    gifts: []
};
let activeTikTokGiftCatalogPromise = null;
let tiktokConnectionState = {
    status: 'idle',
    message: 'TikTok接続はまだ開始していません。',
    transportMethod: 'unknown',
    websocketReasonCode: null,
    websocketReasonLabel: null,
    websocketReasonDetail: null,
    wsAuthAvailable: HAS_TIKTOK_WS_AUTH,
    retryScheduled: false,
    retryReason: null,
    retryDelayMs: null,
    broadcasterId: null,
    updatedAt: new Date().toISOString()
};

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*' }
});

const dbStore = createDbStore({
    appRoot: APP_ROOT,
    userDataDirectory: USER_DATA_DIRECTORY
});
const DB_PATH = dbStore.dbPath;

const effectMediaUpload = multer({
    storage: multer.diskStorage({
        destination(req, file, callback) {
            try {
                const directory = getEffectMediaDirectory();
                fs.mkdirSync(directory, { recursive: true });
                callback(null, directory);
            } catch (error) {
                callback(error);
            }
        },
        filename(req, file, callback) {
            const extension = path.extname(file.originalname || '').slice(0, 16).toLowerCase();
            const safeExtension = /^[.][a-z0-9]+$/.test(extension) ? extension : '';
            callback(null, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${safeExtension}`);
        }
    }),
    limits: {
        fileSize: 1024 * 1024 * 250
    },
    fileFilter(req, file, callback) {
        const mimeType = String(file.mimetype || '').toLowerCase();

        if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
            callback(null, true);
            return;
        }

        callback(new Error('動画または音声ファイルのみ取り込めます。'));
    }
});

if (dbStore.migratedLegacyFiles.length > 0) {
    console.log(`ℹ️ Migrated legacy data files to ${path.dirname(DB_PATH)}: ${dbStore.migratedLegacyFiles.join(', ')}`);
}

app.use(express.json());

app.use('/api/overlay', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    return next();
});

function sendContributorsOverlayHtml(res) {
    res.type('html').send(renderContributorsOverlayHtml({ backendOrigin: '' }));
}

function escapeHtmlForOverlay(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildEffectOverlayHtml(slot, config) {
    const title = config?.name || `Screen ${slot}`;
    const hasVideo = Boolean(config?.videoAssetUrl);
    const hasAudio = Boolean(config?.audioAssetUrl);

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtmlForOverlay(title)}</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root {
            color-scheme: light;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            font-family: "Segoe UI", "Yu Gothic UI", sans-serif;
            background: transparent;
            color: #f8fafc;
            overflow: hidden;
        }

        video {
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            object-fit: contain;
            display: none;
        }

        .debug-card {
            position: fixed;
            left: 16px;
            bottom: 16px;
            width: min(360px, calc(100vw - 32px));
            padding: 14px 16px;
            border-radius: 18px;
            background: rgba(15, 23, 42, 0.72);
            border: 1px solid rgba(148, 163, 184, 0.32);
            backdrop-filter: blur(18px);
            box-shadow: 0 16px 40px rgba(15, 23, 42, 0.24);
            opacity: 0;
            pointer-events: none;
            transition: opacity 160ms ease;
        }

        body.debug .debug-card {
            opacity: 1;
        }

        .slot {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 4px 10px;
            border-radius: 999px;
            background: rgba(59, 130, 246, 0.22);
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        h1 {
            margin: 12px 0 8px;
            font-size: 24px;
            line-height: 1.15;
        }

        p {
            margin: 0;
            color: rgba(226, 232, 240, 0.86);
            line-height: 1.6;
            font-size: 13px;
        }

        dl {
            margin: 16px 0 0;
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 8px 12px;
            font-size: 13px;
        }

        dt {
            color: rgba(148, 163, 184, 0.96);
        }

        dd {
            margin: 0;
        }
    </style>
</head>
<body>
    <aside class="debug-card" id="debug-card" aria-live="polite">
        <div class="slot">slot ${slot}</div>
        <h1>${escapeHtmlForOverlay(title)}</h1>
        <p>通常は透過のまま待機し、受信したイベントだけを再生します。?debug=1 を付けたときだけこの情報を表示します。</p>
        <dl>
            <dt>Video</dt>
            <dd>${escapeHtmlForOverlay(hasVideo ? config.videoAssetName || 'configured' : 'none')}</dd>
            <dt>Audio</dt>
            <dd>${escapeHtmlForOverlay(hasAudio ? config.audioAssetName || 'configured' : 'none')}</dd>
        </dl>
        <p id="debug-log"></p>
    </aside>
    <video id="effect-video" playsinline preload="auto"></video>
    <audio id="effect-audio" preload="auto"></audio>
    <script>
        const params = new URLSearchParams(window.location.search);
        document.body.classList.toggle('debug', params.get('debug') === '1');
        const slot = ${slot};
        const socket = io();
        const video = document.getElementById('effect-video');
        const audio = document.getElementById('effect-audio');
        const debugLog = document.getElementById('debug-log');
        let activePlaybackId = null;
        let playbackQueue = [];
        let isPlaying = false;
        let audioEnded = true;
        let videoEnded = true;

        function updateDebugLog(message) {
            debugLog.textContent = message || '';
        }

        function finishPlayback() {
            if (!isPlaying) {
                return;
            }

            stopMedia();
            isPlaying = false;
            processPlaybackQueue();
        }

        function stopMedia() {
            video.pause();
            audio.pause();
            video.removeAttribute('src');
            audio.removeAttribute('src');
            video.load();
            audio.load();
            video.style.display = 'none';
            activePlaybackId = null;
        }

        video.addEventListener('ended', () => {
            videoEnded = true;

            if (audioEnded) {
                finishPlayback();
            }
        });

        audio.addEventListener('ended', () => {
            audioEnded = true;

            if (videoEnded) {
                finishPlayback();
            }
        });

        async function processPlaybackQueue() {
            if (isPlaying || playbackQueue.length === 0) {
                return;
            }

            const payload = playbackQueue.shift();
            isPlaying = true;
            activePlaybackId = payload.playbackId || String(Date.now());
            videoEnded = !payload.videoUrl;
            audioEnded = !payload.audioUrl;
            updateDebugLog((payload.eventName || 'event') + ' / ' + (payload.uniqueId || '') + ' / ' + (payload.giftName || ''));

            try {
                if (payload.videoUrl) {
                    video.src = payload.videoUrl;
                    video.currentTime = 0;
                    video.volume = Math.max(0, Math.min(1, Number(payload.mediaVolume || 100) / 100));
                    video.style.display = 'block';
                    await video.play().catch(() => null);
                } else {
                    video.style.display = 'none';
                }

                if (payload.audioUrl) {
                    audio.src = payload.audioUrl;
                    audio.currentTime = 0;
                    audio.volume = Math.max(0, Math.min(1, Number(payload.mediaVolume || 100) / 100));
                    await audio.play().catch(() => null);
                }
            } catch (error) {
                updateDebugLog(error && error.message ? error.message : 'playback failed');
                finishPlayback();
                return;
            }

            if (!payload.videoUrl && !payload.audioUrl) {
                updateDebugLog('再生するメディアが設定されていません。');
                finishPlayback();
                return;
            }

            if (videoEnded && audioEnded) {
                finishPlayback();
            }
        }

        socket.on('effects:playback', async (payload) => {
            if (!payload || payload.screen !== slot) {
                return;
            }

            const playbackCount = Math.max(1, Number(payload.playbackCount || 1));

            for (let index = 0; index < playbackCount; index += 1) {
                playbackQueue.push({
                    ...payload,
                    playbackId: String(payload.playbackId || Date.now()) + '-' + index
                });
            }

            processPlaybackQueue();
        });
    </script>
</body>
</html>`;
}

function getRequestOrigin(req) {
    return `${req.protocol}://${req.get('host')}`;
}

function buildStudioCompatibleHostname(hostname) {
    const normalizedHostname = String(hostname || '').trim().toLowerCase();
    if (!normalizedHostname) {
        return '127.0.0.1.sslip.io';
    }

    if (normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1' || normalizedHostname === '[::1]') {
        return '127.0.0.1.sslip.io';
    }

    return normalizedHostname;
}

function getStudioCompatibleOrigin(req) {
    const requestOrigin = new URL(getRequestOrigin(req));
    requestOrigin.hostname = buildStudioCompatibleHostname(requestOrigin.hostname);
    return requestOrigin.toString().replace(/\/+$/u, '');
}

function buildEffectOverlayUrls(req) {
    const origin = getStudioCompatibleOrigin(req);

    return Array.from({ length: EFFECT_SCREEN_COUNT }, (_, index) => ({
        slot: index + 1,
        url: `${origin}/overlays/effects/${index + 1}`
    }));
}

function buildWidgetUrls(req) {
    const origin = getStudioCompatibleOrigin(req);

    return {
        contributorsOverlayUrl: `${origin}/overlays/contributors`,
        topGiftOverlayUrl: `${origin}/overlays/top-gift`,
        goalGiftsOverlayUrl: `${origin}/overlays/goal-gifts`
    };
}

app.get('/', (req, res) => {
    return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'home.html'));
});

app.get('/index.html', (req, res) => {
    return res.redirect('/');
});

app.get('/setup', (req, res) => {
    return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'setup.html'));
});

app.get('/setup.html', (req, res) => {
    return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'setup.html'));
});

app.get('/comments', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'comments.html'));
});

app.get('/comments.html', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.redirect('/comments');
});

app.get('/gifts', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'gifts.html'));
});

app.get('/gifts.html', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.redirect('/gifts');
});

app.get('/effects', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'effects.html'));
});

app.get('/effects.html', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.redirect('/effects');
});

app.get('/widgets', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'widgets.html'));
});

app.get('/widgets.html', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.redirect('/widgets');
});

app.use('/media/effects', express.static(EFFECT_MEDIA_ROOT_DIRECTORY, {
    setHeaders(res) {
        res.setHeader('Cache-Control', 'no-store');
    }
}));

app.get('/overlays/contributors', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return sendContributorsOverlayHtml(res);
});

app.get('/overlays/contributors/index.html', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return sendContributorsOverlayHtml(res);
});

app.get('/overlays/effects/:slot', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    const slot = Number.parseInt(req.params.slot, 10);

    if (!Number.isInteger(slot) || slot < 1 || slot > EFFECT_SCREEN_COUNT) {
        return res.status(404).send('Effect overlay slot not found');
    }

    const config = getEffectEvents().find((item) => item.screen === slot) || createDefaultEffectEvent(slot);
    return res.type('html').send(buildEffectOverlayHtml(slot, config));
});

app.get('/overlays/effects/:slot/index.html', (req, res) => {
    return res.redirect(`/overlays/effects/${req.params.slot}`);
});

app.get(['/overlays/top-gift', '/overlays/widgets/top-gift'], (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'top-gift.html'));
});

app.get(['/overlays/top-gift/index.html', '/overlays/widgets/top-gift/index.html'], (req, res) => {
    return res.redirect('/overlays/top-gift');
});

app.get(['/overlays/goal-gifts', '/overlays/widgets/goal-gifts'], (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'goal-gifts.html'));
});

app.get(['/overlays/goal-gifts/index.html', '/overlays/widgets/goal-gifts/index.html'], (req, res) => {
    return res.redirect('/overlays/goal-gifts');
});

app.use(express.static(PUBLIC_DIRECTORY, {
    setHeaders(res) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));

function getTimestamp() {
    return new Date().toISOString();
}

function getDayKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);

    const year = parts.find((part) => part.type === 'year').value;
    const month = parts.find((part) => part.type === 'month').value;
    const day = parts.find((part) => part.type === 'day').value;

    return `${year}-${month}-${day}`;
}

function shiftDayKey(dayKey, offsetDays) {
    const [year, month, day] = dayKey.split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    value.setUTCDate(value.getUTCDate() + offsetDays);
    return value.toISOString().slice(0, 10);
}

function normalizeDayKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeWholeNumber(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizePositiveHundreds(value) {
    const parsed = normalizeWholeNumber(value);
    return parsed !== null && parsed > 0 && parsed % 100 === 0 ? parsed : null;
}

function normalizeDisplayAvatarVisibility(value) {
    return value === 'hide' ? 'hide' : 'show';
}

function normalizeBooleanInput(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    if (typeof value !== 'string') {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();

    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return fallback;
}

function normalizeHexColor(value, fallback) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : fallback;
}

function normalizeSignedWholeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : fallback;
}

function tryListen(port) {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            httpServer.off('listening', onListening);
            reject(error);
        };

        const onListening = () => {
            httpServer.off('error', onError);
            resolve();
        };

        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(port);
    });
}

function normalizeBooleanEnv(value, fallback) {
    if (typeof value !== 'string' || value.trim() === '') {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();

    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return fallback;
}

function normalizeStartPath(value) {
    if (typeof value !== 'string' || value.trim() === '') {
        return DEFAULT_APP_START_PATH;
    }

    const trimmed = value.trim();
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function loadEnvFile(filePath) {
    const values = readEnvFileValues(filePath);

    for (const [key, value] of Object.entries(values)) {
        if (process.env[key] !== undefined) {
            continue;
        }

        process.env[key] = value;
    }
}

function readEnvFileValues(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    const values = {};
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');

        if (separatorIndex <= 0) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();

        if (!key) {
            continue;
        }

        let value = line.slice(separatorIndex + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

function loadPersistedAuthEnv(filePath) {
    const values = readEnvFileValues(filePath);
    const persistedSessionId = values.TIKTOK_SESSION_ID?.trim();
    const persistedTtTargetIdc = values.TIKTOK_TT_TARGET_IDC?.trim();

    if ((!process.env.TIKTOK_SESSION_ID || !process.env.TIKTOK_SESSION_ID.trim()) && persistedSessionId) {
        process.env.TIKTOK_SESSION_ID = persistedSessionId;
    }

    if ((!process.env.TIKTOK_TT_TARGET_IDC || !process.env.TIKTOK_TT_TARGET_IDC.trim()) && persistedTtTargetIdc) {
        process.env.TIKTOK_TT_TARGET_IDC = persistedTtTargetIdc;
    }
}

function persistAuthEnvFile(filePath, sessionId, ttTargetIdc) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const lines = [
        '# Auto-generated TikTok auth credentials for Electron login.',
        '# This file is stored in the current user\'s AppData directory.',
        `TIKTOK_SESSION_ID=${sessionId || ''}`,
        `TIKTOK_TT_TARGET_IDC=${ttTargetIdc || ''}`,
        ''
    ];

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');

    if (process.platform !== 'win32') {
        try {
            fs.chmodSync(filePath, 0o600);
        } catch {
            // Best-effort only.
        }
    }
}

function clearPersistedAuthEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return;
    }

    try {
        fs.unlinkSync(filePath);
    } catch {
        persistAuthEnvFile(filePath, '', '');
    }
}

function resolveUserDataDirectory() {
    const configuredDirectory = process.env.APP_DATA_DIR?.trim();

    if (configuredDirectory) {
        return path.resolve(configuredDirectory);
    }

    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local');
        return path.join(localAppData, APP_NAME);
    }

    return path.join(os.homedir(), '.tikeffect');
}

function openBrowser(url) {
    try {
        if (process.platform === 'win32') {
            const command = process.env.COMSPEC || 'cmd.exe';
            const child = spawn(command, ['/c', 'start', '', url], {
                detached: true,
                stdio: 'ignore'
            });

            child.unref();
            return true;
        }

        if (process.platform === 'darwin') {
            const child = spawn('open', [url], {
                detached: true,
                stdio: 'ignore'
            });

            child.unref();
            return true;
        }

        const child = spawn('xdg-open', [url], {
            detached: true,
            stdio: 'ignore'
        });

        child.unref();
        return true;
    } catch (error) {
        console.warn(`⚠️ Failed to open browser automatically: ${error.message}`);
        return false;
    }
}

function isLoopbackAddress(address) {
    if (!address) {
        return false;
    }

    const normalizedAddress = address.trim();

    return normalizedAddress === '127.0.0.1'
        || normalizedAddress === '::1'
        || normalizedAddress === '::ffff:127.0.0.1';
}

function isLoopbackRequest(req) {
    return isLoopbackAddress(req.ip)
        || isLoopbackAddress(req.socket?.remoteAddress)
        || isLoopbackAddress(req.connection?.remoteAddress);
}

function closeHttpServer() {
    return new Promise((resolve, reject) => {
        if (!httpServer.listening) {
            resolve();
            return;
        }

        httpServer.close((error) => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

function normalizePositiveWholeNumber(value) {
    const parsed = normalizeWholeNumber(value);
    return parsed !== null && parsed > 0 ? parsed : null;
}

function normalizeNickname(value) {
    const trimmedValue = typeof value === 'string' ? value.trim() : '';
    if (!trimmedValue) {
        return null;
    }

    if (/^[?？]+$/.test(trimmedValue)) {
        return null;
    }

    return trimmedValue;
}

function normalizeBroadcasterId(value) {
    const trimmedValue = typeof value === 'string' ? value.trim() : '';
    const normalizedValue = trimmedValue.replace(/^@+/, '');

    if (!normalizedValue || /\s/.test(normalizedValue)) {
        return null;
    }

    return normalizedValue;
}

function getTodayDayKey() {
    return getDayKey();
}

function normalizeStoredTimestamp(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    const parsedValue = Date.parse(value);
    return Number.isFinite(parsedValue) ? new Date(parsedValue).toISOString() : null;
}

function getYesterdayDayKey() {
    return shiftDayKey(getTodayDayKey(), -1);
}

function normalizeContributorsDisplayRange(value) {
    return String(value || '').trim().toLowerCase() === 'session'
        ? 'session'
        : DEFAULT_CONTRIBUTORS_DISPLAY_RANGE;
}

function getContributorsDisplayRange() {
    return normalizeContributorsDisplayRange(getScopedStateValue(CONTRIBUTORS_DISPLAY_RANGE_STATE_KEY));
}

function setContributorsDisplayRange(value) {
    const normalizedValue = normalizeContributorsDisplayRange(value);
    setScopedStateValue(CONTRIBUTORS_DISPLAY_RANGE_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function getContributorsSessionState() {
    const startedAt = normalizeStoredTimestamp(getScopedStateValue(CONTRIBUTORS_SESSION_STARTED_AT_STATE_KEY));
    const endedAt = normalizeStoredTimestamp(getScopedStateValue(CONTRIBUTORS_SESSION_ENDED_AT_STATE_KEY));
    const resolvedEndedAt = startedAt && endedAt && endedAt >= startedAt ? endedAt : null;

    return {
        startedAt,
        endedAt: resolvedEndedAt,
        isActive: Boolean(startedAt && !resolvedEndedAt)
    };
}

function startContributorsSession(startedAt = getTimestamp()) {
    const normalizedStartedAt = normalizeStoredTimestamp(startedAt) || getTimestamp();
    setScopedStateValue(CONTRIBUTORS_SESSION_STARTED_AT_STATE_KEY, normalizedStartedAt);
    setScopedStateValue(CONTRIBUTORS_SESSION_ENDED_AT_STATE_KEY, '');
    return getContributorsSessionState();
}

function finishContributorsSession(endedAt = getTimestamp()) {
    const currentSession = getContributorsSessionState();

    if (!currentSession.startedAt) {
        return currentSession;
    }

    if (currentSession.endedAt) {
        return currentSession;
    }

    const normalizedEndedAt = normalizeStoredTimestamp(endedAt) || getTimestamp();
    setScopedStateValue(CONTRIBUTORS_SESSION_ENDED_AT_STATE_KEY, normalizedEndedAt);
    return getContributorsSessionState();
}

function buildContributorsDisplayContext(dayKey) {
    const rangeMode = getContributorsDisplayRange();
    const session = getContributorsSessionState();

    if (rangeMode === 'session') {
        return {
            rangeMode,
            dayKey: getTodayDayKey(),
            session,
            effectiveSessionEndedAt: session.startedAt
                ? (session.isActive ? getTimestamp() : session.endedAt)
                : null
        };
    }

    return {
        rangeMode,
        dayKey: normalizeDayKey(dayKey) || getTodayDayKey(),
        session,
        effectiveSessionEndedAt: session.endedAt
    };
}

function getDisplayDayKey() {
    return getScopedStateValue(DISPLAY_STATE_KEY) || getTodayDayKey();
}

function getDisplayGoalCount() {
    const storedValue = Number(getScopedStateValue(GOAL_COUNT_STATE_KEY));
    return Number.isInteger(storedValue) && storedValue >= 0 ? storedValue : DEFAULT_GOAL_COUNT;
}

function getDisplayThreshold() {
    const storedValue = normalizePositiveHundreds(getScopedStateValue(DISPLAY_THRESHOLD_STATE_KEY));
    return storedValue ?? DEFAULT_DISPLAY_THRESHOLD;
}

function setDisplayThreshold(value) {
    const normalizedValue = normalizePositiveHundreds(value);

    if (normalizedValue === null) {
        return getDisplayThreshold();
    }

    setScopedStateValue(DISPLAY_THRESHOLD_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function getDisplayAvatarVisibility() {
    return normalizeDisplayAvatarVisibility(getScopedStateValue(DISPLAY_AVATAR_VISIBILITY_STATE_KEY));
}

function setDisplayAvatarVisibility(value) {
    const normalizedValue = normalizeDisplayAvatarVisibility(value);
    setScopedStateValue(DISPLAY_AVATAR_VISIBILITY_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeDisplayColorTheme(value) {
    const normalizedValue = normalizeEffectText(value, 32).toLowerCase();
    const aliases = {
        gold_black: 'gold-night',
        white_black: 'mono-impact',
        mint_navy: 'mint-lime',
        pink_burgundy: 'candy-pop',
        sky_royal: 'ice-night',
        neon_lime: 'lemon-pop',
        sakura_plum: 'sakura-bloom',
        sunset_fire: 'sunset-party',
        ice_silver: 'ice-night',
        citrus_forest: 'emerald-city'
    };
    const resolvedValue = aliases[normalizedValue] || normalizedValue;
    const allowedKeys = new Set([
        'gold-night',
        'ice-night',
        'candy-pop',
        'mint-lime',
        'sunset-party',
        'violet-flash',
        'mono-impact',
        'sakura-bloom',
        'ocean-glow',
        'emerald-city',
        'ruby-flare',
        'lemon-pop',
        'midnight-aqua',
        'peach-fizz',
        'festival-red',
        'rose-gold',
        'cyber-teal',
        'aurora-dream',
        'coral-soda',
        'platinum-pop',
        'champagne-shine',
        'royal-velvet',
        'emerald-luxe',
        'sunrise-opal'
    ]);

    return allowedKeys.has(resolvedValue) ? resolvedValue : DEFAULT_DISPLAY_COLOR_THEME;
}

function getDisplayColorTheme() {
    return normalizeDisplayColorTheme(getScopedStateValue(DISPLAY_COLOR_THEME_STATE_KEY));
}

function setDisplayColorTheme(value) {
    const normalizedValue = normalizeDisplayColorTheme(value);
    setScopedStateValue(DISPLAY_COLOR_THEME_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeDisplayStrokeWidth(value) {
    const normalizedValue = normalizeWholeNumber(value);

    if (!Number.isInteger(normalizedValue) || normalizedValue < 1) {
        return DEFAULT_DISPLAY_STROKE_WIDTH;
    }

    return Math.min(normalizedValue, MAX_DISPLAY_STROKE_WIDTH);
}

function getDisplayStrokeWidth() {
    return normalizeDisplayStrokeWidth(getScopedStateValue(DISPLAY_STROKE_WIDTH_STATE_KEY));
}

function setDisplayStrokeWidth(value) {
    const normalizedValue = normalizeDisplayStrokeWidth(value);
    setScopedStateValue(DISPLAY_STROKE_WIDTH_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function setDisplayGoalCount(value) {
    const normalizedValue = normalizeWholeNumber(value);

    if (normalizedValue === null) {
        return getDisplayGoalCount();
    }

    setScopedStateValue(GOAL_COUNT_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function setDisplayDayKey(dayKey) {
    return setScopedStateValue(DISPLAY_STATE_KEY, dayKey);
}

function normalizeWidgetTopGiftSettings(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        source = {};
    }

    return {
        title: normalizeEffectText(source.title, 40) || DEFAULT_WIDGET_TOP_GIFT_SETTINGS.title,
        senderDisplayMode: String(source.senderDisplayMode || '').trim().toLowerCase() === 'all'
            ? 'all'
            : DEFAULT_WIDGET_TOP_GIFT_SETTINGS.senderDisplayMode
    };
}

function getWidgetTopGiftSettings() {
    return normalizeWidgetTopGiftSettings(getScopedStateValue(WIDGET_TOP_GIFT_SETTINGS_STATE_KEY));
}

function setWidgetTopGiftSettings(settings) {
    const normalizedSettings = normalizeWidgetTopGiftSettings(settings);
    setScopedStateValue(WIDGET_TOP_GIFT_SETTINGS_STATE_KEY, JSON.stringify(normalizedSettings));
    return normalizedSettings;
}

function getSharedWidgetTextAppearance() {
    return {
        fontKey: getDisplayFontFamily(),
        textStyleKey: getDisplayColorTheme(),
        strokeWidth: getDisplayStrokeWidth()
    };
}

function normalizeGoalGiftFontKey(value) {
    const normalizedValue = normalizeEffectText(value, 32).toLowerCase();
    const aliases = {
        robot: 'gothic',
        roboto: 'gothic',
        shippori: 'luxury-mincho',
        'cyber-core': 'pixel-code',
        'neon-grid': 'pixel-code',
        'signal-runner': 'pixel-code'
    };
    const resolvedValue = aliases[normalizedValue] || normalizedValue;
    const allowedKeys = new Set([
        'default',
        'gothic',
        'ui-gothic',
        'mincho',
        'ud-gothic',
        'ud-mincho',
        'meiryo',
        'rounded',
        'kyokasho',
        'gyosho',
        'togarie',
        'ln-pop',
        'comic-impact',
        'pop-idol',
        'entame',
        'marker',
        'retro-bold',
        'luxury-mincho',
        'antique-modern',
        'atelier-brush',
        'pixel-code'
    ]);

    return allowedKeys.has(resolvedValue) ? resolvedValue : DEFAULT_GOAL_GIFT_WIDGET_FONT_KEY;
}

function getGoalGiftWidgetFontKey() {
    return normalizeGoalGiftFontKey(getScopedStateValue(WIDGET_GOAL_GIFTS_FONT_STATE_KEY));
}

function setGoalGiftWidgetFontKey(value) {
    const normalizedValue = normalizeGoalGiftFontKey(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_FONT_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeDisplayFontFamily(value) {
    const normalizedValue = normalizeEffectText(value, 32).toLowerCase();
    const aliases = {
        notosans: 'gothic',
        roboto: 'gothic',
        robot: 'gothic',
        rounded: 'default',
        mincho: 'ud-mincho',
        decol: 'retro-bold',
        magic: 'marker',
        gothic_heavy: 'togarie',
        maru_pop: 'pop-idol',
        dot: 'default',
        display: 'comic-impact',
        klee: 'kyokasho',
        shippori: 'luxury-mincho',
        reggae: 'entame',
        'cyber-core': 'pixel-code',
        'neon-grid': 'pixel-code',
        'signal-runner': 'pixel-code'
    };
    const resolvedValue = aliases[normalizedValue] || normalizedValue;

    return normalizeGoalGiftFontKey(resolvedValue);
}

function getDisplayFontFamily() {
    return normalizeDisplayFontFamily(getScopedStateValue(DISPLAY_FONT_FAMILY_STATE_KEY));
}

function setDisplayFontFamily(value) {
    const normalizedValue = normalizeDisplayFontFamily(value);
    setScopedStateValue(DISPLAY_FONT_FAMILY_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeGoalGiftTextStyleKey(value) {
    const normalizedValue = normalizeEffectText(value, 32).toLowerCase();
    const allowedKeys = new Set([
        'gold-night',
        'ice-night',
        'candy-pop',
        'mint-lime',
        'sunset-party',
        'violet-flash',
        'mono-impact',
        'sakura-bloom',
        'ocean-glow',
        'emerald-city',
        'ruby-flare',
        'lemon-pop',
        'midnight-aqua',
        'peach-fizz',
        'festival-red',
        'rose-gold',
        'cyber-teal',
        'aurora-dream',
        'coral-soda',
        'platinum-pop',
        'champagne-shine',
        'royal-velvet',
        'emerald-luxe',
        'sunrise-opal'
    ]);

    return allowedKeys.has(normalizedValue) ? normalizedValue : DEFAULT_GOAL_GIFT_WIDGET_TEXT_STYLE_KEY;
}

function getGoalGiftWidgetTextStyleKey() {
    return normalizeGoalGiftTextStyleKey(getScopedStateValue(WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY));
}

function setGoalGiftWidgetTextStyleKey(value) {
    const normalizedValue = normalizeGoalGiftTextStyleKey(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeGoalGiftStrokeWidth(value) {
    const normalizedValue = normalizeWholeNumber(value);
    if (!Number.isInteger(normalizedValue) || normalizedValue < 0) {
        return DEFAULT_GOAL_GIFT_WIDGET_STROKE_WIDTH;
    }

    return Math.min(normalizedValue, MAX_GOAL_GIFT_WIDGET_STROKE_WIDTH);
}

function getGoalGiftSystemTypeById(value) {
    const normalizedValue = String(value || '').trim();

    if (normalizedValue === GOAL_GIFT_SYSTEM_IDS.like) {
        return 'like';
    }

    if (normalizedValue === GOAL_GIFT_SYSTEM_IDS.follow) {
        return 'follow';
    }

    return '';
}

function normalizeGoalGiftActivityCounts(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = {};
        }
    }

    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        source = {};
    }

    const normalized = {};

    Object.entries(source).forEach(([dayKey, counts]) => {
        const normalizedDayKey = normalizeDayKey(dayKey);

        if (!normalizedDayKey || !counts || typeof counts !== 'object' || Array.isArray(counts)) {
            return;
        }

        normalized[normalizedDayKey] = {
            like: normalizeWholeNumber(counts.like) || 0,
            follow: normalizeWholeNumber(counts.follow) || 0
        };
    });

    return normalized;
}

function getGoalGiftActivityCountsState() {
    return normalizeGoalGiftActivityCounts(getScopedStateValue(WIDGET_GOAL_GIFT_ACTIVITY_COUNTS_STATE_KEY));
}

function setGoalGiftActivityCountsState(value) {
    const normalizedValue = normalizeGoalGiftActivityCounts(value);
    setScopedStateValue(WIDGET_GOAL_GIFT_ACTIVITY_COUNTS_STATE_KEY, JSON.stringify(normalizedValue));
    return normalizedValue;
}

function getGoalGiftActivityCounts(dayKey = getTodayDayKey()) {
    const normalizedDayKey = normalizeDayKey(dayKey) || getTodayDayKey();
    const counts = getGoalGiftActivityCountsState()[normalizedDayKey] || {};

    return {
        like: normalizeWholeNumber(counts.like) || 0,
        follow: normalizeWholeNumber(counts.follow) || 0
    };
}

function incrementGoalGiftActivityCount(type, amount = 1, dayKey = getTodayDayKey()) {
    if (type !== 'like' && type !== 'follow') {
        return getGoalGiftActivityCounts(dayKey);
    }

    const normalizedAmount = normalizeWholeNumber(amount) || 0;
    const normalizedDayKey = normalizeDayKey(dayKey) || getTodayDayKey();

    if (normalizedAmount <= 0) {
        return getGoalGiftActivityCounts(normalizedDayKey);
    }

    const countsState = getGoalGiftActivityCountsState();
    const currentCounts = countsState[normalizedDayKey] || { like: 0, follow: 0 };
    countsState[normalizedDayKey] = {
        like: normalizeWholeNumber(currentCounts.like) || 0,
        follow: normalizeWholeNumber(currentCounts.follow) || 0,
        [type]: (normalizeWholeNumber(currentCounts[type]) || 0) + normalizedAmount
    };

    setGoalGiftActivityCountsState(countsState);
    return countsState[normalizedDayKey];
}

function getGoalGiftWidgetStrokeWidth() {
    return normalizeGoalGiftStrokeWidth(getScopedStateValue(WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY));
}

function setGoalGiftWidgetStrokeWidth(value) {
    const normalizedValue = normalizeGoalGiftStrokeWidth(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeGoalGiftWidgetItems(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = [];
        }
    }

    if (!Array.isArray(source)) {
        source = [];
    }

    return source.slice(0, MAX_GOAL_GIFT_WIDGET_ITEMS).map((item) => {
        const giftId = typeof item?.giftId === 'string' ? item.giftId.trim() : '';
        const systemType = getGoalGiftSystemTypeById(giftId);
        const giftName = normalizeEffectText(item?.giftName, 80) || (systemType ? GOAL_GIFT_SYSTEM_LABELS[giftId] : '');
        const displayName = normalizeEffectText(item?.displayName, 80);
        const note = normalizeEffectText(item?.note, 120);
        const giftImage = systemType ? '' : (typeof item?.giftImage === 'string' ? item?.giftImage.trim() : '');
        const targetCount = normalizeWholeNumber(item?.targetCount) || DEFAULT_GOAL_GIFT_WIDGET_ITEM.targetCount;
        const currentCountOffset = normalizeSignedWholeNumber(item?.currentCountOffset, DEFAULT_GOAL_GIFT_WIDGET_ITEM.currentCountOffset);
        const resetAtMidnight = normalizeBooleanInput(item?.resetAtMidnight, DEFAULT_GOAL_GIFT_WIDGET_ITEM.resetAtMidnight);
        const currentCountOffsetDayKey = normalizeDayKey(item?.currentCountOffsetDayKey) || '';

        return {
            enabled: Boolean(giftId || giftName),
            giftId,
            giftName: giftName || '',
            displayName: displayName || '',
            note: note || '',
            giftImage,
            targetCount,
            currentCountOffset,
            resetAtMidnight,
            currentCountOffsetDayKey: resetAtMidnight ? currentCountOffsetDayKey : ''
        };
    });
}

function getGoalGiftWidgetItems() {
    return normalizeGoalGiftWidgetItems(getScopedStateValue(WIDGET_GOAL_GIFTS_STATE_KEY));
}

function normalizeGoalGiftMatchName(value) {
    return normalizeEffectText(value, 80).toLowerCase();
}

function buildGoalGiftProgressSnapshot(
    dayKey = getTodayDayKey(),
    goalItems = getGoalGiftWidgetItems(),
    fontKey = getDisplayFontFamily(),
    textStyleKey = getDisplayColorTheme(),
    strokeWidth = getDisplayStrokeWidth()
) {
    const requestedDayKey = normalizeDayKey(dayKey) || getTodayDayKey();
    const broadcasterId = getBroadcasterId();
    const normalizedItems = normalizeGoalGiftWidgetItems(goalItems);
    const normalizedFontKey = normalizeGoalGiftFontKey(fontKey);
    const normalizedTextStyleKey = normalizeGoalGiftTextStyleKey(textStyleKey);
    const normalizedStrokeWidth = normalizeGoalGiftStrokeWidth(strokeWidth);

    if (!broadcasterId) {
        return {
            dayKey: requestedDayKey,
            broadcasterId: null,
            fontKey: normalizedFontKey,
            textStyleKey: normalizedTextStyleKey,
            strokeWidth: normalizedStrokeWidth,
            goals: normalizedItems.map((item, index) => ({
                slot: index + 1,
                ...item,
                currentCount: Math.max(0, item.resetAtMidnight && item.currentCountOffsetDayKey !== requestedDayKey ? 0 : item.currentCountOffset),
                observedCount: 0,
                completed: false,
                progressRatio: 0
            }))
        };
    }

    const gifts = dbStore.getAdminGiftEventsByDay(requestedDayKey, broadcasterId).map(hydrateStoredGiftEvent);
    const activityCounts = getGoalGiftActivityCounts(requestedDayKey);

    return {
        dayKey: requestedDayKey,
        broadcasterId,
        fontKey: normalizedFontKey,
        textStyleKey: normalizedTextStyleKey,
        strokeWidth: normalizedStrokeWidth,
        goals: normalizedItems.map((item, index) => {
            const systemType = getGoalGiftSystemTypeById(item.giftId);

            if (systemType) {
                const observedCount = normalizeWholeNumber(activityCounts[systemType]) || 0;
                const currentCountOffset = item.resetAtMidnight && item.currentCountOffsetDayKey !== requestedDayKey
                    ? 0
                    : item.currentCountOffset;
                const currentCount = Math.max(0, observedCount + currentCountOffset);

                return {
                    slot: index + 1,
                    ...item,
                    giftImage: '',
                    currentCount,
                    observedCount,
                    completed: currentCount >= item.targetCount,
                    progressRatio: item.targetCount > 0 ? Math.min(currentCount / item.targetCount, 1) : 0
                };
            }

            const normalizedGiftName = normalizeGoalGiftMatchName(item.giftName);
            let observedCount = 0;
            let latestGiftImage = item.giftImage || '';

            gifts.forEach((gift) => {
                const idMatched = item.giftId && String(gift.giftId || '') === item.giftId;
                const nameMatched = !item.giftId && normalizedGiftName && normalizeGoalGiftMatchName(gift.giftName) === normalizedGiftName;

                if (!idMatched && !nameMatched) {
                    return;
                }

                observedCount += Math.max(0, Number(gift.repeatCount || 0));

                if (!latestGiftImage && gift.giftImage) {
                    latestGiftImage = gift.giftImage;
                }
            });

            const currentCountOffset = item.resetAtMidnight && item.currentCountOffsetDayKey !== requestedDayKey
                ? 0
                : item.currentCountOffset;
            const currentCount = Math.max(0, observedCount + currentCountOffset);
            return {
                slot: index + 1,
                ...item,
                giftImage: latestGiftImage,
                currentCount,
                observedCount,
                completed: currentCount >= item.targetCount,
                progressRatio: item.targetCount > 0 ? Math.min(currentCount / item.targetCount, 1) : 0
            };
        })
    };
}

function setGoalGiftWidgetItems(items) {
    const requestedItems = Array.isArray(items) ? items.slice(0, MAX_GOAL_GIFT_WIDGET_ITEMS) : [];
    const todayDayKey = getTodayDayKey();
    const observedSnapshot = buildGoalGiftProgressSnapshot(todayDayKey, requestedItems);

    const normalizedItems = requestedItems.map((item, index) => {
        const normalizedBaseItem = normalizeGoalGiftWidgetItems([item])[0] || { ...DEFAULT_GOAL_GIFT_WIDGET_ITEM };
        const observedGoal = observedSnapshot.goals[index] || null;
        const requestedCurrentCount = normalizeWholeNumber(item?.currentCount);
        const currentCountOffset = requestedCurrentCount === null
            ? normalizedBaseItem.currentCountOffset
            : requestedCurrentCount - Number(observedGoal?.observedCount || 0);

        return {
            ...normalizedBaseItem,
            currentCountOffset,
            currentCountOffsetDayKey: normalizedBaseItem.resetAtMidnight ? todayDayKey : ''
        };
    });

    const normalizedItemsText = JSON.stringify(normalizedItems);
    setScopedStateValue(WIDGET_GOAL_GIFTS_STATE_KEY, normalizedItemsText);
    return normalizeGoalGiftWidgetItems(normalizedItemsText);
}

function createDefaultEffectEvent(slot = 1) {
    return {
        id: `event-${slot}`,
        name: `エフェクト ${slot}`,
        screen: slot,
        videoEnabled: false,
        videoAssetUrl: '',
        videoAssetName: '',
        audioEnabled: false,
        audioAssetUrl: '',
        audioAssetName: '',
        mediaVolume: 100,
        treatGiftComboAsSingle: true
    };
}

function createDefaultCommentFeedSettings() {
    return {
        sortOrder: 'desc',
        enabledTypes: COMMENT_FEED_EVENT_DEFINITIONS.map((item) => item.type)
    };
}

function normalizeEffectText(value, maxLength = 120) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().slice(0, maxLength);
}

function normalizeCommentFeedType(value) {
    const normalized = normalizeEffectText(value, 80);
    return COMMENT_FEED_EVENT_DEFINITIONS.some((item) => item.type === normalized) ? normalized : 'chat';
}

function normalizeCommentFeedSettings(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    const defaults = createDefaultCommentFeedSettings();
    const hasEnabledTypes = Array.isArray(source?.enabledTypes);
    const enabledTypesSource = hasEnabledTypes ? source.enabledTypes : defaults.enabledTypes;
    const enabledTypes = [...new Set(enabledTypesSource.map((item) => normalizeCommentFeedType(item)).filter(Boolean))];

    return {
        sortOrder: source?.sortOrder === 'asc' ? 'asc' : 'desc',
        enabledTypes: hasEnabledTypes ? enabledTypes : defaults.enabledTypes
    };
}

function getCommentFeedTypes() {
    return COMMENT_FEED_EVENT_DEFINITIONS.map((item) => ({ ...item }));
}

function getCommentFeedSettings() {
    return normalizeCommentFeedSettings(getScopedStateValue(COMMENT_SETTINGS_STATE_KEY));
}

function setCommentFeedSettings(settings) {
    const normalizedSettings = normalizeCommentFeedSettings(settings);
    setScopedStateValue(COMMENT_SETTINGS_STATE_KEY, JSON.stringify(normalizedSettings));
    return normalizedSettings;
}

function getCommentFeedTypeMeta(type) {
    return COMMENT_FEED_EVENT_DEFINITIONS.find((item) => item.type === type)
        || COMMENT_FEED_EVENT_DEFINITIONS[0];
}

function getCommentFeedDisplayText(data) {
    const directText = firstDefinedString([
        data?.comment,
        data?.questionText,
        data?.content,
        data?.text,
        data?.description,
        data?.title,
        data?.common?.displayText?.defaultPattern,
        data?.common?.displayText?.key
    ]);

    if (directText) {
        return directText;
    }

    const pieces = Array.isArray(data?.common?.displayText?.pieces)
        ? data.common.displayText.pieces
        : [];

    return pieces
        .map((piece) => firstDefinedString([
            piece?.stringValue,
            piece?.text,
            piece?.userValue?.nickname,
            piece?.userValue?.uniqueId,
            piece?.userValue?.unique_id
        ]))
        .filter(Boolean)
        .join(' ')
        .trim();
}

function extractCommentFeedActor(data) {
    const uniqueId = normalizeBroadcasterId(firstDefinedString([
        data?.uniqueId,
        data?.user?.uniqueId,
        data?.user?.unique_id,
        data?.fromUser?.uniqueId,
        data?.fromUser?.unique_id
    ]));
    const nickname = firstDefinedString([
        data?.nickname,
        data?.user?.nickname,
        data?.fromUser?.nickname,
        uniqueId,
        'システム'
    ]) || 'システム';
    const image = firstDefinedString([
        data?.profilePictureUrl,
        data?.user?.profilePictureUrl,
        data?.fromUser?.profilePictureUrl,
        Array.isArray(data?.avatarThumb?.urlList) ? data.avatarThumb.urlList[0] : ''
    ]) || '';

    return {
        uniqueId: uniqueId || '',
        nickname,
        image
    };
}

function buildCommentFeedMessage(type, data, actor) {
    const displayName = actor.nickname || actor.uniqueId || 'システム';
    const displayText = getCommentFeedDisplayText(data);
    const viewerCount = normalizeWholeNumber(data?.viewerCount);
    const likeCount = normalizeWholeNumber(data?.likeCount);
    const totalLikeCount = normalizeWholeNumber(data?.totalLikeCount);
    const displayType = normalizeEffectText(data?.common?.displayText?.displayType, 80).toLowerCase();

    switch (type) {
        case 'chat':
            return displayText;
        case 'member':
            return `${displayName} が入室しました。`;
        case 'like':
            if (likeCount && totalLikeCount) {
                return `${displayName} が ${likeCount} 件のいいねを送りました。合計 ${totalLikeCount} 件です。`;
            }

            if (likeCount) {
                return `${displayName} が ${likeCount} 件のいいねを送りました。`;
            }

            return `${displayName} がいいねを送りました。`;
        case 'social':
            if (displayType.includes('follow') || displayType.includes('share')) {
                return '';
            }

            return displayText || `${displayName} のソーシャル通知です。`;
        case 'follow':
            return `${displayName} がフォローしました。`;
        case 'share':
            return `${displayName} が配信をシェアしました。`;
        case 'questionNew':
            return displayText ? `${displayName} の質問: ${displayText}` : `${displayName} が質問しました。`;
        case 'roomUser':
            return viewerCount ? `視聴者数が ${viewerCount} 人になりました。` : (displayText || '視聴者数が更新されました。');
        case 'subscribe':
            return `${displayName} がサブスクライブしました。`;
        case 'emote':
            return displayText ? `${displayName} がエモートを送信しました: ${displayText}` : `${displayName} がエモートを送信しました。`;
        case 'envelope':
            return `${displayName} が宝箱を送信しました。`;
        case 'liveIntro':
            return displayText || 'ライブ紹介メッセージを受信しました。';
        case 'streamEnd':
            return '配信が終了しました。';
        case 'goalUpdate':
            return displayText || '配信ゴールが更新されました。';
        case 'roomMessage':
            return displayText || 'ルームメッセージを受信しました。';
        case 'captionMessage':
            return displayText || '字幕メッセージを受信しました。';
        case 'imDelete':
            return displayText || `${displayName} のメッセージが削除されました。`;
        case 'unauthorizedMember':
            return displayText || `${displayName} の制限対象アクションを検知しました。`;
        case 'inRoomBanner':
            return displayText || 'ルームバナーを受信しました。';
        case 'rankUpdate':
            return displayText || 'ランキングが更新されました。';
        case 'pollMessage':
            return displayText || '投票メッセージを受信しました。';
        case 'rankText':
            return displayText || 'ランキング表示を受信しました。';
        case 'oecLiveShopping':
            return displayText || 'ライブショッピング通知を受信しました。';
        case 'msgDetect':
            return displayText || 'システムメッセージ検知通知を受信しました。';
        case 'linkMessage':
            return displayText || 'リンクメッセージを受信しました。';
        case 'roomVerify':
            return displayText || 'ルーム認証通知を受信しました。';
        case 'linkLayer':
            return displayText || 'リンクレイヤー更新を受信しました。';
        case 'roomPin':
            return displayText || '固定メッセージを受信しました。';
        default:
            return displayText || `${getCommentFeedTypeMeta(type).label} を受信しました。`;
    }
}

function createDefaultEffectTrigger(eventId = '') {
    return {
        id: `trigger-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        enabled: true,
        eventId,
        giftName: '',
        minCoins: 0,
        commentMode: 'disabled',
        commentText: '',
        userIds: []
    };
}

function normalizeEffectTriggerCommentMode(value) {
    const normalized = normalizeEffectText(value, 16).toLowerCase();
    return normalized === 'any' || normalized === 'exact' ? normalized : 'disabled';
}

function normalizeEffectScreen(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= EFFECT_SCREEN_COUNT ? parsed : 1;
}

function normalizeEffectId(value, fallbackPrefix) {
    const normalized = normalizeEffectText(value, 60).replace(/[^a-zA-Z0-9_-]/g, '');
    return normalized || `${fallbackPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAssetUrl(value) {
    const url = normalizeEffectText(value, 240);
    return url.startsWith('/media/effects/') ? url : '';
}

function normalizeUserIdList(value) {
    const values = Array.isArray(value)
        ? value
        : String(value || '').split(/[\s,\n\r]+/u);

    return [...new Set(values.map((item) => normalizeBroadcasterId(item)).filter(Boolean))];
}

function normalizeEffectEvent(value, index) {
    const fallback = createDefaultEffectEvent(index + 1);
    const mediaVolume = Number.isFinite(Number(value?.mediaVolume))
        ? Math.max(0, Math.min(100, Math.round(Number(value.mediaVolume))))
        : fallback.mediaVolume;

    return {
        id: normalizeEffectId(value?.id, 'event'),
        name: normalizeEffectText(value?.name, 80) || fallback.name,
        screen: normalizeEffectScreen(value?.screen),
        videoEnabled: Boolean(value?.videoEnabled),
        videoAssetUrl: normalizeAssetUrl(value?.videoAssetUrl),
        videoAssetName: normalizeEffectText(value?.videoAssetName, 160),
        audioEnabled: Boolean(value?.audioEnabled),
        audioAssetUrl: normalizeAssetUrl(value?.audioAssetUrl),
        audioAssetName: normalizeEffectText(value?.audioAssetName, 160),
        mediaVolume,
        treatGiftComboAsSingle: value?.treatGiftComboAsSingle !== false
    };
}

function normalizeEffectEvents(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    if (!Array.isArray(source)) {
        return [];
    }

    return source.map((item, index) => normalizeEffectEvent(item, index));
}

function normalizeEffectTrigger(value) {
    const fallback = createDefaultEffectTrigger();
    const commentText = normalizeEffectText(value?.commentText, 160).toLowerCase();
    const commentMode = normalizeEffectTriggerCommentMode(value?.commentMode);
    return {
        id: normalizeEffectId(value?.id, 'trigger'),
        name: normalizeEffectText(value?.name, 80),
        enabled: Boolean(value?.enabled),
        eventId: normalizeEffectText(value?.eventId, 80),
        giftName: normalizeEffectText(value?.giftName, 80).toLowerCase(),
        minCoins: normalizeWholeNumber(value?.minCoins) ?? 0,
        commentMode: commentMode === 'exact' && !commentText ? fallback.commentMode : commentMode,
        commentText,
        userIds: normalizeUserIdList(value?.userIds)
    };
}

function normalizeEffectTriggers(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    if (!Array.isArray(source)) {
        return [];
    }

    return source.map((item) => normalizeEffectTrigger(item));
}

function getEffectEvents() {
    return normalizeEffectEvents(getScopedStateValue(EFFECT_EVENTS_STATE_KEY));
}

function setEffectEvents(events) {
    const normalizedEvents = normalizeEffectEvents(events);
    setScopedStateValue(EFFECT_EVENTS_STATE_KEY, JSON.stringify(normalizedEvents));
    return normalizedEvents;
}

function getEffectTriggers() {
    return normalizeEffectTriggers(getScopedStateValue(EFFECT_TRIGGERS_STATE_KEY));
}

function setEffectTriggers(triggers) {
    const normalizedTriggers = normalizeEffectTriggers(triggers);
    setScopedStateValue(EFFECT_TRIGGERS_STATE_KEY, JSON.stringify(normalizedTriggers));
    return normalizedTriggers;
}

function sanitizePathSegment(value) {
    return String(value || 'global').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getEffectMediaDirectory() {
    return path.join(EFFECT_MEDIA_ROOT_DIRECTORY, sanitizePathSegment(getBroadcasterId() || 'global'));
}

function buildEffectMediaUrl(fileName) {
    return `/media/effects/${encodeURIComponent(sanitizePathSegment(getBroadcasterId() || 'global'))}/${encodeURIComponent(fileName)}`;
}

function createEffectPlaybackPayload(effectEvent, trigger, sourceEvent) {
    return {
        playbackId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        eventId: effectEvent.id,
        eventName: effectEvent.name,
        screen: effectEvent.screen,
        videoUrl: effectEvent.videoEnabled ? effectEvent.videoAssetUrl : '',
        audioUrl: effectEvent.audioEnabled ? effectEvent.audioAssetUrl : '',
        mediaVolume: effectEvent.mediaVolume,
        playbackCount: effectEvent.treatGiftComboAsSingle ? 1 : Math.max(1, Number(sourceEvent?.repeatCount || 1)),
        triggerId: trigger?.id || 'preview-trigger',
        triggerName: trigger?.name || 'Preview',
        giftName: sourceEvent?.giftName || '',
        comment: sourceEvent?.comment || '',
        totalGifts: sourceEvent?.totalGifts || 0,
        repeatCount: sourceEvent?.repeatCount || 1,
        uniqueId: sourceEvent?.uniqueId || '',
        nickname: sourceEvent?.nickname || '',
        timestamp: getTimestamp()
    };
}

function emitEffectPlayback(effectEvent, trigger, sourceEvent) {
    io.emit('effects:playback', createEffectPlaybackPayload(effectEvent, trigger, sourceEvent));
}

function matchesEffectTrigger(trigger, context) {
    if (trigger.giftName && trigger.giftName !== context.giftName) {
        return false;
    }

    if (trigger.minCoins > 0 && context.totalGifts < trigger.minCoins) {
        return false;
    }

    if (trigger.commentMode === 'any') {
        if (context.type !== 'comment') {
            return false;
        }
    } else if (trigger.commentMode === 'exact') {
        if (context.type !== 'comment' || !trigger.commentText || trigger.commentText !== context.comment) {
            return false;
        }
    }

    if (trigger.userIds.length > 0 && (!context.userId || !trigger.userIds.includes(context.userId))) {
        return false;
    }

    return true;
}

function tryRunEffectTriggers(context, sourceEvent) {
    const effectEvents = getEffectEvents();
    const eventById = new Map(effectEvents.map((item) => [item.id, item]));
    const triggers = getEffectTriggers().filter((item) => item.enabled && item.eventId);

    triggers.forEach((trigger) => {
        if (!matchesEffectTrigger(trigger, context)) {
            return;
        }

        const effectEvent = eventById.get(trigger.eventId);

        if (!effectEvent) {
            return;
        }

        emitEffectPlayback(effectEvent, trigger, sourceEvent);
    });
}

function tryRunEffectTriggersForGift(giftEvent) {
    tryRunEffectTriggers({
        type: 'gift',
        giftName: normalizeEffectText(giftEvent?.giftName, 80).toLowerCase(),
        comment: '',
        totalGifts: normalizeWholeNumber(giftEvent?.totalGifts) ?? 0,
        userId: normalizeBroadcasterId(giftEvent?.uniqueId)
    }, giftEvent);
}

function tryRunEffectTriggersForComment(commentEvent) {
    if (commentEvent?.type !== 'chat') {
        return;
    }

    tryRunEffectTriggers({
        type: 'comment',
        giftName: '',
        comment: normalizeEffectText(commentEvent?.comment, 160).toLowerCase(),
        totalGifts: 0,
        userId: normalizeBroadcasterId(commentEvent?.uniqueId)
    }, commentEvent);
}

function setGlobalStateValue(stateKey, stateValue) {
    dbStore.setGlobalStateValue(stateKey, stateValue, getTimestamp());
    return stateValue;
}

function getScopedStateValue(stateKey) {
    const broadcasterId = getBroadcasterId();

    if (!broadcasterId) {
        return dbStore.getGlobalStateValue(stateKey);
    }

    const broadcasterValue = dbStore.getBroadcasterStateValue(broadcasterId, stateKey);

    if (broadcasterValue != null) {
        return broadcasterValue;
    }

    return dbStore.getGlobalStateValue(stateKey);
}

function setScopedStateValue(stateKey, stateValue) {
    const broadcasterId = getBroadcasterId();

    if (!broadcasterId) {
        return setGlobalStateValue(stateKey, stateValue);
    }

    dbStore.setBroadcasterStateValue(broadcasterId, stateKey, stateValue, getTimestamp());
    return stateValue;
}

function getStoredBroadcasterId() {
    return normalizeBroadcasterId(dbStore.getGlobalStateValue(BROADCASTER_ID_STATE_KEY));
}

function getInitialBroadcasterId() {
    return getStoredBroadcasterId() || normalizeBroadcasterId(ENV_TIKTOK_USERNAME);
}

function getBroadcasterId() {
    return currentBroadcasterId;
}

function hasConfiguredBroadcasterId() {
    return Boolean(getBroadcasterId());
}

function setBroadcasterId(broadcasterId) {
    const normalizedBroadcasterId = normalizeBroadcasterId(broadcasterId);

    if (!normalizedBroadcasterId) {
        return null;
    }

    currentBroadcasterId = setGlobalStateValue(BROADCASTER_ID_STATE_KEY, normalizedBroadcasterId);
    return currentBroadcasterId;
}

function clearBroadcasterId() {
    currentBroadcasterId = null;
    setGlobalStateValue(BROADCASTER_ID_STATE_KEY, '', getTimestamp());
    return currentBroadcasterId;
}

function getWebsocketAuthState() {
    if (HAS_TIKTOK_WS_AUTH) {
        return {
            websocketReasonCode: null,
            websocketReasonLabel: null,
            websocketReasonDetail: null,
            wsAuthAvailable: true
        };
    }

    if (TIKTOK_SESSION_ID && !TIKTOK_TT_TARGET_IDC) {
        return {
            websocketReasonCode: 'ws_auth_incomplete',
            websocketReasonLabel: '認証付き WebSocket が未設定です。',
            websocketReasonDetail: 'sessionid はありますが tt-target-idc が未設定のため、認証付き WebSocket は使えません。現在は request polling までしか使えません。',
            wsAuthAvailable: false
        };
    }

    return {
        websocketReasonCode: 'ws_auth_missing',
        websocketReasonLabel: 'WebSocket 用の認証情報が未設定です。',
        websocketReasonDetail: 'sessionid と tt-target-idc を設定しないと認証付き WebSocket は使えません。配信によっては request polling にも切り替えられません。',
        wsAuthAvailable: false
    };
}

function setTikTokConnectionState(status, message, options = {}) {
    const defaultWsState = getWebsocketAuthState();
    const hasReasonCode = Object.prototype.hasOwnProperty.call(options, 'websocketReasonCode');
    const hasReasonLabel = Object.prototype.hasOwnProperty.call(options, 'websocketReasonLabel');
    const hasReasonDetail = Object.prototype.hasOwnProperty.call(options, 'websocketReasonDetail');
    const hasTransportMethod = Object.prototype.hasOwnProperty.call(options, 'transportMethod');
    const nextState = {
        status,
        message,
        transportMethod: hasTransportMethod ? options.transportMethod : 'unknown',
        websocketReasonCode: hasReasonCode ? options.websocketReasonCode : defaultWsState.websocketReasonCode,
        websocketReasonLabel: hasReasonLabel ? options.websocketReasonLabel : defaultWsState.websocketReasonLabel,
        websocketReasonDetail: hasReasonDetail ? options.websocketReasonDetail : defaultWsState.websocketReasonDetail,
        wsAuthAvailable: options.wsAuthAvailable ?? defaultWsState.wsAuthAvailable,
        retryScheduled: Boolean(options.retryScheduled),
        retryReason: options.retryReason || null,
        retryDelayMs: options.retryDelayMs ?? null,
        broadcasterId: getBroadcasterId(),
        updatedAt: new Date().toISOString()
    };
    const previousState = tiktokConnectionState;

    if (
        previousState
        && previousState.status === nextState.status
        && previousState.message === nextState.message
        && previousState.transportMethod === nextState.transportMethod
        && previousState.websocketReasonCode === nextState.websocketReasonCode
        && previousState.websocketReasonLabel === nextState.websocketReasonLabel
        && previousState.websocketReasonDetail === nextState.websocketReasonDetail
        && previousState.wsAuthAvailable === nextState.wsAuthAvailable
        && previousState.retryScheduled === nextState.retryScheduled
        && previousState.retryReason === nextState.retryReason
        && previousState.retryDelayMs === nextState.retryDelayMs
        && previousState.broadcasterId === nextState.broadcasterId
    ) {
        return tiktokConnectionState;
    }

    tiktokConnectionState = nextState;

    if (httpServer.listening) {
        emitAdminDayUpdate(getDisplayDayKey());
    }

    return tiktokConnectionState;
}

function getTikTokConnectionState() {
    return {
        ...tiktokConnectionState,
        broadcasterId: getBroadcasterId()
    };
}

function buildTikTokOfflineMessage(broadcasterId) {
    return broadcasterId
    ? `@${broadcasterId} は現在配信していません。配信開始後まで待機してください。アプリは自動で再接続を試行します。`
        : '現在このユーザーは配信していません。';
}

function isTikTokUserOfflineError(error) {
    const candidates = [
        error,
        error?.exception,
        error?.cause,
        error?.response?.data,
        error?.error
    ].filter(Boolean);

    const detailText = candidates.map((candidate) => {
        if (typeof candidate?.message === 'string' && candidate.message.trim()) {
            return candidate.message;
        }

        if (typeof candidate?.info === 'string' && candidate.info.trim()) {
            return candidate.info;
        }

        return String(candidate || '');
    }).join('\n');

    const hasOfflineName = candidates.some((candidate) => candidate?.name === 'UserOfflineError');

    return hasOfflineName || /isn\'t online|user.+offline|requested user.+online/i.test(detailText);
}

function isTikTokAlreadyConnectedError(error) {
    const message = typeof error?.message === 'string' ? error.message : String(error || '');
    return /already connected!?/i.test(message);
}

function isTikTokAuthInvalidError(error) {
    const statusCandidates = [
        error?.status,
        error?.statusCode,
        error?.response?.status,
        error?.response?.statusCode,
        error?.cause?.status,
        error?.cause?.statusCode
    ].map((value) => Number(value)).filter((value) => Number.isFinite(value));

    if (statusCandidates.some((value) => value === 401 || value === 403)) {
        return true;
    }

    const detailText = [
        error?.message,
        error?.response?.statusText,
        error?.response?.data?.message,
        error?.response?.data?.error,
        error?.response?.data?.description,
        error?.cause?.message
    ].filter(Boolean).join('\n');

    return /(session expired|session invalid|invalid session|login required|not logged in|unauthorized|forbidden|captcha|verify|redirect(?:ed)? to login|login expired|passport\/web\/account\/info.*(?:login|forbidden)|tt-target-idc.*invalid)/i.test(detailText);
}

function isTikTokRecoverableRoomInfoError(error) {
    const detailText = [
        error?.message,
        error?.info,
        error?.exception?.message,
        error?.cause?.message,
        error?.error?.message
    ].filter(Boolean).join('\n');

    return /Failed to retrieve Room ID from main page|SIGI_STATE|falling back to API source|blocked by TikTok/i.test(detailText);
}

function sortContributorsByFirstSeen(left, right) {
    const leftValue = left.firstSeenAt || '';
    const rightValue = right.firstSeenAt || '';

    if (leftValue !== rightValue) {
        return leftValue.localeCompare(rightValue);
    }

    return left.uniqueId.localeCompare(right.uniqueId);
}

function getAdminContributorsForSession(startedAt, endedAt) {
    if (!hasConfiguredBroadcasterId() || !startedAt || !endedAt) {
        return [];
    }

    return [...dbStore.getAdminContributorsByTimeRange(getBroadcasterId(), startedAt, endedAt)].sort(sortContributorsByFirstSeen);
}

function buildOverlayContributorsSnapshot(dayKey = getDisplayDayKey()) {
    const displayContext = buildContributorsDisplayContext(dayKey);
    const displayThreshold = getDisplayThreshold();
    const sourceContributors = displayContext.rangeMode === 'session'
        ? getAdminContributorsForSession(displayContext.session.startedAt, displayContext.effectiveSessionEndedAt)
        : getAdminContributorsForDay(displayContext.dayKey);
    const contributors = sourceContributors
        .filter((contributor) => Number(contributor.total || 0) >= displayThreshold);

    return {
        version: 1,
        overlay: 'contributors',
        dayKey: displayContext.dayKey,
        generatedAt: new Date().toISOString(),
        broadcaster: {
            id: getBroadcasterId(),
            configured: hasConfiguredBroadcasterId()
        },
        display: {
            rangeMode: displayContext.rangeMode,
            threshold: displayThreshold,
            goalCount: getDisplayGoalCount(),
            sortOrder: DEFAULT_DISPLAY_SORT_ORDER,
            avatarVisibility: getDisplayAvatarVisibility(),
            fontFamily: getDisplayFontFamily(),
            colorTheme: getDisplayColorTheme(),
            strokeWidth: getDisplayStrokeWidth()
        },
        session: {
            startedAt: displayContext.session.startedAt,
            endedAt: displayContext.session.endedAt,
            effectiveEndedAt: displayContext.effectiveSessionEndedAt,
            isActive: displayContext.session.isActive
        },
        contributors,
        summary: {
            qualifiedContributorCount: contributors.length,
            goalCount: getDisplayGoalCount(),
            displayThreshold
        }
    };
}

function getAdminContributorsForDay(dayKey) {
    if (!hasConfiguredBroadcasterId()) {
        return [];
    }

    return [...dbStore.getAdminContributorsByDay(dayKey, getBroadcasterId())].sort(sortContributorsByFirstSeen);
}

function getAvailableDays() {
    if (!hasConfiguredBroadcasterId()) {
        return [];
    }

    return dbStore.getAvailableDays(getBroadcasterId());
}

function createAdminDayPayload(dayKey) {
    return {
        dayKey,
        contributors: getAdminContributorsForDay(dayKey),
        days: getAvailableDays(),
        displayDayKey: getDisplayDayKey(),
        displayRangeMode: getContributorsDisplayRange(),
        liveSession: getContributorsSessionState(),
        broadcasterId: getBroadcasterId(),
        broadcasterIdConfigured: hasConfiguredBroadcasterId(),
        tiktokConnection: getTikTokConnectionState(),
        todayDayKey: getTodayDayKey(),
        yesterdayDayKey: getYesterdayDayKey()
    };
}

function emitOverlaySnapshot(target, dayKey) {
    const snapshot = buildOverlayContributorsSnapshot(dayKey);
    target.emit('overlay:contributors:snapshot', snapshot);
    return snapshot;
}

function emitSnapshot(dayKey) {
    return emitOverlaySnapshot(io, dayKey);
}

function emitAdminDayUpdate(dayKey) {
    io.emit('admin_day_updated', createAdminDayPayload(dayKey));
}

function emitDayStateChanges(dayKey) {
    emitSnapshot(dayKey);
    emitAdminDayUpdate(dayKey);
}

function emitDisplayAppearanceChanges() {
    const activeDayKey = getDisplayDayKey();
    emitSnapshot(activeDayKey);
    emitAdminDayUpdate(activeDayKey);
}

function emitDisplayThresholdChanges() {
    const activeDayKey = getDisplayDayKey();
    emitSnapshot(activeDayKey);
    emitAdminDayUpdate(activeDayKey);
}

function updateDisplayedDay(dayKey) {
    const activeDayKey = setDisplayDayKey(dayKey);
    emitSnapshot(activeDayKey);
    emitAdminDayUpdate(activeDayKey);
    return activeDayKey;
}

function respondWithDisplayChange(res, dayKey) {
    const activeDayKey = updateDisplayedDay(dayKey);
    res.json({ ok: true, displayDayKey: activeDayKey });
}

function deleteContributor(dayKey, uniqueId) {
    if (!hasConfiguredBroadcasterId()) {
        return 0;
    }

    const deletedCount = dbStore.deleteContributor(dayKey, getBroadcasterId(), uniqueId);
    emitDayStateChanges(dayKey);
    return deletedCount;
}

function resetContributorsForDay(dayKey) {
    if (!hasConfiguredBroadcasterId()) {
        return 0;
    }

    const deletedCount = dbStore.deleteDay(dayKey, getBroadcasterId());
    emitDayStateChanges(dayKey);
    return deletedCount;
}

function setContributorTotal(dayKey, uniqueId, totalCoins) {
    if (!hasConfiguredBroadcasterId()) {
        return null;
    }

    const contributor = dbStore.updateContributorTotal({
        dayKey,
        broadcasterId: getBroadcasterId(),
        uniqueId,
        totalCoins,
        updatedAt: getTimestamp()
    });

    if (!contributor) {
        return null;
    }

    emitDayStateChanges(dayKey);
    return contributor;
}

function setContributorNickname(uniqueId, nickname) {
    if (!hasConfiguredBroadcasterId()) {
        return null;
    }

    const broadcasterId = getBroadcasterId();
    const affectedDays = dbStore.getContributorDaysByUniqueId(broadcasterId, uniqueId);

    if (!affectedDays.length) {
        return null;
    }

    dbStore.upsertListenerNameOverride(broadcasterId, uniqueId, nickname, getTimestamp());
    affectedDays.forEach((dayKey) => {
        emitDayStateChanges(dayKey);
    });

    return {
        uniqueId,
        nickname,
        affectedDayCount: affectedDays.length
    };
}

function hydrateStoredGiftEvent(gift) {
    if (gift.giftImage) {
        return gift;
    }

    try {
        const rawPayload = JSON.parse(gift.rawPayload || '{}');
        return {
            ...gift,
            giftImage: typeof rawPayload.giftPictureUrl === 'string' ? rawPayload.giftPictureUrl : null
        };
    } catch {
        return gift;
    }
}

function buildTopGiftSnapshot(dayKey = getTodayDayKey()) {
    const requestedDayKey = normalizeDayKey(dayKey) || getTodayDayKey();
    const broadcasterId = getBroadcasterId();

    if (!broadcasterId) {
        return {
            dayKey: requestedDayKey,
            broadcasterId: null,
            giftCount: 0,
            topGift: null
        };
    }

    const gifts = dbStore.getAdminGiftEventsByDay(requestedDayKey, broadcasterId).map(hydrateStoredGiftEvent);
    let topGift = null;
    let topGiftAmount = 0;

    gifts.forEach((gift) => {
        if (!topGift) {
            topGift = gift;
            topGiftAmount = Number(gift.totalGifts || 0);
            return;
        }

        const currentAmount = Number(gift.totalGifts || 0);
        const previousAmount = Number(topGift.totalGifts || 0);

        if (currentAmount > previousAmount) {
            topGift = gift;
            topGiftAmount = currentAmount;
            return;
        }

        if (currentAmount === previousAmount && String(gift.timestamp || '') > String(topGift.timestamp || '')) {
            topGift = gift;
            topGiftAmount = currentAmount;
        }
    });

    const matchingTopSenders = topGift
        ? gifts
            .filter((gift) => {
                if (Number(gift.totalGifts || 0) !== topGiftAmount) {
                    return false;
                }

                if (topGift.giftId && gift.giftId) {
                    return String(gift.giftId) === String(topGift.giftId);
                }

                return String(gift.giftName || '').trim().toLowerCase() === String(topGift.giftName || '').trim().toLowerCase();
            })
            .sort((left, right) => String(left.timestamp || '').localeCompare(String(right.timestamp || '')))
            .reduce((senders, gift) => {
                const label = String(gift.nickname || gift.uniqueId || '').trim();
                if (!label) {
                    return senders;
                }

                const existingIndex = senders.indexOf(label);
                if (existingIndex >= 0) {
                    senders.splice(existingIndex, 1);
                }

                senders.push(label);
                return senders;
            }, [])
        : [];

    return {
        dayKey: requestedDayKey,
        broadcasterId,
        giftCount: gifts.length,
        topGift: topGift ? {
            uniqueId: topGift.uniqueId,
            nickname: topGift.nickname,
            image: topGift.image,
            giftId: topGift.giftId || '',
            giftName: topGift.giftName || 'ギフト名未取得',
            giftImage: topGift.giftImage || null,
            totalGifts: Number(topGift.totalGifts || 0),
            repeatCount: Number(topGift.repeatCount || 1),
            timestamp: topGift.timestamp || '',
            senders: matchingTopSenders,
            latestSender: matchingTopSenders.at(-1) || topGift.nickname || topGift.uniqueId || ''
        } : null
    };
}

function getTikTokGiftImageUrl(gift) {
    return firstDefinedString([
        gift?.image?.url_list?.[0],
        gift?.image?.urlList?.[0],
        gift?.image?.url?.[0],
        gift?.giftImage?.url_list?.[0],
        gift?.giftImage?.urlList?.[0],
        gift?.giftImage?.url?.[0],
        gift?.icon?.url_list?.[0],
        gift?.icon?.urlList?.[0],
        gift?.icon?.url?.[0]
    ]);
}

function getTikTokGiftLocalizationInfo(gift) {
    return {
        giftNameKey: firstDefinedString([gift?.giftNameKey]),
        nameRefKey: firstDefinedString([
            gift?.nameRef?.key,
            gift?.gift?.nameRef?.key
        ]),
        nameRefDefaultPattern: firstDefinedString([
            gift?.nameRef?.defaultPattern,
            gift?.gift?.nameRef?.defaultPattern
        ]),
        rawName: firstDefinedString([gift?.name]),
        rawGiftName: firstDefinedString([gift?.giftName]),
        rawGiftTextName: firstDefinedString([gift?.giftTextName]),
        rawGiftSkinName: firstDefinedString([gift?.giftSkinName]),
        rawDescribe: firstDefinedString([gift?.describe, gift?.description])
    };
}

function hasJapaneseText(value) {
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(String(value || ''));
}

function buildObservedGiftNameMap(broadcasterId) {
    if (!broadcasterId) {
        return new Map();
    }

    return new Map(
        dbStore.getLatestGiftNamesById(broadcasterId).map((gift) => [String(gift.giftId || ''), gift])
    );
}

function normalizeTikTokGiftCatalog(gifts, options = {}) {
    if (!Array.isArray(gifts)) {
        return [];
    }

    const observedGiftNamesById = options.observedGiftNamesById || new Map();

    return gifts.map((gift) => {
        const normalizedDiamondCount = Number(
            gift?.diamond_count
            ?? gift?.diamondCount
            ?? gift?.price
            ?? 0
        );
        const giftId = firstDefinedString([gift?.id?.toString(), gift?.giftId?.toString()]) || '';
        const observedGift = observedGiftNamesById.get(giftId);
        const localization = getTikTokGiftLocalizationInfo(gift);
        const catalogName = firstDefinedString([
            gift?.giftTextName,
            gift?.giftSkinName,
            gift?.giftName,
            gift?.name,
            gift?.describe
        ]) || '名称未取得';
        const preferredName = hasJapaneseText(observedGift?.giftName) && !hasJapaneseText(catalogName)
            ? observedGift.giftName
            : firstDefinedString([
                hasJapaneseText(gift?.giftTextName) ? gift.giftTextName : null,
                hasJapaneseText(gift?.giftSkinName) ? gift.giftSkinName : null,
                hasJapaneseText(gift?.giftName) ? gift.giftName : null,
                hasJapaneseText(gift?.name) ? gift.name : null,
                observedGift?.giftName,
                catalogName
            ]) || '名称未取得';

        return {
            id: giftId,
            name: preferredName,
            imageUrl: firstDefinedString([observedGift?.giftImage, getTikTokGiftImageUrl(gift)]),
            diamondCount: Number.isFinite(normalizedDiamondCount) ? normalizedDiamondCount : 0,
            describe: firstDefinedString([gift?.describe, gift?.description]) || '',
            fallbackName: catalogName,
            localization,
            observedGiftName: observedGift?.giftName || null
        };
    }).filter((gift) => gift.id && gift.name)
        .sort((left, right) => {
            if (left.diamondCount !== right.diamondCount) {
                return left.diamondCount - right.diamondCount;
            }

            return left.name.localeCompare(right.name, 'ja');
        })
        .filter((gift, index, array) => array.findIndex((other) => other.id === gift.id) === index);
}

function buildTikTokGiftCatalogConnectionOptions() {
    return {
        ...tiktokConnectionOptions,
        processInitialData: false,
        enableExtendedGiftInfo: false,
        webClientParams: {
            ...(tiktokConnectionOptions.webClientParams || {}),
            ...TIKTOK_JA_LOCALE_CLIENT_PARAMS
        }
    };
}

async function fetchTikTokGiftCatalog(options = {}) {
    const broadcasterId = getBroadcasterId();

    if (!broadcasterId) {
        throw new Error('TikTok の配信ユーザーIDが未設定です。');
    }

    const forceRefresh = Boolean(options.forceRefresh);
    const now = Date.now();

    if (!forceRefresh
        && cachedTikTokGiftCatalog.broadcasterId === broadcasterId
        && Array.isArray(cachedTikTokGiftCatalog.gifts)
        && cachedTikTokGiftCatalog.gifts.length > 0
        && now - cachedTikTokGiftCatalog.fetchedAt < TIKTOK_GIFT_CACHE_TTL_MS) {
        return cachedTikTokGiftCatalog.gifts;
    }

    if (activeTikTokGiftCatalogPromise && !forceRefresh) {
        return activeTikTokGiftCatalogPromise;
    }

    activeTikTokGiftCatalogPromise = (async () => {
        const shouldReuseConnection = tiktokLiveConnection && activeTikTokUsername === broadcasterId;
        const connection = shouldReuseConnection
            ? tiktokLiveConnection
            : new WebcastPushConnection(broadcasterId, buildTikTokGiftCatalogConnectionOptions());
        const observedGiftNamesById = buildObservedGiftNameMap(broadcasterId);

        try {
            const gifts = normalizeTikTokGiftCatalog(await connection.fetchAvailableGifts(), {
                observedGiftNamesById
            });

            cachedTikTokGiftCatalog = {
                broadcasterId,
                fetchedAt: Date.now(),
                gifts
            };

            return gifts;
        } finally {
            if (!shouldReuseConnection && typeof connection?.disconnect === 'function') {
                await connection.disconnect().catch(() => {});
            }

            activeTikTokGiftCatalogPromise = null;
        }
    })();

    return activeTikTokGiftCatalogPromise;
}

function buildGiftEventKey(data) {
    return [
        getBroadcasterId() || 'broadcaster:none',
        data.msgId || 'msg:none',
        data.eventId || 'event:none',
        data.uniqueId || 'user:none',
        data.giftId || 'gift:none',
        data.repeatCount || 1,
        data.repeatEnd ? 1 : 0,
        data.createTime || 'time:none'
    ].join(':');
}

function normalizeGiftEvent(data) {
    const {
        uniqueId,
        diamondCount = 0,
        repeatCount = 1,
        nickname,
        profilePictureUrl,
        giftType,
        repeatEnd,
        giftName,
        giftPictureUrl,
        giftId,
        msgId,
        eventId,
        createTime
    } = data;

    if (giftType === 1 && !repeatEnd) {
        return null;
    }

    const totalGifts = Number(diamondCount) * Number(repeatCount);

    if (!uniqueId || !Number.isFinite(totalGifts) || totalGifts <= 0) {
        return null;
    }

    const timestamp = getTimestamp();

    return {
        dayKey: getTodayDayKey(),
        eventKey: buildGiftEventKey(data),
        msgId: msgId ? String(msgId) : null,
        eventId: eventId ? String(eventId) : null,
        uniqueId,
        nickname: nickname || uniqueId,
        image: profilePictureUrl || '',
        giftId: giftId ? String(giftId) : null,
        giftName: giftName || null,
        giftImage: typeof giftPictureUrl === 'string' ? giftPictureUrl : null,
        repeatCount: Number(repeatCount) || 1,
        totalGifts,
        rawPayload: JSON.stringify(data),
        timestamp,
        createTime: createTime ? String(createTime) : null
    };
}

function storeRawGiftEvent(event) {
    if (!hasConfiguredBroadcasterId()) {
        return false;
    }

    return dbStore.storeRawGiftEvent(getBroadcasterId(), event);
}

function buildTestDataTimestamp(dayKey, offsetMinutes) {
    return new Date(`${dayKey}T00:00:00.000Z`).getTime() + (offsetMinutes * 60 * 1000);
}

function createSyntheticGiftEvent(dayKey, index, data) {
    const timestampValue = normalizeWholeNumber(data.timestampValue) || buildTestDataTimestamp(dayKey, 9 * 60 + index * 7);
    const timestamp = new Date(timestampValue).toISOString();
    const repeatCount = Number(data.repeatCount) || 1;
    const diamondCount = Number(data.diamondCount) || 1;
    const eventSuffix = typeof data.eventSuffix === 'string' && data.eventSuffix.trim()
        ? data.eventSuffix.trim()
        : String(timestampValue);

    return {
        dayKey,
        eventKey: [
            getBroadcasterId() || 'broadcaster:none',
            'test',
            dayKey,
            data.uniqueId,
            data.giftId,
            index,
            eventSuffix
        ].join(':'),
        msgId: `test-msg-${dayKey}-${index}-${eventSuffix}`,
        eventId: `test-event-${dayKey}-${index}-${eventSuffix}`,
        uniqueId: data.uniqueId,
        nickname: data.nickname,
        image: data.profilePictureUrl || '',
        giftId: data.giftId,
        giftName: data.giftName,
        giftImage: data.giftPictureUrl || null,
        repeatCount,
        totalGifts: diamondCount * repeatCount,
        rawPayload: JSON.stringify({
            ...data,
            repeatCount,
            diamondCount,
            createTime: String(timestampValue),
            giftPictureUrl: data.giftPictureUrl || ''
        }),
        timestamp,
        createTime: String(timestampValue)
    };
}

function insertTestGiftEventsForDay(dayKey, mode = 'mixed') {
    const requestedDayKey = normalizeDayKey(dayKey);

    if (!requestedDayKey) {
        throw new Error('dayKey is invalid');
    }

    if (!hasConfiguredBroadcasterId()) {
        throw new Error('配信ユーザーIDが未設定です。');
    }

    const seeds = [
        {
            uniqueId: 'test_farm_01',
            nickname: 'テスト農園A',
            giftId: '565',
            giftName: 'Rose',
            repeatCount: 12,
            diamondCount: 1
        },
        {
            uniqueId: 'test_farm_02',
            nickname: 'テスト農園B',
            giftId: '7934',
            giftName: 'GG',
            repeatCount: 3,
            diamondCount: 5
        },
        {
            uniqueId: 'test_farm_03',
            nickname: 'テスト農園C',
            giftId: '8064',
            giftName: 'Heart Me',
            repeatCount: 2,
            diamondCount: 10
        },
        {
            uniqueId: 'test_farm_04',
            nickname: 'テスト農園D',
            giftId: '5487',
            giftName: 'Perfume',
            repeatCount: 1,
            diamondCount: 20
        },
        {
            uniqueId: 'test_farm_05',
            nickname: 'テスト農園E',
            giftId: '5760',
            giftName: 'Finger Heart',
            repeatCount: 5,
            diamondCount: 5
        }
    ];

    const selectedSeeds = mode === 'contributors' ? seeds.slice(0, 4) : mode === 'gifts' ? seeds : seeds;
    let insertedCount = 0;

    selectedSeeds.forEach((seed, index) => {
        const event = createSyntheticGiftEvent(requestedDayKey, index, seed);
        if (storeRawGiftEvent(event)) {
            insertedCount += 1;
        }
    });

    flushRawGiftEvents();
    emitDayStateChanges(requestedDayKey);

    return {
        dayKey: requestedDayKey,
        insertedCount
    };
}

function insertCustomTestGiftEventForDay(dayKey, input = {}) {
    const requestedDayKey = normalizeDayKey(dayKey);

    if (!requestedDayKey) {
        throw new Error('dayKey is invalid');
    }

    if (!hasConfiguredBroadcasterId()) {
        throw new Error('配信ユーザーIDが未設定です。');
    }

    const uniqueId = typeof input.uniqueId === 'string' ? input.uniqueId.trim() : '';
    const nickname = normalizeNickname(input.nickname) || uniqueId;
    const giftId = typeof input.giftId === 'string' ? input.giftId.trim() : '';
    const giftName = normalizeEffectText(input.giftName, 80);
    const giftPictureUrl = typeof input.giftPictureUrl === 'string' ? input.giftPictureUrl.trim() : '';
    const profilePictureUrl = typeof input.profilePictureUrl === 'string' ? input.profilePictureUrl.trim() : '';
    const repeatCount = normalizePositiveWholeNumber(input.repeatCount);
    const diamondCount = normalizePositiveWholeNumber(input.diamondCount);

    if (!uniqueId) {
        throw new Error('ユーザーIDを入力してください。');
    }

    if (!nickname) {
        throw new Error('ユーザー名を入力してください。');
    }

    if (!giftName) {
        throw new Error('ギフト名を入力してください。');
    }

    if (!repeatCount) {
        throw new Error('まとめ投げ個数は 1 以上で入力してください。');
    }

    if (!diamondCount) {
        throw new Error('1回あたりコイン数は 1 以上で入力してください。');
    }

    const currentGiftCount = dbStore.getAdminGiftEventsByDay(requestedDayKey, getBroadcasterId()).length;
    const event = createSyntheticGiftEvent(requestedDayKey, currentGiftCount, {
        uniqueId,
        nickname,
        giftId,
        giftName,
        repeatCount,
        diamondCount,
        giftPictureUrl,
        profilePictureUrl,
        timestampValue: Date.now(),
        eventSuffix: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    });

    if (!storeRawGiftEvent(event)) {
        throw new Error('テストデータの保存に失敗しました。');
    }

    flushRawGiftEvents();
    emitDayStateChanges(requestedDayKey);

    return {
        dayKey: requestedDayKey,
        insertedCount: 1,
        gift: hydrateStoredGiftEvent({
            id: null,
            dayKey: requestedDayKey,
            uniqueId,
            nickname,
            image: profilePictureUrl,
            totalGifts: diamondCount * repeatCount,
            timestamp: event.timestamp,
            giftId,
            giftName,
            giftImage: giftPictureUrl,
            repeatCount,
            rawPayload: event.rawPayload
        })
    };
}

function deleteGiftEvent(dayKey, giftEventId) {
    const requestedDayKey = normalizeDayKey(dayKey);
    const normalizedGiftEventId = normalizePositiveWholeNumber(giftEventId);

    if (!requestedDayKey || !normalizedGiftEventId) {
        return null;
    }

    if (!hasConfiguredBroadcasterId()) {
        return {
            deletedCount: 0,
            giftEvent: null
        };
    }

    const broadcasterId = getBroadcasterId();
    const giftEvent = dbStore.getRawGiftEventById(normalizedGiftEventId, broadcasterId);

    if (!giftEvent || giftEvent.dayKey !== requestedDayKey) {
        return {
            deletedCount: 0,
            giftEvent: null
        };
    }

    if (giftEvent.processedAt) {
        const contributor = dbStore.getContributorById(requestedDayKey, broadcasterId, giftEvent.uniqueId);

        if (contributor) {
            const nextTotal = Math.max(0, Number(contributor.total || 0) - Number(giftEvent.totalGifts || 0));

            if (nextTotal > 0) {
                dbStore.updateContributorTotal({
                    dayKey: requestedDayKey,
                    broadcasterId,
                    uniqueId: giftEvent.uniqueId,
                    totalCoins: nextTotal,
                    updatedAt: getTimestamp()
                });
            } else {
                dbStore.deleteContributor(requestedDayKey, broadcasterId, giftEvent.uniqueId);
            }
        }
    }

    const deletedCount = dbStore.deleteRawGiftEventById(normalizedGiftEventId, broadcasterId);

    if (deletedCount > 0) {
        emitDayStateChanges(requestedDayKey);
    }

    return {
        deletedCount,
        giftEvent: hydrateStoredGiftEvent(giftEvent)
    };
}

let rawEventFlushTimer = null;
let isProcessingRawEvents = false;
let reconnectTimer = null;
let broadcasterIdResolutionRetryTimer = null;
let activeConnectPromise = null;
let isShuttingDown = false;
let shutdownPromise = null;
let recentTikTokComments = [];

function normalizeTikTokCommentEvent(type, data) {
    const normalizedType = normalizeCommentFeedType(type);
    const actor = extractCommentFeedActor(data);
    const comment = buildCommentFeedMessage(normalizedType, data, actor);

    if (!comment) {
        return null;
    }

    const typeMeta = getCommentFeedTypeMeta(normalizedType);

    return {
        id: [
            getBroadcasterId() || 'broadcaster:none',
            normalizedType,
            data?.msgId || data?.eventId || actor.uniqueId || typeMeta.label,
            data?.createTime || Date.now()
        ].join(':'),
        type: normalizedType,
        typeLabel: typeMeta.label,
        system: typeMeta.system,
        uniqueId: actor.uniqueId,
        nickname: actor.nickname,
        comment,
        image: actor.image,
        timestamp: getTimestamp(),
        dayKey: getTodayDayKey()
    };
}

function getRecentTikTokComments() {
    return recentTikTokComments;
}

function createAdminCommentsPayload() {
    return {
        broadcasterId: getBroadcasterId(),
        comments: getRecentTikTokComments(),
        settings: getCommentFeedSettings(),
        commentTypes: getCommentFeedTypes(),
        updatedAt: getTimestamp()
    };
}

function emitAdminCommentsUpdate() {
    io.emit('admin_comments_updated', createAdminCommentsPayload());
}

function pushTikTokComment(commentEvent) {
    recentTikTokComments = [commentEvent, ...recentTikTokComments].slice(0, LIVE_COMMENT_HISTORY_LIMIT);
    emitAdminCommentsUpdate();
}

function scheduleRawEventFlush(delayMs = RAW_EVENT_FLUSH_DELAY_MS) {
    if (isShuttingDown || rawEventFlushTimer || isProcessingRawEvents) {
        return;
    }

    rawEventFlushTimer = setTimeout(() => {
        rawEventFlushTimer = null;
        flushRawGiftEvents();
    }, delayMs);
}

function flushRawGiftEvents() {
    if (isProcessingRawEvents || !hasConfiguredBroadcasterId()) {
        return;
    }

    isProcessingRawEvents = true;
    const touchedDayKeys = new Set();
    const broadcasterId = getBroadcasterId();

    try {
        while (true) {
            const storedEvents = dbStore.getUnprocessedRawGiftEvents(broadcasterId, RAW_EVENT_BATCH_SIZE);

            if (!storedEvents.length) {
                break;
            }

            for (const storedEvent of storedEvents) {
                try {
                    const contributor = dbStore.processStoredGiftEvent(
                        storedEvent,
                        getTimestamp(),
                        broadcasterId
                    );
                    touchedDayKeys.add(storedEvent.dayKey);

                    console.log(
                        `★ Contributor: ${contributor.nickname} +${storedEvent.totalGifts} (${contributor.total})${storedEvent.giftName ? ` [${storedEvent.giftName}]` : ''}`
                    );
                } catch (error) {
                    dbStore.markRawGiftEventError(storedEvent.id, String(error));
                    console.error('❌ Failed to process raw gift event:', error);
                    scheduleRawEventFlush(RAW_EVENT_RETRY_DELAY_MS);
                    return;
                }
            }
        }
    } finally {
        isProcessingRawEvents = false;
    }

    touchedDayKeys.forEach((dayKey) => {
        emitDayStateChanges(dayKey);
    });
}

function scheduleReconnect(reason, errorDetail = null) {
    if (isShuttingDown || reconnectTimer || !hasConfiguredBroadcasterId()) {
        return;
    }

    const retryDetail = errorDetail
        ? `切断後の再接続待機中です。再接続が成功すると受信方式が更新されます。\n直前のエラー: ${errorDetail}`
        : '切断後の再接続待機中です。再接続が成功すると受信方式が更新されます。';

    setTikTokConnectionState(
        'retrying',
        `TikTok接続が切れました。${Math.round(RECONNECT_DELAY_MS / 1000)}秒後に再接続します。`,
        {
            transportMethod: 'unknown',
            retryScheduled: true,
            retryReason: reason,
            retryDelayMs: RECONNECT_DELAY_MS,
            websocketReasonCode: 'reconnecting',
            websocketReasonLabel: '再接続を待機しています。',
            websocketReasonDetail: retryDetail
        }
    );
    console.warn(`⚠️ TikTok connection retry scheduled (${reason}) in ${RECONNECT_DELAY_MS}ms${errorDetail ? ` — ${errorDetail}` : ''}`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        setTikTokConnectionState('connecting', 'TikTokへ再接続しています...', {
            transportMethod: 'unknown',
            websocketReasonCode: 'reconnecting',
            websocketReasonLabel: '再接続を試行しています。',
            websocketReasonDetail: '接続先の状態を再確認しているため、受信方式はまだ確定していません。'
        });
        connectToTikTok().catch(() => {
            // connectToTikTok logs concrete failures.
        });
    }, RECONNECT_DELAY_MS);
}

function scheduleBroadcasterIdResolutionRetry(sessionId, ttTargetIdc, reason, errorDetail = null, delayMs = BROADCASTER_ID_RESOLUTION_RETRY_DELAY_MS) {
    if (isShuttingDown || broadcasterIdResolutionRetryTimer || !sessionId || !ttTargetIdc || hasConfiguredBroadcasterId()) {
        return;
    }

    const retryDetail = errorDetail
        ? `認証アカウントから配信ユーザーIDを再確認しています。自動取得に成功すると接続を開始します。\n直前のエラー: ${errorDetail}`
        : '認証アカウントから配信ユーザーIDを再確認しています。自動取得に成功すると接続を開始します。';

    setTikTokConnectionState(
        'retrying',
        delayMs > 0
            ? `配信ユーザーIDを自動確認できませんでした。${Math.round(delayMs / 1000)}秒後に再試行します。`
            : '配信ユーザーIDを再確認しています。',
        {
            transportMethod: 'unknown',
            retryScheduled: delayMs > 0,
            retryReason: reason,
            retryDelayMs: delayMs > 0 ? delayMs : null,
            websocketReasonCode: 'broadcaster_id_resolution_retry',
            websocketReasonLabel: delayMs > 0 ? '配信ユーザーIDの再確認を待機しています。' : '配信ユーザーIDを再確認しています。',
            websocketReasonDetail: retryDetail,
            wsAuthAvailable: HAS_TIKTOK_WS_AUTH
        }
    );

    console.warn(`⚠️ Broadcaster ID resolution retry scheduled (${reason}) in ${delayMs}ms${errorDetail ? ` — ${errorDetail}` : ''}`);
    broadcasterIdResolutionRetryTimer = setTimeout(() => {
        broadcasterIdResolutionRetryTimer = null;
        setTikTokConnectionState('connecting', '認証アカウントの配信ユーザーIDを再確認しています...', {
            transportMethod: 'unknown',
            websocketReasonCode: 'broadcaster_id_resolution_retry',
            websocketReasonLabel: '配信ユーザーIDを再確認しています。',
            websocketReasonDetail: '認証状態は保持したまま、配信ユーザーID の自動取得を再試行しています。',
            wsAuthAvailable: HAS_TIKTOK_WS_AUTH
        });
        injectAuthenticatedTikTokSession(sessionId, ttTargetIdc).catch(() => {
            // injectAuthenticatedTikTokSession updates the visible state and re-schedules when needed.
        });
    }, delayMs);
}

async function expireTikTokAuthCredentials(message, detail, error = null) {
    await resetTikTokConnection();

    TIKTOK_SESSION_ID = null;
    TIKTOK_TT_TARGET_IDC = null;
    HAS_TIKTOK_WS_AUTH = false;
    process.env.TIKTOK_SESSION_ID = '';
    process.env.TIKTOK_TT_TARGET_IDC = '';

    tiktokConnectionOptions.enableWebsocketUpgrade = false;
    tiktokConnectionOptions.enableRequestPolling = false;
    tiktokConnectionOptions.sessionId = undefined;
    tiktokConnectionOptions.ttTargetIdc = undefined;
    tiktokConnectionOptions.authenticateWs = false;

    clearPersistedAuthEnvFile(APPDATA_AUTH_ENV_PATH);

    const composedDetail = error?.message
        ? `${detail}\n直前のエラー: ${error.message}`
        : detail;

    setTikTokConnectionState('not_configured', message, {
        transportMethod: 'unknown',
        websocketReasonCode: 'login_expired',
        websocketReasonLabel: 'TikTok認証の有効期限が切れました。',
        websocketReasonDetail: composedDetail,
        wsAuthAvailable: false,
        retryScheduled: false,
        retryReason: null,
        retryDelayMs: null
    });
}

async function clearTikTokAuthCredentials(message = 'TikTokからログアウトしました。再度認証してください。') {
    await resetTikTokConnection();

    TIKTOK_SESSION_ID = null;
    TIKTOK_TT_TARGET_IDC = null;
    HAS_TIKTOK_WS_AUTH = false;
    process.env.TIKTOK_SESSION_ID = '';
    process.env.TIKTOK_TT_TARGET_IDC = '';

    tiktokConnectionOptions.enableWebsocketUpgrade = false;
    tiktokConnectionOptions.enableRequestPolling = false;
    tiktokConnectionOptions.sessionId = undefined;
    tiktokConnectionOptions.ttTargetIdc = undefined;
    tiktokConnectionOptions.authenticateWs = false;

    clearPersistedAuthEnvFile(APPDATA_AUTH_ENV_PATH);
    clearBroadcasterId();

    setTikTokConnectionState('not_configured', message, {
        transportMethod: 'unknown',
        websocketReasonCode: 'login_required',
        websocketReasonLabel: 'TikTokログインが必要です。',
        websocketReasonDetail: '認証情報を削除しました。再度ログインすると配信ユーザーIDを自動取得します。',
        wsAuthAvailable: false,
        retryScheduled: false,
        retryReason: null,
        retryDelayMs: null
    });

    emitAdminDayUpdate(getDisplayDayKey());
}

async function resetTikTokConnection() {
    recentTikTokComments = [];
    emitAdminCommentsUpdate();

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (broadcasterIdResolutionRetryTimer) {
        clearTimeout(broadcasterIdResolutionRetryTimer);
        broadcasterIdResolutionRetryTimer = null;
    }

    activeConnectPromise = null;

    if (!tiktokLiveConnection) {
        activeTikTokUsername = null;
        return;
    }

    const connection = tiktokLiveConnection;
    tiktokLiveConnection = null;
    activeTikTokUsername = null;

    finishContributorsSession();

    connection.removeAllListeners?.();

    try {
        await Promise.resolve(connection.disconnect?.());
    } catch (error) {
        console.warn('⚠️ Failed to disconnect previous TikTok connection cleanly:', error);
    }

    setTikTokConnectionState('idle', 'TikTok接続をリセットしました。', {
        transportMethod: 'unknown',
        websocketReasonCode: 'connection_reset',
        websocketReasonLabel: '接続はリセット済みです。',
        websocketReasonDetail: '次回接続時にあらためて WebSocket か request polling かを判定します。'
    });
}

async function shutdownApplication(reason = 'manual') {
    if (shutdownPromise) {
        return shutdownPromise;
    }

    isShuttingDown = true;
    shutdownPromise = (async () => {
        console.log(`ℹ️ Shutting down TikEffect (${reason})...`);

        if (rawEventFlushTimer) {
            clearTimeout(rawEventFlushTimer);
            rawEventFlushTimer = null;
        }

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        if (broadcasterIdResolutionRetryTimer) {
            clearTimeout(broadcasterIdResolutionRetryTimer);
            broadcasterIdResolutionRetryTimer = null;
        }

        await resetTikTokConnection();

        await new Promise((resolve) => {
            io.close(() => resolve());
        });

        await closeHttpServer();

        try {
            dbStore.close();
        } catch (error) {
            console.warn('⚠️ Failed to close SQLite cleanly:', error);
        }

        console.log('ℹ️ TikEffect shutdown completed.');
    })();

    return shutdownPromise;
}

async function switchBroadcasterId(broadcasterId) {
    const normalizedBroadcasterId = normalizeBroadcasterId(broadcasterId);

    if (!normalizedBroadcasterId) {
        return null;
    }

    if (getBroadcasterId() !== normalizedBroadcasterId) {
        await resetTikTokConnection();
    }

    const savedBroadcasterId = setBroadcasterId(normalizedBroadcasterId);
    if (TIKTOK_SESSION_ID) {
        setTikTokConnectionState('idle', `@${savedBroadcasterId} への接続準備ができました。`, {
            transportMethod: 'unknown',
            websocketReasonCode: 'pending_connection',
            websocketReasonLabel: '接続前の待機状態です。',
            websocketReasonDetail: '接続が始まると、その配信で WebSocket が使えるかどうかを判定します。'
        });
    } else {
        setTikTokConnectionState('not_configured', 'TikTokへの接続には先にログインが必要です。', {
            transportMethod: 'unknown',
            websocketReasonCode: 'login_required',
            websocketReasonLabel: 'TikTokログインが必要です。',
            websocketReasonDetail: 'セットアップ画面の「TikTokにログイン」ボタンからログインすると自動的に接続されます。'
        });
    }
    return savedBroadcasterId;
}

io.on('connection', (socket) => {
    const displayDayKey = getDisplayDayKey();
    emitOverlaySnapshot(socket, displayDayKey);
    socket.emit('admin_day_updated', createAdminDayPayload(displayDayKey));
    socket.emit('admin_comments_updated', createAdminCommentsPayload());
});

app.get('/admin', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.redirect('/admin');
});

app.get('/api/state', (req, res) => {
    res.json({
        displayDayKey: getDisplayDayKey(),
        broadcasterId: getBroadcasterId(),
        broadcasterIdConfigured: hasConfiguredBroadcasterId(),
        tiktokConnection: getTikTokConnectionState(),
        todayDayKey: getTodayDayKey(),
        yesterdayDayKey: getYesterdayDayKey(),
        isElectron: IS_ELECTRON
    });
});

app.get('/api/comments/config', (req, res) => {
    res.json({
        settings: getCommentFeedSettings(),
        commentTypes: getCommentFeedTypes()
    });
});

app.patch('/api/comments/config', (req, res) => {
    const settings = setCommentFeedSettings(req.body || {});
    emitAdminCommentsUpdate();
    res.json({
        ok: true,
        settings,
        commentTypes: getCommentFeedTypes()
    });
});

app.get('/api/effects/config', (req, res) => {
    res.json({
        events: getEffectEvents(),
        triggers: getEffectTriggers(),
        screenUrls: buildEffectOverlayUrls(req)
    });
});

app.get('/api/widgets/config', (req, res) => {
    const sharedWidgetAppearance = getSharedWidgetTextAppearance();

    res.json({
        broadcasterId: getBroadcasterId(),
        displayDayKey: getDisplayDayKey(),
        todayDayKey: getTodayDayKey(),
        contributorsDisplayRangeMode: getContributorsDisplayRange(),
        liveSession: getContributorsSessionState(),
        widgetUrls: buildWidgetUrls(req),
        contributorsDisplayThreshold: getDisplayThreshold(),
        contributorsGoalCount: getDisplayGoalCount(),
        contributorsAvatarVisibility: getDisplayAvatarVisibility(),
        contributorsFontKey: getDisplayFontFamily(),
        contributorsColorTheme: getDisplayColorTheme(),
        contributorsStrokeWidth: getDisplayStrokeWidth(),
        sharedWidgetAppearance,
        topGiftSettings: getWidgetTopGiftSettings(),
        topGiftSnapshot: buildTopGiftSnapshot(getTodayDayKey()),
        goalGiftFontKey: sharedWidgetAppearance.fontKey,
        goalGiftTextStyleKey: sharedWidgetAppearance.textStyleKey,
        goalGiftStrokeWidth: sharedWidgetAppearance.strokeWidth,
        goalGiftItems: buildGoalGiftProgressSnapshot(getTodayDayKey()).goals
    });
});

app.get('/api/widgets/top-gift/snapshot', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey) || getTodayDayKey();
    res.json({
        settings: {
            ...getWidgetTopGiftSettings(),
            appearance: getSharedWidgetTextAppearance()
        },
        snapshot: buildTopGiftSnapshot(requestedDayKey)
    });
});

app.patch('/api/widgets/top-gift', (req, res) => {
    const settings = setWidgetTopGiftSettings(req.body || {});
    const snapshot = buildTopGiftSnapshot(getTodayDayKey());
    const payload = {
        settings: {
            ...settings,
            appearance: getSharedWidgetTextAppearance()
        },
        snapshot
    };

    io.emit('widgets:top-gift:updated', payload);

    res.json({
        ok: true,
        ...payload
    });
});

app.get('/api/widgets/goal-gifts/snapshot', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey) || getTodayDayKey();
    res.json({
        snapshot: buildGoalGiftProgressSnapshot(requestedDayKey)
    });
});

app.patch('/api/widgets/goal-gifts', (req, res) => {
    if (!Array.isArray(req.body?.items)) {
        return res.status(400).json({ ok: false, error: 'items must be an array' });
    }

    const fontKey = req.body?.fontKey !== undefined
        ? setDisplayFontFamily(req.body.fontKey)
        : getDisplayFontFamily();
    const textStyleKey = req.body?.textStyleKey !== undefined
        ? setDisplayColorTheme(req.body.textStyleKey)
        : getDisplayColorTheme();
    const strokeWidth = req.body?.strokeWidth !== undefined
        ? setDisplayStrokeWidth(req.body.strokeWidth)
        : getDisplayStrokeWidth();
    const items = setGoalGiftWidgetItems(req.body.items);
    const snapshot = buildGoalGiftProgressSnapshot(getTodayDayKey(), items, fontKey, textStyleKey, strokeWidth);

    io.emit('widgets:goal-gifts:updated', {
        snapshot
    });

    res.json({
        ok: true,
        items: snapshot.goals,
        snapshot
    });
});

app.patch('/api/widgets/contributors-style', (req, res) => {
    const displayThreshold = normalizePositiveHundreds(req.body?.displayThreshold);
    if (req.body?.displayThreshold !== undefined && displayThreshold === null) {
        return res.status(400).json({ ok: false, error: 'displayThreshold must be a positive multiple of 100' });
    }

    const goalCount = normalizeWholeNumber(req.body?.goalCount);
    if (req.body?.goalCount !== undefined && goalCount === null) {
        return res.status(400).json({ ok: false, error: 'goalCount must be a non-negative integer' });
    }

    const avatarVisibility = req.body?.avatarVisibility !== undefined
        ? normalizeDisplayAvatarVisibility(req.body.avatarVisibility)
        : getDisplayAvatarVisibility();

    const fontFamily = setDisplayFontFamily(req.body?.fontFamily);
    const savedDisplayThreshold = req.body?.displayThreshold !== undefined ? setDisplayThreshold(displayThreshold) : getDisplayThreshold();
    const savedGoalCount = req.body?.goalCount !== undefined ? setDisplayGoalCount(goalCount) : getDisplayGoalCount();
    const savedAvatarVisibility = req.body?.avatarVisibility !== undefined ? setDisplayAvatarVisibility(avatarVisibility) : getDisplayAvatarVisibility();
    const colorTheme = setDisplayColorTheme(req.body?.colorTheme);
    const strokeWidth = setDisplayStrokeWidth(req.body?.strokeWidth);

    emitDisplayThresholdChanges();

    io.emit('widgets:top-gift:updated', {
        settings: {
            ...getWidgetTopGiftSettings(),
            appearance: getSharedWidgetTextAppearance()
        },
        snapshot: buildTopGiftSnapshot(getTodayDayKey())
    });
    io.emit('widgets:goal-gifts:updated', {
        snapshot: buildGoalGiftProgressSnapshot(getTodayDayKey())
    });

    res.json({
        ok: true,
        fontFamily,
        displayRangeMode: getContributorsDisplayRange(),
        displayThreshold: savedDisplayThreshold,
        goalCount: savedGoalCount,
        avatarVisibility: savedAvatarVisibility,
        colorTheme,
        strokeWidth,
        liveSession: getContributorsSessionState(),
        snapshot: buildOverlayContributorsSnapshot(getDisplayDayKey())
    });
});

app.patch('/api/widgets/contributors-range', (req, res) => {
    const displayRangeMode = setContributorsDisplayRange(req.body?.displayRangeMode);
    const snapshot = buildOverlayContributorsSnapshot();
    emitSnapshot(getDisplayDayKey());
    emitAdminDayUpdate(getDisplayDayKey());

    res.json({
        ok: true,
        displayRangeMode,
        liveSession: getContributorsSessionState(),
        snapshot
    });
});

app.patch('/api/effects/config', (req, res) => {
    if (!Array.isArray(req.body?.events) || !Array.isArray(req.body?.triggers)) {
        return res.status(400).json({ ok: false, error: 'events and triggers must be arrays' });
    }

    const events = setEffectEvents(req.body.events);
    const eventIds = new Set(events.map((item) => item.id));
    const triggers = setEffectTriggers(req.body.triggers.filter((item) => {
        const eventId = normalizeEffectText(item?.eventId, 80);
        return !eventId || eventIds.has(eventId);
    }));

    return res.json({
        ok: true,
        events,
        triggers,
        screenUrls: buildEffectOverlayUrls(req)
    });
});

app.post('/api/effects/preview', (req, res) => {
    const effectEvent = normalizeEffectEvent(req.body?.event, 0);

    if (!effectEvent.videoAssetUrl && !effectEvent.audioAssetUrl) {
        return res.status(400).json({ ok: false, error: '動画または音声を設定したイベントだけ再生できます。' });
    }

    emitEffectPlayback(effectEvent, null, null);

    return res.json({
        ok: true,
        event: effectEvent
    });
});

app.post('/api/effects/media', (req, res) => {
    effectMediaUpload.single('media')(req, res, (error) => {
        if (error) {
            return res.status(400).json({ ok: false, error: error.message || 'メディアの取り込みに失敗しました。' });
        }

        if (!req.file) {
            return res.status(400).json({ ok: false, error: 'media file is required' });
        }

        const isVideo = String(req.file.mimetype || '').toLowerCase().startsWith('video/');

        return res.json({
            ok: true,
            asset: {
                kind: isVideo ? 'video' : 'audio',
                name: req.file.originalname,
                url: buildEffectMediaUrl(req.file.filename),
                mimeType: req.file.mimetype,
                size: req.file.size
            }
        });
    });
});

app.post('/api/tiktok-login/start', (req, res) => {
    if (!IS_ELECTRON) {
        return res.status(400).json({ error: 'Electron モードでのみ使用できます。' });
    }

    serverEvents.emit('tiktok-login-start', {
        switchMode: Boolean(req.body?.switchMode),
        currentBroadcasterId: normalizeBroadcasterId(req.body?.currentBroadcasterId)
    });
    res.json({ ok: true });
});

app.post('/api/tiktok-login/logout', async (req, res) => {
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({
            error: 'This endpoint is available only from localhost.'
        });
    }

    try {
        await clearTikTokAuthCredentials();
        res.json({ ok: true });
    } catch (error) {
        console.error('❌ Failed to clear TikTok auth:', error);
        res.status(500).json({
            error: 'TikTok認証のログアウトに失敗しました。'
        });
    }
});

app.post('/api/app/exit', (req, res) => {
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({
            error: 'This endpoint is available only from localhost.'
        });
    }

    res.status(202).json({
        ok: true,
        shuttingDown: true
    });

    setImmediate(() => {
        shutdownApplication('api_request')
            .then(() => {
                process.exit(0);
            })
            .catch((error) => {
                console.error('❌ Failed during graceful shutdown:', error);
                process.exit(1);
            });
    });
});

app.get('/api/days', (req, res) => {
    res.json({
        days: getAvailableDays(),
        displayDayKey: getDisplayDayKey(),
        broadcasterId: getBroadcasterId(),
        broadcasterIdConfigured: hasConfiguredBroadcasterId(),
        tiktokConnection: getTikTokConnectionState(),
        todayDayKey: getTodayDayKey(),
        yesterdayDayKey: getYesterdayDayKey()
    });
});

app.get('/api/contributors', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey) || getDisplayDayKey();
    res.json({
        dayKey: requestedDayKey,
        contributors: getAdminContributorsForDay(requestedDayKey)
    });
});

app.get('/api/users/recent', (req, res) => {
    const broadcasterId = getBroadcasterId();
    if (!broadcasterId) {
        return res.json({ users: [] });
    }
    const today = getTodayDayKey();
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 6);
    const sinceDay = sinceDate.toISOString().slice(0, 10);
    const users = dbStore.getRecentGiftSenders(broadcasterId, sinceDay, 200);
    return res.json({ users });
});

app.get('/api/gifts', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey) || getDisplayDayKey();
    const gifts = dbStore.getAdminGiftEventsByDay(requestedDayKey, getBroadcasterId()).map(hydrateStoredGiftEvent);

    res.json({
        dayKey: requestedDayKey,
        gifts
    });
});

app.get('/api/overlay/contributors/snapshot', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey) || getDisplayDayKey();
    res.json(buildOverlayContributorsSnapshot(requestedDayKey));
});

app.get('/api/gift-suggestions', (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200)
        : 100;

    const gifts = dbStore.getKnownGiftNames(getBroadcasterId(), limit).map((gift) => gift.giftName);

    res.json({
        gifts
    });
});

app.post('/api/test-data/contributors', (req, res) => {
    try {
        const result = insertTestGiftEventsForDay(req.body?.dayKey || getDisplayDayKey(), 'contributors');
        return res.json({
            ok: true,
            ...result
        });
    } catch (error) {
        return res.status(400).json({
            ok: false,
            error: error?.message || 'テストデータの追加に失敗しました。'
        });
    }
});

app.post('/api/test-data/gifts', (req, res) => {
    try {
        const result = insertTestGiftEventsForDay(req.body?.dayKey || getDisplayDayKey(), 'gifts');
        return res.json({
            ok: true,
            ...result
        });
    } catch (error) {
        return res.status(400).json({
            ok: false,
            error: error?.message || 'テストデータの追加に失敗しました。'
        });
    }
});

app.post('/api/test-data/gifts/custom', (req, res) => {
    try {
        const result = insertCustomTestGiftEventForDay(req.body?.dayKey || getDisplayDayKey(), req.body || {});
        return res.json({
            ok: true,
            ...result
        });
    } catch (error) {
        return res.status(400).json({
            ok: false,
            error: error?.message || 'テストデータの追加に失敗しました。'
        });
    }
});

app.get('/api/tiktok/gifts', async (req, res) => {
    try {
        const gifts = await fetchTikTokGiftCatalog({
            forceRefresh: req.query.force === '1'
        });

        return res.json({
            gifts,
            fetchedAt: cachedTikTokGiftCatalog.fetchedAt,
            broadcasterId: getBroadcasterId()
        });
    } catch (error) {
        return res.status(500).json({
            ok: false,
            error: error?.message || 'TikTok ギフト一覧の取得に失敗しました。'
        });
    }
});

app.patch('/api/contributors', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.body.dayKey);
    const uniqueId = typeof req.body.uniqueId === 'string' ? req.body.uniqueId.trim() : '';
    const totalCoins = normalizeWholeNumber(req.body.total);

    if (!requestedDayKey || !uniqueId || totalCoins === null) {
        return res.status(400).json({ ok: false, error: 'dayKey, uniqueId and non-negative integer total are required' });
    }

    const contributor = setContributorTotal(requestedDayKey, uniqueId, totalCoins);

    if (!contributor) {
        return res.status(404).json({ ok: false, error: 'Contributor not found' });
    }

    return res.json({ ok: true, contributor });
});

app.patch('/api/contributors/nickname', (req, res) => {
    const uniqueId = typeof req.body.uniqueId === 'string' ? req.body.uniqueId.trim() : '';
    const nickname = normalizeNickname(req.body.nickname);

    if (!uniqueId || !nickname) {
        return res.status(400).json({ ok: false, error: 'uniqueId and valid nickname are required' });
    }

    const result = setContributorNickname(uniqueId, nickname);

    if (!result) {
        return res.status(404).json({ ok: false, error: 'Contributor not found' });
    }

    return res.json({ ok: true, ...result });
});

app.delete('/api/gifts', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey);
    const giftEventId = normalizePositiveWholeNumber(req.query.giftEventId);

    if (!requestedDayKey || !giftEventId) {
        return res.status(400).json({ ok: false, error: 'dayKey and giftEventId are required' });
    }

    const result = deleteGiftEvent(requestedDayKey, giftEventId);

    if (!result?.giftEvent) {
        return res.status(404).json({ ok: false, error: 'Gift event not found' });
    }

    return res.json({ ok: true, ...result });
});

app.delete('/api/contributors', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey);
    const uniqueId = typeof req.query.uniqueId === 'string' ? req.query.uniqueId.trim() : '';

    if (!requestedDayKey || !uniqueId) {
        return res.status(400).json({ ok: false, error: 'dayKey and uniqueId are required' });
    }

    const changes = deleteContributor(requestedDayKey, uniqueId);
    return res.json({ ok: true, deletedCount: changes });
});

app.delete('/api/contributors/day', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey);

    if (!requestedDayKey) {
        return res.status(400).json({ ok: false, error: 'dayKey must be YYYY-MM-DD' });
    }

    const changes = resetContributorsForDay(requestedDayKey);
    return res.json({ ok: true, deletedCount: changes });
});

app.post('/api/display/day', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.body.dayKey);

    if (!requestedDayKey) {
        return res.status(400).json({ ok: false, error: 'dayKey must be YYYY-MM-DD' });
    }

    respondWithDisplayChange(res, requestedDayKey);
});

app.get('/display/today', (req, res) => {
    respondWithDisplayChange(res, getTodayDayKey());
});

app.get('/display/yesterday', (req, res) => {
    respondWithDisplayChange(res, getYesterdayDayKey());
});

app.get('/display/day/:dayKey', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.params.dayKey);

    if (!requestedDayKey) {
        return res.status(400).json({ ok: false, error: 'dayKey must be YYYY-MM-DD' });
    }

    respondWithDisplayChange(res, requestedDayKey);
});

currentBroadcasterId = getInitialBroadcasterId();

if (hasConfiguredBroadcasterId()) {
    if (TIKTOK_SESSION_ID) {
        setTikTokConnectionState('idle', `@${getBroadcasterId()} への接続待機中です。`, {
            transportMethod: 'unknown',
            websocketReasonCode: 'pending_connection',
            websocketReasonLabel: 'まだ接続前です。',
            websocketReasonDetail: '接続が成功すると、WebSocket か request polling かがここに表示されます。'
        });
    } else {
        setTikTokConnectionState('not_configured', 'TikTokへの接続には先にログインが必要です。', {
            transportMethod: 'unknown',
            websocketReasonCode: 'login_required',
            websocketReasonLabel: 'TikTokログインが必要です。',
            websocketReasonDetail: 'セットアップ画面の「TikTokにログイン」ボタンからログインすると自動的に接続されます。'
        });
    }
} else {
    if (HAS_TIKTOK_WS_AUTH) {
        scheduleBroadcasterIdResolutionRetry(TIKTOK_SESSION_ID, TIKTOK_TT_TARGET_IDC, 'startup', null, 0);
    } else {
        setTikTokConnectionState('not_configured', 'TikTokログイン待機中です。認証が完了すると配信ユーザーIDを自動取得します。', {
            transportMethod: 'unknown',
            websocketReasonCode: 'broadcaster_not_configured',
            websocketReasonLabel: '配信ユーザーIDは未確定です。',
            websocketReasonDetail: 'TikTok にログインすると認証アカウントの配信ユーザーIDを自動取得し、接続方式の判定を開始します。',
            wsAuthAvailable: HAS_TIKTOK_WS_AUTH
        });
    }
}

if (hasConfiguredBroadcasterId()) {
    setDisplayDayKey(getDisplayDayKey());
}

const tiktokConnectionOptions = {
    processInitialData: false,
    enableExtendedGiftInfo: false,
    enableWebsocketUpgrade: HAS_TIKTOK_WS_AUTH,
    enableRequestPolling: Boolean(TIKTOK_SESSION_ID),
    requestPollingIntervalMs: 1000,
    sessionId: TIKTOK_SESSION_ID || undefined,
    ttTargetIdc: TIKTOK_TT_TARGET_IDC || undefined,
    authenticateWs: HAS_TIKTOK_WS_AUTH,
    webClientParams: {
        ...TIKTOK_JA_LOCALE_CLIENT_PARAMS
    },
    webClientHeaders: {
        ...TIKTOK_JA_LOCALE_HEADERS
    },
    wsClientParams: {
        ...TIKTOK_JA_LOCALE_CLIENT_PARAMS
    },
    wsClientHeaders: {
        ...TIKTOK_JA_LOCALE_HEADERS
    },
    signedWebSocketProvider: IS_ELECTRON ? async (params) => {
        if (!process.env.WHITELIST_AUTHENTICATED_SESSION_ID_HOST) {
            process.env.WHITELIST_AUTHENTICATED_SESSION_ID_HOST = getTikTokSignServerHost();
        }

        const webClient = new TikTokWebClient({
            customHeaders: {
                ...TIKTOK_JA_LOCALE_HEADERS
            },
            axiosOptions: {},
            clientParams: {
                ...TIKTOK_JA_LOCALE_CLIENT_PARAMS
            },
            authenticateWs: Boolean(params.sessionId && params.ttTargetIdc)
        });

        if (typeof webClient.cookieJar?.setSession === 'function') {
            webClient.cookieJar.setSession(params.sessionId, params.ttTargetIdc);
        }

        return webClient.fetchSignedWebSocketFromEuler(params);
    } : undefined
};

function injectWsCredentials(sessionId, ttTargetIdc) {
    TIKTOK_SESSION_ID = sessionId || null;
    TIKTOK_TT_TARGET_IDC = ttTargetIdc || null;
    HAS_TIKTOK_WS_AUTH = Boolean(TIKTOK_SESSION_ID && TIKTOK_TT_TARGET_IDC);
    persistAuthEnvFile(APPDATA_AUTH_ENV_PATH, TIKTOK_SESSION_ID, TIKTOK_TT_TARGET_IDC);

    tiktokConnectionOptions.enableWebsocketUpgrade = HAS_TIKTOK_WS_AUTH;
    tiktokConnectionOptions.enableRequestPolling = Boolean(TIKTOK_SESSION_ID);
    tiktokConnectionOptions.sessionId = TIKTOK_SESSION_ID || undefined;
    tiktokConnectionOptions.ttTargetIdc = TIKTOK_TT_TARGET_IDC || undefined;
    tiktokConnectionOptions.authenticateWs = HAS_TIKTOK_WS_AUTH;

    // 既存の接続キャッシュを無効化して再接続させる
    activeTikTokUsername = null;

    if (tiktokLiveConnection) {
        tiktokLiveConnection.disconnect();
        tiktokLiveConnection = null;
    }

    setTikTokConnectionState('idle', 'WebSocket 認証情報を保存しました。認証アカウントの配信ユーザーIDを確認しています。', {
        transportMethod: 'unknown',
        websocketReasonCode: null,
        websocketReasonLabel: null,
        websocketReasonDetail: null,
        wsAuthAvailable: HAS_TIKTOK_WS_AUTH
    });

    // ここでは認証情報だけを更新する。
    // Electron では続けて injectAuthenticatedTikTokSession() が呼ばれ、認証アカウントの broadcaster ID 解決と接続開始を行う。

    console.log('🔑 WebSocket credentials injected via Electron login.');
}

async function injectAuthenticatedTikTokSession(sessionId, ttTargetIdc) {
    injectWsCredentials(sessionId, ttTargetIdc);

    if (broadcasterIdResolutionRetryTimer) {
        clearTimeout(broadcasterIdResolutionRetryTimer);
        broadcasterIdResolutionRetryTimer = null;
    }

    let accountInfo;

    try {
        accountInfo = await fetchAuthenticatedTikTokAccountInfo(sessionId, ttTargetIdc);
    } catch (error) {
        if (isTikTokAuthInvalidError(error)) {
            await expireTikTokAuthCredentials(
                '保存済みの TikTok 認証情報の有効期限が切れました。再ログインしてください。',
                '認証アカウント情報の確認中に、保存済みの TikTok 認証情報が無効と判定されました。',
                error
            );
            return null;
        }

        scheduleBroadcasterIdResolutionRetry(
            sessionId,
            ttTargetIdc,
            'broadcaster_id_auto_detect_failed',
            error?.message || 'TikTok アカウント情報の取得に失敗しました。'
        );
        emitAdminDayUpdate(getDisplayDayKey());
        return null;
    }

    const authenticatedBroadcasterId = extractAuthenticatedBroadcasterId(accountInfo);

    if (!authenticatedBroadcasterId) {
        scheduleBroadcasterIdResolutionRetry(
            sessionId,
            ttTargetIdc,
            'broadcaster_id_missing',
            'TikTok の自己情報 API は応答しましたが、username を解釈できませんでした。'
        );
        emitAdminDayUpdate(getDisplayDayKey());
        return null;
    }

    const savedBroadcasterId = await switchBroadcasterId(authenticatedBroadcasterId);

    if (!savedBroadcasterId) {
        scheduleBroadcasterIdResolutionRetry(
            sessionId,
            ttTargetIdc,
            'broadcaster_id_save_failed',
            '認証アカウントの配信ユーザーIDを保存できませんでした。'
        );
        return null;
    }

    emitSnapshot(getDisplayDayKey());
    emitAdminDayUpdate(getDisplayDayKey());

    connectToTikTok().catch(() => {
        // connectToTikTok logs concrete failures.
    });

    return {
        broadcasterId: savedBroadcasterId,
        accountInfo
    };
}

function ensureTikTokConnection() {
    const broadcasterId = getBroadcasterId();

    if (!broadcasterId) {
        return null;
    }

    if (tiktokLiveConnection && activeTikTokUsername === broadcasterId) {
        return tiktokLiveConnection;
    }

    recentTikTokComments = [];
    emitAdminCommentsUpdate();

    tiktokLiveConnection = new WebcastPushConnection(broadcasterId, tiktokConnectionOptions);
    activeTikTokUsername = broadcasterId;

    tiktokLiveConnection.on('disconnected', () => {
        finishContributorsSession();
        emitSnapshot(getDisplayDayKey());
        emitAdminDayUpdate(getDisplayDayKey());
        scheduleReconnect('disconnected');
    });

    tiktokLiveConnection.on('streamEnd', () => {
        finishContributorsSession();
        emitSnapshot(getDisplayDayKey());
        emitAdminDayUpdate(getDisplayDayKey());
        scheduleReconnect('stream_end');
    });

    tiktokLiveConnection.on('error', (err) => {
        if (isTikTokUserOfflineError(err)) {
            setTikTokConnectionState('offline', buildTikTokOfflineMessage(getBroadcasterId()), {
                transportMethod: 'unknown',
                websocketReasonCode: 'broadcaster_offline',
                websocketReasonLabel: '配信が始まっていないため判定できません。',
                websocketReasonDetail: '配信者がオフラインのため、WebSocket が使えるかどうかの確認もまだできません。'
            });
            scheduleReconnect('user_offline');
            return;
        }

        if (isTikTokRecoverableRoomInfoError(err)) {
            console.warn('⚠️ TikTok room info fetch fell back while probing the live state. Retrying in the background.');
            scheduleReconnect('room_info_probe_failed', err?.exception?.message || err?.message || null);
            return;
        }

        console.error('❌ TikTok connection error:', err);
        scheduleReconnect(err?.name || 'runtime_error', err?.message);
    });

    tiktokLiveConnection.on('gift', (data) => {
        const normalizedEvent = normalizeGiftEvent(data);

        if (!normalizedEvent) {
            return;
        }

        const inserted = storeRawGiftEvent(normalizedEvent);

        if (!inserted) {
            return;
        }

        tryRunEffectTriggersForGift(normalizedEvent);
        scheduleRawEventFlush();
    });

    COMMENT_FEED_EVENT_DEFINITIONS.forEach(({ type }) => {
        tiktokLiveConnection.on(type, (data) => {
            const normalizedComment = normalizeTikTokCommentEvent(type, data);

            if (!normalizedComment) {
                return;
            }

            let goalGiftCountsChanged = false;

            if (type === 'like') {
                incrementGoalGiftActivityCount('like', normalizeWholeNumber(data?.likeCount) || 1);
                goalGiftCountsChanged = true;
            } else if (type === 'follow') {
                incrementGoalGiftActivityCount('follow', 1);
                goalGiftCountsChanged = true;
            }

            pushTikTokComment(normalizedComment);
            tryRunEffectTriggersForComment(normalizedComment);

            if (goalGiftCountsChanged) {
                io.emit('widgets:goal-gifts:updated', {
                    snapshot: buildGoalGiftProgressSnapshot(getTodayDayKey())
                });
            }
        });
    });

    return tiktokLiveConnection;
}

async function connectToTikTok() {
    if (activeConnectPromise) {
        return activeConnectPromise;
    }

    const broadcasterId = getBroadcasterId();

    if (!broadcasterId) {
        if (HAS_TIKTOK_WS_AUTH) {
            scheduleBroadcasterIdResolutionRetry(TIKTOK_SESSION_ID, TIKTOK_TT_TARGET_IDC, 'connect_without_broadcaster', null, 0);
        } else {
            setTikTokConnectionState('not_configured', 'TikTokログイン待機中です。認証が完了すると配信ユーザーIDを自動取得します。', {
                transportMethod: 'unknown',
                websocketReasonCode: 'broadcaster_not_configured',
                websocketReasonLabel: '配信ユーザーIDは未確定です。',
                websocketReasonDetail: 'TikTok にログインすると認証アカウントの配信ユーザーIDを自動取得し、接続方式の判定を開始します。',
                wsAuthAvailable: HAS_TIKTOK_WS_AUTH
            });
        }
        return;
    }

    if (!TIKTOK_SESSION_ID) {
        setTikTokConnectionState(
            'not_configured',
            'TikTokへの接続には先にログインが必要です。',
            {
                transportMethod: 'unknown',
                websocketReasonCode: 'login_required',
                websocketReasonLabel: 'TikTokログインが必要です。',
                websocketReasonDetail: 'セットアップ画面の「TikTokにログイン」ボタンからログインすると自動的に接続されます。'
            }
        );
        return;
    }

    const connection = ensureTikTokConnection();
    if (tiktokLiveConnection === connection && activeTikTokUsername === broadcasterId && tiktokConnectionState.status === 'connected') {
        return connection;
    }

    setTikTokConnectionState('connecting', `@${broadcasterId} に接続しています...`, {
        transportMethod: 'unknown',
        websocketReasonCode: 'connecting',
        websocketReasonLabel: '接続方式を確認中です。',
        websocketReasonDetail: 'WebSocket upgrade を試し、その結果に応じて request polling へフォールバックするかを判定しています。'
    });

    activeConnectPromise = (async () => {
        try {
            const state = await connection.connect();
        // v2.x は常に WebSocket で接続する（Electron では signedWebSocketProvider でも同様）
            const connectedStateOptions = {
                transportMethod: 'websocket',
                websocketReasonCode: 'websocket_active',
                websocketReasonLabel: '現在は WebSocket で受信できています。',
                websocketReasonDetail: 'この配信は WebSocket で受信中です。追加の対応は不要です。'
            };
            const transport = 'websocket';
            setTikTokConnectionState('connected', `@${broadcasterId} に接続中です。受信方式: ${transport}`, connectedStateOptions);
            startContributorsSession();
            emitSnapshot(getDisplayDayKey());
            emitAdminDayUpdate(getDisplayDayKey());
            console.log(`✅ Connected to ${broadcasterId} via ${transport}`);
            return state;
        } catch (err) {
            if (isTikTokAlreadyConnectedError(err)) {
                setTikTokConnectionState('connected', `@${broadcasterId} に接続中です。受信方式: websocket`, {
                    transportMethod: 'websocket',
                    websocketReasonCode: 'websocket_active',
                    websocketReasonLabel: '現在は WebSocket で受信できています。',
                    websocketReasonDetail: '既存の WebSocket 接続を継続利用しています。'
                });
                return connection;
            }

            if (isTikTokAuthInvalidError(err)) {
                await expireTikTokAuthCredentials(
                    '保存済みの TikTok 認証情報の有効期限が切れました。再ログインしてください。',
                    '接続時に、保存済みの TikTok 認証情報が無効と判定されました。',
                    err
                );
                return null;
            }

            if (isTikTokUserOfflineError(err)) {
                setTikTokConnectionState('offline', buildTikTokOfflineMessage(broadcasterId), {
                    transportMethod: 'unknown',
                    websocketReasonCode: 'broadcaster_offline',
                    websocketReasonLabel: '配信がオフラインです。',
                    websocketReasonDetail: '配信が始まっていないため、WebSocket が使えるかどうかの判定もまだ完了していません。'
                });
                console.warn(`⚠️ TikTok broadcaster @${broadcasterId} is offline. Retrying in the background.`);
                scheduleReconnect('user_offline');
                return null;
            }

            if (err?.name === 'NoWSUpgradeError' && !TIKTOK_SESSION_ID) {
                setTikTokConnectionState(
                    'error',
                    'この配信は request polling か認証付き WebSocket が必要です。sessionid と tt-target-idc を設定してアプリを再起動してください。',
                    {
                        transportMethod: 'unknown',
                        websocketReasonCode: 'ws_upgrade_unavailable',
                        websocketReasonLabel: 'この配信はそのままでは WebSocket に上がれません。',
                        websocketReasonDetail: '匿名の WebSocket upgrade が拒否され、sessionid も未設定のため request polling にも切り替えられません。sessionid と tt-target-idc を設定して再起動してください。'
                    }
                );
                console.error('❌ TikTok connection failed: this live requires request polling or authenticated websocket access. Set TIKTOK_SESSION_ID and TIKTOK_TT_TARGET_IDC from your browser cookies and restart the app.');
                throw err;
            }

            if (err?.name === 'NoWSUpgradeError' && TIKTOK_SESSION_ID && !TIKTOK_TT_TARGET_IDC) {
                setTikTokConnectionState(
                    'error',
                    'この配信は認証付き WebSocket が必要ですが、tt-target-idc が未設定です。request polling のみ利用できます。',
                    {
                        transportMethod: 'unknown',
                        websocketReasonCode: 'ws_auth_incomplete',
                        websocketReasonLabel: 'tt-target-idc が未設定のため認証付き WebSocket を開始できません。',
                        websocketReasonDetail: 'sessionid はありますが tt-target-idc が不足しています。両方そろえると WebSocket を試せます。'
                    }
                );
                console.error('❌ TikTok connection failed: authenticated websocket access is incomplete because TIKTOK_TT_TARGET_IDC is missing.');
                throw err;
            }

            setTikTokConnectionState('error', 'TikTok接続に失敗しました。自動再接続を待機しています。', {
                transportMethod: 'unknown',
                websocketReasonCode: 'connect_failed',
                websocketReasonLabel: 'WebSocket へ接続できませんでした。',
                websocketReasonDetail: err?.message
                    ? `接続エラー: ${err.message}`
                    : '接続エラーの詳細はログを確認してください。'
            });
            console.error('❌ Connection Failed:', err);
            scheduleReconnect(err?.name || 'connect_failed', err?.message);
            throw err;
        } finally {
            activeConnectPromise = null;
        }
    })();

    return activeConnectPromise;
}

async function startHttpServer() {
    const listenPort = REQUESTED_PORT;

    try {
        await tryListen(listenPort);
    } catch (error) {
        if (error?.code === 'EADDRINUSE') {
            error.message = buildPortInUseMessage(listenPort);
        }

        throw error;
    }

    const appUrl = `http://localhost:${listenPort}${APP_START_PATH}`;

    console.log(`🚀 Server running on http://localhost:${listenPort}`);
    console.log(`📂 User data: ${USER_DATA_DIRECTORY}`);
    console.log(`💾 SQLite DB: ${DB_PATH}`);
    scheduleRawEventFlush(0);

    if (AUTO_OPEN_BROWSER) {
        setTimeout(() => {
            if (!openBrowser(appUrl)) {
                console.log(`ℹ️ Open ${appUrl} manually.`);
            }
        }, 250);
    } else {
        console.log(`ℹ️ Browser auto-open is disabled. Open ${appUrl} manually.`);
    }

    if (hasConfiguredBroadcasterId()) {
        connectToTikTok().catch(() => {
            // connectToTikTok logs concrete failures.
        });
    } else {
        if (HAS_TIKTOK_WS_AUTH) {
            scheduleBroadcasterIdResolutionRetry(TIKTOK_SESSION_ID, TIKTOK_TT_TARGET_IDC, 'startup', null, 0);
        } else {
            setTikTokConnectionState('not_configured', 'TikTokログイン待機中です。認証が完了すると配信ユーザーIDを自動取得します。', {
                transportMethod: 'unknown',
                websocketReasonCode: 'broadcaster_not_configured',
                websocketReasonLabel: '配信ユーザーIDは未確定です。',
                websocketReasonDetail: 'TikTok にログインすると認証アカウントの配信ユーザーIDを自動取得し、接続方式の判定を開始します。',
                wsAuthAvailable: HAS_TIKTOK_WS_AUTH
            });
            console.log('ℹ️ Broadcaster ID is not configured yet. Waiting for TikTok login.');
        }
    }
}

function handleShutdownSignal(signal) {
    shutdownApplication(signal)
        .then(() => {
            process.exit(0);
        })
        .catch((error) => {
            console.error(`❌ Failed during ${signal} shutdown:`, error);

            setTimeout(() => {
                process.exit(1);
            }, SHUTDOWN_FORCE_TIMEOUT_MS).unref();
        });
}

process.once('SIGINT', () => {
    handleShutdownSignal('SIGINT');
});

process.once('SIGTERM', () => {
    handleShutdownSignal('SIGTERM');
});

process.once('SIGBREAK', () => {
    handleShutdownSignal('SIGBREAK');
});

startHttpServer().catch((error) => {
    if (error?.code === 'EADDRINUSE') {
        console.error(`❌ ${buildPortInUseMessage(REQUESTED_PORT)}`);
    } else {
        console.error('❌ Failed to start application:', error);
    }

    process.exitCode = 1;
});

module.exports = {
    serverEvents,
    injectWsCredentials,
    injectAuthenticatedTikTokSession,
    shutdownServer: () => {
        shutdownApplication('electron_quit').catch((err) => {
            console.error('❌ Shutdown error:', err);
        });
    }
};