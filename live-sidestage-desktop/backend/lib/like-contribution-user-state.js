const { normalizeBroadcasterId, normalizeWholeNumber } = require('./utils');
const { WIDGET_LIKE_CONTRIBUTION_USER_TOTALS_STATE_KEY, WIDGET_LIKE_CONTRIBUTION_USER_NICKNAMES_STATE_KEY, WIDGET_LIKE_CONTRIBUTION_USER_AVATARS_STATE_KEY } = require('./constants');

module.exports = function({ getScopedStateValue, setScopedStateValue, getTodayDayKey, normalizeDayKey }) {

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

function getLikeContributionUserNicknames() {
    let source = getScopedStateValue(WIDGET_LIKE_CONTRIBUTION_USER_NICKNAMES_STATE_KEY);
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = {}; }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    const result = {};
    for (const [uid, nick] of Object.entries(source)) {
        if (typeof uid === 'string' && uid && typeof nick === 'string' && nick) {
            result[uid] = nick;
        }
    }
    return result;
}

function setLikeContributionUserNickname(uniqueId, nickname) {
    if (!uniqueId || !nickname) return;
    const current = getLikeContributionUserNicknames();
    current[uniqueId] = nickname;
    setScopedStateValue(WIDGET_LIKE_CONTRIBUTION_USER_NICKNAMES_STATE_KEY, JSON.stringify(current));
}

function getLikeContributionUserAvatars() {
    let source = getScopedStateValue(WIDGET_LIKE_CONTRIBUTION_USER_AVATARS_STATE_KEY);
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = {}; }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    return source;
}

function setLikeContributionUserAvatar(uniqueId, avatarUrl) {
    if (!uniqueId || !avatarUrl) return;
    const current = getLikeContributionUserAvatars();
    current[uniqueId] = avatarUrl;
    setScopedStateValue(WIDGET_LIKE_CONTRIBUTION_USER_AVATARS_STATE_KEY, JSON.stringify(current));
}


    return {
        normalizeLikeContributionUserTotalsState,
        getLikeContributionUserTotalsState, setLikeContributionUserTotalsState,
        getLikeContributionUserNicknames, setLikeContributionUserNickname,
        getLikeContributionUserAvatars, setLikeContributionUserAvatar,
    };
};
