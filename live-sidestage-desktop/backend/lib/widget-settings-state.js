const {
    DEFAULT_WIDGET_TOP_GIFT_SETTINGS, WIDGET_TOP_GIFT_SETTINGS_STATE_KEY,
    DEFAULT_WIDGET_LIKE_CONTRIBUTION_SETTINGS, WIDGET_LIKE_CONTRIBUTION_SETTINGS_STATE_KEY,
    ALLOWED_BALLOON_DESIGN_KEYS, ALLOWED_LIKE_CONTRIBUTION_FONT_KEYS, ALLOWED_LIKE_CONTRIBUTION_TEXT_STYLE_KEYS,
    DEFAULT_WIDGET_FEEDBACK_SETTINGS, SHARED_WIDGET_FEEDBACK_SETTINGS_STATE_KEY,
    CONTRIBUTORS_FEEDBACK_SETTINGS_STATE_KEY, WIDGET_GOAL_GIFT_FEEDBACK_SETTINGS_STATE_KEY,
    WIDGET_CONTRIBUTORS_FONT_STATE_KEY, WIDGET_CONTRIBUTORS_TEXT_STYLE_STATE_KEY, WIDGET_CONTRIBUTORS_STROKE_WIDTH_STATE_KEY,
    WIDGET_TOP_GIFT_FONT_STATE_KEY, WIDGET_TOP_GIFT_TEXT_STYLE_STATE_KEY, WIDGET_TOP_GIFT_STROKE_WIDTH_STATE_KEY,
    WIDGET_LIKE_CONTRIBUTION_FONT_STATE_KEY, WIDGET_LIKE_CONTRIBUTION_TEXT_STYLE_STATE_KEY, WIDGET_LIKE_CONTRIBUTION_STROKE_WIDTH_STATE_KEY,
    WIDGET_TAP_LIST_FONT_STATE_KEY, WIDGET_TAP_LIST_TEXT_STYLE_STATE_KEY, WIDGET_TAP_LIST_STROKE_WIDTH_STATE_KEY,
    WIDGET_COIN_LIST_FONT_STATE_KEY, WIDGET_COIN_LIST_TEXT_STYLE_STATE_KEY, WIDGET_COIN_LIST_STROKE_WIDTH_STATE_KEY,
    WIDGET_GIFT_JAR_FONT_STATE_KEY, WIDGET_GIFT_JAR_TEXT_STYLE_STATE_KEY, WIDGET_GIFT_JAR_STROKE_WIDTH_STATE_KEY,
    WIDGET_PUSH_PULL_FONT_STATE_KEY, WIDGET_PUSH_PULL_TEXT_STYLE_STATE_KEY, WIDGET_PUSH_PULL_STROKE_WIDTH_STATE_KEY,
    WIDGET_GOAL_GIFTS_FONT_STATE_KEY, WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY, WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY,
    WIDGET_TAP_GOAL_FONT_STATE_KEY, WIDGET_TAP_GOAL_TEXT_STYLE_STATE_KEY, WIDGET_TAP_GOAL_STROKE_WIDTH_STATE_KEY,
    WIDGET_TIMER_FONT_STATE_KEY, WIDGET_TIMER_TEXT_STYLE_STATE_KEY, WIDGET_TIMER_STROKE_WIDTH_STATE_KEY,
} = require('./constants');
const { normalizeEffectText, normalizeWholeNumber, normalizeBooleanInput } = require('./utils');

module.exports = function({
    getScopedStateValue, setScopedStateValue,
    getDisplayFontFamily, getDisplayColorTheme, getDisplayStrokeWidth,
    normalizeDisplayColorTheme, normalizeDisplayStrokeWidth,
    pushPullConfig, normalizeGoalGiftFontKey,
}) {

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

function getPerWidgetTextAppearance(fontStateKey, textStyleStateKey, strokeWidthStateKey, fontNormalizer) {
    const normFont = fontNormalizer || normalizeSharedWidgetFontKey;
    const storedFont = getScopedStateValue(fontStateKey);
    const storedStyle = getScopedStateValue(textStyleStateKey);
    const storedWidth = getScopedStateValue(strokeWidthStateKey);
    return {
        fontKey: normFont(storedFont || getDisplayFontFamily()),
        textStyleKey: normalizeDisplayColorTheme(storedStyle || getDisplayColorTheme()),
        strokeWidth: normalizeDisplayStrokeWidth(storedWidth !== '' && storedWidth !== null && storedWidth !== undefined ? storedWidth : getDisplayStrokeWidth())
    };
}

function setPerWidgetTextAppearance(fontStateKey, textStyleStateKey, strokeWidthStateKey, appearance, fontNormalizer) {
    const normFont = fontNormalizer || normalizeSharedWidgetFontKey;
    if (!appearance || typeof appearance !== 'object') {
        return getPerWidgetTextAppearance(fontStateKey, textStyleStateKey, strokeWidthStateKey, fontNormalizer);
    }
    if (appearance.fontKey !== undefined) {
        setScopedStateValue(fontStateKey, normFont(appearance.fontKey));
    }
    if (appearance.textStyleKey !== undefined) {
        setScopedStateValue(textStyleStateKey, normalizeDisplayColorTheme(appearance.textStyleKey));
    }
    if (appearance.strokeWidth !== undefined) {
        setScopedStateValue(strokeWidthStateKey, normalizeDisplayStrokeWidth(appearance.strokeWidth));
    }
    return getPerWidgetTextAppearance(fontStateKey, textStyleStateKey, strokeWidthStateKey, fontNormalizer);
}

function getContributorsWidgetTextAppearance() {
    return getPerWidgetTextAppearance(WIDGET_CONTRIBUTORS_FONT_STATE_KEY, WIDGET_CONTRIBUTORS_TEXT_STYLE_STATE_KEY, WIDGET_CONTRIBUTORS_STROKE_WIDTH_STATE_KEY);
}
function setContributorsWidgetTextAppearance(a) {
    return setPerWidgetTextAppearance(WIDGET_CONTRIBUTORS_FONT_STATE_KEY, WIDGET_CONTRIBUTORS_TEXT_STYLE_STATE_KEY, WIDGET_CONTRIBUTORS_STROKE_WIDTH_STATE_KEY, a);
}

function getTopGiftWidgetTextAppearance() {
    return getPerWidgetTextAppearance(WIDGET_TOP_GIFT_FONT_STATE_KEY, WIDGET_TOP_GIFT_TEXT_STYLE_STATE_KEY, WIDGET_TOP_GIFT_STROKE_WIDTH_STATE_KEY);
}
function setTopGiftWidgetTextAppearance(a) {
    return setPerWidgetTextAppearance(WIDGET_TOP_GIFT_FONT_STATE_KEY, WIDGET_TOP_GIFT_TEXT_STYLE_STATE_KEY, WIDGET_TOP_GIFT_STROKE_WIDTH_STATE_KEY, a);
}

function getLikeContributionWidgetTextAppearance() {
    return getPerWidgetTextAppearance(WIDGET_LIKE_CONTRIBUTION_FONT_STATE_KEY, WIDGET_LIKE_CONTRIBUTION_TEXT_STYLE_STATE_KEY, WIDGET_LIKE_CONTRIBUTION_STROKE_WIDTH_STATE_KEY);
}
function setLikeContributionWidgetTextAppearance(a) {
    return setPerWidgetTextAppearance(WIDGET_LIKE_CONTRIBUTION_FONT_STATE_KEY, WIDGET_LIKE_CONTRIBUTION_TEXT_STYLE_STATE_KEY, WIDGET_LIKE_CONTRIBUTION_STROKE_WIDTH_STATE_KEY, a);
}

function getTapListWidgetTextAppearance() {
    return getPerWidgetTextAppearance(WIDGET_TAP_LIST_FONT_STATE_KEY, WIDGET_TAP_LIST_TEXT_STYLE_STATE_KEY, WIDGET_TAP_LIST_STROKE_WIDTH_STATE_KEY);
}
function setTapListWidgetTextAppearance(a) {
    return setPerWidgetTextAppearance(WIDGET_TAP_LIST_FONT_STATE_KEY, WIDGET_TAP_LIST_TEXT_STYLE_STATE_KEY, WIDGET_TAP_LIST_STROKE_WIDTH_STATE_KEY, a);
}

function getCoinListWidgetTextAppearance() {
    return getPerWidgetTextAppearance(WIDGET_COIN_LIST_FONT_STATE_KEY, WIDGET_COIN_LIST_TEXT_STYLE_STATE_KEY, WIDGET_COIN_LIST_STROKE_WIDTH_STATE_KEY);
}
function setCoinListWidgetTextAppearance(a) {
    return setPerWidgetTextAppearance(WIDGET_COIN_LIST_FONT_STATE_KEY, WIDGET_COIN_LIST_TEXT_STYLE_STATE_KEY, WIDGET_COIN_LIST_STROKE_WIDTH_STATE_KEY, a);
}

function getGiftJarWidgetTextAppearance() {
    return getPerWidgetTextAppearance(WIDGET_GIFT_JAR_FONT_STATE_KEY, WIDGET_GIFT_JAR_TEXT_STYLE_STATE_KEY, WIDGET_GIFT_JAR_STROKE_WIDTH_STATE_KEY);
}
function setGiftJarWidgetTextAppearance(a) {
    return setPerWidgetTextAppearance(WIDGET_GIFT_JAR_FONT_STATE_KEY, WIDGET_GIFT_JAR_TEXT_STYLE_STATE_KEY, WIDGET_GIFT_JAR_STROKE_WIDTH_STATE_KEY, a);
}

function getPushPullWidgetTextAppearance() {
    const base = getPerWidgetTextAppearance(WIDGET_PUSH_PULL_FONT_STATE_KEY, WIDGET_PUSH_PULL_TEXT_STYLE_STATE_KEY, WIDGET_PUSH_PULL_STROKE_WIDTH_STATE_KEY);
    base.giftSize = pushPullConfig.giftSize;
    base.giftPtsSize = pushPullConfig.giftPtsSize;
    return base;
}
function setPushPullWidgetTextAppearance(a) {
    const base = setPerWidgetTextAppearance(WIDGET_PUSH_PULL_FONT_STATE_KEY, WIDGET_PUSH_PULL_TEXT_STYLE_STATE_KEY, WIDGET_PUSH_PULL_STROKE_WIDTH_STATE_KEY, a);
    if (a && a.giftSize !== undefined) {
        const n = parseInt(String(a.giftSize), 10);
        pushPullConfig.giftSize = (!isNaN(n) && n >= 40 && n <= 160) ? n : 88;
    }
    if (a && a.giftPtsSize !== undefined) {
        const n = parseInt(String(a.giftPtsSize), 10);
        pushPullConfig.giftPtsSize = (!isNaN(n) && n >= 8 && n <= 40) ? n : 15;
    }
    base.giftSize = pushPullConfig.giftSize;
    base.giftPtsSize = pushPullConfig.giftPtsSize;
    return base;
}

function getGoalGiftsWidgetTextAppearance() {
    return getPerWidgetTextAppearance(WIDGET_GOAL_GIFTS_FONT_STATE_KEY, WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY, WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY, normalizeGoalGiftFontKey);
}
function setGoalGiftsWidgetTextAppearance(a) {
    return setPerWidgetTextAppearance(WIDGET_GOAL_GIFTS_FONT_STATE_KEY, WIDGET_GOAL_GIFTS_TEXT_STYLE_STATE_KEY, WIDGET_GOAL_GIFTS_STROKE_WIDTH_STATE_KEY, a, normalizeGoalGiftFontKey);
}

function getTapGoalWidgetTextAppearance() {
    return getPerWidgetTextAppearance(WIDGET_TAP_GOAL_FONT_STATE_KEY, WIDGET_TAP_GOAL_TEXT_STYLE_STATE_KEY, WIDGET_TAP_GOAL_STROKE_WIDTH_STATE_KEY);
}
function setTapGoalWidgetTextAppearance(a) {
    return setPerWidgetTextAppearance(WIDGET_TAP_GOAL_FONT_STATE_KEY, WIDGET_TAP_GOAL_TEXT_STYLE_STATE_KEY, WIDGET_TAP_GOAL_STROKE_WIDTH_STATE_KEY, a);
}

function getTimerWidgetTextAppearance() {
    return getPerWidgetTextAppearance(WIDGET_TIMER_FONT_STATE_KEY, WIDGET_TIMER_TEXT_STYLE_STATE_KEY, WIDGET_TIMER_STROKE_WIDTH_STATE_KEY);
}
function setTimerWidgetTextAppearance(a) {
    return setPerWidgetTextAppearance(WIDGET_TIMER_FONT_STATE_KEY, WIDGET_TIMER_TEXT_STYLE_STATE_KEY, WIDGET_TIMER_STROKE_WIDTH_STATE_KEY, a);
}

function normalizeSharedWidgetFontKey(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    const allowedKeys = new Set([
        'default', 'gothic', 'ui-gothic', 'mincho', 'ud-gothic', 'ud-mincho',
        'meiryo', 'rounded', 'kyokasho', 'gyosho', 'togarie', 'ln-pop',
        'comic-impact', 'pop-idol', 'entame', 'marker', 'retro-bold',
        'luxury-mincho', 'antique-modern', 'atelier-brush', 'pixel-code',
        'sawarabi-mincho', 'potta-one', 'murecho-thin', 'stick'
    ]);
    return allowedKeys.has(normalizedValue) ? normalizedValue : 'default';
}

    return {
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
    };
};
