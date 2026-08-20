const { WIDGET_TAP_LIST_SETTINGS_STATE_KEY, WIDGET_COIN_LIST_SETTINGS_STATE_KEY } = require('./constants');

module.exports = function({
    dbStore, getBroadcasterId, hasConfiguredBroadcasterId,
    getScopedStateValue, setScopedStateValue, getTodayDayKey,
    getTapListWidgetTextAppearance, getCoinListWidgetTextAppearance,
    getLikeContributionUserAvatars, getLikeContributionUserNicknames, getLikeContributionUserTotalsState,
}) {

function normalizeWidgetTapListSettings(value) {
    let source = value;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = null; }
    }
    if (!source || typeof source !== 'object') source = {};
    const bgStyle = String(source.bgStyle || '').trim();
    const maxEntries = Number.parseInt(String(source.maxEntries ?? '20'), 10);
    const rowGap = Number.parseInt(String(source.rowGap ?? '8'), 10);
    return {
        bgStyle: bgStyle === 'semi' ? 'semi' : 'transparent',
        maxEntries: Number.isInteger(maxEntries) && maxEntries >= 1 ? Math.min(maxEntries, 100) : 20,
        rowGap: Number.isInteger(rowGap) && rowGap >= -30 ? Math.min(rowGap, 80) : 8
    };
}

function getWidgetTapListSettings() {
    return normalizeWidgetTapListSettings(getScopedStateValue(WIDGET_TAP_LIST_SETTINGS_STATE_KEY));
}

function setWidgetTapListSettings(settings) {
    const normalized = normalizeWidgetTapListSettings(settings);
    setScopedStateValue(WIDGET_TAP_LIST_SETTINGS_STATE_KEY, JSON.stringify(normalized));
    return normalized;
}

// ---- コイン数一覧ウィジェット ----

function normalizeWidgetCoinListSettings(value) {
    let source = value;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = null; }
    }
    if (!source || typeof source !== 'object') source = {};
    const bgStyle = String(source.bgStyle || '').trim();
    const maxEntries = Number.parseInt(String(source.maxEntries ?? '20'), 10);
    const rowGap = Number.parseInt(String(source.rowGap ?? '8'), 10);
    const sortOrder = String(source.sortOrder || '').trim();
    return {
        bgStyle: bgStyle === 'semi' ? 'semi' : 'transparent',
        maxEntries: Number.isInteger(maxEntries) && maxEntries >= 1 ? Math.min(maxEntries, 100) : 20,
        rowGap: Number.isInteger(rowGap) && rowGap >= -30 ? Math.min(rowGap, 80) : 8,
        sortOrder: sortOrder === 'asc' ? 'asc' : 'desc'
    };
}

function getWidgetCoinListSettings() {
    return normalizeWidgetCoinListSettings(getScopedStateValue(WIDGET_COIN_LIST_SETTINGS_STATE_KEY));
}

function setWidgetCoinListSettings(settings) {
    const normalized = normalizeWidgetCoinListSettings(settings);
    setScopedStateValue(WIDGET_COIN_LIST_SETTINGS_STATE_KEY, JSON.stringify(normalized));
    return normalized;
}

function buildTapListUserMap() {
    const nicknames = getLikeContributionUserNicknames();
    const avatars = getLikeContributionUserAvatars();
    // コントリビューターDBの表示名で補完
    if (hasConfiguredBroadcasterId()) {
        try {
            const contributors = dbStore.getAdminContributorsByDay(getTodayDayKey(), getBroadcasterId());
            for (const c of contributors) {
                if (c.uniqueId && c.nickname) nicknames[c.uniqueId] = c.nickname;
            }
        } catch {}
    }
    return { nicknames, avatars };
}

function buildTapListEntries(maxEntries = 20) {
    const dayKey = getTodayDayKey();
    const userTotalsState = getLikeContributionUserTotalsState();
    const todayMap = userTotalsState[dayKey] || {};
    const { nicknames, avatars } = buildTapListUserMap();
    return Object.entries(todayMap)
        .map(([uniqueId, tapCount]) => ({
            uniqueId,
            nickname: nicknames[uniqueId] || uniqueId,
            avatarUrl: avatars[uniqueId] || '',
            tapCount: Number(tapCount) || 0
        }))
        .filter((e) => e.tapCount > 0)
        .sort((a, b) => b.tapCount - a.tapCount)
        .slice(0, maxEntries)
        .map((e, i) => ({ rank: i + 1, uniqueId: e.uniqueId, nickname: e.nickname, avatarUrl: e.avatarUrl, tapCount: e.tapCount }));
}

function buildTapListPayload() {
    const settings = getWidgetTapListSettings();
    return {
        settings,
        appearance: getTapListWidgetTextAppearance(),
        entries: buildTapListEntries(settings.maxEntries)
    };
}

function buildCoinListEntries(maxEntries = 20, sortOrder = 'desc') {
    if (!hasConfiguredBroadcasterId()) return [];
    try {
        const contributors = dbStore.getAdminContributorsByDay(getTodayDayKey(), getBroadcasterId());
        return contributors
            .filter((c) => Number(c.total) > 0)
            .sort((a, b) => sortOrder === 'asc' ? Number(a.total) - Number(b.total) : Number(b.total) - Number(a.total))
            .slice(0, maxEntries)
            .map((c, i) => ({
                rank: i + 1,
                uniqueId: c.uniqueId,
                nickname: c.nickname || c.uniqueId,
                avatarUrl: c.image || '',
                coinCount: Number(c.total) || 0
            }));
    } catch {
        return [];
    }
}

function buildCoinListPayload() {
    const settings = getWidgetCoinListSettings();
    return {
        settings,
        appearance: getCoinListWidgetTextAppearance(),
        entries: buildCoinListEntries(settings.maxEntries, settings.sortOrder)
    };
}

    return {
        normalizeWidgetTapListSettings, getWidgetTapListSettings, setWidgetTapListSettings,
        normalizeWidgetCoinListSettings, getWidgetCoinListSettings, setWidgetCoinListSettings,
        buildTapListUserMap, buildTapListEntries, buildTapListPayload,
        buildCoinListEntries, buildCoinListPayload,
    };
};
