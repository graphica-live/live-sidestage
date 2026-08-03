process.on('unhandledRejection', (reason) => {
    console.error('[CRASH] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[CRASH] uncaughtException:', err);
});

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
const tiktokState = require('./lib/tiktok-state');
const tikTokHelpers = require('./lib/tiktok-helpers');
const {
    setTikTokConnectionState,
    getTikTokConnectionState,
    buildTikTokOfflineMessage,
    isTikTokUserOfflineError,
    isTikTokAlreadyConnectedError,
    getTikTokErrorDetailText,
    isTikTokRecoverableRoomInfoError,
    scheduleReconnect,
    resetTikTokConnection,
    switchBroadcasterId,
} = tikTokHelpers;
const { firstDefinedString, normalizeBooleanInput, normalizeHexColor, normalizeEffectText, hasJapaneseText, normalizeWholeNumber, normalizeBroadcasterId } = require('./lib/utils');
const giftCatalogModule = require('./lib/tiktok-gift-catalog');
const {
    getTikTokGiftImageUrl,
    getTikTokGiftLocalizationInfo,
    buildObservedGiftNameMap,
    normalizeTikTokGiftCatalog,
    buildTikTokGiftCatalogConnectionOptions,
    fetchTikTokGiftCatalog,
} = giftCatalogModule;
const {
    createDefaultCommentFeedSettings,
    normalizeCommentReadAloudVoices,
    normalizeCommentFeedType,
    normalizeCommentReadAloudFilters,
    migrateCommentReadAloudFilters,
    normalizeCommentReadAloudTextReplacements,
    normalizeCommentReadAloudEmojiReplacements,
    normalizeCommentReadAloudEmoteKey,
    normalizeCommentReadAloudEmoteReplacements,
    normalizeCommentReadAloudVoiceMappings,
    normalizeCommentObservedEmoteCatalog,
    normalizeCommentObservedEmojiCatalog,
    normalizeCommentFeedSettings,
    getCommentFeedTypes,
} = require('./lib/comment-normalizers');
const commentFeedModule = require('./lib/comment-feed');
const effectHelpers = require('./lib/effect-helpers');
const {
    getEffectsGloballyPaused, setEffectsGloballyPaused,
    createDefaultEffectEvent, createDefaultEffectTrigger,
    normalizeEffectTriggerCommentMode, normalizeEffectScreen, normalizeEffectId,
    normalizeAssetUrl, normalizeUserIdList,
    normalizeEffectEvent, normalizeEffectEvents,
    normalizeEffectTriggerEventIds, normalizeEffectTrigger, normalizeEffectTriggers,
    getEffectEvents, setEffectEvents, getEffectTriggers, setEffectTriggers,
    getEffectCategories, setEffectCategories,
    normalizeEffectMediaKind, getEffectMediaDirectory, buildEffectMediaUrl, resolveEffectAssetFilePath,
} = effectHelpers;
const {
    setCommentReadAloudVoiceProvider,
    setCommentReadAloudAudioProvider,
    clearCommentReadAloudRandomVoiceAssignments,
    invalidateCommentFeedCaches,
    getCommentFeedSettings,
    setCommentFeedSettings,
    getObservedCommentEmoteCatalog,
    setObservedCommentEmoteCatalog,
    getObservedCommentEmojiCatalog,
    setObservedCommentEmojiCatalog,
    buildCommentReadAloudText,
    createCommentReadAloudPayload,
    createCommentReadAloudPlaybackPayload,
    emitCommentReadAloud,
    stopCommentReadAloud,
    emitCommentReadAloudTest,
    getCommentFeedTypeMeta,
    buildCommentFeedEmoteToken,
    getCommentFeedEmoteId,
    getCommentFeedEmoteImageUrl,
    buildCommentFeedEmoteItems,
    buildCommentFeedTextWithInlineEmotes,
    buildCommentFeedEmoteText,
    getCommentFeedDisplayText,
    extractCommentFeedActor,
    buildCommentFeedMessage,
    updateObservedCommentAssetCaches,
    normalizeTikTokCommentEvent,
    getRecentTikTokComments,
    clearRecentTikTokComments,
    createAdminCommentsPayload,
    emitAdminCommentsUpdate,
    pushTikTokComment,
    emitAdminCommentAppended,
} = commentFeedModule;

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

const {
    TIME_ZONE,
    BROADCASTER_ID_STATE_KEY,
    DISPLAY_STATE_KEY,
    DISPLAY_DAY_REFERENCE_STATE_KEY,
    CONTRIBUTORS_DISPLAY_RANGE_STATE_KEY,
    CONTRIBUTORS_SESSION_STARTED_AT_STATE_KEY,
    CONTRIBUTORS_SESSION_ENDED_AT_STATE_KEY,
    DISPLAY_THRESHOLD_STATE_KEY,
    GOAL_COUNT_STATE_KEY,
    DISPLAY_AVATAR_VISIBILITY_STATE_KEY,
    DISPLAY_FONT_FAMILY_STATE_KEY,
    DISPLAY_COLOR_THEME_STATE_KEY,
    DISPLAY_STROKE_WIDTH_STATE_KEY,
    COMMENT_SETTINGS_STATE_KEY,
    COMMENT_OBSERVED_EMOTES_STATE_KEY,
    COMMENT_OBSERVED_EMOJIS_STATE_KEY,
    EFFECT_EVENTS_STATE_KEY,
    EFFECT_TRIGGERS_STATE_KEY,
    WIDGET_TOP_GIFT_SETTINGS_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_SETTINGS_STATE_KEY,
    WIDGET_GOAL_GIFTS_STATE_KEY,
    WIDGET_GOAL_GIFT_FEEDBACK_SETTINGS_STATE_KEY,
    CONTRIBUTORS_FEEDBACK_SETTINGS_STATE_KEY,
    SHARED_WIDGET_FEEDBACK_SETTINGS_STATE_KEY,
    WIDGET_GOAL_GIFTS_FONT_STATE_KEY,
    WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY,
    WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY,
    WIDGET_GOAL_GIFTS_NOTE_FONT_SIZE_STATE_KEY,
    WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_SIZE_STATE_KEY,
    WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_STYLE_STATE_KEY,
    WIDGET_GOAL_GIFTS_LAYOUT_STATE_KEY,
    WIDGET_GOAL_GIFTS_HEADING_TEXT_STATE_KEY,
    WIDGET_GOAL_GIFTS_HEADING_SCROLL_STATE_KEY,
    WIDGET_GOAL_GIFTS_HEADING_FONT_SIZE_STATE_KEY,
    WIDGET_GOAL_GIFT_ACTIVITY_COUNTS_STATE_KEY,
    WIDGET_GOAL_GIFT_LIKE_TOTALS_STATE_KEY,
    WIDGET_GOAL_GIFT_LIKE_UNIQUE_SEEN_STATE_KEY,
    WIDGET_GOAL_GIFT_FOLLOW_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_USER_TOTALS_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_USER_NICKNAMES_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_USER_AVATARS_STATE_KEY,
    WIDGET_TAP_LIST_SETTINGS_STATE_KEY,
    WIDGET_CONTRIBUTORS_FONT_STATE_KEY,
    WIDGET_CONTRIBUTORS_TEXT_STYLE_STATE_KEY,
    WIDGET_CONTRIBUTORS_STROKE_WIDTH_STATE_KEY,
    WIDGET_TOP_GIFT_FONT_STATE_KEY,
    WIDGET_TOP_GIFT_TEXT_STYLE_STATE_KEY,
    WIDGET_TOP_GIFT_STROKE_WIDTH_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_FONT_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_TEXT_STYLE_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_STROKE_WIDTH_STATE_KEY,
    WIDGET_TAP_LIST_FONT_STATE_KEY,
    WIDGET_TAP_LIST_TEXT_STYLE_STATE_KEY,
    WIDGET_TAP_LIST_STROKE_WIDTH_STATE_KEY,
    WIDGET_COIN_LIST_SETTINGS_STATE_KEY,
    WIDGET_COIN_LIST_FONT_STATE_KEY,
    WIDGET_COIN_LIST_TEXT_STYLE_STATE_KEY,
    WIDGET_COIN_LIST_STROKE_WIDTH_STATE_KEY,
    WIDGET_GIFT_JAR_FONT_STATE_KEY,
    WIDGET_GIFT_JAR_TEXT_STYLE_STATE_KEY,
    WIDGET_GIFT_JAR_STROKE_WIDTH_STATE_KEY,
    WIDGET_PUSH_PULL_FONT_STATE_KEY,
    WIDGET_PUSH_PULL_TEXT_STYLE_STATE_KEY,
    WIDGET_PUSH_PULL_STROKE_WIDTH_STATE_KEY,
    EXPORTABLE_SCOPED_SETTINGS_KEYS,
    EXPORTABLE_GLOBAL_SETTINGS_KEYS,
    EFFECT_SCREEN_COUNT,
    DEFAULT_DISPLAY_THRESHOLD,
    DEFAULT_GOAL_COUNT,
    DEFAULT_CONTRIBUTORS_DISPLAY_RANGE,
    DEFAULT_DISPLAY_SORT_ORDER,
    DEFAULT_DISPLAY_AVATAR_VISIBILITY,
    DEFAULT_DISPLAY_FONT_FAMILY,
    DEFAULT_DISPLAY_COLOR_THEME,
    DEFAULT_DISPLAY_STROKE_WIDTH,
    MAX_DISPLAY_STROKE_WIDTH,
    TIKTOK_GIFT_CACHE_TTL_MS,
    MAX_GOAL_GIFT_WIDGET_ITEMS,
    DEFAULT_WIDGET_TOP_GIFT_SETTINGS,
    DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS,
    ALLOWED_BALLOON_DESIGN_KEYS,
    ALLOWED_LIKE_CONTRIBUTION_FONT_KEYS,
    ALLOWED_LIKE_CONTRIBUTION_TEXT_STYLE_KEYS,
    DEFAULT_WIDGET_FEEDBACK_SETTINGS,
    DEFAULT_GOAL_GIFT_WIDGET_ITEM,
    DEFAULT_GOAL_GIFT_WIDGET_FONT_KEY,
    DEFAULT_GOAL_GIFT_WIDGET_TEXT_STYLE_KEY,
    DEFAULT_GOAL_GIFT_WIDGET_STROKE_WIDTH,
    MAX_GOAL_GIFT_WIDGET_STROKE_WIDTH,
    DEFAULT_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE,
    MIN_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE,
    MAX_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE,
    DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE,
    MIN_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE,
    MAX_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE,
    DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_STYLE,
    ALLOWED_GOAL_GIFT_ACHIEVEMENT_BADGE_STYLES,
    DEFAULT_GOAL_GIFT_WIDGET_LAYOUT,
    ALLOWED_GOAL_GIFT_WIDGET_LAYOUTS,
    DEFAULT_GOAL_GIFT_WIDGET_HEADING_TEXT,
    MAX_GOAL_GIFT_WIDGET_HEADING_TEXT_LENGTH,
    DEFAULT_GOAL_GIFT_WIDGET_HEADING_SCROLL,
    DEFAULT_GOAL_GIFT_WIDGET_HEADING_FONT_SIZE,
    MIN_GOAL_GIFT_WIDGET_HEADING_FONT_SIZE,
    MAX_GOAL_GIFT_WIDGET_HEADING_FONT_SIZE,
    GOAL_GIFT_SYSTEM_IDS,
    GOAL_GIFT_SYSTEM_LABELS,
    GOAL_GIFT_SYSTEM_IMAGE_DATA_URLS,
    TIKTOK_JA_LOCALE_CLIENT_PARAMS,
    TIKTOK_JA_LOCALE_HEADERS,
    TIKTOK_DESKTOP_USER_AGENT,
    RECONNECT_DELAY_MS,
    OFFLINE_RECONNECT_DELAY_MS,
    FIRST_CONNECT_RETRY_DELAY_MS,
    RAW_EVENT_BATCH_SIZE,
    RAW_EVENT_FLUSH_DELAY_MS,
    RAW_EVENT_RETRY_DELAY_MS,
    LIVE_COMMENT_HISTORY_LIMIT,
    WS_LATENCY_LOG_ENABLED,
    WS_LATENCY_LOG_MIN_INTERVAL_MS,
    COMMENT_DISPLAY_TTL_MS,
    COMMENT_READ_ALOUD_EFFECT_SCREEN,
    COMMENT_READ_ALOUD_MAX_AGE_MS,
    COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION,
    COMMENT_OBSERVED_EMOTE_CACHE_LIMIT,
    COMMENT_OBSERVED_EMOJI_CACHE_LIMIT,
    COMMENT_READ_ALOUD_DEFAULT_FILTERS,
    COMMENT_FEED_EVENT_DEFINITIONS,
    EFFECT_TRIGGER_FOLLOW_GIFT_NAME,
} = require('./lib/constants');
const IS_ELECTRON = Boolean(process.env.ELECTRON_RUN);
const serverEvents = new EventEmitter();
const ENV_TIKTOK_USERNAME = process.env.TIKTOK_USERNAME?.trim() || '';

const AUTO_OPEN_BROWSER = !IS_ELECTRON && normalizeBooleanEnv(process.env.AUTO_OPEN_BROWSER, process.platform === 'win32');
const APP_START_PATH = normalizeStartPath(process.env.APP_START_PATH);
const PUBLIC_DIRECTORY = path.join(BACKEND_ROOT, 'public');
const DB_STATIC_DIRECTORY = path.join(PUBLIC_DIRECTORY, 'db');
const EFFECT_MEDIA_ROOT_DIRECTORY = path.join(USER_DATA_DIRECTORY, 'effects-media');
const EFFECT_VIDEO_ROOT_DIRECTORY = path.join(EFFECT_MEDIA_ROOT_DIRECTORY, 'video');
const EFFECT_SOUND_ROOT_DIRECTORY = path.join(EFFECT_MEDIA_ROOT_DIRECTORY, 'sound');
// 旧バージョン互換: exe隣接ディレクトリに保存されていたファイルを引き続き配信する
const LEGACY_EFFECT_BASE_DIRECTORY = (IS_ELECTRON && !process.defaultApp && process.execPath)
    ? path.dirname(process.execPath)
    : APP_ROOT;
const LEGACY_VIDEO_ROOT_DIRECTORY = path.join(LEGACY_EFFECT_BASE_DIRECTORY, 'video');
const LEGACY_SOUND_ROOT_DIRECTORY = path.join(LEGACY_EFFECT_BASE_DIRECTORY, 'sound');

let currentBroadcasterId = null;
let pendingUpdateInfo = null;
function getPendingUpdateInfo() { return pendingUpdateInfo; }
function setPendingUpdateInfo(val) { pendingUpdateInfo = val; }
const IS_PACKAGED_ELECTRON = process.env.ELECTRON_APP_PACKAGED === '1';
const GIFT_JAR_WALL_EDITOR_ENABLED = !IS_PACKAGED_ELECTRON;
const ACTIVE_COMBO_TRIGGER_KEYS_MAX = 200;
// comboKey -> boolean (エフェクト発動済みかどうか)
const activeComboTriggerMap = new Map();
// comboKey -> pending gift object（repeatEnd 前の中間パケットをメモリに保持）
const pendingGiftsByComboKey = new Map();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: '*' }
});

tikTokHelpers.init({
    getBroadcasterId: () => getBroadcasterId(),
    emitAdminDayUpdate: (...args) => emitAdminDayUpdate(...args),
    getDisplayDayKey: () => getDisplayDayKey(),
    httpServer,
    connectToTikTok: (...args) => connectToTikTok(...args),
    hasConfiguredBroadcasterId: () => hasConfiguredBroadcasterId(),
    isShuttingDown: () => getIsShuttingDown(),
    getRecentTikTokComments: () => commentFeedModule.getRecentTikTokComments(),
    emitAdminCommentsUpdate: () => emitAdminCommentsUpdate(),
    finishContributorsSession: () => finishContributorsSession(),
    normalizeBroadcasterId: (v) => normalizeBroadcasterId(v),
    setBroadcasterId: (v) => setBroadcasterId(v),
});

effectHelpers.initEffectHelpers({
    getScopedStateValue,
    setScopedStateValue,
    path,
    effectVideoRootDirectory: EFFECT_VIDEO_ROOT_DIRECTORY,
    effectSoundRootDirectory: EFFECT_SOUND_ROOT_DIRECTORY,
});

commentFeedModule.initCommentFeed({
    io,
    serverEvents,
    getBroadcasterId,
    getScopedStateValue,
    setScopedStateValue,
    getEffectMediaDirectory,
    buildEffectMediaUrl,
    getTimestamp,
    getTodayDayKey,
    path,
    fs,
});

// keep-alive 接続を追跡して closeHttpServer で強制破棄できるようにする
const openSockets = new Set();
httpServer.on('connection', (socket) => {
    openSockets.add(socket);
    socket.once('close', () => openSockets.delete(socket));
});

const dbStore = createDbStore({
    appRoot: APP_ROOT,
    userDataDirectory: USER_DATA_DIRECTORY
});
const DB_PATH = dbStore.dbPath;

const {
    GIFT_JAR_HISTORY_LIMIT, CUSTOM_JAR_HISTORY_LIMIT, GIFT_JAR_THEMES,
    giftJarHistory, giftJarConfig, pushPullConfig, pushPullState, customJarConfig, customJarHistory,
    getGiftJarLastPositions, setGiftJarLastPositions, getCustomJarLastPositions, setCustomJarLastPositions,
    scheduleGiftJarHistoryPersist, scheduleGiftJarPositionsPersist,
    persistGiftJarCustomProfiles, persistCustomJarConfig, persistPushPullConfig, persistPushPullState,
    normalizeGiftJarProfile, normalizeGiftJarCustomProfiles,
    buildCustomJarPayload, saveCustomJarImageFile, deleteCustomJarImageFile,
    normalizePushPullGifts, buildPushPullSnapshot,
} = require('./lib/gift-jar-config-state')({ dbStore, PUBLIC_DIRECTORY, getPushPullWidgetTextAppearance: (...args) => getPushPullWidgetTextAppearance(...args) });

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


app.use(express.json({ limit: '20mb' }));

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

const { buildEffectOverlayHtml, escapeHtmlForOverlay } = require('./lib/effect-overlay-html')({ getDisplayFontFamilyCss });

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

function buildTriggerGiftsOverlayUrlBase(req) {
    const origin = getStudioCompatibleOrigin(req);
    const loaderOrigin = getLoaderOrigin(req);

    return {
        url: `${loaderOrigin}/overlays/trigger-gifts`,
        directUrl: `${origin}/overlays/trigger-gifts`
    };
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
        giftJarLoaderUrl: `${loaderOrigin}/overlays/gift-jar?slave=1`,
        tapListOverlayUrl: `${origin}/overlays/tap-list`,
        tapListLoaderUrl: `${loaderOrigin}/overlays/tap-list`,
        coinListOverlayUrl: `${origin}/overlays/coin-list`,
        coinListLoaderUrl: `${loaderOrigin}/overlays/coin-list`,
        pushPullOverlayUrl: `${origin}/overlays/push-pull`,
        pushPullLoaderUrl: `${loaderOrigin}/overlays/push-pull`,
        songBattleOverlayUrl: `${origin}/overlays/song-battle`,
        songBattleLoaderUrl: `${loaderOrigin}/overlays/song-battle`,
        tapGoalOverlayUrl: `${origin}/overlays/tap-goal`,
        tapGoalLoaderUrl: `${loaderOrigin}/overlays/tap-goal`,
        timerOverlayUrl: `${origin}/overlays/timer`,
        timerLoaderUrl: `${loaderOrigin}/overlays/timer`
    };
}

require('./lib/routes/pages')({
    app,
    express,
    DB_STATIC_DIRECTORY,
    PUBLIC_DIRECTORY,
    EFFECT_MEDIA_ROOT_DIRECTORY,
    EFFECT_VIDEO_ROOT_DIRECTORY,
    LEGACY_VIDEO_ROOT_DIRECTORY,
    EFFECT_SOUND_ROOT_DIRECTORY,
    LEGACY_SOUND_ROOT_DIRECTORY,
    EFFECT_SCREEN_COUNT,
    hasConfiguredBroadcasterId,
    sendContributorsOverlayHtml,
    getEffectEvents,
    createDefaultEffectEvent,
    buildEffectOverlayHtml,
});




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

function normalizePositiveHundreds(value) {
    const parsed = normalizeWholeNumber(value);
    return parsed !== null && parsed > 0 && parsed % 100 === 0 ? parsed : null;
}

function normalizeDisplayAvatarVisibility(value) {
    return value === 'hide' ? 'hide' : 'show';
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
    return new Promise((resolve) => {
        if (!httpServer.listening) {
            resolve();
            return;
        }

        // 既存の keep-alive 接続を強制破棄してから close する
        for (const socket of openSockets) {
            socket.destroy();
        }
        openSockets.clear();

        httpServer.close(() => resolve());
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


const {
    normalizeWidgetTopGiftSettings, getWidgetTopGiftSettings, setWidgetTopGiftSettings,
    normalizeWidgetLikeContributionSettings, getWidgetLikeContributionSettings, setWidgetLikeContributionSettings,
    normalizeWidgetFeedbackSettings,
    getSharedWidgetFeedbackSettings, setSharedWidgetFeedbackSettings,
    getContributorsFeedbackSettings, setContributorsFeedbackSettings,
    getGoalGiftFeedbackSettings, setGoalGiftFeedbackSettings,
    getSharedWidgetTextAppearance,
    getPerWidgetTextAppearance, setPerWidgetTextAppearance,
    getContributorsWidgetTextAppearance, setContributorsWidgetTextAppearance,
    getTopGiftWidgetTextAppearance, setTopGiftWidgetTextAppearance,
    getLikeContributionWidgetTextAppearance, setLikeContributionWidgetTextAppearance,
    getTapListWidgetTextAppearance, setTapListWidgetTextAppearance,
    getCoinListWidgetTextAppearance, setCoinListWidgetTextAppearance,
    getGiftJarWidgetTextAppearance, setGiftJarWidgetTextAppearance,
    getPushPullWidgetTextAppearance, setPushPullWidgetTextAppearance,
    getGoalGiftsWidgetTextAppearance, setGoalGiftsWidgetTextAppearance,
    getTapGoalWidgetTextAppearance, setTapGoalWidgetTextAppearance,
    getTimerWidgetTextAppearance, setTimerWidgetTextAppearance,
    normalizeSharedWidgetFontKey,
} = require('./lib/widget-settings-state')({
    getScopedStateValue: (...args) => getScopedStateValue(...args),
    setScopedStateValue: (...args) => setScopedStateValue(...args),
    getDisplayFontFamily: (...args) => getDisplayFontFamily(...args),
    getDisplayColorTheme: (...args) => getDisplayColorTheme(...args),
    getDisplayStrokeWidth: (...args) => getDisplayStrokeWidth(...args),
    normalizeDisplayColorTheme: (...args) => normalizeDisplayColorTheme(...args),
    normalizeDisplayStrokeWidth: (...args) => normalizeDisplayStrokeWidth(...args),
    normalizeGoalGiftFontKey: (...args) => normalizeGoalGiftFontKey(...args),
    pushPullConfig,
});

const {
    normalizeGoalGiftFontKey, getGoalGiftWidgetFontKey, setGoalGiftWidgetFontKey,
    normalizeGoalGiftTextStyleKey, getGoalGiftWidgetTextStyleKey, setGoalGiftWidgetTextStyleKey,
    normalizeGoalGiftStrokeWidth, getGoalGiftWidgetStrokeWidth, setGoalGiftWidgetStrokeWidth,
    normalizeGoalGiftNoteFontSize, getGoalGiftWidgetNoteFontSize, setGoalGiftWidgetNoteFontSize,
    getGoalGiftSystemTypeById, getGoalGiftSystemImageUrl,
    normalizeGoalGiftActivityCounts, getGoalGiftActivityCountsState, setGoalGiftActivityCountsState,
    getGoalGiftActivityCounts,
    normalizeGoalGiftLikeTotalsState, getGoalGiftLikeTotalsState, setGoalGiftLikeTotalsState,
    normalizeGoalGiftFollowState, getGoalGiftFollowState, setGoalGiftFollowState, getGoalGiftFollowActorKey,
    normalizeGoalGiftLikeUniqueSeen, getGoalGiftLikeUniqueSeen, setGoalGiftLikeUniqueSeen,
    incrementGoalGiftActivityCount, consumeGoalGiftLikeActivityCount, consumeGoalGiftFollowActivityCount,
    normalizeGoalGiftAchievementBadgeSize, getGoalGiftWidgetAchievementBadgeSize, setGoalGiftWidgetAchievementBadgeSize,
    normalizeGoalGiftAchievementBadgeStyle, getGoalGiftWidgetAchievementBadgeStyle, setGoalGiftWidgetAchievementBadgeStyle,
    normalizeGoalGiftLayout, getGoalGiftWidgetLayout, setGoalGiftWidgetLayout,
    normalizeGoalGiftHeadingText, getGoalGiftWidgetHeadingText, setGoalGiftWidgetHeadingText,
    normalizeGoalGiftHeadingScroll, getGoalGiftWidgetHeadingScroll, setGoalGiftWidgetHeadingScroll,
    normalizeGoalGiftHeadingFontSize, getGoalGiftWidgetHeadingFontSize, setGoalGiftWidgetHeadingFontSize,
    normalizeGoalGiftProgressRingColor, getGoalGiftWidgetProgressRingColor, setGoalGiftWidgetProgressRingColor,
    normalizeGoalGiftProgressBackgroundOpacity, getGoalGiftWidgetProgressBackgroundOpacity, setGoalGiftWidgetProgressBackgroundOpacity,
    normalizeGoalGiftWidgetItems, getGoalGiftWidgetItems,
    normalizeGoalGiftMatchName, getGoalGiftContributorKey,
    buildGoalGiftProgressSnapshot, getDuplicateUniqueGoalGiftSlots, setGoalGiftWidgetItems,
} = require('./lib/goal-gift-state')({
    dbStore,
    getScopedStateValue: (...args) => getScopedStateValue(...args),
    setScopedStateValue: (...args) => setScopedStateValue(...args),
    getTodayDayKey: (...args) => getTodayDayKey(...args),
    getBroadcasterId: (...args) => getBroadcasterId(...args),
    getContributorsSessionState: (...args) => getContributorsSessionState(...args),
    normalizeDayKey: (...args) => normalizeDayKey(...args),
    normalizeStoredTimestamp: (...args) => normalizeStoredTimestamp(...args),
    normalizeNickname: (...args) => normalizeNickname(...args),
    normalizeSignedWholeNumber: (...args) => normalizeSignedWholeNumber(...args),
    getGoalGiftFeedbackSettings, getGoalGiftsWidgetTextAppearance,
    hydrateStoredGiftEvent: (...args) => hydrateStoredGiftEvent(...args),
});

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


const {
    normalizeLikeContributionUserTotalsState,
    getLikeContributionUserTotalsState, setLikeContributionUserTotalsState,
    getLikeContributionUserNicknames, setLikeContributionUserNickname,
    getLikeContributionUserAvatars, setLikeContributionUserAvatar,
} = require('./lib/like-contribution-user-state')({
    getScopedStateValue: (...args) => getScopedStateValue(...args),
    setScopedStateValue: (...args) => setScopedStateValue(...args),
    getTodayDayKey: (...args) => getTodayDayKey(...args),
    normalizeDayKey: (...args) => normalizeDayKey(...args),
});
const {
    normalizeWidgetTapListSettings, getWidgetTapListSettings, setWidgetTapListSettings,
    normalizeWidgetCoinListSettings, getWidgetCoinListSettings, setWidgetCoinListSettings,
    buildTapListUserMap, buildTapListEntries, buildTapListPayload,
    buildCoinListEntries, buildCoinListPayload,
} = require('./lib/tap-coin-list-state')({
    dbStore,
    getBroadcasterId: (...args) => getBroadcasterId(...args),
    hasConfiguredBroadcasterId: (...args) => hasConfiguredBroadcasterId(...args),
    getScopedStateValue: (...args) => getScopedStateValue(...args),
    setScopedStateValue: (...args) => setScopedStateValue(...args),
    getTodayDayKey: (...args) => getTodayDayKey(...args),
    getTapListWidgetTextAppearance: (...args) => getTapListWidgetTextAppearance(...args),
    getCoinListWidgetTextAppearance: (...args) => getCoinListWidgetTextAppearance(...args),
    getLikeContributionUserAvatars, getLikeContributionUserNicknames, getLikeContributionUserTotalsState,
});

const {
    normalizeTapGoalSettings, getWidgetTapGoalSettings, setWidgetTapGoalSettings,
    getTapGoalProgress, setTapGoalProgress,
    addTapGoalTaps, resetTapGoalProgress,
    buildTapGoalPayload,
} = require('./lib/tap-goal-state')({
    getScopedStateValue: (...args) => getScopedStateValue(...args),
    setScopedStateValue: (...args) => setScopedStateValue(...args),
    getTapGoalWidgetTextAppearance: (...args) => getTapGoalWidgetTextAppearance(...args),
});

const {
    getTimerSettings, setTimerSettings, getTimerDurationMs,
    getTimerRuntime, setTimerRuntime, getTimerRemainingMs,
    startTimer, pauseTimer, resetTimer, adjustTimerByMinutes,
    applyTimerGiftEvent,
    emitTimerEndSound,
    emitTimerBlockSound,
    emitTimerCountdownSound,
    buildTimerPayload,
} = require('./lib/timer-state')({
    io,
    getScopedStateValue: (...args) => getScopedStateValue(...args),
    setScopedStateValue: (...args) => setScopedStateValue(...args),
    getTimerWidgetTextAppearance: (...args) => getTimerWidgetTextAppearance(...args),
});

const { closeAllMidiOutputs } = require('./lib/midi-helpers');

function setGlobalStateValue(stateKey, stateValue) {
    dbStore.setGlobalStateValue(stateKey, stateValue, getTimestamp());
    return stateValue;
}

function getGlobalStateValue(stateKey) {
    return dbStore.getGlobalStateValue(stateKey);
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

const vdjClient = require('./lib/vdj-client')({ getGlobalStateValue, setGlobalStateValue });
const { sendVdjEffectForEvent } = require('./lib/vdj-effects')({ vdjClient });
const songBattleRuntime = require('./lib/song-battle-runtime')({
    io,
    vdjClient,
    getScopedStateValue,
    setScopedStateValue,
    normalizeBroadcasterId,
    normalizeWholeNumber,
    fetchTikTokGiftCatalog,
    getLikeContributionUserAvatars,
    getLikeContributionUserNicknames,
});

const {
    createEffectPlaybackPayload,
    emitEffectPlayback,
    matchesEffectTrigger,
    speculativelyPreloadUserVideos,
    tryRunEffectTriggers,
    tryRunEffectTriggersForGift,
    tryRunEffectTriggersForGiftCombo,
    tryRunEffectTriggersForComment,
    findUserVideoFile,
    normalizeUserIdForFilename,
    USER_VIDEO_EXTENSIONS,
    USER_VIDEO_MIME_TYPES,
} = require('./lib/effects-runtime')({
    io,
    getEffectEvents,
    getEffectTriggers,
    getEffectCategories,
    getEffectsGloballyPaused,
    normalizeBroadcasterId,
    normalizeEffectText,
    normalizeWholeNumber,
    getTimestamp,
    sendVdjEffectForEvent,
    followTriggerGiftName: EFFECT_TRIGGER_FOLLOW_GIFT_NAME,
});

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
    const contributorsAppearance = getContributorsWidgetTextAppearance();

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
            fontFamily: contributorsAppearance.fontKey,
            colorTheme: contributorsAppearance.textStyleKey,
            strokeWidth: contributorsAppearance.strokeWidth
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

function getTriggerGiftsDailyCoinTotals(dayKey = getTodayDayKey()) {
    const requestedDayKey = normalizeDayKey(dayKey) || getTodayDayKey();
    const broadcasterId = getBroadcasterId();
    const totals = new Map();

    if (!broadcasterId) {
        return totals;
    }

    dbStore.getGiftCoinTotalsByDay(requestedDayKey, broadcasterId).forEach((row) => {
        totals.set(row.giftNameKey, Number(row.totalCoins) || 0);
    });

    return totals;
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
            appearance: getTopGiftWidgetTextAppearance(),
            feedback: getSharedWidgetFeedbackSettings()
        },
        snapshot: buildTopGiftSnapshot(dayKey)
    };
}

function buildLikeContributionWidgetPayload(notification = null) {
    return {
        settings: {
            ...getWidgetLikeContributionSettings(),
            appearance: getLikeContributionWidgetTextAppearance(),
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
    setLikeContributionUserNickname(uniqueId, displayName);
    if (actor.image) setLikeContributionUserAvatar(uniqueId, actor.image);

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
    io.emit('effects:trigger-gifts:updated', {});

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
function getAutoReconnectEnabled() { return tiktokState.autoReconnect; }
function setAutoReconnectEnabled(val) { tiktokState.autoReconnect = val; }
let isShuttingDown = false;
function getIsShuttingDown() { return isShuttingDown; }
let shutdownPromise = null;
function pushGiftJarHistoryEntries(payload, deltaRepeat) {
    const clamped = Math.min(Math.max(1, Number(deltaRepeat) || 1), 10);
    for (let i = 0; i < clamped; i++) {
        giftJarHistory.push({ ...payload, repeatCount: 1 });
    }
    while (giftJarHistory.length > GIFT_JAR_HISTORY_LIMIT) {
        giftJarHistory.shift();
    }
    scheduleGiftJarHistoryPersist();
}

function emitGiftJarFromRawData(rawData, deltaRepeat) {
    return; // 瓶詰め/オリジナル瓶詰めウィジェット非表示中につき処理停止（PC負荷軽減）
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
    io.to('gift-jar').emit('widgets:gift-jar:notify', payload);
    if (customJarConfig.activeThemeId) {
        customJarHistory.push({ ...payload, repeatCount: 1 });
        while (customJarHistory.length > CUSTOM_JAR_HISTORY_LIMIT) customJarHistory.shift();
        io.to('custom-jar').emit('widgets:custom-jar:notify', payload);
    }
}

function emitGiftJarFromNormalized(normalizedEvent, rawData, deltaRepeat) {
    return; // 瓶詰め/オリジナル瓶詰めウィジェット非表示中につき処理停止（PC負荷軽減）
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
    io.to('gift-jar').emit('widgets:gift-jar:notify', payload);
    if (customJarConfig.activeThemeId) {
        customJarHistory.push({ ...payload, repeatCount: 1 });
        while (customJarHistory.length > CUSTOM_JAR_HISTORY_LIMIT) customJarHistory.shift();
        io.to('custom-jar').emit('widgets:custom-jar:notify', payload);
    }
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

        if (tiktokState.reconnectTimer) {
            clearTimeout(tiktokState.reconnectTimer);
            tiktokState.reconnectTimer = null;
        }

        clearDisplayDayRolloverTimer();

        await resetTikTokConnection();

        // keep-alive 接続を先に破棄してから io.close() を呼ぶ
        // （io.close() は内部で httpServer.close() を呼ぶため、
        //   接続が残っていると io.close() が永遠に待ち続ける）
        for (const socket of openSockets) {
            socket.destroy();
        }
        openSockets.clear();

        io.disconnectSockets(true);
        await new Promise((resolve) => {
            io.close(() => resolve());
        });

        closeAllMidiOutputs();

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


require('./lib/socket-handlers')({
    io,
    getDisplayDayKey,
    emitOverlaySnapshot,
    createAdminDayPayload,
    createAdminCommentsPayload,
    giftJarHistory,
    giftJarConfig,
    getGiftJarLastPositions,
    setGiftJarLastPositions,
    scheduleGiftJarPositionsPersist,
    customJarHistory,
    getCustomJarLastPositions,
    setCustomJarLastPositions,
    buildCustomJarPayload,
    buildPushPullSnapshot,
    getPendingUpdateInfo,
});


require('./lib/routes/update')({ app, io, serverEvents, IS_PACKAGED_ELECTRON, getPendingUpdateInfo, setPendingUpdateInfo });

require('./lib/routes/state')({
    app,
    IS_ELECTRON, IS_PACKAGED_ELECTRON, APP_VERSION,
    getDisplayDayKey, getBroadcasterId, hasConfiguredBroadcasterId,
    getTikTokConnectionState, getTodayDayKey, getYesterdayDayKey,
    normalizeDayKey, respondWithDisplayChange,
});

require('./lib/routes/comments')({
    app,
    getCommentFeedSettings,
    getObservedCommentEmoteCatalog,
    getObservedCommentEmojiCatalog,
    getCommentFeedTypes,
    normalizeCommentReadAloudVoices,
    commentReadAloudVoiceProvider: commentFeedModule.callCommentReadAloudVoiceProvider,
    clearCommentReadAloudRandomVoiceAssignments,
    stopCommentReadAloud,
    setCommentFeedSettings,
    emitAdminCommentsUpdate,
    emitCommentReadAloudTest,
});

require('./lib/routes/effects')({
    app,
    io,
    getTimestamp,
    getTodayDayKey,
    getTriggerGiftsDailyCoinTotals,
    getEffectEvents,
    getEffectTriggers,
    buildEffectOverlayUrls,
    buildTriggerGiftsOverlayUrlBase,
    fetchTikTokGiftCatalog,
    getScopedStateValue: (...args) => getScopedStateValue(...args),
    setScopedStateValue: (...args) => setScopedStateValue(...args),
    normalizeSharedWidgetFontKey,
    normalizeDisplayColorTheme,
    normalizeDisplayStrokeWidth,
    normalizeEffectEvent,
    emitEffectPlayback,
    effectMediaUpload,
    buildEffectMediaUrl,
    normalizeUserIdForFilename,
    findUserVideoFile,
    USER_VIDEO_MIME_TYPES,
    getEffectsGloballyPaused,
    setEffectsGloballyPaused,
    setEffectEvents,
    setEffectTriggers,
    normalizeEffectTriggerEventIds,
    resolveEffectAssetFilePath,
    getEffectMediaDirectory,
    getEffectCategories,
    setEffectCategories,
    tryRunEffectTriggersForGift,
    tryRunEffectTriggersForGiftCombo,
    path,
    fs,
});

require('./lib/routes/widgets/config')({
    app,
    GIFT_JAR_WALL_EDITOR_ENABLED,
    getBroadcasterId, getDisplayDayKey, getTodayDayKey,
    getContributorsDisplayRange, getContributorsSessionState, buildWidgetUrls,
    getDisplayThreshold, getDisplayGoalCount, getDisplayAvatarVisibility,
    getSharedWidgetTextAppearance, getSharedWidgetFeedbackSettings,
    getContributorsWidgetTextAppearance,
    getWidgetTopGiftSettings, getTopGiftWidgetTextAppearance, buildTopGiftSnapshot,
    getWidgetLikeContributionSettings, getLikeContributionWidgetTextAppearance,
    getWidgetTapListSettings, getTapListWidgetTextAppearance,
    getWidgetCoinListSettings, getCoinListWidgetTextAppearance,
    getGiftJarWidgetTextAppearance, getPushPullWidgetTextAppearance,
    getGoalGiftsWidgetTextAppearance, getGoalGiftWidgetNoteFontSize,
    getGoalGiftWidgetAchievementBadgeSize, getGoalGiftWidgetAchievementBadgeStyle,
    getGoalGiftWidgetLayout,
    getGoalGiftWidgetHeadingText, getGoalGiftWidgetHeadingScroll,
    getGoalGiftWidgetHeadingFontSize,
    getGoalGiftWidgetProgressRingColor,
    getGoalGiftWidgetProgressBackgroundOpacity,
    buildGoalGiftProgressSnapshot,
    getWidgetTapGoalSettings, getTapGoalWidgetTextAppearance, buildTapGoalPayload,
    getTimerWidgetTextAppearance, buildTimerPayload,
});

require('./lib/routes/widgets/top-gift')({
    app, io, normalizeDayKey, getTodayDayKey,
    buildTopGiftWidgetPayload,
    setWidgetTopGiftSettings, setTopGiftWidgetTextAppearance,
});

require('./lib/routes/widgets/song-battle')({
    app, vdjClient, songBattleRuntime, buildWidgetUrls,
});

require('./lib/routes/widgets/like-contribution')({
    app, io,
    buildLikeContributionWidgetPayload,
    buildLikeContributionTestNotification,
    setWidgetLikeContributionSettings,
    setLikeContributionWidgetTextAppearance,
});

require('./lib/routes/widgets/tap-list')({
    app, io, getTodayDayKey,
    buildTapListPayload,
    setWidgetTapListSettings, setTapListWidgetTextAppearance,
    getLikeContributionUserTotalsState, setLikeContributionUserTotalsState,
});

require('./lib/routes/widgets/coin-list')({
    app, io,
    buildCoinListPayload,
    setWidgetCoinListSettings, setCoinListWidgetTextAppearance,
});

require('./lib/routes/widgets/gift-jar')({
    app, io, dbStore,
    cachedTikTokGiftCatalog: tiktokState.giftCatalog,
    giftJarConfig, giftJarHistory,
    getGiftJarLastPositions, setGiftJarLastPositions,
    customJarConfig, customJarHistory,
    getCustomJarLastPositions, setCustomJarLastPositions,
    GIFT_JAR_THEMES, GIFT_JAR_WALL_EDITOR_ENABLED,
    getGiftJarWidgetTextAppearance, setGiftJarWidgetTextAppearance,
    normalizeGiftJarProfile,
    persistGiftJarCustomProfiles, persistCustomJarConfig,
    saveCustomJarImageFile, deleteCustomJarImageFile,
    buildCustomJarPayload,
    isLoopbackRequest,
});








require('./lib/routes/widgets/push-pull')({
    app, io,
    pushPullConfig, pushPullState,
    buildPushPullSnapshot,
    normalizePushPullGifts,
    setPushPullWidgetTextAppearance,
    persistPushPullConfig, persistPushPullState,
});

require('./lib/routes/widgets/goal-gifts')({
    app, io,
    normalizeDayKey, getTodayDayKey, getTimestamp,
    normalizeWholeNumber, normalizeWidgetFeedbackSettings,
    buildGoalGiftProgressSnapshot,
    getGoalGiftFeedbackSettings, setGoalGiftFeedbackSettings,
    getGoalGiftsWidgetTextAppearance, setGoalGiftsWidgetTextAppearance,
    getGoalGiftWidgetNoteFontSize, setGoalGiftWidgetNoteFontSize,
    getGoalGiftWidgetAchievementBadgeSize, setGoalGiftWidgetAchievementBadgeSize,
    getGoalGiftWidgetAchievementBadgeStyle, setGoalGiftWidgetAchievementBadgeStyle,
    getGoalGiftWidgetLayout, setGoalGiftWidgetLayout,
    getGoalGiftWidgetHeadingText, setGoalGiftWidgetHeadingText,
    getGoalGiftWidgetHeadingScroll, setGoalGiftWidgetHeadingScroll,
    getGoalGiftWidgetHeadingFontSize, setGoalGiftWidgetHeadingFontSize,
    getGoalGiftWidgetProgressRingColor, setGoalGiftWidgetProgressRingColor,
    getGoalGiftWidgetProgressBackgroundOpacity, setGoalGiftWidgetProgressBackgroundOpacity,
    setGoalGiftWidgetItems,
});

require('./lib/routes/widgets/tap-goal')({
    app, io,
    buildTapGoalPayload,
    setWidgetTapGoalSettings, setTapGoalWidgetTextAppearance,
    addTapGoalTaps, resetTapGoalProgress,
    getLikeContributionUserAvatars, getLikeContributionUserNicknames,
});

require('./lib/routes/widgets/timer')({
    app, io,
    buildTimerPayload,
    setTimerSettings, setTimerWidgetTextAppearance,
    startTimer, pauseTimer, resetTimer, adjustTimerByMinutes,
    emitTimerEndSound, emitTimerBlockSound, emitTimerCountdownSound,
});

require('./lib/routes/widgets/contributors')({
    app,
    normalizePositiveHundreds, normalizeWholeNumber, normalizeDisplayAvatarVisibility,
    getDisplayThreshold, setDisplayThreshold,
    getDisplayGoalCount, setDisplayGoalCount,
    getDisplayAvatarVisibility, setDisplayAvatarVisibility,
    getContributorsFeedbackSettings, setContributorsFeedbackSettings,
    getContributorsWidgetTextAppearance, setContributorsWidgetTextAppearance,
    getContributorsDisplayRange, setContributorsDisplayRange,
    getContributorsSessionState,
    getDisplayDayKey,
    buildOverlayContributorsSnapshot,
    emitDisplayThresholdChanges,
    emitSnapshot, emitAdminDayUpdate,
});



require('./lib/routes/broadcaster')({
    app,
    IS_ELECTRON,
    serverEvents,
    isLoopbackRequest,
    normalizeBroadcasterId,
    switchBroadcasterId,
    emitSnapshot,
    emitAdminDayUpdate,
    getDisplayDayKey,
    getAutoReconnectEnabled,
    setAutoReconnectEnabled,
    connectToTikTok,
    hasConfiguredBroadcasterId,
    resetTikTokConnection,
    setTikTokConnectionState,
    shutdownApplication,
});

require('./lib/routes/data')({
    app,
    dbStore,
    pendingGiftsByComboKey,
    cachedTikTokGiftCatalog: tiktokState.giftCatalog,
    getAvailableDays,
    getDisplayDayKey,
    getBroadcasterId,
    hasConfiguredBroadcasterId,
    getTikTokConnectionState,
    getTodayDayKey,
    getYesterdayDayKey,
    normalizeDayKey,
    normalizeWholeNumber,
    normalizePositiveWholeNumber,
    normalizeNickname,
    getAdminContributorsForDay,
    hydrateStoredGiftEvent,
    buildOverlayContributorsSnapshot,
    insertTestGiftEventsForDay,
    insertCustomTestGiftEventForDay,
    insertCustomTestContributorForDay,
    fetchTikTokGiftCatalog,
    setContributorTotal,
    setContributorNickname,
    deleteGiftEvent,
    deleteContributor,
    resetContributorsForDay,
});



require('./lib/routes/settings')({ app, dbStore, io, getBroadcasterId, getScopedStateValue, setScopedStateValue, getTimestamp, IS_ELECTRON, IS_PACKAGED_ELECTRON });


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
    setDisplayDaySelection(getTodayDayKey(), 'today');
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

giftCatalogModule.initGiftCatalog({
    dbStore,
    getBroadcasterId,
    getConnectionOptions: () => tiktokConnectionOptions,
});

function ensureTikTokConnection() {
    const broadcasterId = getBroadcasterId();

    if (!broadcasterId) {
        return null;
    }

    if (tiktokState.liveConnection && tiktokState.activeUsername === broadcasterId) {
        return tiktokState.liveConnection;
    }

    clearRecentTikTokComments();
    emitAdminCommentsUpdate();

    tiktokState.liveConnection = new WebcastPushConnection(broadcasterId, tiktokConnectionOptions);
    tiktokState.activeUsername = broadcasterId;

    tiktokState.liveConnection.on('disconnected', () => {
        // connect() の実行中は catch ブロックが処理を担う。
        if (tiktokState.connectPromise) {
            return;
        }
        finishContributorsSession();
        emitSnapshot(getDisplayDayKey());
        emitAdminDayUpdate(getDisplayDayKey());
        scheduleReconnect('disconnected');
    });

    tiktokState.liveConnection.on('streamEnd', () => {
        // connect() の実行中は catch ブロックが処理を担う。
        if (tiktokState.connectPromise) {
            return;
        }
        finishContributorsSession();
        emitSnapshot(getDisplayDayKey());
        emitAdminDayUpdate(getDisplayDayKey());
        scheduleReconnect('stream_end');
    });

    tiktokState.liveConnection.on('error', (err) => {
        // connect() の実行中は catch ブロックが処理を担う。
        // connect() 成功後のランタイムエラー（WebSocket切断等）のみここで処理する。
        if (tiktokState.connectPromise) {
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

    tiktokState.liveConnection.on('gift', (data) => {
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

        // コンボ中（giftType===1 && !repeatEnd）: 「まとめ投げ=1回」トリガーは初回tickで早期発動、
        // 「まとめ投げ=分割」トリガーは毎tick deltaRepeat 分だけ発火（低遅延を維持しつつ回数を反映）。
        // gift-jar には毎回 delta を即時 emit し、pending を最新 repeatCount に更新する。
        if (isCombo && !data.repeatEnd) {
            const isFirstTick = !activeComboTriggerMap.has(comboKey);

            if (isFirstTick && activeComboTriggerMap.size >= ACTIVE_COMBO_TRIGGER_KEYS_MAX) {
                // サイズ上限に達したら最初のエントリを削除
                activeComboTriggerMap.delete(activeComboTriggerMap.keys().next().value);
            }

            tryRunEffectTriggersForGiftCombo({
                giftName: data.giftName || null,
                totalGifts: (Number(data.diamondCount) || 0) * currentRepeat,
                uniqueId: data.uniqueId
            }, { isFirstTick, deltaRepeat });
            activeComboTriggerMap.set(comboKey, true);

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

        // コンボ終了時: 「まとめ投げ=1回」トリガーは初回tickで発火済みなのでスキップ、
        // 「まとめ投げ=分割」トリガーは残り deltaRepeat 分を発火する。
        const wasTrackedAsCombo = previousPending !== null && previousPending !== undefined;
        if (comboKey !== null) {
            activeComboTriggerMap.delete(comboKey);
            pendingGiftsByComboKey.delete(comboKey);
        }

        const duplicateSlots = getDuplicateUniqueGoalGiftSlots(normalizedEvent);

        // エフェクト発火は DB 書き込み（fsync）より先に行う。
        // storeRawGiftEvent は synchronous=FULL の fsync 待ちを伴うため、
        // これより後に発火するとプレビューボタン比で体感的な遅延が生じる。
        if (wasTrackedAsCombo) {
            tryRunEffectTriggersForGiftCombo(normalizedEvent, { isFirstTick: false, deltaRepeat });
        } else {
            tryRunEffectTriggersForGift(normalizedEvent);
        }
        songBattleRuntime.registerVote(normalizedEvent);

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
        io.emit('widgets:coin-list:updated', buildCoinListPayload());
        io.emit('effects:trigger-gifts:updated', {});

        if (duplicateSlots.length) {
            io.emit('widgets:goal-gifts:duplicate-feedback', { slots: duplicateSlots });
        }

        // Push-pull: check if this gift matches a configured push or pull gift
        if (normalizedEvent.giftId) {
            const giftId = String(normalizedEvent.giftId);
            const repeatCount = normalizedEvent.repeatCount || 1;
            const pushMatch = pushPullConfig.pushGifts.find((g) => g.giftId === giftId);
            const pullMatch = !pushMatch && pushPullConfig.pullGifts.find((g) => g.giftId === giftId);
            if (pushMatch) {
                pushPullState.pushPoints += pushMatch.points * repeatCount;
                persistPushPullState();
                io.emit('widgets:push-pull:updated', buildPushPullSnapshot());
            } else if (pullMatch) {
                pushPullState.pullPoints += pullMatch.points * repeatCount;
                persistPushPullState();
                io.emit('widgets:push-pull:updated', buildPushPullSnapshot());
            }

            const timerMatch = applyTimerGiftEvent(giftId, repeatCount);
            if (timerMatch) {
                io.emit('widgets:timer:updated', buildTimerPayload());
                io.emit('widgets:timer:adjusted', {
                    minutesDelta: timerMatch.deltaMinutes,
                    giftName: timerMatch.slot.giftName,
                    blocked: timerMatch.blocked
                });
            }
        }

        scheduleRawEventFlush(0);
    });

    COMMENT_FEED_EVENT_DEFINITIONS.forEach(({ type }) => {
        tiktokState.liveConnection.on(type, (data) => {
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

                io.emit('widgets:tap-list:updated', buildTapListPayload());

                const tapAmount = normalizeWholeNumber(data?.likeCount) || 0;
                const tapActor = extractCommentFeedActor(data);

                const tapGoalResult = addTapGoalTaps(tapAmount);
                if (tapGoalResult.crossings > 0) {
                    const tapGoalSettings = getWidgetTapGoalSettings();
                    const reachedPayload = {};
                    if (tapGoalSettings.soundEnabled && tapGoalSettings.sound?.url) {
                        reachedPayload.url = tapGoalSettings.sound.url;
                        reachedPayload.volume = tapGoalSettings.soundVolume;
                    }
                    io.emit('widgets:tap-goal:reached', reachedPayload);
                }
                io.emit('widgets:tap-goal:updated', {
                    ...buildTapGoalPayload(),
                    actor: { nickname: tapActor.nickname, avatarUrl: tapActor.image },
                });
            }

            if (goalGiftCountsChanged) {
                io.emit('widgets:goal-gifts:updated', {
                    snapshot: buildGoalGiftProgressSnapshot(getTodayDayKey())
                });
            }
        });
    });

    return tiktokState.liveConnection;
}

async function connectToTikTok() {
    if (tiktokState.connectPromise) {
        return tiktokState.connectPromise;
    }

    // ペンディング中の自動再接続タイマーをキャンセルする。
    // タイマーが残ったまま connect() が成功しても、後続の「tiktokState.reconnectTimer が設定されている場合は
    // connected 状態への遷移をスキップする」ガードに引っかかり、接続済みにならない。
    // ※ タイマーコールバック自体が呼び出した場合は、コールバック冒頭で tiktokState.reconnectTimer = null
    //   を代入済みなので、ここでは何も起こらない（二重キャンセルにはならない）。
    if (tiktokState.reconnectTimer) {
        clearTimeout(tiktokState.reconnectTimer);
        tiktokState.reconnectTimer = null;
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
    if (tiktokState.liveConnection === connection && tiktokState.activeUsername === broadcasterId && tiktokState.connectionState.status === 'connected') {
        return connection;
    }

    tiktokState.connectAttempts++;
    const isFirstConnectAttempt = tiktokState.connectAttempts === 1;

    setTikTokConnectionState('connecting', `@${broadcasterId} に接続しています...`, {
        transportMethod: 'unknown',
        websocketReasonCode: 'connecting',
        websocketReasonLabel: '接続方式を確認中です。',
        websocketReasonDetail: 'WebSocket upgrade を試し、その結果に応じて request polling へフォールバックするかを判定しています。'
    });

    tiktokState.connectPromise = (async () => {
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
            // tiktokState.reconnectTimer が既に設定されている。その場合は connected 状態への遷移をスキップする。
            if (tiktokState.reconnectTimer) {
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
            setTikTokConnectionState('connected', `@${broadcasterId} に接続中です。`, connectedStateOptions);
            startContributorsSession();
            emitSnapshot(getDisplayDayKey());
            emitAdminDayUpdate(getDisplayDayKey());
            console.log(`✅ Connected to ${broadcasterId} via ${transport}`);
            return state;
        } catch (err) {
            if (isTikTokAlreadyConnectedError(err)) {
                setTikTokConnectionState('connected', `@${broadcasterId} に接続中です。`, {
                    transportMethod: 'websocket',
                    websocketReasonCode: 'websocket_active',
                    websocketReasonLabel: '現在は WebSocket で受信できています。',
                    websocketReasonDetail: '既存の WebSocket 接続を継続利用しています。'
                });
                return connection;
            }

            if (isTikTokUserOfflineError(err)) {
                // error イベントは tiktokState.connectPromise ガードによりスキップ済みのため、
                // ここで tiktokState.reconnectTimer は未設定。直接スケジュールする。
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
                if (tiktokState.reconnectTimer) {
                    clearTimeout(tiktokState.reconnectTimer);
                    tiktokState.reconnectTimer = null;
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
                if (!tiktokState.reconnectTimer) {
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
            tiktokState.connectPromise = null;
        }
    })();

    return tiktokState.connectPromise;
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
        tiktokState.autoReconnect = true;
        connectToTikTok().catch(() => {});
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
