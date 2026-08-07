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

function sendLiveStudioActionForEffectEvent(effectEvent) {
    if (!effectEvent?.lsEnabled || !activeSocket || !connected) {
        return;
    }

    const build = ACTION_BUILDERS[effectEvent.lsActionType];
    if (!build) return;

    const context = `tikeffect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const action = { ...build(effectEvent), context };

    try {
        activeSocket.emit(channel('action_emit'), JSON.stringify(action));
    } catch (error) {
        console.warn('⚠️ LIVE Studio へのアクション送信に失敗しました:', error.message);
    }
}

module.exports = {
    startLiveStudioConnection,
    closeLiveStudioConnection,
    getLiveStudioStatus,
    getLiveStudioSettings,
    sendLiveStudioActionForEffectEvent
};
