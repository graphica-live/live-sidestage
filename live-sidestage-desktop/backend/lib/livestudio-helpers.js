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

function emitAction(action) {
    if (!activeSocket || !connected) return;

    try {
        activeSocket.emit(channel('action_emit'), JSON.stringify(action));
    } catch (error) {
        console.warn('⚠️ LIVE Studio へのアクション送信に失敗しました:', error.message);
    }
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
function notifyLiveStudioPlaybackFinished(playbackId) {
    if (!playbackId) return;
    fireCameraOff(playbackId);
}

function sendLiveStudioActionForEffectEvent(effectEvent, playbackId) {
    if (!effectEvent?.lsEnabled || !activeSocket || !connected) {
        return;
    }

    const build = ACTION_BUILDERS[effectEvent.lsActionType];
    if (!build) return;

    const context = `tikeffect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const action = { ...build(effectEvent), context };

    emitAction(action);

    if (effectEvent.lsActionType === 'cameraeffects' && effectEvent.lsCameraAutoOffEnabled) {
        registerCameraAutoOff(playbackId, action);
    }
}

module.exports = {
    startLiveStudioConnection,
    closeLiveStudioConnection,
    getLiveStudioStatus,
    getLiveStudioSettings,
    sendLiveStudioActionForEffectEvent,
    notifyLiveStudioPlaybackFinished
};
