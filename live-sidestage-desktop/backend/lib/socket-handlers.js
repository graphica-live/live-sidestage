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
    buildCaptionConfig,
    getPendingUpdateInfo,
    bufferOrEmitCaption,
    startParakeetProcess,
    stopParakeetProcess,
    startNativeAsr,
    stopNativeAsr,
    feedAudioToEngine,
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
        socket.emit('widgets:caption:config', buildCaptionConfig());
        const pendingUpdateInfo = getPendingUpdateInfo();
        if (pendingUpdateInfo) {
            socket.emit('app:update-ready', { version: pendingUpdateInfo.version });
        }

        // Web Speech API からのテキスト受信
        socket.on('caption:text', ({ text, isFinal, srcLang } = {}) => {
            if (!text || typeof text !== 'string') return;
            bufferOrEmitCaption(text.slice(0, 500), Boolean(isFinal), srcLang || 'ja');
        });

        // Parakeet 起動・停止（Python サブプロセス）
        socket.on('caption:start-parakeet', ({ deviceIndex } = {}) => {
            startParakeetProcess(typeof deviceIndex === 'number' ? deviceIndex : undefined);
        });
        socket.on('caption:stop-parakeet', () => {
            stopParakeetProcess();
        });

        // ネイティブ ASR（whisper-cpp / sherpa-parakeet）
        socket.on('caption:start-asr', ({ engine, modelKey } = {}) => {
            if (!engine) return;
            startNativeAsr(socket.id, engine, modelKey);
        });
        socket.on('caption:stop-asr', ({ engine } = {}) => {
            stopNativeAsr(engine || 'whisper-cpp');
        });
        // ブラウザから送られてくる PCM Int16 音声チャンク（16 kHz）
        socket.on('caption:audio-chunk', (buf, engine) => {
            feedAudioToEngine(socket.id, engine || 'whisper-cpp', buf);
        });
    });
};
