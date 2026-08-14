'use strict';

const { WIDGET_TRIGGER_X6_SETTINGS_STATE_KEY } = require('./constants');
const { normalizeSoundAsset } = require('./effect-helpers');

const TRIGGER_X6_MULTIPLIER = 6;

const DEFAULT_TRIGGER_X6_SETTINGS = {
    enabled: false,
    durationSeconds: 15,
    winRatePercent: 30,
    soundEnabled: false,
    sound: { name: '', url: '' },
    soundVolume: 100,
    winSoundEnabled: false,
    winSound: { name: '', url: '' },
    winSoundVolume: 100,
};

function normalizeTriggerX6DurationSeconds(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return DEFAULT_TRIGGER_X6_SETTINGS.durationSeconds;
    }
    return Math.min(parsed, 600);
}

function normalizeTriggerX6WinRatePercent(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return DEFAULT_TRIGGER_X6_SETTINGS.winRatePercent;
    }
    return Math.min(parsed, 100);
}

function normalizeTriggerX6SoundVolume(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed)) {
        return DEFAULT_TRIGGER_X6_SETTINGS.soundVolume;
    }
    return Math.max(0, Math.min(100, parsed));
}

function normalizeTriggerX6Settings(value) {
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
        durationSeconds: normalizeTriggerX6DurationSeconds(source.durationSeconds),
        winRatePercent: normalizeTriggerX6WinRatePercent(source.winRatePercent),
        soundEnabled: Boolean(source.soundEnabled),
        sound: normalizeSoundAsset(source.sound),
        soundVolume: normalizeTriggerX6SoundVolume(source.soundVolume),
        winSoundEnabled: Boolean(source.winSoundEnabled),
        winSound: normalizeSoundAsset(source.winSound),
        winSoundVolume: normalizeTriggerX6SoundVolume(source.winSoundVolume),
    };
}

// トリガー6倍ウィジェット: 「トリガー6倍グローブ発動」をONにしたイベントトリガーが発火すると
// 一定秒数だけ「6倍タイム」が始まり、その間に発火したイベントトリガーが設定した確率
// （デフォルト30%）で6倍（動画なら6回再生）になる。トリガー5倍とは完全に独立しており、
// 両方が同時にアクティブ・当選することもある。
module.exports = function createTriggerX6State({
    io,
    getScopedStateValue,
    setScopedStateValue,
    getTimestamp,
}) {
    // ウィンドウの終了時刻はセッション内メモリで保持する（DB永続化は不要な一時状態）。
    let activeUntil = 0;

    // 延長のたびに積み上がる発動者の時間帯（発動順）。非アクティブからの新規発動でリセットし、
    // 延長のたびに末尾へ追記する。各エントリの endsAt はその人が「発動者」として表示され続ける
    // 終了時刻 — オーバーレイ側はこれを使い、カウントダウンが実際にその枠へ入ったタイミングで
    // アイコンを切り替える（即時上書きすると残り時間と発動者アイコンが食い違って見えるため）。
    let activatorQueue = [];

    function getWidgetTriggerX6Settings() {
        return normalizeTriggerX6Settings(getScopedStateValue(WIDGET_TRIGGER_X6_SETTINGS_STATE_KEY));
    }

    function setWidgetTriggerX6Settings(settings) {
        const normalized = normalizeTriggerX6Settings(settings);
        setScopedStateValue(WIDGET_TRIGGER_X6_SETTINGS_STATE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    function isTriggerX6WindowActive() {
        return Date.now() < activeUntil;
    }

    // トリガー6倍の効果音（発動時／6倍成功時で共通）のペイロードを組み立てる。
    // オーバーレイ選択は不要 — トリガー5倍/6倍オーバーレイ自身が再生を担当する
    // （管理画面のプレビューiframeでは previewMode 判定で再生を止める）。
    function buildTriggerX6SoundPayload({ enabled, sound, volume }) {
        return {
            enabled: Boolean(enabled) && Boolean(sound?.url),
            url: sound?.url || '',
            volume,
        };
    }

    // 「トリガー6倍グローブ発動」がONのイベントトリガーが発火するたびに呼ぶ。有効ならウィンドウを(再)開始する。
    function maybeActivateTriggerX6Window(sourceEvent) {
        const settings = getWidgetTriggerX6Settings();

        if (!settings.enabled) {
            return;
        }

        // 既にウィンドウが有効な状態での再検知は「延長」として区別し、
        // オーバーレイ側で電撃演出（新規ポップインではなく延長エフェクト）を出し分けられるようにする。
        const extended = isTriggerX6WindowActive();
        const now = Date.now();

        // 延長は残り時間に加算する（上限なし）。非アクティブな状態からの発動は現在時刻を起点にする。
        const base = extended ? activeUntil : now;
        activeUntil = base + settings.durationSeconds * 1000;

        // 非アクティブからの新規発動はキューをリセット。延長は末尾に追記し、
        // その人の枠が「それまでの残り時間 〜 今回追加した分」になるようにする。
        if (!extended) {
            activatorQueue = [];
        }
        activatorQueue.push({
            nickname: sourceEvent?.nickname || sourceEvent?.uniqueId || 'リスナー',
            image: sourceEvent?.image || '',
            endsAt: activeUntil,
        });

        // 効果音は新規発動・延長（発動中の再発動）のどちらでも再生する。
        io.emit('widgets:trigger-x6:window', {
            active: true,
            extended,
            durationSeconds: settings.durationSeconds,
            remainingSeconds: Math.max(1, Math.ceil((activeUntil - now) / 1000)),
            nickname: sourceEvent?.nickname || sourceEvent?.uniqueId || 'リスナー',
            image: sourceEvent?.image || '',
            timestamp: getTimestamp(),
            // 延長のたびに積み上がる発動者の時間帯。オーバーレイ側はこれを使って、
            // カウントダウンが実際にその人の枠に入ったタイミングでアイコンを切り替える。
            activators: activatorQueue.map((entry) => ({
                nickname: entry.nickname,
                image: entry.image,
                endsInSeconds: Math.max(1, Math.ceil((entry.endsAt - now) / 1000)),
            })),
            sound: buildTriggerX6SoundPayload({
                enabled: settings.soundEnabled,
                sound: settings.sound,
                volume: settings.soundVolume,
            }),
        });
    }

    // イベントトリガー発火のたびに呼ぶ抽選。ウィンドウが非アクティブなら常にfalse。
    function rollTriggerX6() {
        if (!isTriggerX6WindowActive()) {
            return false;
        }
        const settings = getWidgetTriggerX6Settings();
        return Math.random() < settings.winRatePercent / 100;
    }

    function emitTriggerX6Win(sourceEvent) {
        const settings = getWidgetTriggerX6Settings();
        const nickname = sourceEvent?.nickname || sourceEvent?.uniqueId || 'リスナー';

        io.emit('widgets:trigger-x6:won', {
            nickname,
            image: sourceEvent?.image || '',
            giftImage: sourceEvent?.giftImage || '',
            timestamp: getTimestamp(),
            sound: buildTriggerX6SoundPayload({
                enabled: settings.winSoundEnabled,
                sound: settings.winSound,
                volume: settings.winSoundVolume,
            }),
        });
    }

    function buildTriggerX6Payload() {
        return {
            settings: getWidgetTriggerX6Settings(),
            active: isTriggerX6WindowActive(),
        };
    }

    return {
        normalizeTriggerX6Settings,
        getWidgetTriggerX6Settings,
        setWidgetTriggerX6Settings,
        isTriggerX6WindowActive,
        maybeActivateTriggerX6Window,
        rollTriggerX6,
        emitTriggerX6Win,
        buildTriggerX6Payload,
        TRIGGER_X6_MULTIPLIER,
    };
};
