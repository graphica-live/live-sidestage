'use strict';

const {
    WIDGET_TAP_GOAL_SETTINGS_STATE_KEY,
    WIDGET_TAP_GOAL_PROGRESS_STATE_KEY,
} = require('./constants');
const { normalizeSoundAsset } = require('./effect-helpers');

const DEFAULT_TAP_GOAL_SETTINGS = {
    targetCount: 100,
    orientation: 'horizontal',
    headingText: 'タップチャレンジ',
    headingPosition: 'top',
    headingWritingMode: 'horizontal',
    iconSize: 100,
    soundEnabled: true,
    sound: { name: '', url: '' },
    soundVolume: 100,
    soundTarget: 'tap-goal',
};

const TAP_GOAL_HEADING_POSITIONS = ['top', 'bottom', 'left', 'right'];

function normalizeSoundTarget(value) {
    const trimmed = String(value || '').trim().toLowerCase();
    if (trimmed === 'tap-goal') return 'tap-goal';
    const match = /^screen([1-9]|10)$/.exec(trimmed);
    return match ? `screen${match[1]}` : DEFAULT_TAP_GOAL_SETTINGS.soundTarget;
}

module.exports = function createTapGoalState({
    io,
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
    const orientation = String(source.orientation || '').trim().toLowerCase() === 'vertical' ? 'vertical' : 'horizontal';
    const soundVolume = Number.parseInt(String(source.soundVolume ?? ''), 10);
    const iconSize = Number.parseInt(String(source.iconSize ?? ''), 10);
    const headingPositionRaw = String(source.headingPosition || '').trim().toLowerCase();
    // 未設定時は従来の見た目(horizontal=上, vertical=左)を維持するため向きから既定値を決める
    const headingPosition = TAP_GOAL_HEADING_POSITIONS.includes(headingPositionRaw)
        ? headingPositionRaw
        : (orientation === 'vertical' ? 'left' : 'top');
    const headingWritingModeRaw = String(source.headingWritingMode || '').trim().toLowerCase();
    // 未設定時は従来の見た目(見出しが左右なら縦書き、上下なら横書き)を維持する
    const headingWritingMode = headingWritingModeRaw === 'vertical' || headingWritingModeRaw === 'horizontal'
        ? headingWritingModeRaw
        : (headingPosition === 'left' || headingPosition === 'right' ? 'vertical' : 'horizontal');

    return {
        targetCount: Number.isInteger(targetCount) && targetCount >= 1 ? Math.min(targetCount, 1000000) : DEFAULT_TAP_GOAL_SETTINGS.targetCount,
        orientation,
        headingText: String(source.headingText ?? '').trim().slice(0, 40) || DEFAULT_TAP_GOAL_SETTINGS.headingText,
        headingPosition,
        headingWritingMode,
        iconSize: Number.isInteger(iconSize) ? Math.max(30, Math.min(200, iconSize)) : DEFAULT_TAP_GOAL_SETTINGS.iconSize,
        soundEnabled: source.soundEnabled !== false,
        sound: normalizeSoundAsset(source.sound),
        soundVolume: Number.isInteger(soundVolume) ? Math.max(0, Math.min(100, soundVolume)) : DEFAULT_TAP_GOAL_SETTINGS.soundVolume,
        soundTarget: normalizeSoundTarget(source.soundTarget),
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

// タップ目標到達のたびに呼ぶ。ウィジェット自身では soundTarget が 'tap-goal' の
// ときだけ再生し、screenN 指定時は effects:playback で該当オーバーレイへ直接送る。
// ウィジェット側で無条件に鳴らすと、管理画面のプレビューiframeにも同じソケット
// イベントが届いてElectron本体からも音が出てしまう（トリガー5倍と同種の不具合）。
function emitTapGoalReached() {
    const settings = getWidgetTapGoalSettings();
    const target = settings.soundTarget || 'tap-goal';
    const hasSound = Boolean(settings.soundEnabled && settings.sound?.url);
    const playsOnWidget = hasSound && target === 'tap-goal';

    io.emit('widgets:tap-goal:reached', playsOnWidget
        ? { url: settings.sound.url, volume: settings.soundVolume }
        : {});

    if (hasSound && target !== 'tap-goal') {
        const screen = Number(String(target).replace('screen', ''));
        if (screen >= 1 && screen <= 10) {
            io.emit('effects:playback', {
                screen,
                audioUrl: settings.sound.url,
                mediaVolume: settings.soundVolume,
                eventName: 'タップ目標達成',
                playbackId: `tap-goal-${Date.now()}`,
            });
        }
    }
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
        emitTapGoalReached,
        buildTapGoalPayload,
    };
};
