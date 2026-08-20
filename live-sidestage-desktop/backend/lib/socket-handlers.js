'use strict';

module.exports = function registerSocketHandlers({
    io,
    getDisplayDayKey,
    emitOverlaySnapshot,
    createAdminDayPayload,
    createAdminCommentsPayload,
    giftJarHistory,
    giftJarConfig,
    getGiftJarLastPositions,
    setGiftJarLastPositions,
    scheduleGiftJarPositionsPersist,
    customJarHistory,
    getCustomJarLastPositions,
    setCustomJarLastPositions,
    buildCustomJarPayload,
    buildPushPullSnapshot,
    getPendingUpdateInfo,
    notifyLiveStudioPlaybackFinished,
    notifyLiveStudioPlaybackStarted,
    notifyLiveStudioPlaybackDropped,
}) {
    io.on('connection', (socket) => {
        const displayDayKey = getDisplayDayKey();
        emitOverlaySnapshot(socket, displayDayKey);
        socket.emit('admin_day_updated', createAdminDayPayload(displayDayKey));
        socket.emit('admin_comments_updated', createAdminCommentsPayload());
        // ---- 瓶詰めギフト（非表示中につき処理停止・PC負荷軽減） ----
        /*
        if (giftJarHistory.length > 0) {
            socket.emit('widgets:gift-jar:history', giftJarHistory);
        }
        // Send config before positions so walls are built before bodies are placed.
        socket.emit('widgets:gift-jar:config', { ...giftJarConfig });
        const giftJarLastPositions = getGiftJarLastPositions();
        if (giftJarLastPositions && giftJarLastPositions.length > 0) {
            socket.emit('widgets:gift-jar:positions', giftJarLastPositions);
        }
        socket.on('widgets:gift-jar:positions', (data) => {
            if (Array.isArray(data) && data.length > 0 && data[0]?.settled) {
                setGiftJarLastPositions(data);
                scheduleGiftJarPositionsPersist();
            }
            socket.broadcast.emit('widgets:gift-jar:positions', data);
        });
        */
        // ---- /瓶詰めギフト ----

        // ---- オリジナル瓶詰めギフト（非表示中につき処理停止・PC負荷軽減） ----
        /*
        socket.emit('widgets:custom-jar:config', buildCustomJarPayload());
        if (customJarHistory.length > 0) socket.emit('widgets:custom-jar:history', customJarHistory);
        const customJarLastPositions = getCustomJarLastPositions();
        if (customJarLastPositions?.length > 0) socket.emit('widgets:custom-jar:positions', customJarLastPositions);
        socket.on('widgets:custom-jar:positions', (data) => {
            if (Array.isArray(data) && data.length > 0 && data[0]?.settled) {
                setCustomJarLastPositions(data);
            }
            socket.broadcast.emit('widgets:custom-jar:positions', data);
        });
        */
        // ---- /オリジナル瓶詰めギフト ----
        socket.on('overlay:join-room', (room) => {
            if (room === 'gift-jar' || room === 'custom-jar') {
                socket.join(room);
                console.log('[overlay:join-room] socket', socket.id, '→ room:', room);
            }
        });
        socket.on('debug:event-received', ({ event, mode, url }) => {
            console.log('[debug:event-received] socket', socket.id, '| mode:', mode, '| url:', url, '| event:', event);
        });
        // オーバーレイ側の動画/音声再生エラーを管理画面へ中継し、原因不明な無反応を可視化する。
        socket.on('effects:playback-error', (payload) => {
            console.warn('[effects:playback-error]', payload);
            socket.broadcast.emit('effects:playback-error', payload);
        });
        // オーバーレイ側の動画/音声再生が終わったタイミングで、
        // LIVE Studioの「イベント終了後にオフ」待ちのカメラエフェクトを解除する。
        socket.on('effects:playback-finished', ({ playbackId, screen } = {}) => {
            notifyLiveStudioPlaybackFinished(playbackId, screen);
        });
        // オーバーレイ側の再生キューで該当イベントの順番が実際に来たタイミングで、
        // 保留中のLIVE Studio（TLS）連携アクションを送信する。
        socket.on('effects:playback-started', ({ playbackId, screen } = {}) => {
            notifyLiveStudioPlaybackStarted(playbackId, screen);
        });
        // オーバーレイ側の待機列（待機イベント削除など）で再生開始前に間引かれたアイテムを
        // バックエンドへ伝え、対応する保留中のLIVE Studio連携アクションを掃除する。
        socket.on('effects:playback:dropped', ({ playbackIds } = {}) => {
            notifyLiveStudioPlaybackDropped(playbackIds);
        });
        socket.emit('widgets:push-pull:snapshot', buildPushPullSnapshot());
        const pendingUpdateInfo = getPendingUpdateInfo();
        if (pendingUpdateInfo) {
            socket.emit('app:update-ready', { version: pendingUpdateInfo.version });
        }
    });
};
