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
}) {
    io.on('connection', (socket) => {
        const displayDayKey = getDisplayDayKey();
        emitOverlaySnapshot(socket, displayDayKey);
        socket.emit('admin_day_updated', createAdminDayPayload(displayDayKey));
        socket.emit('admin_comments_updated', createAdminCommentsPayload());
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

        // ---- オリジナル瓶詰めギフト ----
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
        socket.emit('widgets:push-pull:snapshot', buildPushPullSnapshot());
        const pendingUpdateInfo = getPendingUpdateInfo();
        if (pendingUpdateInfo) {
            socket.emit('app:update-ready', { version: pendingUpdateInfo.version });
        }
    });
};
