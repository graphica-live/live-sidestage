'use strict';

const { WIDGET_SHOGO_SETTINGS_STATE_KEY, WIDGET_SHOGO_TITLES_STATE_KEY, WIDGET_SHOGO_TRIGGER_GIFT_NAME } = require('./constants');
const { normalizeBroadcasterId, normalizeEffectText, normalizeBooleanInput } = require('./utils');

const DEFAULT_SHOGO_SETTINGS = {
    enabled: true,
    displaySeconds: 6,
};

// 称号バッジの選択肢。新規追加時はここに1件足すだけで管理画面のドロップダウンにも反映される。
const SHOGO_BADGE_LIBRARY = [
    { key: 'none', label: 'バッジなし', image: '' },
    { key: 'star', label: 'スター', image: '/widgets/badge.png' },
    { key: 'tiktok-universe', label: 'TikTok Universe', image: '/widgets/badge-tiktok-universe.webp' },
];
const SHOGO_BADGE_KEYS = new Set(SHOGO_BADGE_LIBRARY.map((badge) => badge.key));
const DEFAULT_SHOGO_BADGE_KEY = 'star';

function normalizeShogoBadgeKey(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return SHOGO_BADGE_KEYS.has(normalized) ? normalized : DEFAULT_SHOGO_BADGE_KEY;
}

function resolveShogoBadgeImage(badgeKey) {
    const badge = SHOGO_BADGE_LIBRARY.find((item) => item.key === normalizeShogoBadgeKey(badgeKey));
    return badge?.image || '';
}

function normalizeShogoDisplaySeconds(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return DEFAULT_SHOGO_SETTINGS.displaySeconds;
    }
    return Math.min(parsed, 30);
}

function normalizeShogoSettings(value) {
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
        enabled: normalizeBooleanInput(source.enabled, DEFAULT_SHOGO_SETTINGS.enabled),
        displaySeconds: normalizeShogoDisplaySeconds(source.displaySeconds),
    };
}

function normalizeShogoTitlesState(value) {
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

    Object.entries(source).forEach(([uid, entry]) => {
        const normalizedUid = normalizeBroadcasterId(uid);
        const title = normalizeEffectText(typeof entry === 'string' ? entry : entry?.title, 40);

        if (!normalizedUid || !title) {
            return;
        }

        normalized[normalizedUid] = {
            title,
            nickname: normalizeEffectText(typeof entry === 'string' ? '' : entry?.nickname, 80),
            image: normalizeEffectText(typeof entry === 'string' ? '' : entry?.image, 500),
            badgeKey: normalizeShogoBadgeKey(typeof entry === 'string' ? '' : entry?.badgeKey),
        };
    });

    return normalized;
}

// 称号ウィジェット: 視聴者が「ハートミー」を投げると、事前に管理画面で登録しておいた
// その人の称号（自由入力テキスト）を右からスライドインで表示する。称号未登録のユーザーは無視する。
module.exports = function createShogoState({
    io,
    getScopedStateValue,
    setScopedStateValue,
    getTimestamp,
}) {

    function getWidgetShogoSettings() {
        return normalizeShogoSettings(getScopedStateValue(WIDGET_SHOGO_SETTINGS_STATE_KEY));
    }

    function setWidgetShogoSettings(settings) {
        const normalized = normalizeShogoSettings(settings);
        setScopedStateValue(WIDGET_SHOGO_SETTINGS_STATE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    function getShogoTitles() {
        return normalizeShogoTitlesState(getScopedStateValue(WIDGET_SHOGO_TITLES_STATE_KEY));
    }

    function setShogoTitle({ uniqueId, title, nickname, image, badgeKey }) {
        const normalizedUid = normalizeBroadcasterId(uniqueId);
        const normalizedTitle = normalizeEffectText(title, 40);

        if (!normalizedUid || !normalizedTitle) {
            return null;
        }

        const current = getShogoTitles();
        current[normalizedUid] = {
            title: normalizedTitle,
            nickname: normalizeEffectText(nickname, 80),
            image: normalizeEffectText(image, 500),
            badgeKey: normalizeShogoBadgeKey(badgeKey),
        };
        setScopedStateValue(WIDGET_SHOGO_TITLES_STATE_KEY, JSON.stringify(current));
        return current[normalizedUid];
    }

    function deleteShogoTitle(uniqueId) {
        const normalizedUid = normalizeBroadcasterId(uniqueId);
        const current = getShogoTitles();

        if (!normalizedUid || !current[normalizedUid]) {
            return current;
        }

        delete current[normalizedUid];
        setScopedStateValue(WIDGET_SHOGO_TITLES_STATE_KEY, JSON.stringify(current));
        return current;
    }

    function buildShogoPayload() {
        return {
            settings: getWidgetShogoSettings(),
            titles: getShogoTitles(),
            badges: SHOGO_BADGE_LIBRARY,
        };
    }

    function emitShogoDisplay({ uniqueId, nickname, image, title, badgeImage, displaySeconds }) {
        io.emit('widgets:shogo:show', {
            uniqueId,
            nickname: nickname || uniqueId,
            image: image || '',
            title,
            badgeImage: badgeImage || '',
            displaySeconds,
            timestamp: getTimestamp(),
        });
    }

    // ギフト受信のたびに呼ぶ。「ハートミー」かつ、送り主に称号が登録されている場合のみ発火する。
    function maybeEmitShogoDisplay(giftEvent) {
        const settings = getWidgetShogoSettings();

        if (!settings.enabled) {
            return;
        }

        if (normalizeEffectText(giftEvent?.giftName, 80).toLowerCase() !== WIDGET_SHOGO_TRIGGER_GIFT_NAME) {
            return;
        }

        const normalizedUid = normalizeBroadcasterId(giftEvent?.uniqueId);

        if (!normalizedUid) {
            return;
        }

        const entry = getShogoTitles()[normalizedUid];

        if (!entry) {
            return;
        }

        emitShogoDisplay({
            uniqueId: normalizedUid,
            nickname: giftEvent?.nickname || entry.nickname || normalizedUid,
            image: giftEvent?.image || entry.image || '',
            title: entry.title,
            badgeImage: resolveShogoBadgeImage(entry.badgeKey),
            displaySeconds: settings.displaySeconds,
        });
    }

    function emitShogoTest() {
        const settings = getWidgetShogoSettings();
        emitShogoDisplay({
            uniqueId: '__preview__',
            nickname: 'テストリスナー',
            image: '',
            title: '常連さん',
            badgeImage: resolveShogoBadgeImage(DEFAULT_SHOGO_BADGE_KEY),
            displaySeconds: settings.displaySeconds,
        });
    }

    return {
        normalizeShogoSettings,
        getWidgetShogoSettings,
        setWidgetShogoSettings,
        getShogoTitles,
        setShogoTitle,
        deleteShogoTitle,
        buildShogoPayload,
        maybeEmitShogoDisplay,
        emitShogoTest,
    };
};
