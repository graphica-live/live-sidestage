'use strict';

const {
    WIDGET_TIMER_SETTINGS_STATE_KEY,
    WIDGET_TIMER_STATE_KEY,
} = require('./constants');
const { normalizeEffectText, normalizeWholeNumber, normalizeBooleanInput } = require('./utils');
const { normalizeSoundAsset } = require('./effect-helpers');

const MAX_TIMER_GIFT_SLOTS = 3;
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

const DEFAULT_TIMER_SETTINGS = {
    durationMinutes: 10,
    durationSeconds: 0,
    headingText: 'カウントダウン',
    slots: [],
    reversalThresholdMinutes: 5,
    reversalSlots: [],
    endSound: { name: '', url: '' },
    endSoundVolume: 100,
    endSoundScreen: 1,
    minFloorMinutes: 0,
};

module.exports = function createTimerState({
    io,
    getScopedStateValue, setScopedStateValue,
    getTimerWidgetTextAppearance,
}) {

let endTimeoutHandle = null;

function normalizeSignedMinutes(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed)) return 0;
    return Math.max(-180, Math.min(180, parsed));
}

function normalizeTimerSoundVolume(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed)) return DEFAULT_TIMER_SETTINGS.endSoundVolume;
    return Math.max(0, Math.min(100, parsed));
}

function normalizeTimerGiftSlot(value) {
    const source = value && typeof value === 'object' ? value : {};
    const giftId = normalizeEffectText(source.giftId, 80);
    const giftName = normalizeEffectText(source.giftName, 80);
    const giftImage = normalizeEffectText(source.giftImage, 400);
    const minutesDelta = normalizeSignedMinutes(source.minutesDelta);

    return {
        enabled: Boolean(giftId),
        giftId,
        giftName,
        giftImage,
        minutesDelta,
    };
}

function normalizeTimerReversalGiftSlot(value) {
    const source = value && typeof value === 'object' ? value : {};
    const giftId = normalizeEffectText(source.giftId, 80);
    const giftName = normalizeEffectText(source.giftName, 80);
    const giftImage = normalizeEffectText(source.giftImage, 400);
    const belowMinutesDelta = normalizeSignedMinutes(source.belowMinutesDelta);
    const aboveMinutesDelta = normalizeSignedMinutes(source.aboveMinutesDelta);

    return {
        enabled: Boolean(giftId),
        giftId,
        giftName,
        giftImage,
        belowMinutesDelta,
        aboveMinutesDelta,
    };
}

function normalizeReversalThresholdMinutes(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed)) return DEFAULT_TIMER_SETTINGS.reversalThresholdMinutes;
    return Math.max(0, Math.min(180, parsed));
}

function normalizeMinFloorMinutes(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed)) return DEFAULT_TIMER_SETTINGS.minFloorMinutes;
    return Math.max(0, Math.min(1440, parsed));
}

function normalizeEndSoundScreen(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return DEFAULT_TIMER_SETTINGS.endSoundScreen;
    return parsed;
}

function normalizeTimerSettings(value) {
    let source = value;
    if (typeof source === 'string') {
        try { source = JSON.parse(source); } catch { source = null; }
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) source = {};

    const durationMinutes = normalizeWholeNumber(source.durationMinutes);
    const durationSeconds = normalizeWholeNumber(source.durationSeconds);
    const rawSlots = Array.isArray(source.slots) ? source.slots : [];
    const slots = [];
    for (let i = 0; i < MAX_TIMER_GIFT_SLOTS; i++) {
        slots.push(normalizeTimerGiftSlot(rawSlots[i]));
    }
    const rawReversalSlots = Array.isArray(source.reversalSlots) ? source.reversalSlots : [];
    const reversalSlots = [];
    for (let i = 0; i < MAX_TIMER_GIFT_SLOTS; i++) {
        reversalSlots.push(normalizeTimerReversalGiftSlot(rawReversalSlots[i]));
    }

    return {
        durationMinutes: durationMinutes !== null ? Math.min(durationMinutes, 1440) : DEFAULT_TIMER_SETTINGS.durationMinutes,
        durationSeconds: durationSeconds !== null ? Math.min(durationSeconds, 59) : DEFAULT_TIMER_SETTINGS.durationSeconds,
        headingText: normalizeEffectText(source.headingText, 40) || DEFAULT_TIMER_SETTINGS.headingText,
        slots,
        reversalThresholdMinutes: normalizeReversalThresholdMinutes(source.reversalThresholdMinutes),
        reversalSlots,
        endSound: normalizeSoundAsset(source.endSound),
        endSoundVolume: normalizeTimerSoundVolume(source.endSoundVolume),
        endSoundScreen: normalizeEndSoundScreen(source.endSoundScreen),
        minFloorMinutes: normalizeMinFloorMinutes(source.minFloorMinutes),
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
function adjustTimerByMinutes(deltaMinutes) {
    const deltaMs = Number(deltaMinutes) * 60000;
    const floorMs = getTimerSettings().minFloorMinutes * 60000;
    const runtime = getTimerRuntime();

    // 短縮(マイナス)発動時点で既に下限以下なら、時間を変更しない。
    if (deltaMs < 0 && getTimerRemainingMs(runtime) <= floorMs) {
        return runtime;
    }

    let next;

    if (runtime.running) {
        const now = Date.now();
        const nextEndsAt = Math.min(now + MAX_TIMER_MS, Math.max(now + floorMs, runtime.endsAt + deltaMs));
        next = setTimerRuntime({ running: true, endsAt: nextEndsAt, remainingMs: nextEndsAt - now });
    } else {
        const nextRemaining = Math.min(MAX_TIMER_MS, Math.max(floorMs, runtime.remainingMs + deltaMs));
        next = setTimerRuntime({ running: false, endsAt: null, remainingMs: nextRemaining });
    }

    scheduleEndTimeout();
    return next;
}

// ギフトイベントを設定済みスロットと照合し、一致すればタイマーを調整する。
function applyTimerGiftEvent(giftId, repeatCount = 1) {
    const normalizedGiftId = String(giftId || '');
    if (!normalizedGiftId) return null;

    const settings = getTimerSettings();
    const slot = settings.slots.find((s) => s.enabled && s.giftId === normalizedGiftId);
    if (slot && slot.minutesDelta) {
        const deltaMinutes = slot.minutesDelta * Math.max(1, Number(repeatCount) || 1);
        const runtime = adjustTimerByMinutes(deltaMinutes);
        return { slot, deltaMinutes, runtime };
    }

    // 反転スロット: 残り時間が境界時間未満なら左(below)、以上なら右(above)の値を使う。
    const reversalSlot = settings.reversalSlots.find((s) => s.enabled && s.giftId === normalizedGiftId);
    if (reversalSlot) {
        const isBelow = getTimerRemainingMs() < settings.reversalThresholdMinutes * 60000;
        const minutesDelta = isBelow ? reversalSlot.belowMinutesDelta : reversalSlot.aboveMinutesDelta;
        if (minutesDelta) {
            const deltaMinutes = minutesDelta * Math.max(1, Number(repeatCount) || 1);
            const runtime = adjustTimerByMinutes(deltaMinutes);
            return { slot: reversalSlot, deltaMinutes, runtime };
        }
    }

    return null;
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
        MAX_TIMER_GIFT_SLOTS,
        normalizeTimerSettings, getTimerSettings, setTimerSettings, getTimerDurationMs,
        normalizeTimerRuntime, getTimerRuntime, setTimerRuntime, getTimerRemainingMs,
        startTimer, pauseTimer, resetTimer, adjustTimerByMinutes,
        applyTimerGiftEvent,
        emitTimerEndSound,
        buildTimerPayload,
    };
};
