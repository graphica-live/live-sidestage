'use strict';

const { io } = require('socket.io-client');

// TikTok LIVE Studio 純正 Stream Deck プラグイン(com.tiktok.livestudio.sdPlugin)を
// リバースエンジニアリングして判明したローカル Socket.IO プロトコル。
// LIVE Studio 自身がこのいずれかのポートで ws サーバーを立てるため、全候補に
// 並行接続を試み、最初に繋がったものを採用する。
const CANDIDATE_PORTS = [28189, 39728, 34246, 42205, 38534, 40825, 40622];
const WS_SUBPROTOCOL = 'streamdeck_ttls_v1';
const PORT_TRY_STAGGER_MS = 200;
const RESCAN_DELAY_MS = 5000;

const channel = (name) => `stream_deck/${name}`;

let activeSocket = null;
let pendingSockets = [];
let lsSettings = null;
let connected = false;
let rescanTimer = null;

function clearPendingSockets() {
    pendingSockets.forEach(({ socket, timeout }) => {
        if (timeout) clearTimeout(timeout);
        try { socket?.close(); } catch { /* noop */ }
    });
    pendingSockets = [];
}

function scheduleRescan() {
    if (rescanTimer) return;
    rescanTimer = setTimeout(() => {
        rescanTimer = null;
        startScan();
    }, RESCAN_DELAY_MS);
}

function handleActiveConnected(socket) {
    activeSocket = socket;
    connected = true;

    socket.emit(channel('join_room'));

    socket.on(channel('join_room'), () => {
        socket.emit(channel('sync_settings'));
    });

    socket.on(channel('sync_settings'), (raw) => {
        try {
            lsSettings = JSON.parse(raw);
        } catch (error) {
            console.warn('⚠️ LIVE Studio sync_settings のパースに失敗しました:', error.message);
        }
    });

    socket.on('disconnect', () => {
        connected = false;
        lsSettings = null;
        if (activeSocket === socket) {
            activeSocket = null;
        }
        scheduleRescan();
    });
}

function startScan() {
    if (activeSocket) return;
    clearPendingSockets();

    CANDIDATE_PORTS.forEach((port, index) => {
        const entry = { port, socket: null, timeout: null };
        pendingSockets.push(entry);

        entry.timeout = setTimeout(() => {
            const socket = io(`ws://127.0.0.1:${port}`, {
                transports: ['websocket'],
                reconnection: false,
                timeout: 1000,
                protocols: [WS_SUBPROTOCOL]
            });
            entry.socket = socket;

            socket.once('connect', () => {
                if (activeSocket) {
                    socket.close();
                    return;
                }
                const idx = pendingSockets.indexOf(entry);
                if (idx !== -1) pendingSockets.splice(idx, 1);
                handleActiveConnected(socket);
            });

            socket.once('connect_error', () => {
                socket.close();
            });
        }, index * PORT_TRY_STAGGER_MS);
    });

    setTimeout(() => {
        if (!activeSocket) {
            scheduleRescan();
        }
    }, CANDIDATE_PORTS.length * PORT_TRY_STAGGER_MS + 2000);
}

function startLiveStudioConnection() {
    startScan();
}

function closeLiveStudioConnection() {
    if (rescanTimer) {
        clearTimeout(rescanTimer);
        rescanTimer = null;
    }
    pendingCameraOffByPlaybackId.forEach((pending) => clearTimeout(pending.fallbackTimer));
    pendingCameraOffByPlaybackId.clear();
    if (queuedActionSweepTimer) {
        clearTimeout(queuedActionSweepTimer);
        queuedActionSweepTimer = null;
    }
    pendingQueuedActionByPlaybackId.clear();
    lastProgressAtByScreen.clear();
    if (actionTimer) {
        clearTimeout(actionTimer);
        actionTimer = null;
    }
    actionQueue = [];
    clearPendingSockets();
    if (activeSocket) {
        try { activeSocket.close(); } catch { /* noop */ }
        activeSocket = null;
    }
    connected = false;
}

function getLiveStudioStatus() {
    return { connected };
}

function getLiveStudioSettings() {
    return lsSettings;
}

const ACTION_BUILDERS = {
    scene: (event) => ({
        action: 'com.tiktok.livestudio.scene',
        payload: { settings: { scene: String(event.lsScene || '') } }
    }),
    cameraeffects: (event) => ({
        action: 'com.tiktok.livestudio.cameraeffects',
        payload: {
            settings: {
                cameraSource: String(event.lsCameraSource || ''),
                cameraEffectType: String(event.lsCameraEffectType || ''),
                cameraEffectId: String(event.lsCameraEffectId || '')
            }
        }
    }),
    soundeffect: (event) => ({
        action: 'com.tiktok.livestudio.soundeffect',
        payload: { settings: { currentSound: String(event.lsSoundEffect || '') } }
    }),
    vibe: (event) => ({
        action: 'com.tiktok.livestudio.vibe',
        payload: { settings: { currentVibeId: String(event.lsVibeId || '') } }
    })
};

// OFF送信の直後に次のONを間髪入れずに送ると、LIVE Studio側のトグル処理が
// 追いつかずOFFが無視される（＝エフェクトが解除されない）ことがある。
// オーバーレイはキュー内アイテムの再生終了→次アイテムの再生開始をほぼ同一tickで
// 通知してくるため、送信側で最低間隔を強制しFIFOで捌く。
const MIN_ACTION_GAP_MS = 200;
let lastActionSentAt = 0;
let actionQueue = [];
let actionTimer = null;

function drainActionQueue() {
    actionTimer = null;

    if (!activeSocket || !connected) {
        actionQueue = [];
        return;
    }

    const next = actionQueue.shift();
    if (next) {
        lastActionSentAt = Date.now();
        try {
            activeSocket.emit(channel('action_emit'), JSON.stringify(next));
        } catch (error) {
            console.warn('⚠️ LIVE Studio へのアクション送信に失敗しました:', error.message);
        }
    }

    if (actionQueue.length > 0) scheduleActionQueue();
}

function scheduleActionQueue() {
    if (actionTimer) return;
    const gap = Math.max(0, MIN_ACTION_GAP_MS - (Date.now() - lastActionSentAt));
    actionTimer = setTimeout(drainActionQueue, gap);
}

function emitAction(action) {
    if (!activeSocket || !connected) return;
    actionQueue.push(action);
    scheduleActionQueue();
}

// カメラエフェクトは同じ cameraSource/cameraEffectType/cameraEffectId をもう一度
// 送るとトグルでOFFになる（LIVE Studio側の仕様）。専用の「OFF」ペイロードは
// 存在しないため、ON時と全く同じアクションを再送することでOFFにする。
//
// 「イベント終了後にオフ」は、そのイベントの動画/音声再生が実際に終わった
// タイミング（オーバーレイ側からの effects:playback-finished 通知）に合わせて
// OFFを送る。通知が来ない場合（オーバーレイが開かれていない等）にエフェクトが
// 永久にONのまま残らないよう、フォールバックのタイムアウトも併せて仕込む。
const CAMERA_AUTO_OFF_FALLBACK_MS = 2 * 60 * 1000;
const pendingCameraOffByPlaybackId = new Map();

function fireCameraOff(playbackId) {
    const pending = pendingCameraOffByPlaybackId.get(playbackId);
    if (!pending) return;

    pendingCameraOffByPlaybackId.delete(playbackId);
    clearTimeout(pending.fallbackTimer);
    emitAction({ ...pending.action, context: `${pending.action.context}-off` });
}

function registerCameraAutoOff(playbackId, action) {
    if (!playbackId) return;

    const fallbackTimer = setTimeout(() => fireCameraOff(playbackId), CAMERA_AUTO_OFF_FALLBACK_MS);
    pendingCameraOffByPlaybackId.set(playbackId, { action, fallbackTimer });
}

// 再生終了通知（effects:playback-finished）を受けてOFFを送る。socket-handlers.js から呼ばれる。
function notifyLiveStudioPlaybackFinished(playbackId, screen) {
    markScreenProgress(screen);
    if (!playbackId) return;
    fireCameraOff(playbackId);
}

// イベントが連続発火すると、対象SCREENのオーバーレイ再生キューには複数件が積まれ
// 順番に再生される。ここで即座にTLSアクションを送ると、まだ再生中の先行イベントを
// 追い越して後続イベントのTLS操作（シーン切替・カメラエフェクト等）が先に届いてしまう。
// そのためTLSアクションは即時送信せずキューに積んでおき、オーバーレイ側からの
// effects:playback-started（そのキューアイテムの再生順が実際に来たタイミング）を
// 受けて初めて送信する。
//
// オーバーレイが開かれていない等で通知が来ないケースに備え、フォールバックタイムアウトも
// 仕込むが、固定時間で無条件に発火すると「同一screenのキューが単に長い」だけの正常系
// （例: 同じ動画トリガーの連投でキューが数分分積み上がる）まで巻き込んで先走ってしまう。
// そのため screen ごとに「最後に再生の進行（started/finished）があった時刻」を記録し、
// その screen のキューが実際に進行し続けている間はフォールバックの起点を都度後ろへずらす。
// フォールバックが本当に発火するのは、そのscreenで一定時間まったく進行がない
// （＝オーバーレイが本当に応答していない）場合のみになる。
const QUEUED_ACTION_FALLBACK_MS = 2 * 60 * 1000;
const QUEUED_ACTION_SWEEP_INTERVAL_MS = 5000;
const pendingQueuedActionByPlaybackId = new Map();
const lastProgressAtByScreen = new Map();
let queuedActionSweepTimer = null;

function markScreenProgress(screen) {
    if (screen === undefined || screen === null) return;
    lastProgressAtByScreen.set(screen, Date.now());
}

function scheduleQueuedActionSweep() {
    if (queuedActionSweepTimer) return;
    queuedActionSweepTimer = setTimeout(() => {
        queuedActionSweepTimer = null;
        sweepQueuedActionFallbacks();
    }, QUEUED_ACTION_SWEEP_INTERVAL_MS);
}

function sweepQueuedActionFallbacks() {
    const now = Date.now();

    pendingQueuedActionByPlaybackId.forEach((pending, playbackId) => {
        const lastProgressAt = lastProgressAtByScreen.get(pending.screen) || 0;
        const baseline = Math.max(pending.registeredAt, lastProgressAt);

        if (now - baseline >= QUEUED_ACTION_FALLBACK_MS) {
            firePendingQueuedAction(playbackId);
        }
    });

    if (pendingQueuedActionByPlaybackId.size > 0) {
        scheduleQueuedActionSweep();
    }
}

function firePendingQueuedAction(playbackId) {
    const pending = pendingQueuedActionByPlaybackId.get(playbackId);
    if (!pending) return;

    pendingQueuedActionByPlaybackId.delete(playbackId);
    emitAction(pending.action);

    if (pending.autoOff) {
        registerCameraAutoOff(pending.finishPlaybackId, pending.action);
    }
}

// 再生開始通知（effects:playback-started）を受けてONを送る。socket-handlers.js から呼ばれる。
function notifyLiveStudioPlaybackStarted(playbackId, screen) {
    markScreenProgress(screen);
    if (!playbackId) return;
    firePendingQueuedAction(playbackId);
}

// startPlaybackId: バッチ内1回目の再生開始（ONを送るタイミング）に対応するオーバーレイ側ID。
// finishPlaybackId: バッチ内最後の再生終了（OFFを送るタイミング）に対応するオーバーレイ側ID。
// playbackCount>1（トリガー5倍・コンボ分割再生）の場合、この2つは異なるIDになる。
// 両方とも同じ`-0`扱いにすると、バッチ1回目の再生が終わった時点でOFFが発火してしまい、
// 残りの再生中はエフェクトが解除されたままになる。
function sendLiveStudioActionForEffectEvent(effectEvent, startPlaybackId, finishPlaybackId) {
    if (!effectEvent?.lsEnabled || !activeSocket || !connected) {
        return;
    }

    const build = ACTION_BUILDERS[effectEvent.lsActionType];
    if (!build) return;

    const context = `tikeffect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const action = { ...build(effectEvent), context };
    const autoOff = effectEvent.lsActionType === 'cameraeffects' && effectEvent.lsCameraAutoOffEnabled;

    pendingQueuedActionByPlaybackId.set(startPlaybackId, {
        action,
        autoOff,
        finishPlaybackId,
        screen: effectEvent.screen,
        registeredAt: Date.now()
    });
    scheduleQueuedActionSweep();
}

module.exports = {
    startLiveStudioConnection,
    closeLiveStudioConnection,
    getLiveStudioStatus,
    getLiveStudioSettings,
    sendLiveStudioActionForEffectEvent,
    notifyLiveStudioPlaybackFinished,
    notifyLiveStudioPlaybackStarted
};
