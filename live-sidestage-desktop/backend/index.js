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
const APP_VERSION = require('../package.json').version;
const FIXED_PORT = 38100;
const LOADER_PORT = 38099;
const DEFAULT_APP_START_PATH = '/';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BACKEND_ROOT = __dirname;
const APP_ROOT = PROJECT_ROOT;
const SHUTDOWN_FORCE_TIMEOUT_MS = 10000;

loadEnvFile(path.join(APP_ROOT, '.env'));

const USER_DATA_DIRECTORY = resolveUserDataDirectory();
const APPDATA_DEVICE_ENV_PATH = path.join(USER_DATA_DIRECTORY, '.device.env');

loadEnvFile(path.join(USER_DATA_DIRECTORY, '.env'));
const PERSISTED_TIKTOK_DEVICE_ID = loadOrCreatePersistedDeviceId();

const REQUESTED_PORT = FIXED_PORT;

function buildPortInUseMessage(port) {
    return `ポート ${port} は既に使用中です。該当アプリを終了してから TikEffect を再起動してください。`;
}

function firstDefinedString(values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return null;
}

function resolveEffectAssetBaseDirectory() {
    if (IS_ELECTRON && !process.defaultApp && typeof process.execPath === 'string' && process.execPath.trim()) {
        return path.dirname(process.execPath);
    }

    return APP_ROOT;
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

const TIME_ZONE = 'Asia/Tokyo';
const BROADCASTER_ID_STATE_KEY = 'tiktok_broadcaster_id';
const DISPLAY_STATE_KEY = 'active_day_key';
const DISPLAY_DAY_REFERENCE_STATE_KEY = 'active_day_reference';
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
const COMMENT_OBSERVED_EMOTES_STATE_KEY = 'comment_observed_emotes';
const COMMENT_OBSERVED_EMOJIS_STATE_KEY = 'comment_observed_emojis';
const EFFECT_EVENTS_STATE_KEY = 'effect_events';
const EFFECT_TRIGGERS_STATE_KEY = 'effect_triggers';
const WIDGET_TOP_GIFT_SETTINGS_STATE_KEY = 'widget_top_gift_settings';
const WIDGET_LIKE_CONTRIBUTION_SETTINGS_STATE_KEY = 'widget_like_contribution_settings';
const WIDGET_GOAL_GIFTS_STATE_KEY = 'widget_goal_gifts';
const WIDGET_GOAL_GIFT_FEEDBACK_SETTINGS_STATE_KEY = 'widget_goal_gift_feedback_settings';
const CONTRIBUTORS_FEEDBACK_SETTINGS_STATE_KEY = 'contributors_feedback_settings';
const SHARED_WIDGET_FEEDBACK_SETTINGS_STATE_KEY = 'shared_widget_feedback_settings';
const WIDGET_GOAL_GIFTS_FONT_STATE_KEY = 'widget_goal_gifts_font';
const WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY = 'widget_goal_gifts_text_style';
const WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY = 'widget_goal_gifts_stroke_width';
const WIDGET_GOAL_GIFTS_NOTE_FONT_SIZE_STATE_KEY = 'widget_goal_gifts_note_font_size';
const WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_SIZE_STATE_KEY = 'widget_goal_gifts_achievement_badge_size';
const WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_STYLE_STATE_KEY = 'widget_goal_gifts_achievement_badge_style';
const WIDGET_GOAL_GIFT_ACTIVITY_COUNTS_STATE_KEY = 'widget_goal_gift_activity_counts';
const WIDGET_GOAL_GIFT_LIKE_TOTALS_STATE_KEY = 'widget_goal_gift_like_totals';
const WIDGET_GOAL_GIFT_LIKE_UNIQUE_SEEN_STATE_KEY = 'widget_goal_gift_like_unique_seen';
const WIDGET_GOAL_GIFT_FOLLOW_STATE_KEY = 'widget_goal_gift_follow_state';
const WIDGET_LIKE_CONTRIBUTION_USER_TOTALS_STATE_KEY = 'widget_like_contribution_user_totals';
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
    senderDisplayMode: 'latest',
    metalEffectKey: 'none'
};
const DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS = {
    title: 'Likeありがとう！',
    interval: 50,
    soundVolume: 100,
    balloonDesignKey: 'dark-glass',
    countFontSize: 42,
    nameFontSize: 34
};
// 新デザイン追加時は db/widgets.html の select#like-contribution-balloon-design と
// widgets/like-contribution.html の BALLOON_DESIGN_KEYS も同時に更新すること。
const ALLOWED_BALLOON_DESIGN_KEYS = new Set(['dark-glass', 'horizontal-pill', 'big-number', 'side-accent', 'compact-banner', 'stacked-center', 'wa-stamp', 'singer-stage', 'dance-floor', 'kitchen-chalk', 'paw-pop']);
const ALLOWED_LIKE_CONTRIBUTION_FONT_KEYS = new Set(['default','gothic','ui-gothic','mincho','ud-gothic','ud-mincho','meiryo','rounded','kyokasho','gyosho','togarie','ln-pop','comic-impact','pop-idol','entame','marker','retro-bold','luxury-mincho','antique-modern','atelier-brush','pixel-code','sawarabi-mincho','potta-one','murecho-thin','stick']);
const ALLOWED_LIKE_CONTRIBUTION_TEXT_STYLE_KEYS = new Set(['gold-night','ice-night','candy-pop','mint-lime','sunset-party','violet-flash','mono-impact','sakura-bloom','ocean-glow','emerald-city','ruby-flare','lemon-pop','midnight-aqua','peach-fizz','festival-red','rose-gold','cyber-teal','aurora-dream','coral-soda','platinum-pop','champagne-shine','royal-velvet','emerald-luxe','sunrise-opal','prism-burst','tropical-punch','lagoon-shine','berry-mist','polar-neon','citrus-splash']);
const DEFAULT_WIDGET_FEEDBACK_SETTINGS = {
    soundEnabled: true,
    effectEnabled: true,
    soundKey: 'business08',
    effectKey: 'glow'
};
const DEFAULT_GOAL_GIFT_WIDGET_ITEM = {
    enabled: false,
    giftId: '',
    giftName: '',
    displayName: '',
    note: '',
    giftImage: '',
    targetCount: 1,
    countUniqueUsers: false,
    currentCountOffset: 0,
    resetAtMidnight: false,
    currentCountOffsetDayKey: ''
};
const DEFAULT_GOAL_GIFT_WIDGET_FONT_KEY = 'default';
const DEFAULT_GOAL_GIFT_WIDGET_TEXT_STYLE_KEY = 'gold-night';
const DEFAULT_GOAL_GIFT_WIDGET_STROKE_WIDTH = 3;
const MAX_GOAL_GIFT_WIDGET_STROKE_WIDTH = 24;
const DEFAULT_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE = 28;
const MIN_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE = 8;
const MAX_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE = 96;
const DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE = 152;
const MIN_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE = 40;
const MAX_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE = 400;
const DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_STYLE = 'stamp-red';
const ALLOWED_GOAL_GIFT_ACHIEVEMENT_BADGE_STYLES = new Set(['stamp-red', 'stamp-blue', 'stamp-gold', 'stamp-green', 'stamp-dark']);
const GOAL_GIFT_SYSTEM_IDS = {
    like: '__system__:like',
    follow: '__system__:follow'
};
const GOAL_GIFT_SYSTEM_LABELS = {
    [GOAL_GIFT_SYSTEM_IDS.like]: 'タップ',
    [GOAL_GIFT_SYSTEM_IDS.follow]: 'フォロー'
};
const GOAL_GIFT_SYSTEM_IMAGE_DATA_URLS = {
    [GOAL_GIFT_SYSTEM_IDS.like]: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
            <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#fb7185"/>
                    <stop offset="100%" stop-color="#f59e0b"/>
                </linearGradient>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#7c2d12" flood-opacity="0.28"/>
                </filter>
            </defs>
            <rect width="320" height="320" rx="72" fill="url(#bg)"/>
            <circle cx="242" cy="82" r="30" fill="rgba(255,255,255,0.18)"/>
            <circle cx="254" cy="70" r="10" fill="rgba(255,255,255,0.48)"/>
            <g filter="url(#shadow)">
                <path d="M160 250c-8 0-16-3-22-9l-50-47c-22-21-24-56-4-78 19-20 50-23 72-7l4 3 4-3c22-16 53-13 72 7 20 22 18 57-4 78l-50 47c-6 6-14 9-22 9z" fill="#fff7ed"/>
                <path d="M204 108c14 0 27 6 36 16 14 16 13 41-3 56l-50 47c-7 7-18 7-25 0l-50-47c-16-15-17-40-3-56 15-16 40-18 57-6l14 10 14-10c7-6 16-10 25-10z" fill="#ffffff" opacity="0.3"/>
                <circle cx="103" cy="104" r="14" fill="none" stroke="#fff7ed" stroke-width="10" stroke-linecap="round" opacity="0.9"/>
                <path d="M88 74c10-14 21-22 34-26" fill="none" stroke="#fff7ed" stroke-width="10" stroke-linecap="round" opacity="0.82"/>
                <path d="M118 60c8-4 16-6 26-7" fill="none" stroke="#fff7ed" stroke-width="10" stroke-linecap="round" opacity="0.68"/>
            </g>
        </svg>
    `)}`,
    [GOAL_GIFT_SYSTEM_IDS.follow]: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
            <defs>
                <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#38bdf8"/>
                    <stop offset="100%" stop-color="#14b8a6"/>
                </linearGradient>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#164e63" flood-opacity="0.26"/>
                </filter>
            </defs>
            <rect width="320" height="320" rx="72" fill="url(#bg)"/>
            <circle cx="242" cy="94" r="56" fill="rgba(255,255,255,0.16)"/>
            <g filter="url(#shadow)">
                <circle cx="136" cy="118" r="42" fill="#ecfeff"/>
                <path d="M64 244c0-36 29-65 65-65h14c36 0 65 29 65 65v14H64z" fill="#ecfeff"/>
                <circle cx="230" cy="186" r="42" fill="#ffffff"/>
                <path d="M230 162v48" stroke="#0f766e" stroke-width="14" stroke-linecap="round"/>
                <path d="M206 186h48" stroke="#0f766e" stroke-width="14" stroke-linecap="round"/>
            </g>
        </svg>
    `)}`
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
// Electron ログインウィンドウと同じ UA を使用することでフィンガープリントの一致を保つ
const TIKTOK_DESKTOP_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome || '132.0.0.0'} Safari/537.36`;
const RECONNECT_DELAY_MS = 30000;
const OFFLINE_RECONNECT_DELAY_MS = 10000;
const FIRST_CONNECT_RETRY_DELAY_MS = 3000;
const RAW_EVENT_BATCH_SIZE = 100;
const RAW_EVENT_FLUSH_DELAY_MS = 250;
const RAW_EVENT_RETRY_DELAY_MS = 1000;
const LIVE_COMMENT_HISTORY_LIMIT = 100;
// TikTok WS イベントの受信遅延を可視化するための計測ログ。
// process.env.WS_LATENCY_LOG === '0' で無効化可能。既定は有効（診断目的）。
const WS_LATENCY_LOG_ENABLED = process.env.WS_LATENCY_LOG !== '0';
// 1 種別あたり最低この間隔を空けて出力（高頻度な like を間引く）
const WS_LATENCY_LOG_MIN_INTERVAL_MS = {
    like: 1000,
    member: 1000,
    roomUser: 2000
};
const COMMENT_DISPLAY_TTL_MS = 0;
const COMMENT_READ_ALOUD_EFFECT_SCREEN = 1;
const COMMENT_READ_ALOUD_MAX_AGE_MS = 15000;
const COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION = 2;
const COMMENT_OBSERVED_EMOTE_CACHE_LIMIT = 200;
const COMMENT_OBSERVED_EMOJI_CACHE_LIMIT = 200;
const COMMENT_READ_ALOUD_DEFAULT_FILTERS = [
    '死ね',
    '殺す',
    '自殺',
    '殺意',
    '薬物',
    '大麻',
    '覚醒剤',
    'コカイン',
    'マンコ',
    'クリトリス',
    'オメコ',
    'チンポ',
    'チンコ',
    'フェラ',
    'クンニ',
    '中出し',
    'セフレ',
    '援交',
    '立ちんぼ',
    '部落',
    'エッタ',
    'チョン',
    'シナ人',
    'チャンコロ',
    '黒んぼ',
    'ホモ',
    'レズ',
    'おかま',
    'ガイジ',
    '知障',
    'カタワ',
    'ブス',
    'デブ',
    'ハゲ',
    'デッパ',
    '整形モンスター',
    '失敗作',
    'ババア',
    '引退',
    'ゴミ',
    'カス',
    '無能',
    '詐欺',
    'ウンコ',
    'ゲロ',
    'スカトロ',
    '食糞',
    'あへあへ',
    'イクイク'
];
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

const AUTO_OPEN_BROWSER = !IS_ELECTRON && normalizeBooleanEnv(process.env.AUTO_OPEN_BROWSER, process.platform === 'win32');
const APP_START_PATH = normalizeStartPath(process.env.APP_START_PATH);
const PUBLIC_DIRECTORY = path.join(BACKEND_ROOT, 'public');
const DB_STATIC_DIRECTORY = path.join(PUBLIC_DIRECTORY, 'db');
const EFFECT_ASSET_BASE_DIRECTORY = resolveEffectAssetBaseDirectory();
const EFFECT_VIDEO_ROOT_DIRECTORY = path.join(EFFECT_ASSET_BASE_DIRECTORY, 'video');
const EFFECT_SOUND_ROOT_DIRECTORY = path.join(EFFECT_ASSET_BASE_DIRECTORY, 'sound');
const EFFECT_MEDIA_ROOT_DIRECTORY = path.join(USER_DATA_DIRECTORY, 'effects-media');

let currentBroadcasterId = null;
let tiktokLiveConnection = null;
let pendingUpdateInfo = null;
let activeTikTokUsername = null;
let cachedTikTokGiftCatalog = {
    broadcasterId: null,
    fetchedAt: 0,
    gifts: []
};
let activeTikTokGiftCatalogPromise = null;
const GIFT_JAR_HISTORY_LIMIT = 150;
const giftJarHistory = [];
const GIFT_JAR_THEMES = ['jar', 'glass', 'barrel', 'cauldron', 'flask', 'pig', 'bee'];
const IS_PACKAGED_ELECTRON = process.env.ELECTRON_APP_PACKAGED === '1';
const GIFT_JAR_WALL_EDITOR_ENABLED = !IS_PACKAGED_ELECTRON;
const ACTIVE_COMBO_TRIGGER_KEYS_MAX = 200;
// comboKey -> boolean (エフェクト発動済みかどうか)
const activeComboTriggerMap = new Map();
// comboKey -> pending gift object（repeatEnd 前の中間パケットをメモリに保持）
const pendingGiftsByComboKey = new Map();
const giftJarConfig = {
    dropAboveJar: 0,
    crushThreshold: 1000,
    sizeMultiplier: 1.0,
    jarTheme: 'jar',
    customProfiles: {}
};
let tiktokConnectionState = {
    status: 'idle',
    message: 'TikTok接続はまだ開始していません。',
    transportMethod: 'unknown',
    websocketReasonCode: null,
    websocketReasonLabel: null,
    websocketReasonDetail: null,
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
                const directory = getEffectMediaDirectory(file);
                fs.mkdirSync(directory, { recursive: true });
                callback(null, directory);
            } catch (error) {
                callback(error);
            }
        },
        filename(req, file, callback) {
            const extension = path.extname(file.originalname || '').slice(0, 16).toLowerCase();
            const safeExtension = /^[.][a-z0-9]+$/.test(extension) ? extension : '';
            const rawEventId = String(req.query.eventId || '').trim();
            const safeEventId = rawEventId.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 80);
            const kind = normalizeEffectMediaKind(file) === 'video' ? 'video' : 'audio';
            if (safeEventId.length >= 4) {
                callback(null, `${safeEventId}-${kind}${safeExtension}`);
            } else {
                callback(null, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${safeExtension}`);
            }
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

function clampGiftJarCoordinate(value) {
    return Math.max(0, Math.min(Math.round(value), 1080));
}

function normalizeGiftJarProfile(rawProfile) {
    if (!rawProfile || typeof rawProfile !== 'object') return null;

    const widthStops = [];
    const seenStopKeys = new Set();
    for (const stop of Array.isArray(rawProfile.widthStops) ? rawProfile.widthStops : []) {
        if (!stop || typeof stop !== 'object') continue;
        const y = clampGiftJarCoordinate(Number(stop.y));
        const left = clampGiftJarCoordinate(Number(stop.left));
        const right = clampGiftJarCoordinate(Number(stop.right));
        if (!Number.isFinite(y) || !Number.isFinite(left) || !Number.isFinite(right)) continue;
        if (right - left < 8) continue;
        const key = `${y}:${left}:${right}`;
        if (seenStopKeys.has(key)) continue;
        seenStopKeys.add(key);
        widthStops.push({ y, left, right });
    }
    widthStops.sort((a, b) => a.y - b.y);

    const wallPoints = [];
    let previousPointKey = '';
    for (const point of Array.isArray(rawProfile.wallPoints) ? rawProfile.wallPoints : []) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const x = clampGiftJarCoordinate(Number(point[0]));
        const y = clampGiftJarCoordinate(Number(point[1]));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const key = `${x}:${y}`;
        if (key === previousPointKey) continue;
        previousPointKey = key;
        wallPoints.push([x, y]);
    }

    if (widthStops.length < 4 || wallPoints.length < 6) return null;
    return { widthStops, wallPoints };
}

function normalizeGiftJarCustomProfiles(rawProfiles) {
    const profiles = {};
    if (!rawProfiles || typeof rawProfiles !== 'object') return profiles;
    for (const theme of GIFT_JAR_THEMES) {
        const normalized = normalizeGiftJarProfile(rawProfiles[theme]);
        if (normalized) profiles[theme] = normalized;
    }
    return profiles;
}

function persistGiftJarCustomProfiles() {
    dbStore.setGlobalStateValue('gift_jar_custom_profiles', JSON.stringify(giftJarConfig.customProfiles), Date.now());
}

// Restore persisted gift jar config
{
    const saved = dbStore.getGlobalStateValue('gift_jar_drop_above_jar');
    if (saved !== null) {
        const v = Number(saved);
        if (Number.isFinite(v)) giftJarConfig.dropAboveJar = Math.max(0, Math.min(Math.round(v), 2000));
    }
    const savedCrush = dbStore.getGlobalStateValue('gift_jar_crush_threshold');
    if (savedCrush !== null) {
        const v = Number(savedCrush);
        if (Number.isFinite(v)) giftJarConfig.crushThreshold = Math.max(0, Math.min(Math.round(v), 44999));
    }
    const savedMult = dbStore.getGlobalStateValue('gift_jar_size_multiplier');
    if (savedMult !== null) {
        const v = Number(savedMult);
        if (Number.isFinite(v)) giftJarConfig.sizeMultiplier = Math.max(0.1, Math.min(v, 5.0));
    }
    const savedTheme = dbStore.getGlobalStateValue('gift_jar_theme');
    if (savedTheme !== null && GIFT_JAR_THEMES.includes(savedTheme) && savedTheme !== 'glass') {
        giftJarConfig.jarTheme = savedTheme;
    }
    const savedCustomProfiles = dbStore.getGlobalStateValue('gift_jar_custom_profiles');
    if (typeof savedCustomProfiles === 'string' && savedCustomProfiles.trim()) {
        try {
            giftJarConfig.customProfiles = normalizeGiftJarCustomProfiles(JSON.parse(savedCustomProfiles));
        } catch {
            giftJarConfig.customProfiles = {};
        }
    }
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

function buildEffectOverlayHtml(slot, config, options = null) {
    const title = config?.name || `Screen ${slot}`;
    const hasVideo = Boolean(config?.videoAssetUrl);
    const hasAudio = Boolean(config?.audioAssetUrl);
    const readAloudOnly = options?.readAloudOnly === true;
    const readAloudSpeakerEnabled = options?.readAloudSpeakerEnabled === true;
        const displayFontFamilyCss = getDisplayFontFamilyCss();

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtmlForOverlay(title)}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;700;800&family=Noto+Sans+JP:wght@400;700;900&family=Noto+Serif+JP:wght@400;700;900&family=Zen+Kaku+Gothic+New:wght@400;700;900&family=Kosugi&family=Zen+Old+Mincho:wght@400;700;900&family=Klee+One:wght@400;600&family=Zen+Maru+Gothic:wght@400;700;900&family=Yuji+Syuku&family=Dela+Gothic+One&family=DotGothic16&family=Hachi+Maru+Pop&family=RocknRoll+One&family=Yusei+Magic&family=Kaisei+Decol:wght@400;500;700&family=Mochiy+Pop+One&family=Rampart+One&family=Shippori+Mincho+B1:wght@500;700;800&family=Zen+Antique&family=Yuji+Mai&display=swap" rel="stylesheet">
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root {
            color-scheme: light;
                --display-font-family: ${displayFontFamilyCss};
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            font-family: var(--display-font-family);
            background: transparent;
            color: #f8fafc;
            overflow: hidden;
        }

        .read-aloud-credit {
            position: fixed;
                right: 80px;
                bottom: 128px;
            max-width: min(56vw, 720px);
            padding: 14px 20px;
            border-radius: 14px;
            background: rgba(15, 23, 42, 0.66);
            border: 1px solid rgba(148, 163, 184, 0.28);
            color: rgba(248, 250, 252, 0.92);
            font-size: 24px;
            line-height: 1.5;
            letter-spacing: 0.02em;
            text-align: right;
            font-family: inherit;
            opacity: 0;
            transform: translateY(6px);
            transition: opacity 160ms ease, transform 160ms ease;
            pointer-events: none;
            backdrop-filter: blur(12px);
            white-space: pre-wrap;
        }

        .read-aloud-credit.is-visible {
            opacity: 1;
            transform: translateY(0);
        }

        .read-aloud-warning {
            position: fixed;
                right: 80px;
                bottom: 128px;
            max-width: min(56vw, 720px);
            padding: 14px 20px;
            border-radius: 14px;
            background: rgba(15, 23, 42, 0.66);
            border: 1px solid rgba(239, 68, 68, 0.4);
            color: #ef4444;
            font-size: 24px;
            line-height: 1.5;
            letter-spacing: 0.02em;
            text-align: right;
            font-family: inherit;
            opacity: 0;
            transform: translateY(6px);
            transition: opacity 160ms ease, transform 160ms ease;
            pointer-events: none;
            backdrop-filter: blur(12px);
            white-space: pre-wrap;
        }

        .read-aloud-warning.is-visible {
            opacity: 1;
            transform: translateY(0);
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
    <div class="read-aloud-credit" id="read-aloud-credit" aria-live="polite"></div>
    <div class="read-aloud-warning" id="read-aloud-warning" aria-live="assertive">VOICEVOX未起動</div>
    <script>
        const params = new URLSearchParams(window.location.search);
        document.body.classList.toggle('debug', params.get('debug') === '1');
        const slot = ${slot};
        const readAloudOnly = ${readAloudOnly ? 'true' : 'false'};
        const readAloudSpeakerEnabled = ${readAloudSpeakerEnabled ? 'true' : 'false'};
        const socket = io();
        const video = document.getElementById('effect-video');
        const audio = document.getElementById('effect-audio');
        const readAloudCredit = document.getElementById('read-aloud-credit');
        const readAloudWarning = document.getElementById('read-aloud-warning');
        const debugLog = document.getElementById('debug-log');
        const OVERLAY_RECOVERY_RETRY_MS = 2000;
        let readAloudWarningClearTimer = null;
        let activePlaybackId = null;
        let activePlaybackEventId = null;
        let playbackQueue = [];
        let isPlaying = false;
        let audioEnded = true;
        let videoEnded = true;
        let ttsQueue = [];
        let isSpeaking = false;
        let readAloudCreditClearTimer = null;
        let overlayRecoveryTimer = null;
        let overlayRecoveryInFlight = false;

        // メディア Blob URL キャッシュ: 元の URL -> 解決済み Blob URL (ロード中は Promise)
        const mediaBlobCache = new Map();

        function preloadMediaBlob(url) {
            if (!url || mediaBlobCache.has(url) || url.startsWith('data:')) return;
            const promise = fetch(url)
                .then(r => r.ok ? r.blob() : null)
                .then(blob => {
                    const result = blob ? URL.createObjectURL(blob) : url;
                    mediaBlobCache.set(url, result);
                })
                .catch(() => { mediaBlobCache.set(url, url); });
            mediaBlobCache.set(url, promise);
        }

        function resolvedMediaUrl(url) {
            if (!url) return url;
            const v = mediaBlobCache.get(url);
            return (v && typeof v === 'string') ? v : url;
        }

        // ページ起動時に設定済みエフェクトのメディアをすべてプリロード
        fetch('/api/effects/config')
            .then(r => r.ok ? r.json() : null)
            .then(cfg => {
                if (!cfg || !Array.isArray(cfg.events)) return;
                cfg.events.forEach(evt => {
                    if (evt.screen !== slot) return;
                    if (evt.videoEnabled && evt.videoAssetUrl) preloadMediaBlob(evt.videoAssetUrl);
                    if (evt.audioEnabled && evt.audioAssetUrl) preloadMediaBlob(evt.audioAssetUrl);
                });
            })
            .catch(() => {});

        function updateDebugLog(message) {
            debugLog.textContent = message || '';
        }

        function clearOverlayRecoveryTimer() {
            if (overlayRecoveryTimer) {
                clearInterval(overlayRecoveryTimer);
                overlayRecoveryTimer = null;
            }
        }

        async function probeOverlayAvailability() {
            if (overlayRecoveryInFlight) {
                return;
            }

            overlayRecoveryInFlight = true;

            try {
                const response = await fetch(window.location.href, { cache: 'no-store' });

                if (!response.ok) {
                    return;
                }

                clearOverlayRecoveryTimer();
                window.location.reload();
            } catch (error) {
                // Backend is still restarting. Keep polling until it becomes reachable again.
            } finally {
                overlayRecoveryInFlight = false;
            }
        }

        function scheduleOverlayRecoveryReload() {
            if (overlayRecoveryTimer) {
                return;
            }

            overlayRecoveryTimer = setInterval(() => {
                probeOverlayAvailability();
            }, OVERLAY_RECOVERY_RETRY_MS);

            probeOverlayAvailability();
        }

        function clearReadAloudCreditTimer() {
            if (readAloudCreditClearTimer) {
                clearTimeout(readAloudCreditClearTimer);
                readAloudCreditClearTimer = null;
            }
        }

        function scheduleReadAloudCreditClear() {
            clearReadAloudCreditTimer();
            readAloudCreditClearTimer = setTimeout(() => {
                readAloudCreditClearTimer = null;
                setReadAloudCredit('');
            }, 10000);
        }

        function setReadAloudCredit(text) {
            const nextText = typeof text === 'string' ? text.trim() : '';
            clearReadAloudCreditTimer();
            readAloudCredit.textContent = nextText;
            readAloudCredit.classList.toggle('is-visible', Boolean(nextText));
        }

        function setReadAloudWarning(text) {
            const nextText = typeof text === 'string' ? text.trim() : '';
            if (readAloudWarningClearTimer) {
                clearTimeout(readAloudWarningClearTimer);
                readAloudWarningClearTimer = null;
            }
            readAloudWarning.textContent = nextText;
            readAloudWarning.classList.toggle('is-visible', Boolean(nextText));
            if (nextText) {
                readAloudWarningClearTimer = setTimeout(() => {
                    readAloudWarningClearTimer = null;
                    setReadAloudWarning('');
                }, 10000);
            }
        }

        function finishSpeech() {
            isSpeaking = false;

            if (ttsQueue.length === 0 && !isPlaying && playbackQueue.length === 0) {
                scheduleReadAloudCreditClear();
            }

            processSpeechQueue();
        }

        function stopSpeechQueue() {
            ttsQueue = [];
            isSpeaking = false;
            setReadAloudCredit('');

            if (window.speechSynthesis && typeof window.speechSynthesis.cancel === 'function') {
                window.speechSynthesis.cancel();
            }

            updateDebugLog('読み上げを停止しました。');
        }

        function processSpeechQueue() {
            if (isSpeaking || ttsQueue.length === 0) {
                return;
            }

            const synth = window.speechSynthesis;

            if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
                updateDebugLog('この screen は読み上げに対応していません。');
                ttsQueue = [];
                return;
            }

            const payload = ttsQueue.shift();

            if (!payload || !payload.text) {
                processSpeechQueue();
                return;
            }

            isSpeaking = true;
            updateDebugLog('読み上げ: ' + payload.text);
            setReadAloudCredit(payload.readAloudCreditText || '');

            const utterance = new window.SpeechSynthesisUtterance(payload.text);
            const voices = typeof synth.getVoices === 'function' ? synth.getVoices() : [];
            const requestedVoiceName = typeof payload.voiceName === 'string'
                ? payload.voiceName.replace(/^(screen1:|browser:)/, '')
                : '';
            const selectedVoice = requestedVoiceName
                ? voices.find((voice) => voice && voice.name === requestedVoiceName)
                : null;

            utterance.lang = 'ja-JP';
            utterance.rate = 1;
            utterance.pitch = 1;
            utterance.volume = Math.max(0, Math.min(1, Number(payload.volume || 100) / 100));

            if (selectedVoice) {
                utterance.voice = selectedVoice;
                utterance.lang = selectedVoice.lang || utterance.lang;
            }

            utterance.onend = finishSpeech;
            utterance.onerror = finishSpeech;

            synth.speak(utterance);
        }

        function finishPlayback() {
            if (!isPlaying) {
                return;
            }

            stopMedia();
            isPlaying = false;

            if (playbackQueue.length === 0 && !isSpeaking && ttsQueue.length === 0) {
                scheduleReadAloudCreditClear();
            }

            processPlaybackQueue();
        }

        function stopPlaybackQueue(eventId = '') {
            if (eventId) {
                playbackQueue = playbackQueue.filter((payload) => payload?.eventId !== eventId);

                if (activePlaybackEventId && activePlaybackEventId !== eventId) {
                    return;
                }
            } else {
                playbackQueue = [];
            }

            stopMedia();
            isPlaying = false;
            videoEnded = true;
            audioEnded = true;
            setReadAloudCredit('');
            updateDebugLog(eventId ? '再生を停止しました。' : 'すべての再生を停止しました。');
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
            activePlaybackEventId = null;
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

        socket.on('connect', () => {
            clearOverlayRecoveryTimer();
        });

        socket.on('disconnect', () => {
            scheduleOverlayRecoveryReload();
        });

        socket.on('connect_error', () => {
            scheduleOverlayRecoveryReload();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            if (!socket.connected) {
                scheduleOverlayRecoveryReload();
            }
        });

        async function processPlaybackQueue() {
            if (isPlaying || playbackQueue.length === 0) {
                return;
            }

            const payload = playbackQueue.shift();
            isPlaying = true;
            activePlaybackId = payload.playbackId || String(Date.now());
            activePlaybackEventId = payload.eventId || '';
            videoEnded = !payload.videoUrl;
            audioEnded = !payload.audioUrl;
            updateDebugLog((payload.eventName || 'event') + ' / ' + (payload.uniqueId || '') + ' / ' + (payload.giftName || ''));
            setReadAloudCredit(payload.readAloudCreditText || '');

            try {
                if (payload.videoUrl) {
                    video.src = resolvedMediaUrl(payload.videoUrl);
                    video.currentTime = 0;
                    video.volume = Math.max(0, Math.min(1, Number(payload.mediaVolume || 100) / 100));
                    video.style.display = 'block';
                    await video.play().catch(() => null);
                } else {
                    video.style.display = 'none';
                }

                if (payload.audioUrl) {
                    audio.src = resolvedMediaUrl(payload.audioUrl);
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

            if (readAloudOnly) {
                return;
            }

            // Blob URL プリロードを即座に開始（再生待ち中に解決されることが多い）
            if (payload.videoUrl) preloadMediaBlob(payload.videoUrl);
            if (payload.audioUrl) preloadMediaBlob(payload.audioUrl);

            const playbackCount = Math.max(1, Number(payload.playbackCount || 1));

            for (let index = 0; index < playbackCount; index += 1) {
                playbackQueue.push({
                    ...payload,
                    playbackId: String(payload.playbackId || Date.now()) + '-' + index
                });
            }

            processPlaybackQueue();
        });

        socket.on('effects:tts', (payload) => {
            if (!payload || payload.screen !== slot || !payload.text) {
                return;
            }

            if (readAloudOnly) {
                return;
            }

            ttsQueue.push(payload);
            processSpeechQueue();
        });

        socket.on('effects:tts:stop', (payload) => {
            if (!payload || payload.screen !== slot) {
                return;
            }

            stopSpeechQueue();
        });

        socket.on('effects:playback:stop', (payload) => {
            if (!payload || payload.screen !== slot) {
                return;
            }

            stopPlaybackQueue(typeof payload.eventId === 'string' ? payload.eventId : '');
        });

        socket.on('screen1:voicevox-warning', (payload) => {
            if (!payload || payload.screen !== slot) {
                return;
            }

            setReadAloudWarning('VOICEVOX\u672a\u8d77\u52d5');
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

function getLoaderOrigin(req) {
    const loaderOrigin = new URL(getRequestOrigin(req));
    loaderOrigin.hostname = buildStudioCompatibleHostname(loaderOrigin.hostname);
    loaderOrigin.port = String(LOADER_PORT);
    return loaderOrigin.toString().replace(/\/+$/u, '');
}

function buildEffectOverlayUrls(req) {
    const origin = getStudioCompatibleOrigin(req);
    const loaderOrigin = getLoaderOrigin(req);

    return Array.from({ length: EFFECT_SCREEN_COUNT }, (_, index) => ({
        slot: index + 1,
        url: `${loaderOrigin}/overlays/effects/${index + 1}`,
        directUrl: `${origin}/overlays/effects/${index + 1}`
    }));
}

function buildWidgetUrls(req) {
    const origin = getStudioCompatibleOrigin(req);
    const loaderOrigin = getLoaderOrigin(req);

    return {
        contributorsOverlayUrl: `${origin}/overlays/contributors`,
        contributorsLoaderUrl: `${loaderOrigin}/overlays/contributors`,
        topGiftOverlayUrl: `${origin}/overlays/top-gift`,
        topGiftLoaderUrl: `${loaderOrigin}/overlays/top-gift`,
        likeContributionOverlayUrl: `${origin}/overlays/like-contribution`,
        likeContributionLoaderUrl: `${loaderOrigin}/overlays/like-contribution`,
        goalGiftsOverlayUrl: `${origin}/overlays/goal-gifts`,
        goalGiftsLoaderUrl: `${loaderOrigin}/overlays/goal-gifts`,
        giftJarOverlayUrl: `${origin}/overlays/gift-jar`,
        giftJarLoaderUrl: `${loaderOrigin}/overlays/gift-jar?slave=1`
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

app.get('/quick-access', (req, res) => {
    return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'quick-access.html'));
});

app.get('/quick-access.html', (req, res) => {
    return res.redirect('/quick-access');
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

app.use('/video', express.static(EFFECT_VIDEO_ROOT_DIRECTORY, {
    setHeaders(res) {
        res.setHeader('Cache-Control', 'no-store');
    }
}));

app.use('/sound', express.static(EFFECT_SOUND_ROOT_DIRECTORY, {
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
    return res.type('html').send(buildEffectOverlayHtml(slot, config, {
        readAloudOnly: req.query?.readAloudOnly === '1',
        readAloudSpeakerEnabled: req.query?.speaker === '1'
    }));
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

app.get(['/overlays/like-contribution', '/overlays/widgets/like-contribution'], (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'like-contribution.html'));
});

app.get(['/overlays/like-contribution/index.html', '/overlays/widgets/like-contribution/index.html'], (req, res) => {
    return res.redirect('/overlays/like-contribution');
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

app.get(['/overlays/gift-jar', '/overlays/widgets/gift-jar'], (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'gift-jar.html'));
});

app.get(['/overlays/gift-jar/index.html', '/overlays/widgets/gift-jar/index.html'], (req, res) => {
    return res.redirect('/overlays/gift-jar');
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

// device_id を永続化する（ログアウトをまたいでも同一デバイスとして識別させる）
function loadOrCreatePersistedDeviceId() {
    const values = readEnvFileValues(APPDATA_DEVICE_ENV_PATH);
    const existing = values.TIKTOK_DEVICE_ID?.trim();

    if (existing && /^\d{19}$/.test(existing)) {
        return existing;
    }

    let digits = '';
    for (let i = 0; i < 19; i++) {
        digits += Math.floor(Math.random() * 10);
    }

    try {
        fs.mkdirSync(path.dirname(APPDATA_DEVICE_ENV_PATH), { recursive: true });
        fs.writeFileSync(APPDATA_DEVICE_ENV_PATH, `TIKTOK_DEVICE_ID=${digits}\n`, 'utf8');
    } catch {
        // Best-effort only.
    }

    return digits;
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

function normalizeDisplayDayReference(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();

    if (normalizedValue === 'today') {
        return 'today';
    }

    if (normalizedValue === 'yesterday') {
        return 'yesterday';
    }

    return 'fixed';
}

function getDisplayDayReference() {
    return normalizeDisplayDayReference(getScopedStateValue(DISPLAY_DAY_REFERENCE_STATE_KEY));
}

function resolveDisplayDayKey(reference, dayKey) {
    if (reference === 'today') {
        return getTodayDayKey();
    }

    if (reference === 'yesterday') {
        return getYesterdayDayKey();
    }

    return normalizeDayKey(dayKey) || getTodayDayKey();
}

function inferDisplayDayReference(dayKey) {
    const normalizedDayKey = normalizeDayKey(dayKey);

    if (normalizedDayKey && normalizedDayKey === getTodayDayKey()) {
        return 'today';
    }

    return 'fixed';
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
    setGoalGiftFollowState({ sessionStartedAt: normalizedStartedAt, seenUserKeys: [] });
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
    setGoalGiftFollowState({ sessionStartedAt: '', seenUserKeys: [] });
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
    return resolveDisplayDayKey(getDisplayDayReference(), getScopedStateValue(DISPLAY_STATE_KEY));
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
        'sunrise-opal',
        'prism-burst',
        'tropical-punch',
        'lagoon-shine',
        'berry-mist',
        'polar-neon',
        'citrus-splash'
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

function setDisplayDaySelection(dayKey, reference = 'fixed') {
    const normalizedReference = normalizeDisplayDayReference(reference);
    const resolvedDayKey = resolveDisplayDayKey(normalizedReference, dayKey);

    setScopedStateValue(DISPLAY_STATE_KEY, resolvedDayKey);
    setScopedStateValue(DISPLAY_DAY_REFERENCE_STATE_KEY, normalizedReference);

    return {
        dayKey: resolvedDayKey,
        reference: normalizedReference
    };
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
            : DEFAULT_WIDGET_TOP_GIFT_SETTINGS.senderDisplayMode,
        metalEffectKey: ['glow', 'shine'].includes(String(source.metalEffectKey || '').trim().toLowerCase())
            ? 'glow'
            : DEFAULT_WIDGET_TOP_GIFT_SETTINGS.metalEffectKey
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

function normalizeWidgetLikeContributionSettings(value) {
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

    const interval = normalizeWholeNumber(source.interval);
    const soundVolume = Number.isFinite(Number(source.soundVolume))
        ? Math.max(0, Math.min(100, Math.round(Number(source.soundVolume))))
        : DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS.soundVolume;
    const balloonDesignKeyRaw = String(source.balloonDesignKey || '').trim().toLowerCase();
    const countFontSize = (() => {
        const v = Number.parseInt(String(source.countFontSize ?? ''), 10);
        return Number.isInteger(v) && v >= 10 ? Math.min(v, 200) : DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS.countFontSize;
    })();
    const nameFontSize = (() => {
        const v = Number.parseInt(String(source.nameFontSize ?? ''), 10);
        return Number.isInteger(v) && v >= 8 ? Math.min(v, 120) : DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS.nameFontSize;
    })();
    const appearanceSource = source.appearance && typeof source.appearance === 'object' ? source.appearance : {};
    const fontKeyRaw = String(appearanceSource.fontKey || '').trim().toLowerCase();
    const textStyleKeyRaw = String(appearanceSource.textStyleKey || '').trim().toLowerCase();
    const strokeWidthRaw = Number.parseInt(String(appearanceSource.strokeWidth ?? ''), 10);

    return {
        title: normalizeEffectText(source.title, 40) || DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS.title,
        interval: interval && interval > 0
            ? Math.min(interval, 100000)
            : DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS.interval,
        soundVolume,
        balloonDesignKey: ALLOWED_BALLOON_DESIGN_KEYS.has(balloonDesignKeyRaw) ? balloonDesignKeyRaw : DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS.balloonDesignKey,
        countFontSize,
        nameFontSize,
        appearance: {
            fontKey: ALLOWED_LIKE_CONTRIBUTION_FONT_KEYS.has(fontKeyRaw) ? fontKeyRaw : 'default',
            textStyleKey: ALLOWED_LIKE_CONTRIBUTION_TEXT_STYLE_KEYS.has(textStyleKeyRaw) ? textStyleKeyRaw : 'gold-night',
            strokeWidth: Number.isInteger(strokeWidthRaw) && strokeWidthRaw >= 0 ? Math.min(strokeWidthRaw, 12) : 4
        }
    };
}

function getWidgetLikeContributionSettings() {
    return normalizeWidgetLikeContributionSettings(getScopedStateValue(WIDGET_LIKE_CONTRIBUTION_SETTINGS_STATE_KEY));
}

function setWidgetLikeContributionSettings(settings) {
    const normalizedSettings = normalizeWidgetLikeContributionSettings(settings);
    setScopedStateValue(WIDGET_LIKE_CONTRIBUTION_SETTINGS_STATE_KEY, JSON.stringify(normalizedSettings));
    return normalizedSettings;
}

function normalizeWidgetFeedbackSettings(value) {
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

    const soundKey = String(source.soundKey || '').trim().toLowerCase();
    const effectKey = String(source.effectKey || '').trim().toLowerCase();
    const allowedSoundKeys = new Set([
        'business08',
        'business09',
        'business10',
        'business11',
        'bush-warbler',
        'cow',
        'hyoshigi',
        'xylophone',
        'glocken01',
        'glocken02',
        'glocken03',
        'electronic-chime02',
        'electronic-chime03'
    ]);
    const allowedEffectKeys = new Set(['glow', 'magic', 'luxury']);

    return {
        soundEnabled: normalizeBooleanInput(source.soundEnabled, DEFAULT_WIDGET_FEEDBACK_SETTINGS.soundEnabled),
        effectEnabled: normalizeBooleanInput(source.effectEnabled, DEFAULT_WIDGET_FEEDBACK_SETTINGS.effectEnabled),
        soundKey: allowedSoundKeys.has(soundKey) ? soundKey : DEFAULT_WIDGET_FEEDBACK_SETTINGS.soundKey,
        effectKey: allowedEffectKeys.has(effectKey) ? effectKey : DEFAULT_WIDGET_FEEDBACK_SETTINGS.effectKey
    };
}

function getSharedWidgetFeedbackSettings() {
    const sharedValue = getScopedStateValue(SHARED_WIDGET_FEEDBACK_SETTINGS_STATE_KEY);

    if (sharedValue !== null && sharedValue !== undefined) {
        return normalizeWidgetFeedbackSettings(sharedValue);
    }

    const legacyContributorsValue = getScopedStateValue(CONTRIBUTORS_FEEDBACK_SETTINGS_STATE_KEY);
    if (legacyContributorsValue !== null && legacyContributorsValue !== undefined) {
        return normalizeWidgetFeedbackSettings(legacyContributorsValue);
    }

    const legacyGoalGiftValue = getScopedStateValue(WIDGET_GOAL_GIFT_FEEDBACK_SETTINGS_STATE_KEY);
    if (legacyGoalGiftValue !== null && legacyGoalGiftValue !== undefined) {
        return normalizeWidgetFeedbackSettings(legacyGoalGiftValue);
    }

    return normalizeWidgetFeedbackSettings(null);
}

function setSharedWidgetFeedbackSettings(value) {
    const normalizedValue = normalizeWidgetFeedbackSettings(value);
    setScopedStateValue(SHARED_WIDGET_FEEDBACK_SETTINGS_STATE_KEY, JSON.stringify(normalizedValue));
    return normalizedValue;
}

function getContributorsFeedbackSettings() {
    return getSharedWidgetFeedbackSettings();
}

function setContributorsFeedbackSettings(value) {
    return setSharedWidgetFeedbackSettings(value);
}

function getGoalGiftFeedbackSettings() {
    return getSharedWidgetFeedbackSettings();
}

function setGoalGiftFeedbackSettings(value) {
    return setSharedWidgetFeedbackSettings(value);
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

function getDisplayFontFamilyCss(fontKey = getDisplayFontFamily()) {
    const normalizedFontKey = normalizeDisplayFontFamily(fontKey);
    const fontFamilies = {
        default: '"M PLUS Rounded 1c", sans-serif',
        gothic: '"Noto Sans JP", sans-serif',
        'ui-gothic': '"Zen Kaku Gothic New", sans-serif',
        mincho: '"Noto Serif JP", serif',
        'ud-gothic': '"Kosugi", sans-serif',
        'ud-mincho': '"Zen Old Mincho", serif',
        meiryo: '"Klee One", cursive',
        rounded: '"Zen Maru Gothic", sans-serif',
        kyokasho: '"Klee One", cursive',
        gyosho: '"Yuji Syuku", cursive',
        togarie: '"Dela Gothic One", sans-serif',
        'ln-pop': '"Mochiy Pop One", sans-serif',
        'comic-impact': '"Rampart One", sans-serif',
        'pop-idol': '"Hachi Maru Pop", cursive',
        entame: '"RocknRoll One", sans-serif',
        marker: '"Yusei Magic", cursive',
        'retro-bold': '"Kaisei Decol", serif',
        'luxury-mincho': '"Shippori Mincho B1", serif',
        'antique-modern': '"Zen Antique", serif',
        'atelier-brush': '"Yuji Mai", cursive',
        'pixel-code': '"DotGothic16", "Noto Sans JP", sans-serif'
    };

    return fontFamilies[normalizedFontKey] || fontFamilies.default;
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
        'sunrise-opal',
        'prism-burst',
        'tropical-punch',
        'lagoon-shine',
        'berry-mist',
        'polar-neon',
        'citrus-splash'
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

function normalizeGoalGiftNoteFontSize(value) {
    const normalizedValue = normalizeWholeNumber(value);
    if (!Number.isInteger(normalizedValue) || normalizedValue < MIN_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE) {
        return DEFAULT_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE;
    }

    return Math.min(normalizedValue, MAX_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE);
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

function getGoalGiftSystemImageUrl(value) {
    return GOAL_GIFT_SYSTEM_IMAGE_DATA_URLS[String(value || '').trim()] || '';
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
            likeUnique: normalizeWholeNumber(counts.likeUnique) || 0,
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
        likeUnique: normalizeWholeNumber(counts.likeUnique) || 0,
        follow: normalizeWholeNumber(counts.follow) || 0
    };
}

function normalizeGoalGiftLikeTotalsState(value) {
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

    Object.entries(source).forEach(([dayKey, totalLikeCount]) => {
        const normalizedDayKey = normalizeDayKey(dayKey);

        if (!normalizedDayKey) {
            return;
        }

        normalized[normalizedDayKey] = normalizeWholeNumber(totalLikeCount) || 0;
    });

    return normalized;
}

function getGoalGiftLikeTotalsState() {
    return normalizeGoalGiftLikeTotalsState(getScopedStateValue(WIDGET_GOAL_GIFT_LIKE_TOTALS_STATE_KEY));
}

function setGoalGiftLikeTotalsState(value) {
    const normalizedValue = normalizeGoalGiftLikeTotalsState(value);
    setScopedStateValue(WIDGET_GOAL_GIFT_LIKE_TOTALS_STATE_KEY, JSON.stringify(normalizedValue));
    return normalizedValue;
}

// like貢献ウィジェット: ユーザーごとの累計タップ数を dayKey で区切って永続化。
// 構造: { [dayKey]: { [uniqueId]: userTotal } }
// 当日分のみ保持し、過去分は書き込み時に自動削除。
function normalizeLikeContributionUserTotalsState(value) {
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

    Object.entries(source).forEach(([dayKey, userMap]) => {
        const normalizedDayKey = normalizeDayKey(dayKey);

        if (!normalizedDayKey) {
            return;
        }

        if (!userMap || typeof userMap !== 'object' || Array.isArray(userMap)) {
            return;
        }

        const normalizedUserMap = {};

        Object.entries(userMap).forEach(([uid, total]) => {
            const normalizedUid = normalizeBroadcasterId(uid);
            const normalizedTotal = normalizeWholeNumber(total);

            if (normalizedUid && normalizedTotal !== null) {
                normalizedUserMap[normalizedUid] = normalizedTotal;
            }
        });

        normalized[normalizedDayKey] = normalizedUserMap;
    });

    return normalized;
}

function getLikeContributionUserTotalsState() {
    return normalizeLikeContributionUserTotalsState(getScopedStateValue(WIDGET_LIKE_CONTRIBUTION_USER_TOTALS_STATE_KEY));
}

function setLikeContributionUserTotalsState(value) {
    const normalized = normalizeLikeContributionUserTotalsState(value);
    // 当日分のみ残す（過去の無駄なデータを蓄積しない）
    const todayKey = getTodayDayKey();
    const pruned = {};

    if (normalized[todayKey]) {
        pruned[todayKey] = normalized[todayKey];
    }

    setScopedStateValue(WIDGET_LIKE_CONTRIBUTION_USER_TOTALS_STATE_KEY, JSON.stringify(pruned));
    return pruned;
}

function normalizeGoalGiftFollowState(value) {
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

    const seenUserKeys = Array.isArray(source.seenUserKeys)
        ? [...new Set(source.seenUserKeys.map((entry) => normalizeEffectText(entry, 120)).filter(Boolean))]
        : [];

    return {
        sessionStartedAt: normalizeStoredTimestamp(source.sessionStartedAt) || '',
        seenUserKeys
    };
}

function getGoalGiftFollowState() {
    return normalizeGoalGiftFollowState(getScopedStateValue(WIDGET_GOAL_GIFT_FOLLOW_STATE_KEY));
}

function setGoalGiftFollowState(value) {
    const normalizedValue = normalizeGoalGiftFollowState(value);
    setScopedStateValue(WIDGET_GOAL_GIFT_FOLLOW_STATE_KEY, JSON.stringify(normalizedValue));
    return normalizedValue;
}

function getGoalGiftFollowActorKey(data) {
    const uniqueId = normalizeBroadcasterId(firstDefinedString([
        data?.uniqueId,
        data?.user?.uniqueId,
        data?.user?.unique_id,
        data?.fromUser?.uniqueId,
        data?.fromUser?.unique_id
    ]));

    return uniqueId ? `id:${uniqueId}` : '';
}

function normalizeGoalGiftLikeUniqueSeen(value) {
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

    Object.entries(source).forEach(([dayKey, keys]) => {
        const normalizedDayKey = normalizeDayKey(dayKey);

        if (!normalizedDayKey) {
            return;
        }

        normalized[normalizedDayKey] = Array.isArray(keys)
            ? [...new Set(keys.map((k) => normalizeEffectText(k, 120)).filter(Boolean))]
            : [];
    });

    return normalized;
}

function getGoalGiftLikeUniqueSeen() {
    return normalizeGoalGiftLikeUniqueSeen(getScopedStateValue(WIDGET_GOAL_GIFT_LIKE_UNIQUE_SEEN_STATE_KEY));
}

function setGoalGiftLikeUniqueSeen(value) {
    const normalized = normalizeGoalGiftLikeUniqueSeen(value);
    const todayKey = getTodayDayKey();
    const pruned = {};

    if (normalized[todayKey]) {
        pruned[todayKey] = normalized[todayKey];
    }

    setScopedStateValue(WIDGET_GOAL_GIFT_LIKE_UNIQUE_SEEN_STATE_KEY, JSON.stringify(pruned));
    return pruned;
}

function incrementGoalGiftActivityCount(type, amount = 1, dayKey = getTodayDayKey()) {
    if (type !== 'like' && type !== 'likeUnique' && type !== 'follow') {
        return getGoalGiftActivityCounts(dayKey);
    }

    const normalizedAmount = normalizeWholeNumber(amount) || 0;
    const normalizedDayKey = normalizeDayKey(dayKey) || getTodayDayKey();

    if (normalizedAmount <= 0) {
        return getGoalGiftActivityCounts(normalizedDayKey);
    }

    const countsState = getGoalGiftActivityCountsState();
    const currentCounts = countsState[normalizedDayKey] || { like: 0, likeUnique: 0, follow: 0 };
    countsState[normalizedDayKey] = {
        like: normalizeWholeNumber(currentCounts.like) || 0,
        likeUnique: normalizeWholeNumber(currentCounts.likeUnique) || 0,
        follow: normalizeWholeNumber(currentCounts.follow) || 0,
        [type]: (normalizeWholeNumber(currentCounts[type]) || 0) + normalizedAmount
    };

    setGoalGiftActivityCountsState(countsState);
    return countsState[normalizedDayKey];
}

function consumeGoalGiftLikeActivityCount(data, dayKey = getTodayDayKey()) {
    const normalizedDayKey = normalizeDayKey(dayKey) || getTodayDayKey();
    const likeCount = normalizeWholeNumber(data?.likeCount) || 0;
    const totalLikeCount = normalizeWholeNumber(data?.totalLikeCount) || 0;

    // likeUnique: 1人1カウント用にユーザーを初回のみカウント
    const actorKey = getGoalGiftFollowActorKey(data);

    if (actorKey) {
        const seenState = getGoalGiftLikeUniqueSeen();
        const seenKeys = seenState[normalizedDayKey] || [];

        if (!seenKeys.includes(actorKey)) {
            seenKeys.push(actorKey);
            seenState[normalizedDayKey] = seenKeys;
            setGoalGiftLikeUniqueSeen(seenState);
            incrementGoalGiftActivityCount('likeUnique', 1, normalizedDayKey);
        }
    }

    if (totalLikeCount > 0) {
        const likeTotalsState = getGoalGiftLikeTotalsState();
        const previousTotalLikeCount = normalizeWholeNumber(likeTotalsState[normalizedDayKey]) || 0;
        likeTotalsState[normalizedDayKey] = totalLikeCount;
        setGoalGiftLikeTotalsState(likeTotalsState);

        if (previousTotalLikeCount > 0 && totalLikeCount > previousTotalLikeCount) {
            return incrementGoalGiftActivityCount('like', totalLikeCount - previousTotalLikeCount, normalizedDayKey);
        }

        if (previousTotalLikeCount === 0 || totalLikeCount < previousTotalLikeCount) {
            if (likeCount > 0) {
                return incrementGoalGiftActivityCount('like', likeCount, normalizedDayKey);
            }

            return getGoalGiftActivityCounts(normalizedDayKey);
        }

        return getGoalGiftActivityCounts(normalizedDayKey);
    }

    if (likeCount > 0) {
        return incrementGoalGiftActivityCount('like', likeCount, normalizedDayKey);
    }

    return getGoalGiftActivityCounts(normalizedDayKey);
}

function consumeGoalGiftFollowActivityCount(data, dayKey = getTodayDayKey()) {
    const normalizedDayKey = normalizeDayKey(dayKey) || getTodayDayKey();
    const sessionState = getContributorsSessionState();
    const sessionStartedAt = normalizeStoredTimestamp(sessionState.startedAt) || '';
    const actorKey = getGoalGiftFollowActorKey(data);

    if (!sessionStartedAt || !actorKey) {
        return incrementGoalGiftActivityCount('follow', 1, normalizedDayKey);
    }

    const followState = getGoalGiftFollowState();
    const nextState = followState.sessionStartedAt === sessionStartedAt
        ? followState
        : { sessionStartedAt, seenUserKeys: [] };

    if (nextState.seenUserKeys.includes(actorKey)) {
        if (nextState !== followState) {
            setGoalGiftFollowState(nextState);
        }

        return getGoalGiftActivityCounts(normalizedDayKey);
    }

    nextState.seenUserKeys.push(actorKey);
    setGoalGiftFollowState(nextState);
    return incrementGoalGiftActivityCount('follow', 1, normalizedDayKey);
}

function getGoalGiftWidgetStrokeWidth() {
    return normalizeGoalGiftStrokeWidth(getScopedStateValue(WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY));
}

function setGoalGiftWidgetStrokeWidth(value) {
    const normalizedValue = normalizeGoalGiftStrokeWidth(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function getGoalGiftWidgetNoteFontSize() {
    return normalizeGoalGiftNoteFontSize(getScopedStateValue(WIDGET_GOAL_GIFTS_NOTE_FONT_SIZE_STATE_KEY));
}

function setGoalGiftWidgetNoteFontSize(value) {
    const normalizedValue = normalizeGoalGiftNoteFontSize(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_NOTE_FONT_SIZE_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeGoalGiftAchievementBadgeSize(value) {
    const normalizedValue = normalizeWholeNumber(value);
    if (!Number.isInteger(normalizedValue) || normalizedValue < MIN_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE) {
        return DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE;
    }
    return Math.min(normalizedValue, MAX_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE);
}

function getGoalGiftWidgetAchievementBadgeSize() {
    return normalizeGoalGiftAchievementBadgeSize(getScopedStateValue(WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_SIZE_STATE_KEY));
}

function setGoalGiftWidgetAchievementBadgeSize(value) {
    const normalizedValue = normalizeGoalGiftAchievementBadgeSize(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_SIZE_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeGoalGiftAchievementBadgeStyle(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    return ALLOWED_GOAL_GIFT_ACHIEVEMENT_BADGE_STYLES.has(normalizedValue) ? normalizedValue : DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_STYLE;
}

function getGoalGiftWidgetAchievementBadgeStyle() {
    return normalizeGoalGiftAchievementBadgeStyle(getScopedStateValue(WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_STYLE_STATE_KEY));
}

function setGoalGiftWidgetAchievementBadgeStyle(value) {
    const normalizedValue = normalizeGoalGiftAchievementBadgeStyle(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_STYLE_STATE_KEY, normalizedValue);
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
        const giftImage = systemType
            ? getGoalGiftSystemImageUrl(giftId)
            : (typeof item?.giftImage === 'string' ? item?.giftImage.trim() : '');
        const targetCount = normalizeWholeNumber(item?.targetCount) || DEFAULT_GOAL_GIFT_WIDGET_ITEM.targetCount;
        const countUniqueUsers = normalizeBooleanInput(item?.countUniqueUsers, DEFAULT_GOAL_GIFT_WIDGET_ITEM.countUniqueUsers);
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
            countUniqueUsers,
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

function getGoalGiftContributorKey(gift) {
    const uniqueId = normalizeBroadcasterId(gift?.uniqueId);
    if (uniqueId) {
        return `id:${uniqueId.toLowerCase()}`;
    }

    const nickname = normalizeNickname(gift?.nickname);
    return nickname ? `name:${nickname.toLowerCase()}` : null;
}

function buildGoalGiftProgressSnapshot(
    dayKey = getTodayDayKey(),
    goalItems = getGoalGiftWidgetItems(),
    fontKey = getDisplayFontFamily(),
    textStyleKey = getDisplayColorTheme(),
    strokeWidth = getDisplayStrokeWidth(),
    noteFontSize = getGoalGiftWidgetNoteFontSize(),
    achievementBadgeSize = getGoalGiftWidgetAchievementBadgeSize(),
    achievementBadgeStyle = getGoalGiftWidgetAchievementBadgeStyle()
) {
    const requestedDayKey = normalizeDayKey(dayKey) || getTodayDayKey();
    const broadcasterId = getBroadcasterId();
    const normalizedItems = normalizeGoalGiftWidgetItems(goalItems);
    const normalizedFontKey = normalizeGoalGiftFontKey(fontKey);
    const normalizedTextStyleKey = normalizeGoalGiftTextStyleKey(textStyleKey);
    const normalizedStrokeWidth = normalizeGoalGiftStrokeWidth(strokeWidth);
    const normalizedNoteFontSize = normalizeGoalGiftNoteFontSize(noteFontSize);
    const normalizedAchievementBadgeSize = normalizeGoalGiftAchievementBadgeSize(achievementBadgeSize);
    const normalizedAchievementBadgeStyle = normalizeGoalGiftAchievementBadgeStyle(achievementBadgeStyle);

    if (!broadcasterId) {
        return {
            dayKey: requestedDayKey,
            broadcasterId: null,
            fontKey: normalizedFontKey,
            textStyleKey: normalizedTextStyleKey,
            strokeWidth: normalizedStrokeWidth,
            noteFontSize: normalizedNoteFontSize,
            achievementBadgeSize: normalizedAchievementBadgeSize,
            achievementBadgeStyle: normalizedAchievementBadgeStyle,
            feedback: getGoalGiftFeedbackSettings(),
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
        noteFontSize: normalizedNoteFontSize,
        achievementBadgeSize: normalizedAchievementBadgeSize,
        achievementBadgeStyle: normalizedAchievementBadgeStyle,
        feedback: getGoalGiftFeedbackSettings(),
        goals: normalizedItems.map((item, index) => {
            const systemType = getGoalGiftSystemTypeById(item.giftId);

            if (systemType) {
                const countKey = systemType === 'like' && item.countUniqueUsers ? 'likeUnique' : systemType;
                const observedCount = normalizeWholeNumber(activityCounts[countKey]) || 0;
                const currentCountOffset = item.resetAtMidnight && item.currentCountOffsetDayKey !== requestedDayKey
                    ? 0
                    : item.currentCountOffset;
                const currentCount = Math.max(0, observedCount + currentCountOffset);

                return {
                    slot: index + 1,
                    ...item,
                    giftImage: getGoalGiftSystemImageUrl(item.giftId),
                    currentCount,
                    observedCount,
                    completed: currentCount >= item.targetCount,
                    progressRatio: item.targetCount > 0 ? Math.min(currentCount / item.targetCount, 1) : 0
                };
            }

            const normalizedGiftName = normalizeGoalGiftMatchName(item.giftName);
            let observedCount = 0;
            let latestGiftImage = item.giftImage || '';
            const countedContributorKeys = item.countUniqueUsers ? new Set() : null;

            gifts.forEach((gift) => {
                const idMatched = item.giftId && String(gift.giftId || '') === item.giftId;
                const nameMatched = !item.giftId && normalizedGiftName && normalizeGoalGiftMatchName(gift.giftName) === normalizedGiftName;

                if (!idMatched && !nameMatched) {
                    return;
                }

                if (countedContributorKeys) {
                    const contributorKey = getGoalGiftContributorKey(gift);
                    if (contributorKey && countedContributorKeys.has(contributorKey)) {
                        return;
                    }

                    if (contributorKey) {
                        countedContributorKeys.add(contributorKey);
                    }

                    observedCount += 1;
                } else {
                    observedCount += Math.max(0, Number(gift.repeatCount || 0));
                }

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

function getDuplicateUniqueGoalGiftSlots(giftEvent, dayKey = getTodayDayKey(), goalItems = getGoalGiftWidgetItems()) {
    const broadcasterId = getBroadcasterId();

    if (!broadcasterId || !giftEvent) {
        return [];
    }

    const normalizedItems = normalizeGoalGiftWidgetItems(goalItems);
    const contributorKey = getGoalGiftContributorKey(giftEvent);

    if (!contributorKey) {
        return [];
    }

    const requestedDayKey = normalizeDayKey(dayKey) || getTodayDayKey();
    const historicalGifts = dbStore.getAdminGiftEventsByDay(requestedDayKey, broadcasterId).map(hydrateStoredGiftEvent);
    const matchedSlots = [];

    normalizedItems.forEach((item, index) => {
        if (!item.enabled || !item.countUniqueUsers) {
            return;
        }

        const systemType = getGoalGiftSystemTypeById(item.giftId);
        if (systemType) {
            return;
        }

        const idMatched = item.giftId && String(giftEvent.giftId || '') === item.giftId;
        const normalizedGiftName = normalizeGoalGiftMatchName(item.giftName);
        const nameMatched = !item.giftId
            && normalizedGiftName
            && normalizeGoalGiftMatchName(giftEvent.giftName) === normalizedGiftName;

        if (!idMatched && !nameMatched) {
            return;
        }

        const alreadyCounted = historicalGifts.some((gift) => {
            const historicalIdMatched = item.giftId && String(gift.giftId || '') === item.giftId;
            const historicalNameMatched = !item.giftId
                && normalizedGiftName
                && normalizeGoalGiftMatchName(gift.giftName) === normalizedGiftName;

            if (!historicalIdMatched && !historicalNameMatched) {
                return false;
            }

            return getGoalGiftContributorKey(gift) === contributorKey;
        });

        if (alreadyCounted) {
            matchedSlots.push(index + 1);
        }
    });

    return matchedSlots;
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
        mediaVolume: 100
    };
}

function createDefaultCommentFeedSettings() {
    return {
        sortOrder: 'desc',
        enabledTypes: COMMENT_FEED_EVENT_DEFINITIONS.map((item) => item.type),
        readAloudEnabledTypes: COMMENT_FEED_EVENT_DEFINITIONS.map((item) => item.type),
        readAloudEnabled: false,
        readAloudVoiceName: '',
        readAloudVoiceCreditEnabled: false,
        readAloudRandomVoiceEnabled: false,
        readAloudVolume: 100,
        readAloudFilters: [...COMMENT_READ_ALOUD_DEFAULT_FILTERS],
        readAloudTextReplacements: [],
        readAloudEmojiReplacements: [],
        readAloudEmoteReplacements: [],
        readAloudVoiceMappings: [],
        readAloudDefaultsVersion: COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION
    };
}

let commentReadAloudVoiceProvider = async () => [];
let commentReadAloudAudioProvider = null;
const commentReadAloudRandomVoiceAssignments = new Map();
let commentReadAloudVoicevoxRetryAt = 0;
let effectsGloballyPaused = false;

// 同一ボイス×同一テキストの音声合成結果を再利用するLRUキャッシュ。
// 「ありがとう」「草」「👍」のような繰り返しコメントで合成全体（1〜3秒）をスキップする。
const COMMENT_READ_ALOUD_AUDIO_CACHE_LIMIT = 100;
const commentReadAloudAudioCache = new Map();

function getCommentReadAloudAudioCacheKey(payload) {
    const voice = String(payload?.voiceName || '');
    const volume = Number.isFinite(Number(payload?.volume)) ? Number(payload.volume) : 100;
    const text = String(payload?.text || '');
    if (!voice || !text) {
        return '';
    }
    return `${voice}|${volume}|${text}`;
}

function getCommentReadAloudAudioCacheEntry(key) {
    if (!key) return null;
    const entry = commentReadAloudAudioCache.get(key);
    if (!entry) return null;
    // LRU: 末尾に詰め直す
    commentReadAloudAudioCache.delete(key);
    commentReadAloudAudioCache.set(key, entry);
    return entry;
}

function setCommentReadAloudAudioCacheEntry(key, asset) {
    if (!key || !asset?.url) return;
    if (commentReadAloudAudioCache.size >= COMMENT_READ_ALOUD_AUDIO_CACHE_LIMIT) {
        const oldestKey = commentReadAloudAudioCache.keys().next().value;
        if (oldestKey !== undefined) {
            commentReadAloudAudioCache.delete(oldestKey);
        }
    }
    commentReadAloudAudioCache.set(key, { url: asset.url, mimeType: asset.mimeType });
}

let commentReadAloudAudioDirectoryReady = false;

function setCommentReadAloudVoiceProvider(provider) {
    if (typeof provider === 'function') {
        commentReadAloudVoiceProvider = provider;
        return;
    }

    commentReadAloudVoiceProvider = async () => [];
}

function setCommentReadAloudAudioProvider(provider) {
    commentReadAloudAudioProvider = typeof provider === 'function' ? provider : null;
}

function clearCommentReadAloudRandomVoiceAssignments() {
    const clearedCount = commentReadAloudRandomVoiceAssignments.size;
    commentReadAloudRandomVoiceAssignments.clear();
    return clearedCount;
}

function normalizeCommentReadAloudVoices(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((voice) => {
            const voiceValue = normalizeEffectText(voice?.value ?? voice?.name, 200);
            const name = normalizeEffectText(voice?.name, 160);

            if (!name || !voiceValue) {
                return null;
            }

            return {
                value: voiceValue,
                name,
                lang: normalizeEffectText(voice?.lang, 40),
                gender: normalizeEffectText(voice?.gender, 40),
                provider: normalizeEffectText(voice?.provider, 40),
                termsUrl: normalizeEffectText(voice?.termsUrl, 400)
            };
        })
        .filter(Boolean)
        .sort((left, right) => String(left.name).localeCompare(String(right.name), 'ja'));
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

function normalizeCommentReadAloudFilters(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/gu) : []);

    return [...new Set(source
        .map((item) => normalizeEffectText(item, 120))
        .filter(Boolean)
        .slice(0, 100))];
}

function migrateCommentReadAloudFilters(filters, storedDefaultsVersion) {
    if (storedDefaultsVersion >= 2) {
        return filters;
    }

    return normalizeCommentReadAloudFilters([
        ...filters.filter((item) => item !== 'おばさん'),
        'ババア'
    ]);
}

function normalizeCommentReadAloudTextReplacements(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/gu) : []);

    return source
        .map((item) => {
            if (typeof item === 'object' && item) {
                const from = normalizeEffectText(item.from, 120);
                const to = normalizeEffectText(item.to, 120);

                if (!from || !to) {
                    return null;
                }

                return { from, to };
            }

            const line = normalizeEffectText(item, 260);

            if (!line) {
                return null;
            }

            const separatorIndex = line.search(/[=＝]/u);

            if (separatorIndex <= 0) {
                return null;
            }

            const from = normalizeEffectText(line.slice(0, separatorIndex), 120);
            const to = normalizeEffectText(line.slice(separatorIndex + 1), 120);

            if (!from || !to) {
                return null;
            }

            return { from, to };
        })
        .filter(Boolean)
        .sort((left, right) => String(right.from).length - String(left.from).length)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.from === item.from) === index)
        .slice(0, 100);
}

function normalizeCommentReadAloudEmojiReplacements(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/gu) : []);

    return source
        .map((item) => {
            if (typeof item === 'object' && item) {
                const emoji = normalizeEffectText(item.emoji, 32);
                const text = normalizeEffectText(item.text, 120);

                if (!emoji || !text) {
                    return null;
                }

                return { emoji, text };
            }

            const line = normalizeEffectText(item, 180);

            if (!line) {
                return null;
            }

            const separatorIndex = line.indexOf('=');

            if (separatorIndex <= 0) {
                return null;
            }

            const emoji = normalizeEffectText(line.slice(0, separatorIndex), 32);
            const text = normalizeEffectText(line.slice(separatorIndex + 1), 120);

            if (!emoji || !text) {
                return null;
            }

            return { emoji, text };
        })
        .filter(Boolean)
        .sort((left, right) => String(right.emoji).length - String(left.emoji).length)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.emoji === item.emoji) === index)
        .slice(0, 100);
}

function normalizeCommentReadAloudEmoteKey(value) {
    const normalizedValue = normalizeEffectText(value, 64);

    if (!normalizedValue) {
        return '';
    }

    if (normalizedValue.startsWith('[emote:') && normalizedValue.endsWith(']')) {
        return normalizeEffectText(normalizedValue.slice(7, -1), 64);
    }

    if (normalizedValue.startsWith('emote:')) {
        return normalizeEffectText(normalizedValue.slice(6), 64);
    }

    return normalizedValue;
}

function normalizeCommentReadAloudEmoteReplacements(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/gu) : []);

    return source
        .map((item) => {
            if (typeof item === 'object' && item) {
                const emoteId = normalizeCommentReadAloudEmoteKey(item.emoteId ?? item.emote);
                const text = normalizeEffectText(item.text, 120);

                if (!emoteId || !text) {
                    return null;
                }

                return { emoteId, text };
            }

            const line = normalizeEffectText(item, 200);

            if (!line) {
                return null;
            }

            const separatorIndex = line.indexOf('=');

            if (separatorIndex <= 0) {
                return null;
            }

            const emoteId = normalizeCommentReadAloudEmoteKey(line.slice(0, separatorIndex));
            const text = normalizeEffectText(line.slice(separatorIndex + 1), 120);

            if (!emoteId || !text) {
                return null;
            }

            return { emoteId, text };
        })
        .filter(Boolean)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.emoteId === item.emoteId) === index)
        .slice(0, 100);
}

function normalizeCommentReadAloudVoiceMappings(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/gu) : []);

    return source
        .map((item) => {
            if (typeof item === 'object' && item) {
                const uniqueId = normalizeBroadcasterId(item.uniqueId ?? item.userId);
                const voiceName = normalizeEffectText(item.voiceName, 200);

                if (!uniqueId || !voiceName) {
                    return null;
                }

                return { uniqueId, voiceName };
            }

            const line = normalizeEffectText(item, 320);

            if (!line) {
                return null;
            }

            const separatorIndex = line.search(/[=＝]/u);

            if (separatorIndex <= 0) {
                return null;
            }

            const uniqueId = normalizeBroadcasterId(line.slice(0, separatorIndex));
            const voiceName = normalizeEffectText(line.slice(separatorIndex + 1), 200);

            if (!uniqueId || !voiceName) {
                return null;
            }

            return { uniqueId, voiceName };
        })
        .filter(Boolean)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.uniqueId === item.uniqueId) === index)
        .slice(0, 200);
}

function normalizeCommentObservedEmoteCatalog(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    return (Array.isArray(source) ? source : [])
        .map((item) => {
            const emoteId = normalizeCommentReadAloudEmoteKey(item?.emoteId ?? item?.id);
            const imageUrl = normalizeEffectText(item?.imageUrl ?? item?.url, 2000);
            const observedAt = normalizeWholeNumber(item?.observedAt) || 0;

            if (!emoteId || !imageUrl) {
                return null;
            }

            return { emoteId, imageUrl, observedAt };
        })
        .filter(Boolean)
        .sort((left, right) => right.observedAt - left.observedAt)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.emoteId === item.emoteId) === index)
        .slice(0, COMMENT_OBSERVED_EMOTE_CACHE_LIMIT);
}

function normalizeCommentObservedEmojiCatalog(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    return (Array.isArray(source) ? source : [])
        .map((item) => {
            const emoji = normalizeEffectText(item?.emoji ?? item?.value, 32);
            const observedAt = normalizeWholeNumber(item?.observedAt) || 0;

            if (!emoji) {
                return null;
            }

            return { emoji, observedAt };
        })
        .filter(Boolean)
        .sort((left, right) => right.observedAt - left.observedAt)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.emoji === item.emoji) === index)
        .slice(0, COMMENT_OBSERVED_EMOJI_CACHE_LIMIT);
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
    const hasReadAloudEnabledTypes = Array.isArray(source?.readAloudEnabledTypes);
    const readAloudEnabledTypesSource = hasReadAloudEnabledTypes
        ? source.readAloudEnabledTypes
        : (hasEnabledTypes ? enabledTypesSource : defaults.readAloudEnabledTypes);
    const readAloudEnabledTypes = [...new Set(readAloudEnabledTypesSource.map((item) => normalizeCommentFeedType(item)).filter(Boolean))];
    const hasReadAloudFilters = Array.isArray(source?.readAloudFilters) || typeof source?.readAloudFilters === 'string';
    const storedReadAloudDefaultsVersion = Math.max(0, normalizeWholeNumber(source?.readAloudDefaultsVersion, 0));
    const readAloudVoiceName = normalizeEffectText(source?.readAloudVoiceName, 120);
    const readAloudVoiceCreditEnabled = source?.readAloudVoiceCreditEnabled === true;
    const readAloudRandomVoiceEnabled = source?.readAloudRandomVoiceEnabled === true;
    const readAloudVolume = Math.max(0, Math.min(100, normalizeWholeNumber(source?.readAloudVolume, defaults.readAloudVolume)));
    const normalizedStoredReadAloudFilters = hasReadAloudFilters
        ? normalizeCommentReadAloudFilters(source?.readAloudFilters)
        : [];
    const readAloudTextReplacements = normalizeCommentReadAloudTextReplacements(source?.readAloudTextReplacements);
    const readAloudEmojiReplacements = normalizeCommentReadAloudEmojiReplacements(source?.readAloudEmojiReplacements);
    const readAloudEmoteReplacements = normalizeCommentReadAloudEmoteReplacements(source?.readAloudEmoteReplacements);
    const readAloudVoiceMappings = normalizeCommentReadAloudVoiceMappings(source?.readAloudVoiceMappings);
    const readAloudFilters = migrateCommentReadAloudFilters(storedReadAloudDefaultsVersion >= COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION
        ? (hasReadAloudFilters ? normalizedStoredReadAloudFilters : [...defaults.readAloudFilters])
        : normalizeCommentReadAloudFilters([
            ...COMMENT_READ_ALOUD_DEFAULT_FILTERS,
            ...normalizedStoredReadAloudFilters
        ]), storedReadAloudDefaultsVersion);

    return {
        sortOrder: source?.sortOrder === 'asc' ? 'asc' : 'desc',
        enabledTypes: hasEnabledTypes ? enabledTypes : defaults.enabledTypes,
        readAloudEnabledTypes: hasReadAloudEnabledTypes ? readAloudEnabledTypes : (hasEnabledTypes ? enabledTypes : defaults.readAloudEnabledTypes),
        readAloudEnabled: source?.readAloudEnabled === true,
        readAloudVoiceName,
        readAloudVoiceCreditEnabled,
        readAloudRandomVoiceEnabled,
        readAloudVolume,
        readAloudFilters,
        readAloudTextReplacements,
        readAloudEmojiReplacements,
        readAloudEmoteReplacements,
        readAloudVoiceMappings,
        readAloudDefaultsVersion: COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION
    };
}

function getCommentFeedTypes() {
    return COMMENT_FEED_EVENT_DEFINITIONS.map((item) => ({ ...item }));
}

// ホットパス上で同じ設定・カタログを何度も DB 読みしてたのをメモリキャッシュする。
// ブロードキャスター切り替えと set 系 API 経由で無効化し、それ以外はメモリヒットしたオブジェクトをそのまま返す。
let _commentFeedSettingsCache = null;
let _commentFeedSettingsCacheBroadcaster = '__uninitialized__';
let _observedCommentEmoteCatalogCache = null;
let _observedCommentEmoteCatalogCacheBroadcaster = '__uninitialized__';
let _observedCommentEmojiCatalogCache = null;
let _observedCommentEmojiCatalogCacheBroadcaster = '__uninitialized__';

function invalidateCommentFeedCaches() {
    _commentFeedSettingsCache = null;
    _commentFeedSettingsCacheBroadcaster = '__uninitialized__';
    _observedCommentEmoteCatalogCache = null;
    _observedCommentEmoteCatalogCacheBroadcaster = '__uninitialized__';
    _observedCommentEmojiCatalogCache = null;
    _observedCommentEmojiCatalogCacheBroadcaster = '__uninitialized__';
}

function getCommentFeedSettings() {
    const broadcasterCacheKey = String(getBroadcasterId() || '');
    if (_commentFeedSettingsCache && _commentFeedSettingsCacheBroadcaster === broadcasterCacheKey) {
        return _commentFeedSettingsCache;
    }

    const storedValue = getScopedStateValue(COMMENT_SETTINGS_STATE_KEY);
    const normalizedSettings = normalizeCommentFeedSettings(storedValue);

    let source = storedValue;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    const storedReadAloudDefaultsVersion = Math.max(0, normalizeWholeNumber(source?.readAloudDefaultsVersion, 0));

    if (storedReadAloudDefaultsVersion < COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION) {
        setScopedStateValue(COMMENT_SETTINGS_STATE_KEY, JSON.stringify(normalizedSettings));
    }

    _commentFeedSettingsCache = normalizedSettings;
    _commentFeedSettingsCacheBroadcaster = broadcasterCacheKey;
    return normalizedSettings;
}

function setCommentFeedSettings(settings) {
    const normalizedSettings = normalizeCommentFeedSettings(settings);
    setScopedStateValue(COMMENT_SETTINGS_STATE_KEY, JSON.stringify(normalizedSettings));
    _commentFeedSettingsCache = normalizedSettings;
    _commentFeedSettingsCacheBroadcaster = String(getBroadcasterId() || '');
    return normalizedSettings;
}

function getObservedCommentEmoteCatalog() {
    const broadcasterCacheKey = String(getBroadcasterId() || '');
    if (_observedCommentEmoteCatalogCache && _observedCommentEmoteCatalogCacheBroadcaster === broadcasterCacheKey) {
        return _observedCommentEmoteCatalogCache;
    }

    const normalized = normalizeCommentObservedEmoteCatalog(getScopedStateValue(COMMENT_OBSERVED_EMOTES_STATE_KEY));
    _observedCommentEmoteCatalogCache = normalized;
    _observedCommentEmoteCatalogCacheBroadcaster = broadcasterCacheKey;
    return normalized;
}

function setObservedCommentEmoteCatalog(catalog) {
    const normalizedCatalog = normalizeCommentObservedEmoteCatalog(catalog);
    setScopedStateValue(COMMENT_OBSERVED_EMOTES_STATE_KEY, JSON.stringify(normalizedCatalog));
    _observedCommentEmoteCatalogCache = normalizedCatalog;
    _observedCommentEmoteCatalogCacheBroadcaster = String(getBroadcasterId() || '');
    return normalizedCatalog;
}

function getObservedCommentEmojiCatalog() {
    const broadcasterCacheKey = String(getBroadcasterId() || '');
    if (_observedCommentEmojiCatalogCache && _observedCommentEmojiCatalogCacheBroadcaster === broadcasterCacheKey) {
        return _observedCommentEmojiCatalogCache;
    }

    const normalized = normalizeCommentObservedEmojiCatalog(getScopedStateValue(COMMENT_OBSERVED_EMOJIS_STATE_KEY));
    _observedCommentEmojiCatalogCache = normalized;
    _observedCommentEmojiCatalogCacheBroadcaster = broadcasterCacheKey;
    return normalized;
}

function setObservedCommentEmojiCatalog(catalog) {
    const normalizedCatalog = normalizeCommentObservedEmojiCatalog(catalog);
    setScopedStateValue(COMMENT_OBSERVED_EMOJIS_STATE_KEY, JSON.stringify(normalizedCatalog));
    _observedCommentEmojiCatalogCache = normalizedCatalog;
    _observedCommentEmojiCatalogCacheBroadcaster = String(getBroadcasterId() || '');
    return normalizedCatalog;
}

function stripCommentReadAloudEmoji(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u200D\uFE0E\uFE0F]/gu, ' ')
        .replace(/[0-9#*]\u20E3/gu, ' ')
        // 顔文字: 括弧内にω/Д/▽など顔文字特有の文字を含む表現（前後の装飾文字込み）
        .replace(/[ヽノﾉ]?[（(][^（(）)\n]{0,40}[ωдДΩ▽△∀εσοﾟ][^（(）)\n]{0,40}[）)][ヽノﾉ]?/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function applyCommentReadAloudEmojiReplacements(value, replacements) {
    if (typeof value !== 'string' || !Array.isArray(replacements) || !replacements.length) {
        return typeof value === 'string' ? value : '';
    }

    return replacements.reduce((result, item) => {
        const emoji = typeof item?.emoji === 'string' ? item.emoji : '';
        const text = typeof item?.text === 'string' ? item.text : '';

        if (!emoji || !text || !result.includes(emoji)) {
            return result;
        }

        // 最初の1つだけ変換テキストに置換し、残りの同一絵文字は削除する
        const firstIdx = result.indexOf(emoji);
        const withFirst = result.slice(0, firstIdx) + ` ${text} ` + result.slice(firstIdx + emoji.length);
        return withFirst.split(emoji).join(' ');
    }, value);
}

function applyCommentReadAloudTextReplacements(value, replacements) {
    if (typeof value !== 'string' || !Array.isArray(replacements) || !replacements.length) {
        return typeof value === 'string' ? value : '';
    }

    return replacements.reduce((result, item) => {
        const from = typeof item?.from === 'string' ? item.from : '';
        const to = typeof item?.to === 'string' ? item.to : '';

        if (!from || !to || !result.includes(from)) {
            return result;
        }

        return result.split(from).join(to);
    }, value);
}

function applyCommentReadAloudEmoteReplacements(value, replacements) {
    if (typeof value !== 'string') {
        return '';
    }

    const replacementMap = new Map(
        (Array.isArray(replacements) ? replacements : [])
            .map((item) => {
                const emoteId = normalizeCommentReadAloudEmoteKey(item?.emoteId ?? item?.emote);
                const text = normalizeEffectText(item?.text, 120);
                return emoteId && text ? [emoteId, text] : null;
            })
            .filter(Boolean)
    );

    // 同一エモートIDごとに最初の1つだけ変換テキストに置換し、残りは削除する
    const seenEmoteIds = new Set();

    return value.replace(/\[emote:([^\]]+)\]/gu, (match, rawEmoteId) => {
        const emoteId = normalizeCommentReadAloudEmoteKey(rawEmoteId);
        const replacement = emoteId ? replacementMap.get(emoteId) : '';
        if (replacement && !seenEmoteIds.has(emoteId)) {
            seenEmoteIds.add(emoteId);
            return ` ${replacement} `;
        }
        return ' ';
    });
}

function buildCommentReadAloudText(commentEvent, settings = getCommentFeedSettings()) {
    const replacedComment = applyCommentReadAloudEmojiReplacements(commentEvent?.comment, settings?.readAloudEmojiReplacements);
    const replacedEmoteComment = applyCommentReadAloudEmoteReplacements(replacedComment, settings?.readAloudEmoteReplacements);
    const replacedTextComment = applyCommentReadAloudTextReplacements(replacedEmoteComment, settings?.readAloudTextReplacements);
    const message = normalizeEffectText(stripCommentReadAloudEmoji(replacedTextComment), 240);

    if (!message) {
        return '';
    }

    return message;
}

function createCommentReadAloudPayload(commentEvent) {
    const settings = getCommentFeedSettings();
    const normalizedUniqueId = normalizeBroadcasterId(commentEvent?.uniqueId) || '';
    const mappedVoiceName = (Array.isArray(settings.readAloudVoiceMappings) ? settings.readAloudVoiceMappings : [])
        .find((item) => item.uniqueId === normalizedUniqueId)?.voiceName || '';

    return {
        playbackId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        screen: COMMENT_READ_ALOUD_EFFECT_SCREEN,
        text: buildCommentReadAloudText(commentEvent, settings),
        type: commentEvent?.type || 'chat',
        uniqueId: normalizedUniqueId || commentEvent?.uniqueId || '',
        nickname: commentEvent?.nickname || '',
        voiceName: mappedVoiceName || settings.readAloudVoiceName || '',
        volume: settings.readAloudVolume,
        timestamp: getTimestamp()
    };
}

async function resolveCommentReadAloudVoiceName(payload, settings = getCommentFeedSettings()) {
    const normalizedUniqueId = normalizeBroadcasterId(payload?.uniqueId) || '';
    const voiceMappings = Array.isArray(settings?.readAloudVoiceMappings) ? settings.readAloudVoiceMappings : [];
    const mappedVoiceName = voiceMappings.find((item) => item.uniqueId === normalizedUniqueId)?.voiceName || '';
    const forcedVoiceName = payload?.forceVoiceName && typeof payload?.voiceName === 'string'
        ? normalizeEffectText(payload.voiceName, 160)
        : '';

    if (mappedVoiceName) {
        return mappedVoiceName;
    }

    if (forcedVoiceName) {
        return forcedVoiceName;
    }

    if (settings?.readAloudRandomVoiceEnabled) {
        try {
            const cachedVoiceName = normalizedUniqueId ? commentReadAloudRandomVoiceAssignments.get(normalizedUniqueId) : '';

            if (cachedVoiceName) {
                return cachedVoiceName;
            }

            let voices = normalizeCommentReadAloudVoices(await Promise.resolve(commentReadAloudVoiceProvider())).filter((v) => v.provider === 'voicevox');

            if (!voices.length && Date.now() >= commentReadAloudVoicevoxRetryAt) {
                commentReadAloudVoicevoxRetryAt = Date.now() + 15000;
                console.log('[read-aloud] VOICEVOXボイスが未検出。自動連携を試みます…');
                voices = normalizeCommentReadAloudVoices(await Promise.resolve(commentReadAloudVoiceProvider({ forceRefresh: true }))).filter((v) => v.provider === 'voicevox');
                if (voices.length) {
                    console.log(`[read-aloud] VOICEVOX自動連携に成功しました。${voices.length}件のボイスを取得。`);
                }
            }

            if (voices.length) {
                const index = Math.floor(Math.random() * voices.length);
                const nextVoiceName = voices[index]?.value || voices[index]?.name || settings?.readAloudVoiceName || '';

                if (normalizedUniqueId && nextVoiceName) {
                    commentReadAloudRandomVoiceAssignments.set(normalizedUniqueId, nextVoiceName);
                }

                return nextVoiceName;
            }

            // VOICEVOX が起動していない（VOICEVOXボイスが0件）
            return null;
        } catch (error) {
            console.error('❌ Failed to resolve random read aloud voice:', error);
            return null;
        }
    }

    return settings?.readAloudVoiceName || payload?.voiceName || '';
}

function createCommentReadAloudPlaybackPayload(payload, audioUrl) {
    return {
        playbackId: payload.playbackId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        eventId: 'comment-read-aloud',
        eventName: 'Comment Read Aloud',
        screen: payload.screen || COMMENT_READ_ALOUD_EFFECT_SCREEN,
        videoUrl: '',
        audioUrl,
        mediaVolume: Math.max(0, Math.min(100, Number(payload.volume || 100))),
        playbackCount: 1,
        triggerId: 'comment-read-aloud',
        triggerName: 'Comment Read Aloud',
        giftName: '',
        uniqueId: payload.uniqueId || '',
        nickname: payload.nickname || '',
        readAloudCreditText: normalizeEffectText(payload.readAloudCreditText, 160),
        timestamp: payload.timestamp || getTimestamp()
    };
}

async function resolveCommentReadAloudVoiceCreditText(voiceName, settings = getCommentFeedSettings()) {
    if (settings?.readAloudVoiceCreditEnabled !== true) {
        return '';
    }

    const normalizedVoiceName = normalizeEffectText(voiceName, 200);

    if (!normalizedVoiceName.startsWith('voicevox:')) {
        return '';
    }

    try {
        const voices = normalizeCommentReadAloudVoices(await Promise.resolve(commentReadAloudVoiceProvider()));
        const matchedVoice = voices.find((voice) => voice.value === normalizedVoiceName || voice.name === normalizedVoiceName);
        const creditName = normalizeEffectText(matchedVoice?.name, 160);
        return creditName ? `VOICEVOX:${creditName}` : '';
    } catch (error) {
        console.error('❌ Failed to resolve VOICEVOX credit text:', error);
        return '';
    }
}

async function emitCommentReadAloudToScreen(payload) {
    const settings = getCommentFeedSettings();
    const resolvedVoiceName = await resolveCommentReadAloudVoiceName(payload, settings);

    // ランダムモードでVOICEVOX未起動（nullが返った）→ 読み上げをスキップして警告を表示
    if (resolvedVoiceName === null) {
        io.emit('screen1:voicevox-warning', { screen: COMMENT_READ_ALOUD_EFFECT_SCREEN });
        return;
    }

    const effectivePayload = {
        ...payload,
        voiceName: resolvedVoiceName,
        readAloudCreditText: await resolveCommentReadAloudVoiceCreditText(resolvedVoiceName, settings),
        volume: Math.max(0, Math.min(100, Number(payload?.volume ?? settings?.readAloudVolume ?? 100) || 0))
    };

    if (commentReadAloudAudioProvider) {
        try {
            const cacheKey = getCommentReadAloudAudioCacheKey(effectivePayload);
            const cachedEntry = cacheKey ? getCommentReadAloudAudioCacheEntry(cacheKey) : null;

            if (cachedEntry?.url) {
                io.emit('effects:playback', createCommentReadAloudPlaybackPayload(effectivePayload, cachedEntry.url));
                return;
            }

            const fileName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.wav`;
            const directory = getEffectMediaDirectory('audio');
            const filePath = path.join(directory, fileName);
            if (!commentReadAloudAudioDirectoryReady) {
                await fs.promises.mkdir(directory, { recursive: true });
                commentReadAloudAudioDirectoryReady = true;
            }
            const asset = await commentReadAloudAudioProvider(effectivePayload, {
                fileName,
                filePath,
                url: buildEffectMediaUrl('audio', fileName)
            });

            if (asset?.url) {
                if (cacheKey) {
                    setCommentReadAloudAudioCacheEntry(cacheKey, asset);
                }
                io.emit('effects:playback', createCommentReadAloudPlaybackPayload(effectivePayload, asset.url));
                return;
            }
        } catch (error) {
            console.error('❌ Failed to generate comment read aloud audio:', error);

            // ランダムモードでVOICEVOX合成に失敗（VOICEVOX停止）→ TTS fallback せず警告のみ
            if (settings?.readAloudRandomVoiceEnabled) {
                io.emit('screen1:voicevox-warning', { screen: COMMENT_READ_ALOUD_EFFECT_SCREEN });
                return;
            }
        }
    }

    io.emit('effects:tts', effectivePayload);
}

function normalizeCommentEventSourceTimestamp(value) {
    const normalized = normalizeWholeNumber(value);

    if (normalized === null || normalized === 0) {
        return null;
    }

    if (normalized < 100000000000) {
        return normalized * 1000;
    }

    return normalized;
}

function isCommentReadAloudBlockedByFilter(commentEvent, settings = getCommentFeedSettings()) {
    const filters = Array.isArray(settings?.readAloudFilters) ? settings.readAloudFilters : [];

    if (!filters.length) {
        return false;
    }

    const comment = typeof commentEvent?.comment === 'string'
        ? commentEvent.comment.toLocaleLowerCase('ja-JP')
        : '';

    if (!comment) {
        return false;
    }

    return filters.some((filter) => comment.includes(String(filter).toLocaleLowerCase('ja-JP')));
}

function isCommentReadAloudEligible(commentEvent, settings = getCommentFeedSettings()) {
    if (!settings.readAloudEnabled) {
        return false;
    }

    if (!settings.readAloudEnabledTypes.includes(commentEvent?.type)) {
        return false;
    }

    if (isCommentReadAloudBlockedByFilter(commentEvent, settings)) {
        return false;
    }

    const receivedAt = normalizeWholeNumber(commentEvent?.receivedAt);
    const sourceTimestamp = normalizeCommentEventSourceTimestamp(commentEvent?.sourceTimestamp);

    if (receivedAt === null) {
        return false;
    }

    if (sourceTimestamp === null) {
        return true;
    }

    return receivedAt - sourceTimestamp <= COMMENT_READ_ALOUD_MAX_AGE_MS;
}

function emitCommentReadAloud(commentEvent) {
    const settings = getCommentFeedSettings();

    if (!isCommentReadAloudEligible(commentEvent, settings)) {
        return;
    }

    const payload = createCommentReadAloudPayload(commentEvent);

    if (!payload.text) {
        return;
    }

    serverEvents.emit('comment-read-aloud', payload);
    void emitCommentReadAloudToScreen(payload);
}

function stopCommentReadAloud() {
    const payload = {
        screen: COMMENT_READ_ALOUD_EFFECT_SCREEN,
        timestamp: getTimestamp()
    };

    io.emit('effects:playback:stop', {
        ...payload,
        eventId: 'comment-read-aloud'
    });
    io.emit('effects:tts:stop', payload);
    serverEvents.emit('comment-read-aloud-stop', payload);
    return payload;
}

function emitCommentReadAloudTest(overrides = null) {
    const settings = getCommentFeedSettings();
    const source = overrides && typeof overrides === 'object' ? overrides : null;
    const voiceName = typeof source?.voiceName === 'string'
        ? normalizeEffectText(source.voiceName, 160)
        : '';
    const text = typeof source?.text === 'string'
        ? normalizeEffectText(source.text, 240)
        : '';
    const volume = Number.isFinite(Number(source?.volume))
        ? Math.max(0, Math.min(100, Number(source.volume)))
        : settings.readAloudVolume;
    const payload = {
        playbackId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        screen: COMMENT_READ_ALOUD_EFFECT_SCREEN,
        text: text || 'コメント読み上げテストです。screen1 で音声が聞こえれば設定は正常です。',
        type: 'system',
        uniqueId: '',
        nickname: 'TikEffect',
        voiceName: voiceName || settings.readAloudVoiceName || '',
        forceVoiceName: Boolean(voiceName),
        volume,
        timestamp: getTimestamp()
    };

    serverEvents.emit('comment-read-aloud', payload);
    void emitCommentReadAloudToScreen(payload);
    return payload;
}

function getCommentFeedTypeMeta(type) {
    return COMMENT_FEED_EVENT_DEFINITIONS.find((item) => item.type === type)
        || COMMENT_FEED_EVENT_DEFINITIONS[0];
}

function buildCommentFeedEmoteToken(emote) {
    const emoteId = firstDefinedString([
        emote?.emoteId,
        emote?.emote?.emoteId
    ]);

    if (emoteId) {
        return `[emote:${emoteId}]`;
    }

    return '[emote]';
}

function getCommentFeedEmoteId(emote) {
    return firstDefinedString([
        emote?.emoteId,
        emote?.emote?.emoteId
    ]);
}

function getCommentFeedEmoteImageUrl(emote) {
    return firstDefinedString([
        emote?.emoteImageUrl,
        emote?.image?.imageUrl,
        emote?.emote?.image?.imageUrl,
        emote?.image?.url?.[0],
        emote?.image?.urlList?.[0],
        emote?.emote?.image?.url?.[0],
        emote?.emote?.image?.urlList?.[0]
    ]);
}

function buildCommentFeedEmoteItems(data) {
    const emoteSource = Array.isArray(data?.emotes)
        ? data.emotes
        : (Array.isArray(data?.emoteList) ? data.emoteList : []);

    return emoteSource
        .map((item) => {
            const emoteId = getCommentFeedEmoteId(item);
            const imageUrl = getCommentFeedEmoteImageUrl(item);

            if (!emoteId || !imageUrl) {
                return null;
            }

            return {
                emoteId,
                imageUrl,
                placeInComment: normalizeWholeNumber(item?.placeInComment) ?? null
            };
        })
        .filter(Boolean);
}

function extractObservedEmojiEntries(comment) {
    const source = typeof comment === 'string'
        ? comment.replace(/\[emote:[^\]]+\]/gu, ' ')
        : '';

    if (!source) {
        return [];
    }

    const segmenter = typeof Intl?.Segmenter === 'function'
        ? new Intl.Segmenter('ja', { granularity: 'grapheme' })
        : null;
    const graphemes = segmenter
        ? [...segmenter.segment(source)].map((item) => item.segment)
        : Array.from(source);

    return graphemes
        .filter((item) => /[\p{Extended_Pictographic}\p{Regional_Indicator}]|[0-9#*]\uFE0F?\u20E3/gu.test(item))
        .map((emoji) => ({ emoji, observedAt: Date.now() }));
}

function updateObservedCommentAssetCaches(commentEvent) {
    if (!commentEvent || typeof commentEvent !== 'object') {
        return;
    }

    const observedAt = Date.now();
    const nextEmotes = normalizeCommentObservedEmoteCatalog([
        ...(Array.isArray(commentEvent.emotes)
            ? commentEvent.emotes.map((item) => ({
                emoteId: item?.emoteId,
                imageUrl: item?.imageUrl,
                observedAt
            }))
            : []),
        ...getObservedCommentEmoteCatalog()
    ]);
    const nextEmojis = normalizeCommentObservedEmojiCatalog([
        ...extractObservedEmojiEntries(commentEvent.comment).map((item) => ({
            emoji: item.emoji,
            observedAt
        })),
        ...getObservedCommentEmojiCatalog()
    ]);

    setObservedCommentEmoteCatalog(nextEmotes);
    setObservedCommentEmojiCatalog(nextEmojis);
}

function buildCommentFeedTextWithInlineEmotes(comment, emotes) {
    const baseComment = typeof comment === 'string' ? comment : '';
    const normalizedEmotes = Array.isArray(emotes)
        ? emotes
            .map((item) => ({
                placeInComment: normalizeWholeNumber(item?.placeInComment) ?? null,
                token: buildCommentFeedEmoteToken(item)
            }))
            .filter((item) => item.token)
        : [];

    if (!normalizedEmotes.length) {
        return baseComment.trim();
    }

    const inlineEmotes = normalizedEmotes
        .filter((item) => item.placeInComment !== null)
        .sort((left, right) => left.placeInComment - right.placeInComment);
    const trailingEmotes = normalizedEmotes
        .filter((item) => item.placeInComment === null)
        .map((item) => item.token);

    let cursor = 0;
    let result = '';

    inlineEmotes.forEach((item) => {
        const safeIndex = Math.max(0, Math.min(baseComment.length, item.placeInComment));

        result += baseComment.slice(cursor, safeIndex);
        result += item.token;
        cursor = safeIndex;
    });

    result += baseComment.slice(cursor);

    if (trailingEmotes.length) {
        result += `${result ? ' ' : ''}${trailingEmotes.join(' ')}`;
    }

    return result.trim();
}

function buildCommentFeedEmoteText(data) {
    const inlineCommentText = buildCommentFeedTextWithInlineEmotes(data?.comment, data?.emotes);

    if (inlineCommentText) {
        return inlineCommentText;
    }

    const emoteList = Array.isArray(data?.emoteList)
        ? data.emoteList
        : (Array.isArray(data?.emotes) ? data.emotes : []);
    const tokens = emoteList
        .map((item) => buildCommentFeedEmoteToken(item))
        .filter(Boolean);

    return tokens.join(' ').trim();
}

function getCommentFeedDisplayText(data) {
    const emoteText = buildCommentFeedEmoteText(data);

    const directText = firstDefinedString([
        emoteText,
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

function createDefaultEffectTrigger() {
    return {
        id: `trigger-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        enabled: true,
        eventIds: [],
        eventPlayMode: 'sequential',
        giftName: '',
        minCoins: 0,
        commentMode: 'disabled',
        commentText: '',
        userIds: [],
        treatGiftComboAsSingle: true,
        userTargetMode: 'list',
        userIdToFileDir: ''
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
    if (url.startsWith('/video/') || url.startsWith('/sound/') || url.startsWith('/media/effects/')) {
        return url;
    }

    return '';
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
        mediaVolume
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

function normalizeEffectTriggerEventIds(value) {
    // 旧フォーマット (eventId: string) との後方互換
    const legacyId = normalizeEffectText(value?.eventId, 80);
    let ids;

    if (Array.isArray(value?.eventIds)) {
        ids = value.eventIds.map((id) => normalizeEffectText(id, 80)).filter(Boolean);
    } else if (legacyId) {
        ids = [legacyId];
    } else {
        ids = [];
    }

    return [...new Set(ids)];
}

function normalizeEffectTrigger(value) {
    const fallback = createDefaultEffectTrigger();
    const commentText = normalizeEffectText(value?.commentText, 160).toLowerCase();
    const commentMode = normalizeEffectTriggerCommentMode(value?.commentMode);
    const userTargetMode = String(value?.userTargetMode || '').trim() === 'file-map' ? 'file-map' : 'list';
    const rawPlayMode = String(value?.eventPlayMode || '').trim().toLowerCase();
    const eventPlayMode = rawPlayMode === 'random' ? 'random' : 'sequential';
    return {
        id: normalizeEffectId(value?.id, 'trigger'),
        name: normalizeEffectText(value?.name, 80),
        enabled: Boolean(value?.enabled),
        eventIds: normalizeEffectTriggerEventIds(value),
        eventPlayMode,
        giftName: normalizeEffectText(value?.giftName, 80).toLowerCase(),
        minCoins: normalizeWholeNumber(value?.minCoins) ?? 0,
        commentMode: commentMode === 'exact' && !commentText ? fallback.commentMode : commentMode,
        commentText,
        userIds: normalizeUserIdList(value?.userIds),
        treatGiftComboAsSingle: value?.treatGiftComboAsSingle !== false,
        userTargetMode,
        userIdToFileDir: userTargetMode === 'file-map' ? String(value?.userIdToFileDir || '').trim() : ''
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

function normalizeEffectMediaKind(value) {
    if (typeof value === 'string') {
        return value.toLowerCase() === 'video' ? 'video' : 'audio';
    }

    const mimeType = String(value?.mimetype || '').toLowerCase();
    return mimeType.startsWith('video/') ? 'video' : 'audio';
}

function getEffectMediaDirectory(kind = 'audio') {
    return normalizeEffectMediaKind(kind) === 'video'
        ? EFFECT_VIDEO_ROOT_DIRECTORY
        : EFFECT_SOUND_ROOT_DIRECTORY;
}

function buildEffectMediaUrl(kind, fileName) {
    const normalizedKind = normalizeEffectMediaKind(kind);
    const basePath = normalizedKind === 'video' ? '/video' : '/sound';
    return `${basePath}/${encodeURIComponent(fileName)}`;
}

function resolveEffectAssetFilePath(assetUrl) {
    if (!assetUrl) return null;
    try {
        const pathname = new URL(assetUrl, 'http://localhost').pathname;
        let dir, prefix;
        if (pathname.startsWith('/video/')) {
            dir = EFFECT_VIDEO_ROOT_DIRECTORY;
            prefix = '/video/';
        } else if (pathname.startsWith('/sound/')) {
            dir = EFFECT_SOUND_ROOT_DIRECTORY;
            prefix = '/sound/';
        } else {
            return null;
        }
        const filename = decodeURIComponent(pathname.slice(prefix.length));
        // パストラバーサル防止
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
            return null;
        }
        return path.join(dir, filename);
    } catch {
        return null;
    }
}

const USER_VIDEO_EXTENSIONS = ['mp4', 'vp9', 'mov'];
const USER_VIDEO_MIME_TYPES = { mp4: 'video/mp4', vp9: 'video/webm', mov: 'video/quicktime' };

function normalizeUserIdForFilename(value) {
    const normalized = normalizeBroadcasterId(value);
    if (!normalized) {
        return null;
    }

    const cleaned = normalized.replace(/[^a-zA-Z0-9._-]/g, '');
    return cleaned || null;
}

function findUserVideoFile(dirPath, userId) {
    const normalizedUserId = normalizeUserIdForFilename(userId);

    if (!normalizedUserId || !dirPath) {
        return null;
    }

    const resolvedDir = path.resolve(dirPath);

    for (const ext of USER_VIDEO_EXTENSIONS) {
        const filePath = path.join(resolvedDir, `${normalizedUserId}.${ext}`);
        const resolvedPath = path.resolve(filePath);

        if (resolvedPath !== resolvedDir && !resolvedPath.startsWith(resolvedDir + path.sep)) {
            continue;
        }

        try {
            const stat = fs.statSync(resolvedPath);

            if (stat.isFile()) {
                return { filePath: resolvedPath, ext };
            }
        } catch {
            // ファイルが存在しない場合は次の拡張子を試す
        }
    }

    return null;
}

function createEffectPlaybackPayload(effectEvent, trigger, sourceEvent) {
    const treatGiftComboAsSingle = trigger?.treatGiftComboAsSingle !== undefined
        ? trigger.treatGiftComboAsSingle !== false
        : effectEvent?.treatGiftComboAsSingle !== false;

    return {
        playbackId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        eventId: effectEvent.id,
        eventName: effectEvent.name,
        screen: effectEvent.screen,
        videoUrl: effectEvent.videoEnabled ? effectEvent.videoAssetUrl : '',
        audioUrl: effectEvent.audioEnabled ? effectEvent.audioAssetUrl : '',
        mediaVolume: effectEvent.mediaVolume,
        playbackCount: treatGiftComboAsSingle ? 1 : Math.max(1, Number(sourceEvent?.repeatCount || 1)),
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
    if (effectsGloballyPaused) return;
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
    const triggers = getEffectTriggers().filter((item) => item.enabled && item.eventIds.length > 0);
    let anyTriggered = false;

    triggers.forEach((trigger) => {
        if (!matchesEffectTrigger(trigger, context)) {
            return;
        }

        anyTriggered = true;

        // 再生するイベントを決定（順次 or ランダム）
        let targetEventIds;

        if (trigger.eventPlayMode === 'random') {
            const randomId = trigger.eventIds[Math.floor(Math.random() * trigger.eventIds.length)];
            targetEventIds = randomId ? [randomId] : [];
        } else {
            targetEventIds = trigger.eventIds;
        }

        targetEventIds.forEach((eventId) => {
            const effectEvent = eventById.get(eventId);

            if (!effectEvent) {
                return;
            }

            if (trigger.userTargetMode === 'file-map' && trigger.userIdToFileDir && context.userId) {
                const videoInfo = findUserVideoFile(trigger.userIdToFileDir, context.userId);

                if (!videoInfo) {
                    return;
                }

                const normalizedUserId = normalizeUserIdForFilename(context.userId);
                const payload = createEffectPlaybackPayload(effectEvent, trigger, sourceEvent);
                payload.videoUrl = effectEvent.videoEnabled
                    ? `/api/effects/user-video/${encodeURIComponent(trigger.id)}/${encodeURIComponent(normalizedUserId)}`
                    : '';
                if (!effectsGloballyPaused) {
                    io.emit('effects:playback', payload);
                }
            } else {
                emitEffectPlayback(effectEvent, trigger, sourceEvent);
            }
        });
    });

    return anyTriggered;
}

function tryRunEffectTriggersForGift(giftEvent) {
    return tryRunEffectTriggers({
        type: 'gift',
        giftName: normalizeEffectText(giftEvent?.giftName, 80).toLowerCase(),
        comment: '',
        totalGifts: normalizeWholeNumber(giftEvent?.totalGifts) ?? 0,
        userId: normalizeBroadcasterId(giftEvent?.uniqueId)
    }, giftEvent);
}

function tryRunEffectTriggersForComment(commentEvent) {
    if (commentEvent?.type !== 'chat' && commentEvent?.type !== 'emote') {
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
    invalidateCommentFeedCaches();
    return currentBroadcasterId;
}

function clearBroadcasterId() {
    currentBroadcasterId = null;
    setGlobalStateValue(BROADCASTER_ID_STATE_KEY, '', getTimestamp());
    invalidateCommentFeedCaches();
    return currentBroadcasterId;
}

function setTikTokConnectionState(status, message, options = {}) {
    const hasReasonCode = Object.prototype.hasOwnProperty.call(options, 'websocketReasonCode');
    const hasReasonLabel = Object.prototype.hasOwnProperty.call(options, 'websocketReasonLabel');
    const hasReasonDetail = Object.prototype.hasOwnProperty.call(options, 'websocketReasonDetail');
    const hasTransportMethod = Object.prototype.hasOwnProperty.call(options, 'transportMethod');
    const nextState = {
        status,
        message,
        transportMethod: hasTransportMethod ? options.transportMethod : 'unknown',
        websocketReasonCode: hasReasonCode ? options.websocketReasonCode : null,
        websocketReasonLabel: hasReasonLabel ? options.websocketReasonLabel : null,
        websocketReasonDetail: hasReasonDetail ? options.websocketReasonDetail : null,
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

function getTikTokErrorDetailText(error) {
    return [
        error?.message,
        error?.response?.statusText,
        error?.response?.data?.message,
        error?.response?.data?.error,
        error?.response?.data?.description,
        error?.cause?.message
    ].filter(Boolean).join('\n');
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
        feedback: getContributorsFeedbackSettings(),
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
        displayDayReference: getDisplayDayReference(),
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
    const selection = setDisplayDaySelection(dayKey, inferDisplayDayReference(dayKey));
    emitSnapshot(selection.dayKey);
    emitAdminDayUpdate(selection.dayKey);
    return selection;
}

function respondWithDisplayChange(res, dayKey, reference = inferDisplayDayReference(dayKey)) {
    const selection = setDisplayDaySelection(dayKey, reference);
    emitSnapshot(selection.dayKey);
    emitAdminDayUpdate(selection.dayKey);
    res.json({ ok: true, displayDayKey: selection.dayKey, displayDayReference: selection.reference });
}

let displayDayRolloverTimer = null;

function clearDisplayDayRolloverTimer() {
    if (displayDayRolloverTimer) {
        clearTimeout(displayDayRolloverTimer);
        displayDayRolloverTimer = null;
    }
}

function getMillisecondsUntilNextMidnight(now = new Date()) {
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    return Math.max(1, nextMidnight.getTime() - now.getTime());
}

function syncDisplayDayReference(options = {}) {
    const shouldEmit = options.emit === true;
    const reference = getDisplayDayReference();

    if (reference === 'fixed') {
        return null;
    }

    const storedDayKey = normalizeDayKey(getScopedStateValue(DISPLAY_STATE_KEY));
    const resolvedDayKey = resolveDisplayDayKey(reference, storedDayKey);

    if (storedDayKey === resolvedDayKey) {
        return null;
    }

    setScopedStateValue(DISPLAY_STATE_KEY, resolvedDayKey);

    if (shouldEmit) {
        emitSnapshot(resolvedDayKey);
        emitAdminDayUpdate(resolvedDayKey);
    }

    return resolvedDayKey;
}

function scheduleDisplayDayRolloverCheck() {
    clearDisplayDayRolloverTimer();
    displayDayRolloverTimer = setTimeout(() => {
        syncDisplayDayReference({ emit: true });
        scheduleDisplayDayRolloverCheck();
    }, getMillisecondsUntilNextMidnight());

    if (displayDayRolloverTimer && typeof displayDayRolloverTimer.unref === 'function') {
        displayDayRolloverTimer.unref();
    }
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

function getSingleGiftValue(gift) {
    const explicitDiamondCount = Number(gift?.diamondCount);
    if (Number.isFinite(explicitDiamondCount) && explicitDiamondCount > 0) {
        return explicitDiamondCount;
    }

    const repeatCount = Number(gift?.repeatCount || 1);
    const totalGifts = Number(gift?.totalGifts || 0);

    if (!Number.isFinite(totalGifts) || totalGifts <= 0) {
        return 0;
    }

    if (!Number.isFinite(repeatCount) || repeatCount <= 0) {
        return totalGifts;
    }

    return totalGifts / repeatCount;
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
        const currentAmount = getSingleGiftValue(gift);

        if (!topGift) {
            topGift = gift;
            topGiftAmount = currentAmount;
            return;
        }

        const previousAmount = getSingleGiftValue(topGift);

        if (currentAmount > previousAmount) {
            topGift = gift;
            topGiftAmount = currentAmount;
            return;
        }
    });

    const matchingTopSenders = topGift
        ? gifts
            .filter((gift) => {
                if (getSingleGiftValue(gift) !== topGiftAmount) {
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
            giftValue: topGiftAmount,
            totalGifts: Number(topGift.totalGifts || 0),
            repeatCount: Number(topGift.repeatCount || 1),
            timestamp: topGift.timestamp || '',
            senders: matchingTopSenders,
            latestSender: matchingTopSenders.at(-1) || topGift.nickname || topGift.uniqueId || ''
        } : null
    };
}

function buildTopGiftWidgetPayload(dayKey = getTodayDayKey()) {
    return {
        settings: {
            ...getWidgetTopGiftSettings(),
            appearance: getSharedWidgetTextAppearance(),
            feedback: getSharedWidgetFeedbackSettings()
        },
        snapshot: buildTopGiftSnapshot(dayKey)
    };
}

function buildLikeContributionWidgetPayload(notification = null) {
    return {
        settings: {
            ...getWidgetLikeContributionSettings(),
            appearance: getSharedWidgetTextAppearance(),
            feedback: getSharedWidgetFeedbackSettings()
        },
        notification: notification || null
    };
}

function buildLikeContributionTestNotification(settings = getWidgetLikeContributionSettings()) {
    const normalizedSettings = normalizeWidgetLikeContributionSettings(settings);

    return buildLikeContributionWidgetPayload({
        id: ['like-demo', Date.now()].join(':'),
        uniqueId: '__demo__:like-contribution',
        nickname: 'Tap Master',
        profilePictureUrl: '',
        title: normalizedSettings.title,
        likeCount: normalizedSettings.interval,
        totalLikeCount: normalizedSettings.interval * 25,
        milestoneCount: normalizedSettings.interval * 25,
        timestamp: getTimestamp()
    });
}

function buildLikeContributionNotifications(commentEvent, data, settings = getWidgetLikeContributionSettings()) {
    const normalizedSettings = normalizeWidgetLikeContributionSettings(settings);
    const interval = normalizeWholeNumber(normalizedSettings.interval) || DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS.interval;
    const actor = extractCommentFeedActor(data);
    const uniqueId = normalizeBroadcasterId(firstDefinedString([
        commentEvent?.uniqueId,
        actor.uniqueId
    ]));
    const displayName = normalizeEffectText(firstDefinedString([
        commentEvent?.nickname,
        actor.nickname,
        uniqueId,
        '視聴者'
    ]), 80) || uniqueId || '視聴者';
    const likeCount = Math.max(0, normalizeWholeNumber(data?.likeCount) || 0);

    if (!uniqueId || likeCount <= 0 || interval <= 0) {
        return [];
    }

    // 永続化ストアから当日分のユーザー累計を取得
    const dayKey = getTodayDayKey();
    const userTotalsState = getLikeContributionUserTotalsState();
    const todayMap = userTotalsState[dayKey] || {};
    const storedUserTotal = normalizeWholeNumber(todayMap[uniqueId]) ?? 0;

    // likeCount はこのイベントでこのユーザーが送ったタップ数。
    // totalLikeCount は配信全体の累積値なので per-user 計算には使わない。
    const tapIncrement = likeCount;
    const userTotal = storedUserTotal + tapIncrement;

    // 更新して永続化
    const nextState = { ...userTotalsState, [dayKey]: { ...todayMap, [uniqueId]: userTotal } };
    setLikeContributionUserTotalsState(nextState);

    if (userTotal <= 0) {
        return [];
    }

    const previousMilestoneIndex = Math.floor(storedUserTotal / interval);
    const currentMilestoneIndex = Math.floor(userTotal / interval);

    if (currentMilestoneIndex <= previousMilestoneIndex) {
        return [];
    }

    return Array.from({ length: currentMilestoneIndex - previousMilestoneIndex }, (_, index) => {
        const milestoneCount = (previousMilestoneIndex + index + 1) * interval;

        return {
            id: [
                uniqueId,
                milestoneCount,
                userTotal,
                data?.msgId || data?.eventId || Date.now()
            ].join(':'),
            uniqueId,
            nickname: displayName,
            profilePictureUrl: actor.image || '',
            title: normalizedSettings.title,
            likeCount,
            totalLikeCount: milestoneCount,
            milestoneCount,
            timestamp: getTimestamp()
        };
    });
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
    // ギフトカタログ取得用の一時接続では、メイン接続と同じ sessionid を流用しない。
    // 同一アカウントで 2 本目の認証セッションを張ると TikTok 側のリスクスコアが
    // 上がりやすく、宝箱（ギフト送付）系で「異常な取引が検出されました」が
    // 発生する原因になるため、認証情報・ポーリング・WS 昇格・署名プロバイダを
    // すべて剥がした「未認証で fetchAvailableGifts だけ叩く最小構成」にする。
    const {
        sessionId: _omitSessionId,
        ttTargetIdc: _omitTtTargetIdc,
        authenticateWs: _omitAuthenticateWs,
        enableWebsocketUpgrade: _omitEnableWs,
        enableRequestPolling: _omitEnablePolling,
        signedWebSocketProvider: _omitSignedWsProvider,
        ...baseOptions
    } = tiktokConnectionOptions;

    return {
        ...baseOptions,
        processInitialData: false,
        enableExtendedGiftInfo: false,
        enableWebsocketUpgrade: false,
        enableRequestPolling: false,
        authenticateWs: false,
        sessionId: undefined,
        ttTargetIdc: undefined,
        signedWebSocketProvider: undefined,
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

function insertCustomTestContributorForDay(dayKey, input = {}) {
    const requestedDayKey = normalizeDayKey(dayKey);

    if (!requestedDayKey) {
        throw new Error('dayKey is invalid');
    }

    if (!hasConfiguredBroadcasterId()) {
        throw new Error('配信ユーザーIDが未設定です。');
    }

    const uniqueId = typeof input.uniqueId === 'string' ? input.uniqueId.trim() : '';
    const nickname = normalizeNickname(input.nickname) || uniqueId;
    const profilePictureUrl = typeof input.profilePictureUrl === 'string' ? input.profilePictureUrl.trim() : '';
    const coins = normalizePositiveWholeNumber(input.coins);

    if (!uniqueId) {
        throw new Error('ユーザーIDを入力してください。');
    }

    if (!coins) {
        throw new Error('コイン数は 1 以上で入力してください。');
    }

    const currentGiftCount = dbStore.getAdminGiftEventsByDay(requestedDayKey, getBroadcasterId()).length;
    const event = createSyntheticGiftEvent(requestedDayKey, currentGiftCount, {
        uniqueId,
        nickname,
        giftId: '',
        giftName: 'テストコイン',
        repeatCount: 1,
        diamondCount: coins,
        giftPictureUrl: '',
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
        contributor: {
            uniqueId,
            nickname,
            image: profilePictureUrl,
            coins
        }
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
let autoReconnectEnabled = false;
let activeConnectPromise = null;
let tikTokConnectAttempts = 0;
let isShuttingDown = false;
let shutdownPromise = null;
let recentTikTokComments = [];

function normalizeTikTokCommentEvent(type, data) {
    const normalizedType = normalizeCommentFeedType(type);
    const actor = extractCommentFeedActor(data);
    const comment = buildCommentFeedMessage(normalizedType, data, actor);
    const receivedAt = Date.now();
    const sourceTimestamp = normalizeCommentEventSourceTimestamp(data?.createTime);

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
        emotes: buildCommentFeedEmoteItems(data),
        image: actor.image,
        timestamp: getTimestamp(),
        receivedAt,
        sourceTimestamp,
        dayKey: getTodayDayKey()
    };
}

function getRecentTikTokComments() {
    if (!Number.isFinite(COMMENT_DISPLAY_TTL_MS) || COMMENT_DISPLAY_TTL_MS <= 0) {
        return recentTikTokComments;
    }

    const now = Date.now();

    recentTikTokComments = recentTikTokComments.filter((commentEvent) => {
        const receivedAt = Number(commentEvent?.receivedAt);

        if (!Number.isFinite(receivedAt) || receivedAt <= 0) {
            return true;
        }

        return now - receivedAt < COMMENT_DISPLAY_TTL_MS;
    });

    return recentTikTokComments;
}

function createAdminCommentsPayload() {
    return {
        broadcasterId: getBroadcasterId(),
        comments: getRecentTikTokComments(),
        settings: getCommentFeedSettings(),
        observedEmotes: getObservedCommentEmoteCatalog(),
        observedEmojis: getObservedCommentEmojiCatalog(),
        commentTypes: getCommentFeedTypes(),
        updatedAt: getTimestamp()
    };
}

function emitAdminCommentsUpdate() {
    io.emit('admin_comments_updated', createAdminCommentsPayload());
}

function pushGiftJarHistoryEntries(payload, deltaRepeat) {
    const clamped = Math.min(Math.max(1, Number(deltaRepeat) || 1), 10);
    for (let i = 0; i < clamped; i++) {
        giftJarHistory.push({ ...payload, repeatCount: 1 });
    }
    while (giftJarHistory.length > GIFT_JAR_HISTORY_LIMIT) {
        giftJarHistory.shift();
    }
}

function emitGiftJarFromRawData(rawData, deltaRepeat) {
    const payload = {
        giftId: rawData.giftId ? String(rawData.giftId) : '',
        giftName: rawData.giftName || '',
        giftImage: (typeof rawData.giftPictureUrl === 'string' ? rawData.giftPictureUrl : '')
            || getTikTokGiftImageUrl(rawData) || '',
        diamondCount: Math.max(1, Number(rawData.diamondCount) || 1),
        repeatCount: deltaRepeat,
        uniqueId: rawData.uniqueId,
        nickname: rawData.nickname || rawData.uniqueId
    };
    pushGiftJarHistoryEntries(payload, deltaRepeat);
    io.emit('widgets:gift-jar:notify', payload);
}

function emitGiftJarFromNormalized(normalizedEvent, rawData, deltaRepeat) {
    const payload = {
        giftId: normalizedEvent.giftId || '',
        giftName: normalizedEvent.giftName || '',
        giftImage: normalizedEvent.giftImage || getTikTokGiftImageUrl(rawData) || '',
        diamondCount: getSingleGiftValue(normalizedEvent),
        repeatCount: deltaRepeat,
        uniqueId: normalizedEvent.uniqueId,
        nickname: normalizedEvent.nickname
    };
    pushGiftJarHistoryEntries(payload, deltaRepeat);
    io.emit('widgets:gift-jar:notify', payload);
}

const _wsLatencyLastLogAt = new Map();
function logWsEventLatency(eventType, data) {
    if (!WS_LATENCY_LOG_ENABLED) {
        return;
    }

    try {
        const minInterval = WS_LATENCY_LOG_MIN_INTERVAL_MS[eventType] || 0;
        if (minInterval > 0) {
            const now = Date.now();
            const last = _wsLatencyLastLogAt.get(eventType) || 0;
            if (now - last < minInterval) {
                return;
            }
            _wsLatencyLastLogAt.set(eventType, now);
        }

        const createValue = Number(data?.createTime);
        let ageMs = null;
        if (Number.isFinite(createValue) && createValue > 0) {
            const createMs = createValue < 1e12 ? createValue * 1000 : createValue;
            const diff = Date.now() - createMs;
            // ±60 秒を超えるズレは時計ズレ等の外れ値として扱い、表示はするがマーク付け
            ageMs = diff;
        }

        const uniqueId = data?.uniqueId ? String(data.uniqueId).slice(0, 32) : '';
        const repeatEnd = data?.repeatEnd === undefined ? '' : ` repeatEnd=${data.repeatEnd}`;
        const ageStr = ageMs === null
            ? 'age=?'
            : (Math.abs(ageMs) > 60_000 ? `age=${ageMs}ms(skew?)` : `age=${ageMs}ms`);
        console.log(`[wsLatency] ${eventType} ${ageStr} uniqueId=${uniqueId}${repeatEnd}`);
    } catch {
        // ignore
    }
}

function pushTikTokComment(commentEvent) {
    const activeComments = getRecentTikTokComments();
    recentTikTokComments = [commentEvent, ...activeComments].slice(0, LIVE_COMMENT_HISTORY_LIMIT);
    updateObservedCommentAssetCaches(commentEvent);
    emitAdminCommentsUpdate();
    emitCommentReadAloud(commentEvent);
}

// 1コメントごとの軽量デルタイベント。
// admin / quick-access 画面はこれを受けて追加描画し、100件全体の再描画を避ける。
function emitAdminCommentAppended(commentEvent) {
    if (!commentEvent) {
        return;
    }
    io.emit('admin_comments_appended', {
        broadcasterId: getBroadcasterId(),
        comment: commentEvent,
        updatedAt: getTimestamp()
    });
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

function scheduleReconnect(reason, errorDetail = null, overrideDelayMs = null, retryMessageOverride = null) {
    if (isShuttingDown || reconnectTimer || !hasConfiguredBroadcasterId()) {
        return;
    }

    if (!autoReconnectEnabled) {
        const isOfflineWait = reason === 'user_offline';
        const stateMessage = isOfflineWait
            ? '配信がオフラインです。接続ボタンを押して再試行できます。'
            : '接続が切れました。接続ボタンを押して再接続できます。';
        console.info(`ℹ️ Auto-reconnect disabled. Manual reconnect required (reason: ${reason}).`);
        setTikTokConnectionState(
            'error',
            stateMessage,
            {
                transportMethod: 'unknown',
                retryScheduled: false,
                retryReason: reason,
                websocketReasonCode: 'manual_reconnect',
                websocketReasonLabel: '手動接続が必要です。',
                websocketReasonDetail: stateMessage
            }
        );
        return;
    }

    // 配信がオフライン（配信前待機）の場合は短い間隔で再試行して開始を素早く検知する
    const isOfflineWait = reason === 'user_offline';
    const delayMs = overrideDelayMs ?? (isOfflineWait ? OFFLINE_RECONNECT_DELAY_MS : RECONNECT_DELAY_MS);

    const retryDetail = errorDetail
        ? `切断後の再接続待機中です。再接続が成功すると受信方式が更新されます。\n直前のエラー: ${errorDetail}`
        : isOfflineWait
            ? '配信開始を待機しています。配信が始まると自動的に接続します。'
            : '切断後の再接続待機中です。再接続が成功すると受信方式が更新されます。';

    const retryMessage = retryMessageOverride ?? (isOfflineWait
        ? `配信がオフラインです。${Math.round(delayMs / 1000)}秒後に再確認します。`
        : `TikTok接続が切れました。${Math.round(delayMs / 1000)}秒後に再接続します。`);

    setTikTokConnectionState(
        'retrying',
        retryMessage,
        {
            transportMethod: 'unknown',
            retryScheduled: true,
            retryReason: reason,
            retryDelayMs: delayMs,
            websocketReasonCode: 'reconnecting',
            websocketReasonLabel: isOfflineWait ? '配信開始を待機しています。' : '再接続を待機しています。',
            websocketReasonDetail: retryDetail
        }
    );
    console.warn(`⚠️ TikTok connection retry scheduled (${reason}) in ${delayMs}ms${errorDetail ? ` — ${errorDetail}` : ''}`);
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
    }, delayMs);
}

async function resetTikTokConnection() {
    recentTikTokComments = [];
    emitAdminCommentsUpdate();

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    activeConnectPromise = null;
    tikTokConnectAttempts = 0;

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

        stopCommentReadAloud();

        if (rawEventFlushTimer) {
            clearTimeout(rawEventFlushTimer);
            rawEventFlushTimer = null;
        }

        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        clearDisplayDayRolloverTimer();

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
    setTikTokConnectionState('idle', `@${savedBroadcasterId} への接続準備ができました。`, {
        transportMethod: 'unknown',
        websocketReasonCode: 'pending_connection',
        websocketReasonLabel: '接続前の待機状態です。',
        websocketReasonDetail: '接続が始まると、その配信で WebSocket が使えるかどうかを判定します。'
    });
    return savedBroadcasterId;
}

io.on('connection', (socket) => {
    const displayDayKey = getDisplayDayKey();
    emitOverlaySnapshot(socket, displayDayKey);
    socket.emit('admin_day_updated', createAdminDayPayload(displayDayKey));
    socket.emit('admin_comments_updated', createAdminCommentsPayload());
    if (giftJarHistory.length > 0) {
        socket.emit('widgets:gift-jar:history', giftJarHistory);
    }
    socket.emit('widgets:gift-jar:config', { ...giftJarConfig });
    socket.on('widgets:gift-jar:positions', (data) => {
        socket.broadcast.emit('widgets:gift-jar:positions', data);
    });
    if (pendingUpdateInfo) {
        socket.emit('app:update-ready', { version: pendingUpdateInfo.version });
    }
});

app.get('/user-coins', (req, res) => {
    if (!hasConfiguredBroadcasterId()) {
        return res.redirect('/setup');
    }

    return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'user-coins.html'));
});

app.get('/user-coins.html', (req, res) => {
    return res.redirect('/user-coins');
});

app.get('/admin', (req, res) => {
    return res.redirect('/');
});

app.get('/admin.html', (req, res) => {
    return res.redirect('/');
});

app.get('/api/update/status', (req, res) => {
    if (pendingUpdateInfo) {
        res.json({ available: true, version: pendingUpdateInfo.version });
    } else {
        res.json({ available: false });
    }
});

app.post('/api/update/install', (req, res) => {
    if (!pendingUpdateInfo) {
        return res.status(409).json({ error: 'no_pending_update' });
    }
    res.json({ ok: true });
    serverEvents.emit('install-update-requested');
});

app.get('/api/state', (req, res) => {
    res.json({
        displayDayKey: getDisplayDayKey(),
        broadcasterId: getBroadcasterId(),
        broadcasterIdConfigured: hasConfiguredBroadcasterId(),
        tiktokConnection: getTikTokConnectionState(),
        todayDayKey: getTodayDayKey(),
        yesterdayDayKey: getYesterdayDayKey(),
        isElectron: IS_ELECTRON,
        isPackagedElectron: IS_PACKAGED_ELECTRON,
        appVersion: APP_VERSION
    });
});

app.get('/api/comments/config', (req, res) => {
    res.json({
        settings: getCommentFeedSettings(),
        observedEmotes: getObservedCommentEmoteCatalog(),
        observedEmojis: getObservedCommentEmojiCatalog(),
        commentTypes: getCommentFeedTypes()
    });
});

app.get('/api/comments/read-aloud-voices', async (req, res) => {
    try {
        const forceRefresh = req.query?.refresh === '1';
        const voices = normalizeCommentReadAloudVoices(await Promise.resolve(commentReadAloudVoiceProvider({ forceRefresh })));
        res.json({ voices });
    } catch (error) {
        console.error('❌ Failed to load read aloud voices:', error);
        res.status(500).json({
            error: '読み上げ音声の取得に失敗しました。'
        });
    }
});

app.post('/api/comments/read-aloud-random-voices/reset', (req, res) => {
    const clearedCount = clearCommentReadAloudRandomVoiceAssignments();
    res.json({
        ok: true,
        clearedCount
    });
});

app.post('/api/comments/read-aloud-stop', (req, res) => {
    const payload = stopCommentReadAloud();
    res.json({
        ok: true,
        payload
    });
});

app.patch('/api/comments/config', (req, res) => {
    const previousSettings = getCommentFeedSettings();
    const settings = setCommentFeedSettings(req.body || {});

    if (previousSettings.readAloudEnabled && !settings.readAloudEnabled) {
        stopCommentReadAloud();
    }

    emitAdminCommentsUpdate();
    res.json({
        ok: true,
        settings,
        commentTypes: getCommentFeedTypes()
    });
});

app.post('/api/comments/read-aloud-test', (req, res) => {
    const payload = emitCommentReadAloudTest(req.body);
    res.json({
        ok: true,
        payload
    });
});

app.get('/api/effects/global-pause', (req, res) => {
    res.json({ paused: effectsGloballyPaused });
});

app.post('/api/effects/global-pause', (req, res) => {
    const paused = req.body?.paused === true;
    effectsGloballyPaused = paused;

    if (paused) {
        const stopPayload = { timestamp: getTimestamp() };
        io.emit('effects:playback:stop', stopPayload);
        io.emit('effects:tts:stop', stopPayload);
    }

    io.emit('effects:global-pause-changed', { paused: effectsGloballyPaused });
    res.json({ ok: true, paused: effectsGloballyPaused });
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
    const sharedWidgetFeedback = getSharedWidgetFeedbackSettings();

    res.json({
        broadcasterId: getBroadcasterId(),
        displayDayKey: getDisplayDayKey(),
        todayDayKey: getTodayDayKey(),
        giftJarWallEditorEnabled: GIFT_JAR_WALL_EDITOR_ENABLED,
        contributorsDisplayRangeMode: getContributorsDisplayRange(),
        liveSession: getContributorsSessionState(),
        widgetUrls: buildWidgetUrls(req),
        contributorsDisplayThreshold: getDisplayThreshold(),
        contributorsGoalCount: getDisplayGoalCount(),
        contributorsAvatarVisibility: getDisplayAvatarVisibility(),
        contributorsFontKey: getDisplayFontFamily(),
        contributorsColorTheme: getDisplayColorTheme(),
        contributorsStrokeWidth: getDisplayStrokeWidth(),
        contributorsFeedback: sharedWidgetFeedback,
        sharedWidgetFeedback,
        sharedWidgetAppearance,
        topGiftSettings: getWidgetTopGiftSettings(),
        likeContributionSettings: getWidgetLikeContributionSettings(),
        topGiftSnapshot: buildTopGiftSnapshot(getTodayDayKey()),
        goalGiftFontKey: sharedWidgetAppearance.fontKey,
        goalGiftTextStyleKey: sharedWidgetAppearance.textStyleKey,
        goalGiftStrokeWidth: sharedWidgetAppearance.strokeWidth,
        goalGiftNoteFontSize: getGoalGiftWidgetNoteFontSize(),
        goalGiftAchievementBadgeSize: getGoalGiftWidgetAchievementBadgeSize(),
        goalGiftAchievementBadgeStyle: getGoalGiftWidgetAchievementBadgeStyle(),
        goalGiftFeedback: sharedWidgetFeedback,
        goalGiftItems: buildGoalGiftProgressSnapshot(getTodayDayKey()).goals
    });
});

app.get('/api/widgets/top-gift/snapshot', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey) || getTodayDayKey();
    res.json(buildTopGiftWidgetPayload(requestedDayKey));
});

app.patch('/api/widgets/top-gift', (req, res) => {
    setWidgetTopGiftSettings(req.body || {});
    const payload = buildTopGiftWidgetPayload(getTodayDayKey());

    io.emit('widgets:top-gift:updated', payload);

    res.json({
        ok: true,
        ...payload
    });
});

app.get('/api/widgets/like-contribution/config', (req, res) => {
    res.json(buildLikeContributionWidgetPayload());
});

app.patch('/api/widgets/like-contribution', (req, res) => {
    const settings = setWidgetLikeContributionSettings(req.body || {});
    const payload = buildLikeContributionWidgetPayload();

    io.emit('widgets:like-contribution:config', payload);

    res.json({
        ok: true,
        settings,
        ...payload
    });
});

app.post('/api/widgets/like-contribution/test-notification', (req, res) => {
    const payload = buildLikeContributionTestNotification();

    io.emit('widgets:like-contribution:test-notification', payload);

    res.json({
        ok: true,
        ...payload
    });
});

app.get('/api/widgets/gift-jar/catalog', (req, res) => {
    const catalog = Array.isArray(cachedTikTokGiftCatalog?.gifts) ? cachedTikTokGiftCatalog.gifts : [];
    const gifts = catalog
        .filter((g) => g.imageUrl)
        .map((g) => ({ imageUrl: g.imageUrl, diamondCount: g.diamondCount, name: g.name || '' }));
    res.json({ gifts });
});

app.get('/api/widgets/gift-jar/config', (req, res) => {
    res.json({ ...giftJarConfig });
});

app.post('/api/widgets/gift-jar/config', (req, res) => {
    const {
        dropAboveJar,
        crushThreshold,
        sizeMultiplier,
        jarTheme,
        customProfileTheme,
        customProfile,
        clearCustomProfileTheme
    } = req.body || {};
    if (typeof dropAboveJar === 'number' && Number.isFinite(dropAboveJar)) {
        giftJarConfig.dropAboveJar = Math.max(0, Math.min(Math.round(dropAboveJar), 2000));
        dbStore.setGlobalStateValue('gift_jar_drop_above_jar', giftJarConfig.dropAboveJar, Date.now());
    }
    if (typeof crushThreshold === 'number' && Number.isFinite(crushThreshold)) {
        giftJarConfig.crushThreshold = Math.max(0, Math.min(Math.round(crushThreshold), 44999));
        dbStore.setGlobalStateValue('gift_jar_crush_threshold', giftJarConfig.crushThreshold, Date.now());
    }
    if (typeof sizeMultiplier === 'number' && Number.isFinite(sizeMultiplier)) {
        giftJarConfig.sizeMultiplier = Math.max(0.1, Math.min(sizeMultiplier, 5.0));
        dbStore.setGlobalStateValue('gift_jar_size_multiplier', giftJarConfig.sizeMultiplier, Date.now());
    }
    if (typeof jarTheme === 'string' && GIFT_JAR_THEMES.includes(jarTheme)) {
        giftJarConfig.jarTheme = jarTheme;
        dbStore.setGlobalStateValue('gift_jar_theme', giftJarConfig.jarTheme, Date.now());
    }
    if (typeof customProfileTheme === 'string' || typeof clearCustomProfileTheme === 'string') {
        if (!GIFT_JAR_WALL_EDITOR_ENABLED) {
            return res.status(403).json({ ok: false, error: 'gift jar wall editor is disabled in packaged builds' });
        }
        if (!isLoopbackRequest(req)) {
            return res.status(403).json({ ok: false, error: 'custom gift jar wall editing is only available from the local admin machine' });
        }
    }
    if (typeof customProfileTheme === 'string' && GIFT_JAR_THEMES.includes(customProfileTheme)) {
        const normalizedProfile = normalizeGiftJarProfile(customProfile);
        if (!normalizedProfile) {
            return res.status(400).json({ ok: false, error: 'invalid gift jar wall profile' });
        }
        giftJarConfig.customProfiles = {
            ...giftJarConfig.customProfiles,
            [customProfileTheme]: normalizedProfile
        };
        persistGiftJarCustomProfiles();
    }
    if (typeof clearCustomProfileTheme === 'string' && GIFT_JAR_THEMES.includes(clearCustomProfileTheme)) {
        if (giftJarConfig.customProfiles[clearCustomProfileTheme]) {
            delete giftJarConfig.customProfiles[clearCustomProfileTheme];
            persistGiftJarCustomProfiles();
        }
    }
    io.emit('widgets:gift-jar:config', { ...giftJarConfig });
    res.json({ ok: true, ...giftJarConfig });
});

app.post('/api/widgets/gift-jar/reset', (req, res) => {
    giftJarHistory.length = 0;
    io.emit('widgets:gift-jar:reset');
    res.json({ ok: true });
});

app.post('/api/widgets/gift-jar/test-single', (req, res) => {
    const catalog = Array.isArray(cachedTikTokGiftCatalog?.gifts) ? cachedTikTokGiftCatalog.gifts : [];
    const catalogWithImages = catalog.filter((g) => g.imageUrl);
    if (catalogWithImages.length === 0) {
        return res.status(503).json({ ok: false, reason: 'no_catalog' });
    }
    // Tier-weighted: pick a random tier then a random gift within it
    const TIERS = [
        { min: 1,    max: 1 },
        { min: 2,    max: 4 },
        { min: 5,    max: 14 },
        { min: 15,   max: 49 },
        { min: 50,   max: 199 },
        { min: 200,  max: 999 },
        { min: 1000, max: Infinity }
    ];
    const buckets = TIERS.map((t) => catalogWithImages.filter((g) => g.diamondCount >= t.min && g.diamondCount <= t.max));
    const nonEmpty = buckets.filter((b) => b.length > 0);
    const bucket = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
    const gift = bucket[Math.floor(Math.random() * bucket.length)];
    const payload = {
        giftId: gift.id,
        giftName: gift.name,
        giftImage: gift.imageUrl,
        diamondCount: gift.diamondCount,
        repeatCount: 1,
        uniqueId: '__test__',
        nickname: 'テスト'
    };
    giftJarHistory.push({ ...payload });
    while (giftJarHistory.length > GIFT_JAR_HISTORY_LIMIT) { giftJarHistory.shift(); }
    io.emit('widgets:gift-jar:notify', payload);
    res.json({ ok: true, giftName: gift.name, diamondCount: gift.diamondCount });
});

app.post('/api/widgets/gift-jar/test', (req, res) => {
    const catalog = Array.isArray(cachedTikTokGiftCatalog?.gifts) ? cachedTikTokGiftCatalog.gifts : [];
    const catalogWithImages = catalog.filter((g) => g.imageUrl);

    if (catalogWithImages.length > 0) {
        // Pick one random gift per tier (tier-weighted), up to 10 total
        const DEMO_TIERS = [
            { min: 1,    max: 1 },
            { min: 2,    max: 4 },
            { min: 5,    max: 14 },
            { min: 15,   max: 49 },
            { min: 50,   max: 199 },
            { min: 200,  max: 999 },
            { min: 1000, max: Infinity }
        ];
        const picks = [];
        for (const tier of DEMO_TIERS) {
            const bucket = catalogWithImages.filter((g) => g.diamondCount >= tier.min && g.diamondCount <= tier.max);
            if (bucket.length > 0) {
                const pick = bucket[Math.floor(Math.random() * bucket.length)];
                if (!picks.some((p) => p.id === pick.id)) picks.push(pick);
            }
        }

        picks.slice(0, 10).forEach((gift, index) => {
            setTimeout(() => {
                const payload = {
                    giftId: gift.id,
                    giftName: gift.name,
                    giftImage: gift.imageUrl,
                    diamondCount: gift.diamondCount,
                    repeatCount: 1,
                    uniqueId: '__demo__',
                    nickname: 'デモ'
                };
                giftJarHistory.push({ ...payload });
                while (giftJarHistory.length > GIFT_JAR_HISTORY_LIMIT) { giftJarHistory.shift(); }
                io.emit('widgets:gift-jar:notify', payload);
            }, index * 220);
        });

        return res.json({ ok: true, count: Math.min(picks.length, 10), source: 'catalog' });
    }

    // Fallback when no catalog is cached (not yet connected to TikTok)
    const DEMO_COINS = [1, 5, 1, 15, 1, 50, 1, 5, 200];
    const FALLBACK_IMAGE = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f59e0b"/>' +
        '<text y="44" x="32" text-anchor="middle" font-size="36" font-family="sans-serif">🎁</text></svg>'
    )}`;

    DEMO_COINS.forEach((diamondCount, index) => {
        setTimeout(() => {
            io.emit('widgets:gift-jar:notify', {
                giftId: `demo-${index}`,
                giftName: 'デモギフト',
                giftImage: FALLBACK_IMAGE,
                diamondCount,
                repeatCount: 1,
                uniqueId: '__demo__',
                nickname: 'デモ'
            });
        }, index * 180);
    });

    res.json({ ok: true, count: DEMO_COINS.length, source: 'fallback' });
});

app.get('/api/widgets/goal-gifts/snapshot', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey) || getTodayDayKey();
    res.json({
        snapshot: buildGoalGiftProgressSnapshot(requestedDayKey)
    });
});

app.post('/api/widgets/goal-gifts/test-feedback', (req, res) => {
    const requestedSlot = normalizeWholeNumber(req.body?.slot) || 1;
    const feedback = normalizeWidgetFeedbackSettings(req.body?.feedback || getGoalGiftFeedbackSettings());

    if (requestedSlot <= 0) {
        return res.status(400).json({ ok: false, error: 'slot must be a positive integer' });
    }

    io.emit('widgets:goal-gifts:test-feedback', {
        slot: requestedSlot,
        feedback,
        requestedAt: getTimestamp()
    });

    return res.json({
        ok: true,
        slot: requestedSlot,
        feedback
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
    const noteFontSize = req.body?.noteFontSize !== undefined
        ? setGoalGiftWidgetNoteFontSize(req.body.noteFontSize)
        : getGoalGiftWidgetNoteFontSize();
    const achievementBadgeSize = req.body?.achievementBadgeSize !== undefined
        ? setGoalGiftWidgetAchievementBadgeSize(req.body.achievementBadgeSize)
        : getGoalGiftWidgetAchievementBadgeSize();
    const achievementBadgeStyle = req.body?.achievementBadgeStyle !== undefined
        ? setGoalGiftWidgetAchievementBadgeStyle(req.body.achievementBadgeStyle)
        : getGoalGiftWidgetAchievementBadgeStyle();
    const feedback = req.body?.feedback !== undefined
        ? setGoalGiftFeedbackSettings(req.body.feedback)
        : getGoalGiftFeedbackSettings();
    const items = setGoalGiftWidgetItems(req.body.items);
    const snapshot = buildGoalGiftProgressSnapshot(getTodayDayKey(), items, fontKey, textStyleKey, strokeWidth, noteFontSize, achievementBadgeSize, achievementBadgeStyle);

    io.emit('widgets:goal-gifts:updated', {
        snapshot
    });

    res.json({
        ok: true,
        items: snapshot.goals,
        feedback,
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
    const feedback = req.body?.feedback !== undefined
        ? setContributorsFeedbackSettings(req.body.feedback)
        : getContributorsFeedbackSettings();

    emitDisplayThresholdChanges();

    io.emit('widgets:top-gift:updated', buildTopGiftWidgetPayload(getTodayDayKey()));
    io.emit('widgets:like-contribution:config', buildLikeContributionWidgetPayload());
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
        feedback,
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

    const oldEvents = getEffectEvents();
    const events = setEffectEvents(req.body.events);
    const eventIds = new Set(events.map((item) => item.id));
    const triggers = setEffectTriggers(req.body.triggers.map((item) => {
        // eventIds 内の存在しないイベントIDを除去（旧 eventId フォーマットも考慮）
        const normalizedEventIds = normalizeEffectTriggerEventIds(item).filter((id) => eventIds.has(id));
        return { ...item, eventIds: normalizedEventIds, eventId: undefined };
    }));

    // 旧イベントにあって新イベントに存在しない（または差し替えられた）アセットを削除
    const newAssetUrls = new Set();
    for (const ev of events) {
        if (ev.videoAssetUrl) newAssetUrls.add(ev.videoAssetUrl);
        if (ev.audioAssetUrl) newAssetUrls.add(ev.audioAssetUrl);
    }
    for (const oldEv of oldEvents) {
        for (const url of [oldEv.videoAssetUrl, oldEv.audioAssetUrl]) {
            if (url && !newAssetUrls.has(url)) {
                const filePath = resolveEffectAssetFilePath(url);
                if (filePath) {
                    fs.unlink(filePath, () => {});
                }
            }
        }
    }

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
        const kind = isVideo ? 'video' : 'audio';

        return res.json({
            ok: true,
            asset: {
                kind,
                name: req.file.originalname,
                url: buildEffectMediaUrl(kind, req.file.filename),
                mimeType: req.file.mimetype,
                size: req.file.size
            }
        });
    });
});

app.get('/api/effects/user-video/:triggerId/:userId', (req, res) => {
    const triggerId = String(req.params.triggerId || '');
    const userId = String(req.params.userId || '');

    const normalizedUserId = normalizeUserIdForFilename(userId);

    if (!normalizedUserId) {
        return res.status(400).end();
    }

    const triggers = getEffectTriggers();
    const trigger = triggers.find((t) => t.id === triggerId);

    if (!trigger || trigger.userTargetMode !== 'file-map' || !trigger.userIdToFileDir) {
        return res.status(404).end();
    }

    const videoInfo = findUserVideoFile(trigger.userIdToFileDir, normalizedUserId);

    if (!videoInfo) {
        return res.status(404).end();
    }

    const mimeType = USER_VIDEO_MIME_TYPES[videoInfo.ext] || 'video/mp4';

    res.setHeader('Content-Type', mimeType);
    return res.sendFile(videoInfo.filePath);
});

app.post('/api/electron/pick-directory', async (req, res) => {
    if (!IS_ELECTRON) {
        return res.status(400).json({ ok: false, error: 'Electron モードでのみ使用できます。' });
    }

    const dirPath = await new Promise((resolve) => {
        serverEvents.emit('pick-directory-request', resolve);
    });

    return res.json({ ok: true, dirPath: dirPath || null });
});

app.post('/api/broadcaster/set', async (req, res) => {
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({ error: 'This endpoint is available only from localhost.' });
    }

    const rawId = req.body?.broadcasterId;
    const normalized = normalizeBroadcasterId(rawId);

    if (!normalized) {
        return res.status(400).json({ ok: false, error: 'broadcasterId が不正です。' });
    }

    const savedId = await switchBroadcasterId(normalized);

    if (!savedId) {
        return res.status(500).json({ ok: false, error: '配信ユーザーIDの保存に失敗しました。' });
    }

    emitSnapshot(getDisplayDayKey());
    emitAdminDayUpdate(getDisplayDayKey());

    connectToTikTok().catch(() => {});

    res.json({ ok: true, broadcasterId: savedId });
});

app.post('/api/tiktok/connect', (req, res) => {
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({ error: 'This endpoint is available only from localhost.' });
    }

    if (!hasConfiguredBroadcasterId()) {
        return res.status(400).json({ ok: false, error: '配信ユーザーIDが設定されていません。' });
    }

    connectToTikTok().catch(() => {});
    res.json({ ok: true });
});

app.post('/api/tiktok/disconnect', async (req, res) => {
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({ error: 'This endpoint is available only from localhost.' });
    }

    await resetTikTokConnection();
    setTikTokConnectionState('idle', '手動切断しました。再接続するには接続ボタンを押してください。', {
        transportMethod: 'unknown',
        websocketReasonCode: 'manual_disconnect',
        websocketReasonLabel: '手動切断済みです。',
        websocketReasonDetail: 'ユーザーが手動で切断しました。'
    });
    res.json({ ok: true });
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
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - 30);
    const sinceDay = sinceDate.toISOString().slice(0, 10);
    const users = dbStore.getRecentGiftSenders(broadcasterId, sinceDay, 200);
    return res.json({ users });
});

app.get('/api/gifts', (req, res) => {
    const requestedDayKey = normalizeDayKey(req.query.dayKey) || getDisplayDayKey();
    const broadcasterId = getBroadcasterId();
    const confirmedGifts = dbStore.getAdminGiftEventsByDay(requestedDayKey, broadcasterId).map(hydrateStoredGiftEvent);

    // 今日のデータ表示中の場合、メモリ上のpendingギフト（repeatEnd前のコンボ）も含める
    const todayDayKey = getTodayDayKey();
    const pendingGifts = requestedDayKey === todayDayKey
        ? [...pendingGiftsByComboKey.values()].filter((pg) => pg.dayKey === requestedDayKey)
        : [];

    res.json({
        dayKey: requestedDayKey,
        gifts: [...pendingGifts, ...confirmedGifts]
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

app.post('/api/test-data/contributors/custom', (req, res) => {
    try {
        const result = insertCustomTestContributorForDay(req.body?.dayKey || getDisplayDayKey(), req.body || {});
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
    respondWithDisplayChange(res, getTodayDayKey(), 'today');
});

app.get('/display/yesterday', (req, res) => {
    respondWithDisplayChange(res, getYesterdayDayKey(), 'yesterday');
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
    // broadcasterId が保存済みであれば sessionid がなくても匿名 WS で即接続できる
    setTikTokConnectionState('idle', `@${getBroadcasterId()} への接続を準備しています。`, {
        transportMethod: 'unknown',
        websocketReasonCode: 'pending_connection',
        websocketReasonLabel: '接続開始を待機しています。',
        websocketReasonDetail: '起動直後のため、匿名 WebSocket 接続を準備しています。'
    });
} else {
    setTikTokConnectionState('not_configured', 'TikTok 配信ユーザーIDが未設定です。セットアップ画面で設定してください。', {
        transportMethod: 'unknown',
        websocketReasonCode: 'broadcaster_not_configured',
        websocketReasonLabel: '配信ユーザーIDは未確定です。',
        websocketReasonDetail: 'セットアップ画面で TikTok ユーザーIDを入力すると接続を開始します。'
    });
}

if (hasConfiguredBroadcasterId()) {
    setDisplayDaySelection(getDisplayDayKey(), getDisplayDayReference());
}

syncDisplayDayReference();
scheduleDisplayDayRolloverCheck();

// 接続オプションは常に匿名 WebSocket 固定。
// sessionid は Euler に渡さず、TikTok のリスクスコアに影響しない匿名視聴者接続として扱う。
// sessionid は broadcaster ID の自動取得（ログイン時のみ）にのみ使用する。
const tiktokConnectionOptions = {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
    enableExtendedGiftInfo: false,
    enableWebsocketUpgrade: true,
    enableRequestPolling: false,
    disableEulerFallbacks: true,
    requestPollingIntervalMs: 1000,
    sessionId: undefined,
    ttTargetIdc: undefined,
    authenticateWs: false,
    webClientParams: {
        ...TIKTOK_JA_LOCALE_CLIENT_PARAMS,
        device_id: PERSISTED_TIKTOK_DEVICE_ID
    },
    webClientHeaders: {
        ...TIKTOK_JA_LOCALE_HEADERS,
        'User-Agent': TIKTOK_DESKTOP_USER_AGENT
    },
    wsClientParams: {
        ...TIKTOK_JA_LOCALE_CLIENT_PARAMS,
        device_id: PERSISTED_TIKTOK_DEVICE_ID
    },
    wsClientHeaders: {
        ...TIKTOK_JA_LOCALE_HEADERS,
        'User-Agent': TIKTOK_DESKTOP_USER_AGENT
    },
    signedWebSocketProvider: IS_ELECTRON ? async (params) => {
        const webClient = new TikTokWebClient({
            customHeaders: {
                ...TIKTOK_JA_LOCALE_HEADERS
            },
            axiosOptions: {},
            clientParams: {
                ...TIKTOK_JA_LOCALE_CLIENT_PARAMS
            },
            authenticateWs: false
        });
        return webClient.fetchSignedWebSocketFromEuler(params);
    } : undefined
};

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
        // connect() の実行中は catch ブロックが処理を担う。
        if (activeConnectPromise) {
            return;
        }
        finishContributorsSession();
        emitSnapshot(getDisplayDayKey());
        emitAdminDayUpdate(getDisplayDayKey());
        scheduleReconnect('disconnected');
    });

    tiktokLiveConnection.on('streamEnd', () => {
        // connect() の実行中は catch ブロックが処理を担う。
        if (activeConnectPromise) {
            return;
        }
        finishContributorsSession();
        emitSnapshot(getDisplayDayKey());
        emitAdminDayUpdate(getDisplayDayKey());
        scheduleReconnect('stream_end');
    });

    tiktokLiveConnection.on('error', (err) => {
        // connect() の実行中は catch ブロックが処理を担う。
        // connect() 成功後のランタイムエラー（WebSocket切断等）のみここで処理する。
        if (activeConnectPromise) {
            return;
        }

        if (isTikTokUserOfflineError(err)) {
            // scheduleReconnect 内で 'retrying' 状態に遷移する。
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
        logWsEventLatency('gift', data);

        const isCombo = data.giftType === 1;
        // コンボ中の各イベントは同一ストリームでも data.createTime が変わることがあるため、
        // comboKey には含めない。uniqueId+giftId だけで同一ストリークを追跡する。
        // （createTime を含めると repeatEnd=false の pending エントリが
        //   repeatEnd=true で消えず、admin gift history に2行表示される。）
        const comboKey = isCombo
            ? [data.uniqueId || '', data.giftId || ''].join(':')
            : null;
        const currentRepeat = Math.max(1, Number(data.repeatCount) || 1);
        const previousPending = comboKey ? pendingGiftsByComboKey.get(comboKey) : null;
        const previousRepeat = previousPending ? Number(previousPending.repeatCount) || 0 : 0;
        // コンボ中は前回 emit 済み repeatCount との差分だけを gift-jar に流して、
        // repeatEnd 時に「もう 1 個飛んだ」ように見える二重表示を防ぐ。
        const deltaRepeat = isCombo
            ? Math.max(0, currentRepeat - previousRepeat)
            : currentRepeat;

        // コンボ中（giftType===1 && !repeatEnd）: 初投時だけトリガーを早期発動、
        // gift-jar には毎回 delta を即時 emit し、pending を最新 repeatCount に更新する。
        if (isCombo && !data.repeatEnd) {
            if (!activeComboTriggerMap.has(comboKey)) {
                if (activeComboTriggerMap.size >= ACTIVE_COMBO_TRIGGER_KEYS_MAX) {
                    // サイズ上限に達したら最初のエントリを削除
                    activeComboTriggerMap.delete(activeComboTriggerMap.keys().next().value);
                }
                const triggered = tryRunEffectTriggersForGift({
                    giftName: data.giftName || null,
                    totalGifts: (Number(data.diamondCount) || 0) * currentRepeat,
                    uniqueId: data.uniqueId
                });
                activeComboTriggerMap.set(comboKey, triggered);
            }

            if (deltaRepeat > 0) {
                emitGiftJarFromRawData(data, deltaRepeat);
            }

            // pending ギフトをメモリに登録してadmin gift historyを即座に更新
            pendingGiftsByComboKey.set(comboKey, {
                id: null,
                dayKey: getTodayDayKey(),
                uniqueId: data.uniqueId || '',
                nickname: data.nickname || data.uniqueId || '',
                image: data.profilePictureUrl || '',
                giftId: data.giftId ? String(data.giftId) : null,
                giftName: data.giftName || null,
                giftImage: typeof data.giftPictureUrl === 'string' ? data.giftPictureUrl : getTikTokGiftImageUrl(data) || '',
                totalGifts: (Number(data.diamondCount) || 0) * currentRepeat,
                repeatCount: currentRepeat,
                timestamp: previousPending ? previousPending.timestamp : getTimestamp(),
                isPending: true
            });
            emitAdminDayUpdate(getTodayDayKey());
            return;
        }

        const normalizedEvent = normalizeGiftEvent(data);

        if (!normalizedEvent) {
            return;
        }

        // コンボ終了時: 早期発動済みならトリガーをスキップ
        const alreadyTriggered = comboKey !== null && activeComboTriggerMap.get(comboKey) === true;
        const wasTrackedAsCombo = previousPending !== null && previousPending !== undefined;
        if (comboKey !== null) {
            activeComboTriggerMap.delete(comboKey);
            pendingGiftsByComboKey.delete(comboKey);
        }

        const duplicateSlots = getDuplicateUniqueGoalGiftSlots(normalizedEvent);

        // エフェクト発火は DB 書き込み（fsync）より先に行う。
        // storeRawGiftEvent は synchronous=FULL の fsync 待ちを伴うため、
        // これより後に発火するとプレビューボタン比で体感的な遅延が生じる。
        if (!alreadyTriggered) {
            tryRunEffectTriggersForGift(normalizedEvent);
        }

        const inserted = storeRawGiftEvent(normalizedEvent);

        if (!inserted) {
            return;
        }

        // gift-jar: コンボ中に既に delta を emit 済みなら、ここでは差分だけを流す。
        // 通常ギフト・新規コンボ完結（途中 emit 無し）ならフル repeatCount を流す。
        const jarRepeat = wasTrackedAsCombo
            ? deltaRepeat
            : (normalizedEvent.repeatCount || 1);
        if (jarRepeat > 0) {
            emitGiftJarFromNormalized(normalizedEvent, data, jarRepeat);
        }
        io.emit('widgets:top-gift:updated', buildTopGiftWidgetPayload(getTodayDayKey()));
        io.emit('widgets:goal-gifts:updated', {
            snapshot: buildGoalGiftProgressSnapshot(getTodayDayKey())
        });

        if (duplicateSlots.length) {
            io.emit('widgets:goal-gifts:duplicate-feedback', { slots: duplicateSlots });
        }

        scheduleRawEventFlush(0);
    });

    COMMENT_FEED_EVENT_DEFINITIONS.forEach(({ type }) => {
        tiktokLiveConnection.on(type, (data) => {
            logWsEventLatency(type, data);
            const normalizedComment = normalizeTikTokCommentEvent(type, data);

            if (!normalizedComment) {
                return;
            }

            let goalGiftCountsChanged = false;

            if (type === 'like') {
                consumeGoalGiftLikeActivityCount(data, getTodayDayKey());
                goalGiftCountsChanged = true;
            } else if (type === 'follow') {
                const previousCounts = getGoalGiftActivityCounts(getTodayDayKey());
                const nextCounts = consumeGoalGiftFollowActivityCount(data, getTodayDayKey());
                goalGiftCountsChanged = nextCounts.follow !== previousCounts.follow;
            }

            pushTikTokComment(normalizedComment);
            tryRunEffectTriggersForComment(normalizedComment);

            if (type === 'like') {
                const notifications = buildLikeContributionNotifications(normalizedComment, data);

                notifications.forEach((notification) => {
                    io.emit('widgets:like-contribution:notify', buildLikeContributionWidgetPayload(notification));
                });
            }

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

    // ペンディング中の自動再接続タイマーをキャンセルする。
    // タイマーが残ったまま connect() が成功しても、後続の「reconnectTimer が設定されている場合は
    // connected 状態への遷移をスキップする」ガードに引っかかり、接続済みにならない。
    // ※ タイマーコールバック自体が呼び出した場合は、コールバック冒頭で reconnectTimer = null
    //   を代入済みなので、ここでは何も起こらない（二重キャンセルにはならない）。
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    const broadcasterId = getBroadcasterId();

    if (!broadcasterId) {
        setTikTokConnectionState('not_configured', 'TikTok 配信ユーザーIDが未設定です。セットアップ画面で設定してください。', {
            transportMethod: 'unknown',
            websocketReasonCode: 'broadcaster_not_configured',
            websocketReasonLabel: '配信ユーザーIDは未確定です。',
            websocketReasonDetail: 'セットアップ画面で TikTok ユーザーIDを入力すると接続を開始します。'
        });
        return;
    }

    const connection = ensureTikTokConnection();
    if (tiktokLiveConnection === connection && activeTikTokUsername === broadcasterId && tiktokConnectionState.status === 'connected') {
        return connection;
    }

    tikTokConnectAttempts++;
    const isFirstConnectAttempt = tikTokConnectAttempts === 1;

    setTikTokConnectionState('connecting', `@${broadcasterId} に接続しています...`, {
        transportMethod: 'unknown',
        websocketReasonCode: 'connecting',
        websocketReasonLabel: '接続方式を確認中です。',
        websocketReasonDetail: 'WebSocket upgrade を試し、その結果に応じて request polling へフォールバックするかを判定しています。'
    });

    activeConnectPromise = (async () => {
        try {
            // キャッシュされたルームIDをクリアして毎回 fetchRoomId() を呼び直す。
            // TikTok は配信開始時に新しいルームIDを割り当てる場合があるため、
            // 古いルームIDを再利用すると配信開始を検知できなくなる。
            if (connection.clientParams) {
                connection.clientParams.room_id = '';
                connection.clientParams.cursor = '';
                connection.clientParams.internal_ext = '';
            }
            const state = await connection.connect();
        // v2.x は常に WebSocket で接続する（Electron では signedWebSocketProvider でも同様）
            // streamEnd / disconnected / error が connect() の処理中に非同期で発火した場合、
            // reconnectTimer が既に設定されている。その場合は connected 状態への遷移をスキップする。
            if (reconnectTimer) {
                console.warn(`⚠️ connect() resolved but reconnect is already scheduled. Skipping connected state for ${broadcasterId}.`);
                return state;
            }
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

            if (isTikTokUserOfflineError(err)) {
                // error イベントは activeConnectPromise ガードによりスキップ済みのため、
                // ここで reconnectTimer は未設定。直接スケジュールする。
                console.warn(`⚠️ TikTok broadcaster @${broadcasterId} is offline. Retrying in the background.`);
                scheduleReconnect('user_offline');
                return null;
            }

            if (isTikTokRecoverableRoomInfoError(err)) {
                // ページスクレイピングによるルームID取得失敗。配信中でも発生する一時的なエラー。
                // 初回は短い遅延で即リトライ、それ以降は通常の再接続間隔を使う。
                const delay = isFirstConnectAttempt ? FIRST_CONNECT_RETRY_DELAY_MS : RECONNECT_DELAY_MS;
                const msg = `接続に失敗しました。${Math.round(delay / 1000)}秒後に再試行します。`;
                console.warn('⚠️ TikTok room info fetch failed while connecting. Retrying.');
                scheduleReconnect('room_info_probe_failed', err?.exception?.message || err?.message || null, delay, msg);
                return null;
            }

            if (err?.name === 'NoWSUpgradeError') {
                setTikTokConnectionState(
                    'error',
                    'この配信は匿名 WebSocket 接続を受け付けていません。しばらく時間をおいてから再試行します。',
                    {
                        transportMethod: 'unknown',
                        websocketReasonCode: 'ws_upgrade_unavailable',
                        websocketReasonLabel: 'この配信は匿名 WebSocket に接続できません。',
                        websocketReasonDetail: 'TikTok 側が匿名の WebSocket upgrade を拒否しました。配信によっては一時的な制限の場合があります。自動再試行を待ちます。'
                    }
                );
                console.error('❌ TikTok connection failed: anonymous WebSocket upgrade was rejected.');
                scheduleReconnect('ws_upgrade_unavailable', err?.message);
                return null;
            }

            if (isFirstConnectAttempt) {
                // 最初の接続試行失敗は一時的なエラーの可能性が高い。
                // error イベントが先に発火して 30 秒タイマーが既にセットされていればキャンセルし、
                // 短い遅延（3 秒）で素早く再試行する。
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                console.error('❌ Connection Failed (first attempt, fast retry):', err);
                scheduleReconnect(
                    err?.name || 'connect_failed',
                    err?.message,
                    FIRST_CONNECT_RETRY_DELAY_MS,
                    `接続に失敗しました。${FIRST_CONNECT_RETRY_DELAY_MS / 1000}秒後に再試行します。`
                );
            } else {
                // error イベントが先に発火して 'retrying' 状態をセット済みの場合は上書きしない。
                if (!reconnectTimer) {
                    setTikTokConnectionState('error', 'TikTok接続に失敗しました。自動再接続を待機しています。', {
                        transportMethod: 'unknown',
                        websocketReasonCode: 'connect_failed',
                        websocketReasonLabel: 'WebSocket へ接続できませんでした。',
                        websocketReasonDetail: err?.message
                            ? `接続エラー: ${err.message}`
                            : '接続エラーの詳細はログを確認してください。'
                    });
                }
                console.error('❌ Connection Failed:', err);
                scheduleReconnect(err?.name || 'connect_failed', err?.message);
            }
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
        console.log(`ℹ️ Broadcaster ID is configured: @${getBroadcasterId()}. Use the connect button to connect.`);
    } else {
        setTikTokConnectionState('not_configured', 'TikTok 配信ユーザーIDが未設定です。セットアップ画面で設定してください。', {
            transportMethod: 'unknown',
            websocketReasonCode: 'broadcaster_not_configured',
            websocketReasonLabel: '配信ユーザーIDは未確定です。',
            websocketReasonDetail: 'セットアップ画面で TikTok ユーザーIDを入力すると接続を開始します。'
        });
        console.log('ℹ️ Broadcaster ID is not configured yet.');
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

function notifyUpdateReady(info) {
    pendingUpdateInfo = info || {};
    io.emit('app:update-ready', { version: pendingUpdateInfo.version || null });
}

module.exports = {
    serverEvents,
    notifyUpdateReady,
    setCommentReadAloudAudioProvider,
    setCommentReadAloudVoiceProvider,
    shutdownServer: () => {
        return shutdownApplication('electron_quit').catch((err) => {
            console.error('❌ Shutdown error:', err);
            throw err;
        });
    }
};