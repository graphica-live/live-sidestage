'use strict';

const { WIDGET_TRIGGER_X5_SETTINGS_STATE_KEY } = require('./constants');
const { normalizeEffectText } = require('./utils');

const TRIGGER_X5_MULTIPLIER = 5;

const DEFAULT_TRIGGER_X5_SETTINGS = {
    enabled: false,
    giftName: '',
    durationSeconds: 15,
    winRatePercent: 30,
};

function normalizeTriggerX5DurationSeconds(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return DEFAULT_TRIGGER_X5_SETTINGS.durationSeconds;
    }
    return Math.min(parsed, 600);
}

function normalizeTriggerX5WinRatePercent(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return DEFAULT_TRIGGER_X5_SETTINGS.winRatePercent;
    }
    return Math.min(parsed, 100);
}

function normalizeTriggerX5Settings(value) {
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
        enabled: Boolean(source.enabled),
        giftName: normalizeEffectText(source.giftName, 80).toLowerCase(),
        durationSeconds: normalizeTriggerX5DurationSeconds(source.durationSeconds),
        winRatePercent: normalizeTriggerX5WinRatePercent(source.winRatePercent),
    };
}

// トリガー5倍ウィジェット: 設定したギフトが飛ぶと一定秒数だけ「5倍タイム」が始まり、
// その間に発火したイベントトリガーが設定した確率（デフォルト30%）で5倍（動画なら5回再生）になる。
module.exports = function createTriggerX5State({
    io,
    getScopedStateValue,
    setScopedStateValue,
    getTimestamp,
}) {
    // ウィンドウの終了時刻はセッション内メモリで保持する（DB永続化は不要な一時状態）。
    let activeUntil = 0;

    function getWidgetTriggerX5Settings() {
        return normalizeTriggerX5Settings(getScopedStateValue(WIDGET_TRIGGER_X5_SETTINGS_STATE_KEY));
    }

    function setWidgetTriggerX5Settings(settings) {
        const normalized = normalizeTriggerX5Settings(settings);
        setScopedStateValue(WIDGET_TRIGGER_X5_SETTINGS_STATE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    function isTriggerX5WindowActive() {
        return Date.now() < activeUntil;
    }

    // 発動条件のギフトを受け取るたびに呼ぶ。設定と一致すればウィンドウを(再)開始する。
    function maybeActivateTriggerX5Window(giftName) {
        const settings = getWidgetTriggerX5Settings();

        if (!settings.enabled || !settings.giftName) {
            return;
        }

        if (normalizeEffectText(giftName, 80).toLowerCase() !== settings.giftName) {
            return;
        }

        activeUntil = Date.now() + settings.durationSeconds * 1000;
        io.emit('widgets:trigger-x5:window', {
            active: true,
            durationSeconds: settings.durationSeconds,
            timestamp: getTimestamp(),
        });
    }

    // イベントトリガー発火のたびに呼ぶ抽選。ウィンドウが非アクティブなら常にfalse。
    function rollTriggerX5() {
        if (!isTriggerX5WindowActive()) {
            return false;
        }
        const settings = getWidgetTriggerX5Settings();
        return Math.random() < settings.winRatePercent / 100;
    }

    function emitTriggerX5Win(sourceEvent) {
        io.emit('widgets:trigger-x5:won', {
            nickname: sourceEvent?.nickname || sourceEvent?.uniqueId || 'リスナー',
            image: sourceEvent?.image || '',
            timestamp: getTimestamp(),
        });
    }

    function buildTriggerX5Payload() {
        return {
            settings: getWidgetTriggerX5Settings(),
            active: isTriggerX5WindowActive(),
        };
    }

    return {
        normalizeTriggerX5Settings,
        getWidgetTriggerX5Settings,
        setWidgetTriggerX5Settings,
        isTriggerX5WindowActive,
        maybeActivateTriggerX5Window,
        rollTriggerX5,
        emitTriggerX5Win,
        buildTriggerX5Payload,
        TRIGGER_X5_MULTIPLIER,
    };
};
