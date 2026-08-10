'use strict';

const crypto = require('crypto');
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
    { key: 'monthly', label: '月間バッジ', image: '/widgets/monthly_badge.png' },
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

function normalizeShogoSize(value) {
    return String(value || '').trim().toLowerCase() === 'large' ? 'large' : 'small';
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

// 1ユーザーに複数の称号を登録できる。entries の並び順がそのままオーバーレイでの
// 上から下への表示順になる。旧バージョン（1ユーザー1称号のフラットな形）のデータは
// 読み込み時に自動的に entries 配列へ変換する。
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

    Object.entries(source).forEach(([uid, userData]) => {
        const normalizedUid = normalizeBroadcasterId(uid);

        if (!normalizedUid || !userData || typeof userData !== 'object') {
            return;
        }

        const isLegacyFlatEntry = typeof userData.title === 'string' && !Array.isArray(userData.entries);
        const rawEntries = isLegacyFlatEntry
            ? [{ id: `${normalizedUid}-legacy-0`, title: userData.title, badgeKey: userData.badgeKey, size: 'small' }]
            : (Array.isArray(userData.entries) ? userData.entries : []);

        const entries = rawEntries
            .map((entry, index) => {
                const title = normalizeEffectText(entry?.title, 40);

                if (!title) {
                    return null;
                }

                return {
                    id: normalizeEffectText(entry?.id, 60) || `${normalizedUid}-legacy-${index}`,
                    title,
                    badgeKey: normalizeShogoBadgeKey(entry?.badgeKey),
                    size: normalizeShogoSize(entry?.size),
                };
            })
            .filter(Boolean);

        // entries が0件でも「登録だけ済ませたユーザー」として保持する
        // （ユーザーID登録後、称号を1件も追加していない状態のため）。
        normalized[normalizedUid] = {
            nickname: normalizeEffectText(userData.nickname, 80),
            image: normalizeEffectText(userData.image, 500),
            entries,
        };
    });

    return normalized;
}

// 称号ウィジェット: 視聴者が「ハートミー」を投げると、事前に管理画面で登録しておいた
// その人の称号（複数可）を、登録順に上から下へスライドインで表示する。称号未登録のユーザーは無視する。
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

    function persistShogoTitles(titles) {
        setScopedStateValue(WIDGET_SHOGO_TITLES_STATE_KEY, JSON.stringify(titles));
        return titles;
    }

    // ユーザーIDだけを先に登録する（称号は0件のまま）。以降は一覧の「+ 称号追加」から
    // ユーザーIDを再入力せずに称号を追加していける。既に登録済みの場合はニックネーム・
    // アイコンだけ更新し、既存の称号には触れない。
    function registerShogoUser({ uniqueId, nickname, image }) {
        const normalizedUid = normalizeBroadcasterId(uniqueId);

        if (!normalizedUid) {
            return null;
        }

        const current = getShogoTitles();
        const existing = current[normalizedUid];

        current[normalizedUid] = existing
            ? {
                ...existing,
                nickname: normalizeEffectText(nickname, 80) || existing.nickname,
                image: normalizeEffectText(image, 500) || existing.image,
            }
            : {
                nickname: normalizeEffectText(nickname, 80),
                image: normalizeEffectText(image, 500),
                entries: [],
            };

        persistShogoTitles(current);
        return current[normalizedUid];
    }

    // 登録済みユーザーを称号ごと削除する（称号0件の状態でも削除できるようにするため、
    // 最後の称号を消すと自動で消える deleteShogoTitleEntry とは別に用意する）。
    function deleteShogoUser({ uniqueId }) {
        const normalizedUid = normalizeBroadcasterId(uniqueId);
        const current = getShogoTitles();

        if (normalizedUid && current[normalizedUid]) {
            delete current[normalizedUid];
            persistShogoTitles(current);
        }

        return current;
    }

    // 新規称号を1件追加する（既存の称号があっても追加され、複数称号になる）。
    function addShogoTitleEntry({ uniqueId, title, nickname, image, badgeKey, size }) {
        const normalizedUid = normalizeBroadcasterId(uniqueId);
        const normalizedTitle = normalizeEffectText(title, 40);

        if (!normalizedUid || !normalizedTitle) {
            return null;
        }

        const current = getShogoTitles();
        const userRecord = current[normalizedUid] || { nickname: '', image: '', entries: [] };

        const entry = {
            id: crypto.randomUUID(),
            title: normalizedTitle,
            badgeKey: normalizeShogoBadgeKey(badgeKey),
            size: normalizeShogoSize(size),
        };

        current[normalizedUid] = {
            nickname: normalizeEffectText(nickname, 80) || userRecord.nickname,
            image: normalizeEffectText(image, 500) || userRecord.image,
            entries: [...userRecord.entries, entry],
        };

        persistShogoTitles(current);
        return entry;
    }

    // 既存の称号エントリを更新する。title は空欄なら変更しない（誤って空文字を保存させないため）。
    function updateShogoTitleEntry({ uniqueId, entryId, title, badgeKey, size }) {
        const normalizedUid = normalizeBroadcasterId(uniqueId);
        const current = getShogoTitles();
        const userRecord = current[normalizedUid];

        if (!normalizedUid || !userRecord) {
            return null;
        }

        const normalizedTitle = title !== undefined ? normalizeEffectText(title, 40) : '';

        let updatedEntry = null;
        const entries = userRecord.entries.map((entry) => {
            if (entry.id !== entryId) {
                return entry;
            }
            updatedEntry = {
                ...entry,
                title: normalizedTitle || entry.title,
                badgeKey: badgeKey !== undefined ? normalizeShogoBadgeKey(badgeKey) : entry.badgeKey,
                size: size !== undefined ? normalizeShogoSize(size) : entry.size,
            };
            return updatedEntry;
        });

        if (!updatedEntry) {
            return null;
        }

        current[normalizedUid] = { ...userRecord, entries };
        persistShogoTitles(current);
        return updatedEntry;
    }

    function deleteShogoTitleEntry({ uniqueId, entryId }) {
        const normalizedUid = normalizeBroadcasterId(uniqueId);
        const current = getShogoTitles();
        const userRecord = current[normalizedUid];

        if (!normalizedUid || !userRecord) {
            return current;
        }

        const entries = userRecord.entries.filter((entry) => entry.id !== entryId);

        if (entries.length) {
            current[normalizedUid] = { ...userRecord, entries };
        } else {
            delete current[normalizedUid];
        }

        return persistShogoTitles(current);
    }

    // orderedEntryIds に従ってそのユーザーの称号表示順を並び替える。
    // 未知のIDは無視し、抜けているIDは元の相対順のまま末尾に残す。
    function reorderShogoTitleEntries({ uniqueId, orderedEntryIds }) {
        const normalizedUid = normalizeBroadcasterId(uniqueId);
        const current = getShogoTitles();
        const userRecord = current[normalizedUid];

        if (!normalizedUid || !userRecord || !Array.isArray(orderedEntryIds)) {
            return current;
        }

        const entryById = new Map(userRecord.entries.map((entry) => [entry.id, entry]));
        const reordered = [];

        orderedEntryIds.forEach((id) => {
            const entry = entryById.get(id);
            if (entry) {
                reordered.push(entry);
                entryById.delete(id);
            }
        });
        entryById.forEach((entry) => reordered.push(entry));

        current[normalizedUid] = { ...userRecord, entries: reordered };
        return persistShogoTitles(current);
    }

    function buildShogoPayload() {
        return {
            settings: getWidgetShogoSettings(),
            titles: getShogoTitles(),
            badges: SHOGO_BADGE_LIBRARY,
        };
    }

    function emitShogoDisplay({ uniqueId, nickname, image, entries, displaySeconds }) {
        io.emit('widgets:shogo:show', {
            uniqueId,
            nickname: nickname || uniqueId,
            image: image || '',
            entries,
            displaySeconds,
            timestamp: getTimestamp(),
        });
    }

    function buildEntriesForDisplay(userRecord) {
        return userRecord.entries.map((entry) => ({
            title: entry.title,
            badgeImage: resolveShogoBadgeImage(entry.badgeKey),
            size: entry.size,
        }));
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

        const userRecord = getShogoTitles()[normalizedUid];

        if (!userRecord || !userRecord.entries.length) {
            return;
        }

        emitShogoDisplay({
            uniqueId: normalizedUid,
            nickname: giftEvent?.nickname || userRecord.nickname || normalizedUid,
            image: giftEvent?.image || userRecord.image || '',
            entries: buildEntriesForDisplay(userRecord),
            displaySeconds: settings.displaySeconds,
        });
    }

    function emitShogoTest() {
        const settings = getWidgetShogoSettings();
        emitShogoDisplay({
            uniqueId: '__preview__',
            nickname: 'テストリスナー',
            image: '',
            entries: [
                { title: '常連さん', badgeImage: resolveShogoBadgeImage('star'), size: 'large' },
                { title: '古参', badgeImage: resolveShogoBadgeImage('tiktok-universe'), size: 'small' },
            ],
            displaySeconds: settings.displaySeconds,
        });
    }

    // 管理画面の「テスト再生」用: 実際にそのユーザーがハートミーを投げた時と同じ内容
    // （登録済みの全称号を登録順のまま）で表示する。ウィジェットの有効/無効設定に関わらず再生する。
    function emitShogoUserTest(uniqueId) {
        const normalizedUid = normalizeBroadcasterId(uniqueId);
        const userRecord = normalizedUid ? getShogoTitles()[normalizedUid] : null;

        if (!userRecord || !userRecord.entries.length) {
            return false;
        }

        const settings = getWidgetShogoSettings();
        emitShogoDisplay({
            uniqueId: normalizedUid,
            nickname: userRecord.nickname || normalizedUid,
            image: userRecord.image || '',
            entries: buildEntriesForDisplay(userRecord),
            displaySeconds: settings.displaySeconds,
        });
        return true;
    }

    return {
        normalizeShogoSettings,
        getWidgetShogoSettings,
        setWidgetShogoSettings,
        getShogoTitles,
        registerShogoUser,
        deleteShogoUser,
        addShogoTitleEntry,
        updateShogoTitleEntry,
        deleteShogoTitleEntry,
        reorderShogoTitleEntries,
        buildShogoPayload,
        maybeEmitShogoDisplay,
        emitShogoTest,
        emitShogoUserTest,
    };
};
