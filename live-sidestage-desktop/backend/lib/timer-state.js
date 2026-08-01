'use strict';

const {
    WIDGET_TIMER_SETTINGS_STATE_KEY,
    WIDGET_TIMER_STATE_KEY,
} = require('./constants');
const { normalizeEffectText, normalizeWholeNumber, normalizeBooleanInput } = require('./utils');

const MAX_TIMER_GIFT_SLOTS = 3;
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

const DEFAULT_TIMER_SETTINGS = {
    durationMinutes: 10,
    durationSeconds: 0,
    headingText: 'カウントダウン',
    slots: [],
    endSound: { name: '', url: '' },
};

module.exports = function createTimerState({
    getScopedStateValue, setScopedStateValue,
    getTimerWidgetTextAppearance,
}) {

function normalizeSignedMinutes(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed)) return 0;
    return Math.max(-180, Math.min(180, parsed));
}

function normalizeTimerSoundAsset(value) {
    if (!value || typeof value !== 'object') return { name: '', url: '' };
    const url = String(value.url || '').trim();
    const isSafeUrl = /^\/sound\/[^\s"'<>]+$/.test(url);
    return {
        name: normalizeEffectText(value.name, 120),
        url: isSafeUrl ? url : '',
    };
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

    return {
        durationMinutes: durationMinutes !== null ? Math.min(durationMinutes, 1440) : DEFAULT_TIMER_SETTINGS.durationMinutes,
        durationSeconds: durationSeconds !== null ? Math.min(durationSeconds, 59) : DEFAULT_TIMER_SETTINGS.durationSeconds,
        headingText: normalizeEffectText(source.headingText, 40) || DEFAULT_TIMER_SETTINGS.headingText,
        slots,
        endSound: normalizeTimerSoundAsset(source.endSound),
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

function startTimer() {
    const runtime = getTimerRuntime();
    const base = getTimerRemainingMs(runtime) > 0 ? getTimerRemainingMs(runtime) : getTimerDurationMs();
    return setTimerRuntime({ running: true, endsAt: Date.now() + base, remainingMs: base });
}

function pauseTimer() {
    const runtime = getTimerRuntime();
    if (!runtime.running) return runtime;
    return setTimerRuntime({ running: false, endsAt: null, remainingMs: getTimerRemainingMs(runtime) });
}

function resetTimer() {
    return setTimerRuntime({ running: false, endsAt: null, remainingMs: getTimerDurationMs() });
}

// ギフト等でタイマーに分数を加算/減算する。稼働中は終了時刻を、停止中は残り時間を直接調整する。
function adjustTimerByMinutes(deltaMinutes) {
    const deltaMs = Number(deltaMinutes) * 60000;
    const runtime = getTimerRuntime();

    if (runtime.running) {
        const now = Date.now();
        const nextEndsAt = Math.min(now + MAX_TIMER_MS, Math.max(now, runtime.endsAt + deltaMs));
        return setTimerRuntime({ running: true, endsAt: nextEndsAt, remainingMs: nextEndsAt - now });
    }

    const nextRemaining = Math.min(MAX_TIMER_MS, Math.max(0, runtime.remainingMs + deltaMs));
    return setTimerRuntime({ running: false, endsAt: null, remainingMs: nextRemaining });
}

// ギフトイベントを設定済みスロットと照合し、一致すればタイマーを調整する。
function applyTimerGiftEvent(giftId, repeatCount = 1) {
    const normalizedGiftId = String(giftId || '');
    if (!normalizedGiftId) return null;

    const settings = getTimerSettings();
    const slot = settings.slots.find((s) => s.enabled && s.giftId === normalizedGiftId);
    if (!slot || !slot.minutesDelta) return null;

    const deltaMinutes = slot.minutesDelta * Math.max(1, Number(repeatCount) || 1);
    const runtime = adjustTimerByMinutes(deltaMinutes);

    return { slot, deltaMinutes, runtime };
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

    return {
        MAX_TIMER_GIFT_SLOTS,
        normalizeTimerSettings, getTimerSettings, setTimerSettings, getTimerDurationMs,
        normalizeTimerRuntime, getTimerRuntime, setTimerRuntime, getTimerRemainingMs,
        startTimer, pauseTimer, resetTimer, adjustTimerByMinutes,
        applyTimerGiftEvent,
        buildTimerPayload,
    };
};
