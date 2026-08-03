'use strict';

const { normalizeEffectText, normalizeWholeNumber, normalizeBroadcasterId, repairMojibakeFilename } = require('./utils');
const {
    EFFECT_SCREEN_COUNT,
    EFFECT_EVENTS_STATE_KEY,
    EFFECT_TRIGGERS_STATE_KEY,
    EFFECT_CATEGORIES_STATE_KEY,
    EFFECT_DEFAULT_CATEGORY_ID,
    EFFECT_DEFAULT_CATEGORY_NAME,
} = require('./constants');

// ── Module state ──────────────────────────────────────────────────────────────
let effectsGloballyPaused = false;

// ── Injected deps ─────────────────────────────────────────────────────────────
let _getScopedStateValue = null;
let _setScopedStateValue = null;
let _path = null;
let _effectVideoRootDirectory = null;
let _effectSoundRootDirectory = null;

function initEffectHelpers({ getScopedStateValue, setScopedStateValue, path, effectVideoRootDirectory, effectSoundRootDirectory }) {
    _getScopedStateValue = getScopedStateValue;
    _setScopedStateValue = setScopedStateValue;
    _path = path;
    _effectVideoRootDirectory = effectVideoRootDirectory;
    _effectSoundRootDirectory = effectSoundRootDirectory;
}

// ── Globally paused state ─────────────────────────────────────────────────────
function getEffectsGloballyPaused() { return effectsGloballyPaused; }
function setEffectsGloballyPaused(val) { effectsGloballyPaused = val; }

// ── Default factories ─────────────────────────────────────────────────────────
function createDefaultEffectEvent(slot = 1) {
    return {
        id: `event-${slot}`,
        name: `エフェクト ${slot}`,
        categoryId: EFFECT_DEFAULT_CATEGORY_ID,
        screen: slot,
        videoEnabled: false,
        videoAssetUrl: '',
        videoAssetName: '',
        audioEnabled: false,
        audioAssetUrl: '',
        audioAssetName: '',
        mediaVolume: 100,
        midiEnabled: false,
        midiDeviceName: '',
        midiMessageType: 'noteon',
        midiChannel: 1,
        midiData1: 60,
        midiData2: 127,
        vdjEffectEnabled: false,
        vdjCommand: ''
    };
}

function createDefaultEffectTrigger() {
    return {
        id: `trigger-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: '',
        categoryId: EFFECT_DEFAULT_CATEGORY_ID,
        enabled: true,
        eventIds: [],
        eventPlayMode: 'sequential',
        giftName: '',
        minCoins: 0,
        commentMode: 'disabled',
        commentText: '',
        userIds: [],
        treatGiftComboAsSingle: true,
        excludedFromListOverlay: false,
        listOverlayName: '',
        listOverlayBgColor: '',
        userTargetMode: 'list',
        userIdToFileDir: '',
        rapidFireEnabled: false,
        rapidFireCancelMs: 1500
    };
}

// ── Normalizers ───────────────────────────────────────────────────────────────
function normalizeEffectTriggerCommentMode(value) {
    const normalized = normalizeEffectText(value, 16).toLowerCase();
    return normalized === 'any' || normalized === 'exact' ? normalized : 'disabled';
}

const EFFECT_TRIGGER_LIST_OVERLAY_BG_COLORS = ['black', 'white', 'blue', 'green', 'yellow', 'purple', 'red'];

function normalizeEffectTriggerListOverlayBgColor(value) {
    const normalized = normalizeEffectText(value, 16).toLowerCase();
    return EFFECT_TRIGGER_LIST_OVERLAY_BG_COLORS.includes(normalized) ? normalized : '';
}

function normalizeEffectScreen(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= EFFECT_SCREEN_COUNT ? parsed : 1;
}

function normalizeEffectId(value, fallbackPrefix) {
    const normalized = normalizeEffectText(value, 60).replace(/[^a-zA-Z0-9_-]/g, '');
    return normalized || `${fallbackPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEffectCategoryId(value) {
    const normalized = normalizeEffectText(value, 60).replace(/[^a-zA-Z0-9_-]/g, '');
    return normalized || EFFECT_DEFAULT_CATEGORY_ID;
}

function normalizeAssetUrl(value) {
    const url = normalizeEffectText(value, 240);
    if (url.startsWith('/video/') || url.startsWith('/sound/') || url.startsWith('/media/effects/')) {
        return url;
    }

    return '';
}

// myinstants取り込み等で保存された { name, url } 形式のサウンドアセットを検証する。
// タイマーウィジェット・タップ目標ウィジェットなど、複数機能で共通利用する。
function normalizeSoundAsset(value) {
    if (!value || typeof value !== 'object') return { name: '', url: '' };
    return {
        name: normalizeEffectText(value.name, 120),
        url: normalizeAssetUrl(value.url),
    };
}

function normalizeUserIdList(value) {
    const values = Array.isArray(value)
        ? value
        : String(value || '').split(/[\s,\n\r]+/u);

    return [...new Set(values.map((item) => normalizeBroadcasterId(item)).filter(Boolean))];
}

function normalizeMidiMessageType(value) {
    const normalized = normalizeEffectText(value, 16).toLowerCase();
    return ['noteon', 'noteoff', 'noteonoff', 'cc', 'pc'].includes(normalized) ? normalized : 'noteon';
}

function normalizeMidiChannel(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 16 ? parsed : 1;
}

function normalizeMidiByte(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 127 ? parsed : fallback;
}

function normalizeVdjCommand(value) {
    return normalizeEffectText(value, 200);
}

function normalizeEffectTriggerRapidFireCancelMs(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 1500;
    return Math.max(100, Math.min(30000, parsed));
}

function normalizeEffectEvent(value, index) {
    const fallback = createDefaultEffectEvent(index + 1);
    const mediaVolume = Number.isFinite(Number(value?.mediaVolume))
        ? Math.max(0, Math.min(100, Math.round(Number(value.mediaVolume))))
        : fallback.mediaVolume;

    return {
        id: normalizeEffectId(value?.id, 'event'),
        name: normalizeEffectText(value?.name, 80) || fallback.name,
        categoryId: normalizeEffectCategoryId(value?.categoryId),
        screen: normalizeEffectScreen(value?.screen),
        videoEnabled: Boolean(value?.videoEnabled),
        videoAssetUrl: normalizeAssetUrl(value?.videoAssetUrl),
        videoAssetName: repairMojibakeFilename(normalizeEffectText(value?.videoAssetName, 160)),
        audioEnabled: Boolean(value?.audioEnabled),
        audioAssetUrl: normalizeAssetUrl(value?.audioAssetUrl),
        audioAssetName: repairMojibakeFilename(normalizeEffectText(value?.audioAssetName, 160)),
        mediaVolume,
        midiEnabled: Boolean(value?.midiEnabled),
        midiDeviceName: normalizeEffectText(value?.midiDeviceName, 160),
        midiMessageType: normalizeMidiMessageType(value?.midiMessageType),
        midiChannel: normalizeMidiChannel(value?.midiChannel),
        midiData1: normalizeMidiByte(value?.midiData1, fallback.midiData1),
        midiData2: normalizeMidiByte(value?.midiData2, fallback.midiData2),
        vdjEffectEnabled: Boolean(value?.vdjEffectEnabled),
        vdjCommand: normalizeVdjCommand(value?.vdjCommand)
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
        categoryId: normalizeEffectCategoryId(value?.categoryId),
        enabled: Boolean(value?.enabled),
        eventIds: normalizeEffectTriggerEventIds(value),
        eventPlayMode,
        giftName: normalizeEffectText(value?.giftName, 80).toLowerCase(),
        minCoins: normalizeWholeNumber(value?.minCoins) ?? 0,
        commentMode: commentMode === 'exact' && !commentText ? fallback.commentMode : commentMode,
        commentText,
        userIds: normalizeUserIdList(value?.userIds),
        treatGiftComboAsSingle: value?.treatGiftComboAsSingle !== false,
        excludedFromListOverlay: Boolean(value?.excludedFromListOverlay),
        listOverlayName: normalizeEffectText(value?.listOverlayName, 160),
        listOverlayBgColor: normalizeEffectTriggerListOverlayBgColor(value?.listOverlayBgColor),
        userTargetMode,
        userIdToFileDir: userTargetMode === 'file-map' ? String(value?.userIdToFileDir || '').trim() : '',
        rapidFireEnabled: Boolean(value?.rapidFireEnabled),
        rapidFireCancelMs: normalizeEffectTriggerRapidFireCancelMs(value?.rapidFireCancelMs)
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

// ── Category model ────────────────────────────────────────────────────────────
function createDefaultEffectCategory() {
    return { id: EFFECT_DEFAULT_CATEGORY_ID, name: EFFECT_DEFAULT_CATEGORY_NAME, enabled: true };
}

function normalizeEffectCategory(value) {
    return {
        id: normalizeEffectId(value?.id, 'category'),
        name: normalizeEffectText(value?.name, 60) || '無題のカテゴリ',
        enabled: value?.enabled !== false
    };
}

function normalizeEffectCategories(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    if (!Array.isArray(source)) {
        source = [];
    }

    return source.map((item) => normalizeEffectCategory(item));
}

function getEffectCategories() {
    const raw = _getScopedStateValue(EFFECT_CATEGORIES_STATE_KEY);

    // カテゴリが一度も保存されていない場合のみ「初期」カテゴリで初期化する
    // （既存イベント・トリガーの自動移行用）。ユーザーが明示的に全カテゴリを
    // 削除した後は空配列のまま保持し、勝手に復活させない。
    if (raw == null) {
        return [createDefaultEffectCategory()];
    }

    return normalizeEffectCategories(raw);
}

function setEffectCategories(categories) {
    const normalizedCategories = normalizeEffectCategories(categories);
    _setScopedStateValue(EFFECT_CATEGORIES_STATE_KEY, JSON.stringify(normalizedCategories));
    return normalizedCategories;
}

// ── State getters/setters ─────────────────────────────────────────────────────
function getEffectEvents() {
    return normalizeEffectEvents(_getScopedStateValue(EFFECT_EVENTS_STATE_KEY));
}

function setEffectEvents(events) {
    const normalizedEvents = normalizeEffectEvents(events);
    _setScopedStateValue(EFFECT_EVENTS_STATE_KEY, JSON.stringify(normalizedEvents));
    return normalizedEvents;
}

function getEffectTriggers() {
    return normalizeEffectTriggers(_getScopedStateValue(EFFECT_TRIGGERS_STATE_KEY));
}

function setEffectTriggers(triggers) {
    const normalizedTriggers = normalizeEffectTriggers(triggers);
    _setScopedStateValue(EFFECT_TRIGGERS_STATE_KEY, JSON.stringify(normalizedTriggers));
    return normalizedTriggers;
}

// ── Media helpers ─────────────────────────────────────────────────────────────
function normalizeEffectMediaKind(value) {
    if (typeof value === 'string') {
        return value.toLowerCase() === 'video' ? 'video' : 'audio';
    }

    const mimeType = String(value?.mimetype || '').toLowerCase();
    return mimeType.startsWith('video/') ? 'video' : 'audio';
}

function getEffectMediaDirectory(kind = 'audio') {
    return normalizeEffectMediaKind(kind) === 'video'
        ? _effectVideoRootDirectory
        : _effectSoundRootDirectory;
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
            dir = _effectVideoRootDirectory;
            prefix = '/video/';
        } else if (pathname.startsWith('/sound/')) {
            dir = _effectSoundRootDirectory;
            prefix = '/sound/';
        } else {
            return null;
        }
        const filename = decodeURIComponent(pathname.slice(prefix.length));
        if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
            return null;
        }
        return _path.join(dir, filename);
    } catch {
        return null;
    }
}

module.exports = {
    initEffectHelpers,
    getEffectsGloballyPaused,
    setEffectsGloballyPaused,
    createDefaultEffectEvent,
    createDefaultEffectTrigger,
    normalizeEffectTriggerCommentMode,
    normalizeEffectScreen,
    normalizeEffectId,
    normalizeEffectCategoryId,
    normalizeAssetUrl,
    normalizeSoundAsset,
    normalizeUserIdList,
    normalizeEffectEvent,
    normalizeEffectEvents,
    normalizeEffectTriggerEventIds,
    normalizeEffectTrigger,
    normalizeEffectTriggers,
    getEffectEvents,
    setEffectEvents,
    getEffectTriggers,
    setEffectTriggers,
    createDefaultEffectCategory,
    normalizeEffectCategory,
    normalizeEffectCategories,
    getEffectCategories,
    setEffectCategories,
    normalizeEffectMediaKind,
    getEffectMediaDirectory,
    buildEffectMediaUrl,
    resolveEffectAssetFilePath,
};
