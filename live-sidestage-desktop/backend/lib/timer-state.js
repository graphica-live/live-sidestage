'use strict';

const {
    WIDGET_TIMER_SETTINGS_STATE_KEY,
    WIDGET_TIMER_STATE_KEY,
} = require('./constants');
const { normalizeEffectText, normalizeWholeNumber, normalizeBooleanInput } = require('./utils');
const { normalizeSoundAsset } = require('./effect-helpers');

const MAX_TIMER_MS = 24 * 60 * 60 * 1000;
const TIMER_BLOCK_SOUND_URL = '/audio/feedback/business11.mp3';

const DEFAULT_TIMER_SETTINGS = {
    durationMinutes: 10,
    durationSeconds: 0,
    headingText: 'カウントダウン',
    endSound: { name: '', url: '' },
    endSoundVolume: 100,
    endSoundScreen: 1,
    minFloorMinutes: 0,
    maxCeilingMinutes: 0,
    countdownSoundEnabled: false,
    countdownSoundThresholdSeconds: 5,
    countdownSound: { name: '', url: '' },
    countdownSoundVolume: 100,
    countdownSoundScreen: 1,
};

module.exports = function createTimerState({
    io,
    getScopedStateValue, setScopedStateValue,
    getTimerWidgetTextAppearance,
}) {

let endTimeoutHandle = null;
let countdownTimeoutHandle = null;

function normalizeTimerSoundVolume(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed)) return DEFAULT_TIMER_SETTINGS.endSoundVolume;
    return Math.max(0, Math.min(100, parsed));
}

function normalizeMinFloorMinutes(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed)) return DEFAULT_TIMER_SETTINGS.minFloorMinutes;
    return Math.max(0, Math.min(1440, parsed));
}

// 0 は「上限なし」を意味する（短縮下限の0=実質無制限と対になる仕様）。
function normalizeMaxCeilingMinutes(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed)) return DEFAULT_TIMER_SETTINGS.maxCeilingMinutes;
    return Math.max(0, Math.min(1440, parsed));
}

function normalizeEndSoundScreen(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return DEFAULT_TIMER_SETTINGS.endSoundScreen;
    return parsed;
}

function normalizeCountdownSoundScreen(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return DEFAULT_TIMER_SETTINGS.countdownSoundScreen;
    return parsed;
}

function normalizeCountdownThresholdSeconds(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed)) return DEFAULT_TIMER_SETTINGS.countdownSoundThresholdSeconds;
    return Math.max(1, Math.min(60, parsed));
}

function normalizeTimerSettings(value) {
    let source = value;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = null; }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) source = {};

    const durationMinutes = normalizeWholeNumber(source.durationMinutes);
    const durationSeconds = normalizeWholeNumber(source.durationSeconds);

    return {
        durationMinutes: durationMinutes !== null ? Math.min(durationMinutes, 1440) : DEFAULT_TIMER_SETTINGS.durationMinutes,
        durationSeconds: durationSeconds !== null ? Math.min(durationSeconds, 59) : DEFAULT_TIMER_SETTINGS.durationSeconds,
        headingText: normalizeEffectText(source.headingText, 40) || DEFAULT_TIMER_SETTINGS.headingText,
        endSound: normalizeSoundAsset(source.endSound),
        endSoundVolume: normalizeTimerSoundVolume(source.endSoundVolume),
        endSoundScreen: normalizeEndSoundScreen(source.endSoundScreen),
        minFloorMinutes: normalizeMinFloorMinutes(source.minFloorMinutes),
        maxCeilingMinutes: normalizeMaxCeilingMinutes(source.maxCeilingMinutes),
        countdownSoundEnabled: normalizeBooleanInput(source.countdownSoundEnabled, DEFAULT_TIMER_SETTINGS.countdownSoundEnabled),
        countdownSoundThresholdSeconds: normalizeCountdownThresholdSeconds(source.countdownSoundThresholdSeconds),
        countdownSound: normalizeSoundAsset(source.countdownSound),
        countdownSoundVolume: normalizeTimerSoundVolume(source.countdownSoundVolume),
        countdownSoundScreen: normalizeCountdownSoundScreen(source.countdownSoundScreen),
    };
}

function getTimerDurationMs(settings = getTimerSettings()) {
    return Math.max(0, (settings.durationMinutes * 60 + settings.durationSeconds) * 1000);
}

function getTimerSettings() {
    return normalizeTimerSettings(getScopedStateValue(WIDGET_TIMER_SETTINGS_STATE_KEY));
}

function setTimerSettings(settings) {
    const normalized = normalizeTimerSettings(settings);
    setScopedStateValue(WIDGET_TIMER_SETTINGS_STATE_KEY, JSON.stringify(normalized));
    scheduleCountdownTick();
    return normalized;
}

function normalizeTimerRuntime(value) {
    let source = value;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = null; }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) source = {};

    const endsAt = Number.isFinite(Number(source.endsAt)) ? Number(source.endsAt) : null;
    const remainingMs = normalizeWholeNumber(source.remainingMs);

    return {
        running: normalizeBooleanInput(source.running, false),
        endsAt,
        remainingMs: remainingMs !== null ? Math.min(remainingMs, MAX_TIMER_MS) : getTimerDurationMs(),
    };
}

function getTimerRuntime() {
    return normalizeTimerRuntime(getScopedStateValue(WIDGET_TIMER_STATE_KEY));
}

function setTimerRuntime(runtime) {
    const normalized = normalizeTimerRuntime(runtime);
    setScopedStateValue(WIDGET_TIMER_STATE_KEY, JSON.stringify(normalized));
    return normalized;
}

function getTimerRemainingMs(runtime = getTimerRuntime()) {
    if (runtime.running && runtime.endsAt !== null) {
        return Math.max(0, runtime.endsAt - Date.now());
    }
    return Math.max(0, runtime.remainingMs);
}

// 終了時刻ぴったりにサーバー側で1回だけ発火させ、overlay1(screen 1)へ効果音を飛ばす。
// クライアント（オーバーレイ）任せにすると複数インスタンスで多重再生されるため、発火はサーバー側で一元管理する。
function clearEndTimeout() {
    if (endTimeoutHandle) {
        clearTimeout(endTimeoutHandle);
        endTimeoutHandle = null;
    }
}

function scheduleEndTimeout() {
    clearEndTimeout();
    scheduleCountdownTick();
    const runtime = getTimerRuntime();
    if (!runtime.running || runtime.endsAt === null) return;

    const delay = runtime.endsAt - Date.now();
    if (delay <= 0) {
        fireTimerEnded();
        return;
    }
    endTimeoutHandle = setTimeout(fireTimerEnded, Math.min(delay, MAX_TIMER_MS));
}

function fireTimerEnded() {
    endTimeoutHandle = null;
    const runtime = getTimerRuntime();
    if (!runtime.running) return;

    if (getTimerRemainingMs(runtime) > 250) {
        scheduleEndTimeout();
        return;
    }

    if (!io) return;
    io.emit('widgets:timer:updated', buildTimerPayload());
    emitTimerEndSound();
}

// 24のようなカウントダウン音。指定秒数以下になったら残り秒数が1つ減るたびに1回鳴らす。
// 終了音と同様、多重再生を避けるためサーバー側で発火を一元管理する。
function clearCountdownTimeout() {
    if (countdownTimeoutHandle) {
        clearTimeout(countdownTimeoutHandle);
        countdownTimeoutHandle = null;
    }
}

function scheduleCountdownTick() {
    clearCountdownTimeout();
    const settings = getTimerSettings();
    if (!settings.countdownSoundEnabled || !settings.countdownSound.url) return;

    const runtime = getTimerRuntime();
    if (!runtime.running || runtime.endsAt === null) return;

    const remainingMs = runtime.endsAt - Date.now();
    if (remainingMs <= 0) return;

    const thresholdMs = settings.countdownSoundThresholdSeconds * 1000;
    if (remainingMs > thresholdMs) {
        countdownTimeoutHandle = setTimeout(scheduleCountdownTick, Math.min(remainingMs - thresholdMs, MAX_TIMER_MS));
        return;
    }

    const secondsLeft = Math.ceil(remainingMs / 1000);
    emitTimerCountdownSound();

    const delay = runtime.endsAt - (secondsLeft - 1) * 1000 - Date.now();
    countdownTimeoutHandle = setTimeout(scheduleCountdownTick, Math.max(0, delay));
}

// 設定された screen (overlay) のカウントダウン音を1回再生する。管理画面からの手動テストにも使う。
function emitTimerCountdownSound() {
    if (!io) return false;
    const settings = getTimerSettings();
    if (!settings.countdownSound.url) return false;

    io.emit('effects:playback', {
        playbackId: `timer-countdown-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        eventId: 'timer-countdown-sound',
        eventName: 'タイマーカウントダウン',
        screen: settings.countdownSoundScreen,
        videoUrl: '',
        audioUrl: settings.countdownSound.url,
        mediaVolume: settings.countdownSoundVolume,
        playbackCount: 1,
        triggerId: 'timer',
        triggerName: 'タイマー',
        giftName: '',
        comment: '',
        totalGifts: 0,
        repeatCount: 1,
        uniqueId: '',
        nickname: '',
        timestamp: Date.now()
    });
    return true;
}

// 設定された screen (overlay) の効果音オーバーレイへ終了音を直接送る。管理画面からの手動テストにも使う。
function emitTimerEndSound() {
    if (!io) return false;
    const settings = getTimerSettings();
    if (!settings.endSound.url) return false;

    io.emit('effects:playback', {
        playbackId: `timer-end-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        eventId: 'timer-end-sound',
        eventName: 'タイマー終了',
        screen: settings.endSoundScreen,
        videoUrl: '',
        audioUrl: settings.endSound.url,
        mediaVolume: settings.endSoundVolume,
        playbackCount: 1,
        triggerId: 'timer',
        triggerName: 'タイマー',
        giftName: '',
        comment: '',
        totalGifts: 0,
        repeatCount: 1,
        uniqueId: '',
        nickname: '',
        timestamp: Date.now()
    });
    return true;
}

// 短縮下限でブロックされた際、終了音と同じ指定オーバーレイへブロック音を送る。
function emitTimerBlockSound() {
    if (!io) return false;
    const settings = getTimerSettings();

    io.emit('effects:playback', {
        playbackId: `timer-block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        eventId: 'timer-block-sound',
        eventName: 'タイマー短縮ブロック',
        screen: settings.endSoundScreen,
        videoUrl: '',
        audioUrl: TIMER_BLOCK_SOUND_URL,
        mediaVolume: settings.endSoundVolume,
        playbackCount: 1,
        triggerId: 'timer',
        triggerName: 'タイマー',
        giftName: '',
        comment: '',
        totalGifts: 0,
        repeatCount: 1,
        uniqueId: '',
        nickname: '',
        timestamp: Date.now()
    });
    return true;
}

function startTimer() {
    const runtime = getTimerRuntime();
    const base = getTimerRemainingMs(runtime) > 0 ? getTimerRemainingMs(runtime) : getTimerDurationMs();
    const next = setTimerRuntime({ running: true, endsAt: Date.now() + base, remainingMs: base });
    scheduleEndTimeout();
    return next;
}

function pauseTimer() {
    const runtime = getTimerRuntime();
    if (!runtime.running) return runtime;
    const next = setTimerRuntime({ running: false, endsAt: null, remainingMs: getTimerRemainingMs(runtime) });
    scheduleEndTimeout();
    return next;
}

function resetTimer() {
    const next = setTimerRuntime({ running: false, endsAt: null, remainingMs: getTimerDurationMs() });
    scheduleEndTimeout();
    return next;
}

// ギフト等でタイマーに分数を加算/減算する。稼働中は終了時刻を、停止中は残り時間を直接調整する。
// 下限は短縮(マイナス)にのみ作用し、上限は延長(プラス)にのみ作用する(0は無制限)。
// 戻り値の blocked は、短縮下限によって要求どおりに短縮できなかった(据え置き/下限までのクランプ)ことを示す。
// 戻り値の capped は、この延長操作によって残り時間が新規に上限へ到達したことを示す
// (開始/リセット時や、既に上限に達している状態からの再延長では発火しない)。
function adjustTimerByMinutes(deltaMinutes) {
    const deltaMs = Number(deltaMinutes) * 60000;
    const settings = getTimerSettings();
    const floorMs = settings.minFloorMinutes * 60000;
    const ceilingMs = settings.maxCeilingMinutes > 0 ? settings.maxCeilingMinutes * 60000 : null;
    const runtime = getTimerRuntime();
    const currentRemainingMs = getTimerRemainingMs(runtime);
    const blocked = deltaMs < 0 && (currentRemainingMs + deltaMs < floorMs);

    // 短縮(マイナス)発動時点で既に下限以下なら、時間を変更しない。
    if (deltaMs < 0 && currentRemainingMs <= floorMs) {
        return { runtime, blocked, capped: false };
    }

    // 短縮(マイナス)には下限を、延長(プラス)には上限を適用する。互いに逆方向には作用しない。
    const minMs = deltaMs < 0 ? floorMs : 0;
    const maxMs = deltaMs > 0 && ceilingMs !== null ? ceilingMs : MAX_TIMER_MS;
    let next;
    let nextRemainingMs;

    if (runtime.running) {
        const now = Date.now();
        const nextEndsAt = Math.min(now + maxMs, Math.max(now + minMs, runtime.endsAt + deltaMs));
        nextRemainingMs = nextEndsAt - now;
        next = setTimerRuntime({ running: true, endsAt: nextEndsAt, remainingMs: nextRemainingMs });
    } else {
        nextRemainingMs = Math.min(maxMs, Math.max(minMs, runtime.remainingMs + deltaMs));
        next = setTimerRuntime({ running: false, endsAt: null, remainingMs: nextRemainingMs });
    }

    const capped = deltaMs > 0 && ceilingMs !== null && currentRemainingMs < ceilingMs && nextRemainingMs >= ceilingMs;

    scheduleEndTimeout();
    return { runtime: next, blocked, capped };
}

// TikEffectウィジェット連携イベント（タイマーウィジェットカテゴリ）から、タイマーへ分数を加算/減算する。
function applyTimerWidgetAction(effectEvent, repeatCount = 1) {
    if (!effectEvent?.timerWidgetEnabled) return null;

    let minutesDelta;
    if (effectEvent.timerWidgetMode === 'reversal') {
        const thresholdMs = (Number(effectEvent.timerWidgetReversalThresholdMinutes) || 0) * 60000;
        const isBelow = getTimerRemainingMs() < thresholdMs;
        minutesDelta = Number(isBelow ? effectEvent.timerWidgetBelowMinutesDelta : effectEvent.timerWidgetAboveMinutesDelta) || 0;
    } else {
        minutesDelta = Number(effectEvent.timerWidgetMinutesDelta) || 0;
    }

    if (!minutesDelta) return null;

    const deltaMinutes = minutesDelta * Math.max(1, Number(repeatCount) || 1);
    const { runtime, blocked, capped } = adjustTimerByMinutes(deltaMinutes);
    if (blocked) emitTimerBlockSound();
    return { deltaMinutes, runtime, blocked, capped };
}

function buildTimerPayload() {
    const settings = getTimerSettings();
    const runtime = getTimerRuntime();
    return {
        settings,
        appearance: getTimerWidgetTextAppearance(),
        runtime: {
            running: runtime.running,
            endsAt: runtime.endsAt,
            remainingMs: getTimerRemainingMs(runtime),
        },
        serverNow: Date.now(),
    };
}

    // サーバー再起動時、稼働中だった残り時間分のタイムアウトを復元する。
    scheduleEndTimeout();

    return {
        normalizeTimerSettings, getTimerSettings, setTimerSettings, getTimerDurationMs,
        normalizeTimerRuntime, getTimerRuntime, setTimerRuntime, getTimerRemainingMs,
        startTimer, pauseTimer, resetTimer, adjustTimerByMinutes,
        applyTimerWidgetAction,
        emitTimerEndSound,
        emitTimerBlockSound,
        emitTimerCountdownSound,
        buildTimerPayload,
    };
};
