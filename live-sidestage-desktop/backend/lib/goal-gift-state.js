const {
    ALLOWED_GOAL_GIFT_ACHIEVEMENT_BADGE_STYLES, ALLOWED_GOAL_GIFT_WIDGET_LAYOUTS,
    DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE, DEFAULT_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_STYLE,
    DEFAULT_GOAL_GIFT_WIDGET_FONT_KEY, DEFAULT_GOAL_GIFT_WIDGET_HEADING_FONT_SIZE,
    DEFAULT_GOAL_GIFT_WIDGET_HEADING_SCROLL, DEFAULT_GOAL_GIFT_WIDGET_HEADING_TEXT,
    DEFAULT_GOAL_GIFT_WIDGET_ITEM, DEFAULT_GOAL_GIFT_WIDGET_LAYOUT,
    DEFAULT_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE, DEFAULT_GOAL_GIFT_WIDGET_PROGRESS_RING_COLOR,
    DEFAULT_GOAL_GIFT_WIDGET_PROGRESS_BG_OPACITY, MIN_GOAL_GIFT_WIDGET_PROGRESS_BG_OPACITY,
    MAX_GOAL_GIFT_WIDGET_PROGRESS_BG_OPACITY,
    DEFAULT_GOAL_GIFT_WIDGET_STROKE_WIDTH,
    DEFAULT_GOAL_GIFT_WIDGET_TEXT_STYLE_KEY,
    GOAL_GIFT_SYSTEM_IDS, GOAL_GIFT_SYSTEM_IMAGE_DATA_URLS, GOAL_GIFT_SYSTEM_LABELS,
    MAX_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE, MAX_GOAL_GIFT_WIDGET_HEADING_FONT_SIZE,
    MAX_GOAL_GIFT_WIDGET_HEADING_TEXT_LENGTH, MAX_GOAL_GIFT_WIDGET_ITEMS,
    MAX_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE, MAX_GOAL_GIFT_WIDGET_STROKE_WIDTH,
    MIN_GOAL_GIFT_WIDGET_ACHIEVEMENT_BADGE_SIZE, MIN_GOAL_GIFT_WIDGET_HEADING_FONT_SIZE,
    MIN_GOAL_GIFT_WIDGET_NOTE_FONT_SIZE,
    WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_SIZE_STATE_KEY, WIDGET_GOAL_GIFTS_ACHIEVEMENT_BADGE_STYLE_STATE_KEY,
    WIDGET_GOAL_GIFTS_FONT_STATE_KEY, WIDGET_GOAL_GIFTS_HEADING_FONT_SIZE_STATE_KEY,
    WIDGET_GOAL_GIFTS_HEADING_SCROLL_STATE_KEY, WIDGET_GOAL_GIFTS_HEADING_TEXT_STATE_KEY,
    WIDGET_GOAL_GIFTS_LAYOUT_STATE_KEY, WIDGET_GOAL_GIFTS_NOTE_FONT_SIZE_STATE_KEY,
    WIDGET_GOAL_GIFTS_PROGRESS_RING_COLOR_STATE_KEY, WIDGET_GOAL_GIFTS_PROGRESS_BG_OPACITY_STATE_KEY,
    WIDGET_GOAL_GIFTS_STATE_KEY, WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY,
    WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY, WIDGET_GOAL_GIFT_ACTIVITY_COUNTS_STATE_KEY,
    WIDGET_GOAL_GIFT_FOLLOW_STATE_KEY, WIDGET_GOAL_GIFT_LIKE_TOTALS_STATE_KEY,
    WIDGET_GOAL_GIFT_LIKE_UNIQUE_SEEN_STATE_KEY,
} = require('./constants');
const { firstDefinedString, normalizeBooleanInput, normalizeEffectText, normalizeWholeNumber, normalizeBroadcasterId } = require('./utils');
const { getCatalogNameJa } = require('./tiktok-gift-catalog');

module.exports = function({
    dbStore, getScopedStateValue, setScopedStateValue, getTodayDayKey,
    getBroadcasterId, getContributorsSessionState,
    normalizeDayKey, normalizeStoredTimestamp, normalizeNickname, normalizeSignedWholeNumber,
    getGoalGiftFeedbackSettings, getGoalGiftsWidgetTextAppearance,
    hydrateStoredGiftEvent,
}) {

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

function normalizeGoalGiftMissionUnitCount(value, targetCount) {
    const normalizedValue = normalizeWholeNumber(value);
    const normalizedTargetCount = normalizeWholeNumber(targetCount);

    if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
        return 0;
    }

    if (!Number.isInteger(normalizedTargetCount) || normalizedTargetCount <= 0) {
        return 0;
    }

    if (normalizedValue > normalizedTargetCount || normalizedTargetCount % normalizedValue !== 0) {
        return 0;
    }

    return normalizedValue;
}

// missionUnitCount が targetCount の約数として設定されている場合、目標達成までを
// 「ミッション」単位の周回に分割する。0(未設定)の場合は従来通り目標全体を1周とみなす。
function computeGoalMissionState(targetCount, missionUnitCount, currentCount) {
    const normalizedTargetCount = Math.max(0, normalizeWholeNumber(targetCount) || 0);
    const normalizedCurrentCount = Math.max(0, normalizeWholeNumber(currentCount) || 0);
    const unitCount = normalizeGoalGiftMissionUnitCount(missionUnitCount, normalizedTargetCount);

    if (!unitCount || unitCount >= normalizedTargetCount) {
        return {
            missionUnitCount: 0,
            missionTotalSteps: 1,
            missionCurrentStep: 1,
            missionStepProgressCount: Math.min(normalizedCurrentCount, normalizedTargetCount),
            missionStepRemaining: Math.max(0, normalizedTargetCount - normalizedCurrentCount),
            missionStepRatio: normalizedTargetCount > 0 ? Math.min(1, normalizedCurrentCount / normalizedTargetCount) : 0
        };
    }

    const totalSteps = normalizedTargetCount / unitCount;
    const currentStep = normalizedCurrentCount >= normalizedTargetCount
        ? totalSteps
        : Math.min(totalSteps, Math.floor(normalizedCurrentCount / unitCount) + 1);
    const stepProgressCount = Math.min(unitCount, Math.max(0, normalizedCurrentCount - (currentStep - 1) * unitCount));

    return {
        missionUnitCount: unitCount,
        missionTotalSteps: totalSteps,
        missionCurrentStep: currentStep,
        missionStepProgressCount: stepProgressCount,
        missionStepRemaining: Math.max(0, unitCount - stepProgressCount),
        missionStepRatio: stepProgressCount / unitCount
    };
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

function normalizeGoalGiftLayout(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    return ALLOWED_GOAL_GIFT_WIDGET_LAYOUTS.has(normalizedValue) ? normalizedValue : DEFAULT_GOAL_GIFT_WIDGET_LAYOUT;
}

function getGoalGiftWidgetLayout() {
    return normalizeGoalGiftLayout(getScopedStateValue(WIDGET_GOAL_GIFTS_LAYOUT_STATE_KEY));
}

function setGoalGiftWidgetLayout(value) {
    const normalizedValue = normalizeGoalGiftLayout(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_LAYOUT_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeGoalGiftHeadingText(value) {
    return normalizeEffectText(value, MAX_GOAL_GIFT_WIDGET_HEADING_TEXT_LENGTH) || DEFAULT_GOAL_GIFT_WIDGET_HEADING_TEXT;
}

function getGoalGiftWidgetHeadingText() {
    return normalizeGoalGiftHeadingText(getScopedStateValue(WIDGET_GOAL_GIFTS_HEADING_TEXT_STATE_KEY));
}

function setGoalGiftWidgetHeadingText(value) {
    const normalizedValue = normalizeGoalGiftHeadingText(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_HEADING_TEXT_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeGoalGiftHeadingScroll(value) {
    return normalizeBooleanInput(value, DEFAULT_GOAL_GIFT_WIDGET_HEADING_SCROLL);
}

function getGoalGiftWidgetHeadingScroll() {
    return normalizeGoalGiftHeadingScroll(getScopedStateValue(WIDGET_GOAL_GIFTS_HEADING_SCROLL_STATE_KEY));
}

function setGoalGiftWidgetHeadingScroll(value) {
    const normalizedValue = normalizeGoalGiftHeadingScroll(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_HEADING_SCROLL_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeGoalGiftHeadingFontSize(value) {
    const normalizedValue = normalizeWholeNumber(value);
    if (!Number.isInteger(normalizedValue) || normalizedValue < MIN_GOAL_GIFT_WIDGET_HEADING_FONT_SIZE) {
        return DEFAULT_GOAL_GIFT_WIDGET_HEADING_FONT_SIZE;
    }

    return Math.min(normalizedValue, MAX_GOAL_GIFT_WIDGET_HEADING_FONT_SIZE);
}

function getGoalGiftWidgetHeadingFontSize() {
    return normalizeGoalGiftHeadingFontSize(getScopedStateValue(WIDGET_GOAL_GIFTS_HEADING_FONT_SIZE_STATE_KEY));
}

function setGoalGiftWidgetHeadingFontSize(value) {
    const normalizedValue = normalizeGoalGiftHeadingFontSize(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_HEADING_FONT_SIZE_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeGoalGiftProgressRingColor(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalizedValue) ? normalizedValue : DEFAULT_GOAL_GIFT_WIDGET_PROGRESS_RING_COLOR;
}

function getGoalGiftWidgetProgressRingColor() {
    return normalizeGoalGiftProgressRingColor(getScopedStateValue(WIDGET_GOAL_GIFTS_PROGRESS_RING_COLOR_STATE_KEY));
}

function setGoalGiftWidgetProgressRingColor(value) {
    const normalizedValue = normalizeGoalGiftProgressRingColor(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_PROGRESS_RING_COLOR_STATE_KEY, normalizedValue);
    return normalizedValue;
}

function normalizeGoalGiftProgressBackgroundOpacity(value) {
    const normalizedValue = normalizeWholeNumber(value);
    if (!Number.isInteger(normalizedValue) || normalizedValue < MIN_GOAL_GIFT_WIDGET_PROGRESS_BG_OPACITY) {
        return DEFAULT_GOAL_GIFT_WIDGET_PROGRESS_BG_OPACITY;
    }

    return Math.min(normalizedValue, MAX_GOAL_GIFT_WIDGET_PROGRESS_BG_OPACITY);
}

function getGoalGiftWidgetProgressBackgroundOpacity() {
    return normalizeGoalGiftProgressBackgroundOpacity(getScopedStateValue(WIDGET_GOAL_GIFTS_PROGRESS_BG_OPACITY_STATE_KEY));
}

function setGoalGiftWidgetProgressBackgroundOpacity(value) {
    const normalizedValue = normalizeGoalGiftProgressBackgroundOpacity(value);
    setScopedStateValue(WIDGET_GOAL_GIFTS_PROGRESS_BG_OPACITY_STATE_KEY, normalizedValue);
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
        const missionUnitCount = normalizeGoalGiftMissionUnitCount(item?.missionUnitCount, targetCount);

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
            currentCountOffsetDayKey: resetAtMidnight ? currentCountOffsetDayKey : '',
            missionUnitCount
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
    fontKey = getGoalGiftsWidgetTextAppearance().fontKey,
    textStyleKey = getGoalGiftsWidgetTextAppearance().textStyleKey,
    strokeWidth = getGoalGiftsWidgetTextAppearance().strokeWidth,
    noteFontSize = getGoalGiftWidgetNoteFontSize(),
    achievementBadgeSize = getGoalGiftWidgetAchievementBadgeSize(),
    achievementBadgeStyle = getGoalGiftWidgetAchievementBadgeStyle(),
    layout = getGoalGiftWidgetLayout(),
    headingText = getGoalGiftWidgetHeadingText(),
    headingScroll = getGoalGiftWidgetHeadingScroll(),
    headingFontSize = getGoalGiftWidgetHeadingFontSize(),
    progressRingColor = getGoalGiftWidgetProgressRingColor(),
    progressBackgroundOpacity = getGoalGiftWidgetProgressBackgroundOpacity()
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
    const normalizedLayout = normalizeGoalGiftLayout(layout);
    const normalizedHeadingText = normalizeGoalGiftHeadingText(headingText);
    const normalizedHeadingScroll = normalizeGoalGiftHeadingScroll(headingScroll);
    const normalizedHeadingFontSize = normalizeGoalGiftHeadingFontSize(headingFontSize);
    const normalizedProgressRingColor = normalizeGoalGiftProgressRingColor(progressRingColor);
    const normalizedProgressBackgroundOpacity = normalizeGoalGiftProgressBackgroundOpacity(progressBackgroundOpacity);

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
            layout: normalizedLayout,
            headingText: normalizedHeadingText,
            headingScroll: normalizedHeadingScroll,
            headingFontSize: normalizedHeadingFontSize,
            progressRingColor: normalizedProgressRingColor,
            progressBackgroundOpacity: normalizedProgressBackgroundOpacity,
            feedback: getGoalGiftFeedbackSettings(),
            goals: normalizedItems.map((item, index) => {
                const currentCount = Math.max(0, item.resetAtMidnight && item.currentCountOffsetDayKey !== requestedDayKey ? 0 : item.currentCountOffset);

                return {
                    slot: index + 1,
                    ...item,
                    currentCount,
                    observedCount: 0,
                    completed: false,
                    progressRatio: 0,
                    ...computeGoalMissionState(item.targetCount, item.missionUnitCount, currentCount)
                };
            })
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
        layout: normalizedLayout,
        headingText: normalizedHeadingText,
        headingScroll: normalizedHeadingScroll,
        headingFontSize: normalizedHeadingFontSize,
        progressRingColor: normalizedProgressRingColor,
        progressBackgroundOpacity: normalizedProgressBackgroundOpacity,
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
                    progressRatio: item.targetCount > 0 ? Math.min(currentCount / item.targetCount, 1) : 0,
                    ...computeGoalMissionState(item.targetCount, item.missionUnitCount, currentCount)
                };
            }

            const normalizedGiftName = normalizeGoalGiftMatchName(item.giftName);
            let observedCount = 0;
            let latestGiftImage = item.giftImage || '';
            let lastSenderImage = '';
            const countedContributorKeys = item.countUniqueUsers ? new Set() : null;

            gifts.forEach((gift) => {
                const idMatched = item.giftId && String(gift.giftId || '') === item.giftId;
                const nameMatched = normalizedGiftName && normalizeGoalGiftMatchName(gift.giftName) === normalizedGiftName;

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

                if (gift.image) {
                    lastSenderImage = gift.image;
                }
            });

            const currentCountOffset = item.resetAtMidnight && item.currentCountOffsetDayKey !== requestedDayKey
                ? 0
                : item.currentCountOffset;
            const currentCount = Math.max(0, observedCount + currentCountOffset);
            return {
                slot: index + 1,
                ...item,
                // ウィジェットは `displayName || giftName` で描く。giftName は一致キー（英語）
                // なので、手入力の displayName が無いと英語のまま出ていた。
                // TikTok 公式の日本語名をここで補う（手入力があればそちらが優先）。
                displayName: item.displayName || getCatalogNameJa(item.giftName),
                giftImage: latestGiftImage,
                currentCount,
                observedCount,
                completed: currentCount >= item.targetCount,
                progressRatio: item.targetCount > 0 ? Math.min(currentCount / item.targetCount, 1) : 0,
                lastSenderImage,
                ...computeGoalMissionState(item.targetCount, item.missionUnitCount, currentCount)
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
        const nameMatched = normalizedGiftName
            && normalizeGoalGiftMatchName(giftEvent.giftName) === normalizedGiftName;

        if (!idMatched && !nameMatched) {
            return;
        }

        const alreadyCounted = historicalGifts.some((gift) => {
            const historicalIdMatched = item.giftId && String(gift.giftId || '') === item.giftId;
            const historicalNameMatched = normalizedGiftName
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

    return {
        normalizeGoalGiftFontKey, getGoalGiftWidgetFontKey, setGoalGiftWidgetFontKey,
        normalizeGoalGiftTextStyleKey, getGoalGiftWidgetTextStyleKey, setGoalGiftWidgetTextStyleKey,
        normalizeGoalGiftStrokeWidth, getGoalGiftWidgetStrokeWidth, setGoalGiftWidgetStrokeWidth,
        normalizeGoalGiftNoteFontSize, getGoalGiftWidgetNoteFontSize, setGoalGiftWidgetNoteFontSize,
        normalizeGoalGiftMissionUnitCount, computeGoalMissionState,
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
    };
};
