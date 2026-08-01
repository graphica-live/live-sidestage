'use strict';

const {
    WIDGET_TAP_GOAL_SETTINGS_STATE_KEY,
    WIDGET_TAP_GOAL_PROGRESS_STATE_KEY,
} = require('./constants');

const DEFAULT_TAP_GOAL_SETTINGS = {
    targetCount: 100,
    orientation: 'horizontal',
    headingText: 'タップチャレンジ',
    effectEventId: '',
};

module.exports = function createTapGoalState({
    getScopedStateValue, setScopedStateValue,
    getTapGoalWidgetTextAppearance,
}) {

function normalizeTapGoalSettings(value) {
    let source = value;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = null; }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) source = {};

    const targetCount = Number.parseInt(String(source.targetCount ?? ''), 10);
    const orientation = String(source.orientation || '').trim().toLowerCase();
    const effectEventId = String(source.effectEventId || '').trim().slice(0, 80);

    return {
        targetCount: Number.isInteger(targetCount) && targetCount >= 1 ? Math.min(targetCount, 1000000) : DEFAULT_TAP_GOAL_SETTINGS.targetCount,
        orientation: orientation === 'vertical' ? 'vertical' : 'horizontal',
        headingText: String(source.headingText ?? '').trim().slice(0, 40) || DEFAULT_TAP_GOAL_SETTINGS.headingText,
        effectEventId,
    };
}

function getWidgetTapGoalSettings() {
    return normalizeTapGoalSettings(getScopedStateValue(WIDGET_TAP_GOAL_SETTINGS_STATE_KEY));
}

function setWidgetTapGoalSettings(settings) {
    const normalized = normalizeTapGoalSettings(settings);
    setScopedStateValue(WIDGET_TAP_GOAL_SETTINGS_STATE_KEY, JSON.stringify(normalized));
    return normalized;
}

function normalizeTapGoalProgress(value) {
    let source = value;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = null; }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) source = {};
    const count = Number.parseInt(String(source.count ?? '0'), 10);
    return { count: Number.isInteger(count) && count >= 0 ? count : 0 };
}

function getTapGoalProgress() {
    return normalizeTapGoalProgress(getScopedStateValue(WIDGET_TAP_GOAL_PROGRESS_STATE_KEY));
}

function setTapGoalProgress(progress) {
    const normalized = normalizeTapGoalProgress(progress);
    setScopedStateValue(WIDGET_TAP_GOAL_PROGRESS_STATE_KEY, JSON.stringify(normalized));
    return normalized;
}

// タップ数を加算し、目標到達（自動ループ）でクロスした回数を返す
function addTapGoalTaps(amount) {
    const inc = Number(amount) || 0;
    const settings = getWidgetTapGoalSettings();
    const target = settings.targetCount;
    const progress = getTapGoalProgress();

    if (inc <= 0 || target <= 0) {
        return { count: progress.count, target, crossings: 0 };
    }

    const rawCount = progress.count + inc;
    const crossings = Math.floor(rawCount / target);
    const nextCount = rawCount % target;

    setTapGoalProgress({ count: nextCount });

    return { count: nextCount, target, crossings };
}

function resetTapGoalProgress() {
    return setTapGoalProgress({ count: 0 });
}

function buildTapGoalPayload() {
    const settings = getWidgetTapGoalSettings();
    const progress = getTapGoalProgress();
    return {
        settings,
        appearance: getTapGoalWidgetTextAppearance(),
        progress: { count: progress.count, target: settings.targetCount },
    };
}

    return {
        normalizeTapGoalSettings, getWidgetTapGoalSettings, setWidgetTapGoalSettings,
        getTapGoalProgress, setTapGoalProgress,
        addTapGoalTaps, resetTapGoalProgress,
        buildTapGoalPayload,
    };
};
