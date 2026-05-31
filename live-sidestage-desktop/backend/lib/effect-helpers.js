'use strict';

const { normalizeEffectText, normalizeWholeNumber, normalizeBroadcasterId } = require('./utils');
const {
    EFFECT_SCREEN_COUNT,
    EFFECT_EVENTS_STATE_KEY,
    EFFECT_TRIGGERS_STATE_KEY,
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

// ── Normalizers ───────────────────────────────────────────────────────────────
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
    normalizeAssetUrl,
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
    normalizeEffectMediaKind,
    getEffectMediaDirectory,
    buildEffectMediaUrl,
    resolveEffectAssetFilePath,
};
