'use strict';

module.exports = function registerBroadcasterRoutes({
    app,
    IS_ELECTRON,
    serverEvents,
    isLoopbackRequest,
    normalizeBroadcasterId,
    switchBroadcasterId,
    emitSnapshot,
    emitAdminDayUpdate,
    getDisplayDayKey,
    getAutoReconnectEnabled,
    setAutoReconnectEnabled,
    connectToTikTok,
    hasConfiguredBroadcasterId,
    resetTikTokConnection,
    setTikTokConnectionState,
    shutdownApplication,
}) {
    app.post('/api/electron/pick-directory', async (req, res) => {
        if (!IS_ELECTRON) {
            return res.status(400).json({ ok: false, error: 'Electron モードでのみ使用できます。' });
        }

        const dirPath = await new Promise((resolve) => {
            serverEvents.emit('pick-directory-request', resolve);
        });

        return res.json({ ok: true, dirPath: dirPath || null });
    });

    app.post('/api/broadcaster/set', async (req, res) => {
        if (!isLoopbackRequest(req)) {
            return res.status(403).json({ error: 'This endpoint is available only from localhost.' });
        }

        const rawId = req.body?.broadcasterId;
        const normalized = normalizeBroadcasterId(rawId);

        if (!normalized) {
            return res.status(400).json({ ok: false, error: 'broadcasterId が不正です。' });
        }

        const savedId = await switchBroadcasterId(normalized);

        if (!savedId) {
            return res.status(500).json({ ok: false, error: '配信ユーザーIDの保存に失敗しました。' });
        }

        emitSnapshot(getDisplayDayKey());
        emitAdminDayUpdate(getDisplayDayKey());

        setAutoReconnectEnabled(true);
        connectToTikTok().catch(() => {});

        res.json({ ok: true, broadcasterId: savedId });
    });

    app.post('/api/tiktok/connect', (req, res) => {
        if (!isLoopbackRequest(req)) {
            return res.status(403).json({ error: 'This endpoint is available only from localhost.' });
        }

        if (!hasConfiguredBroadcasterId()) {
            return res.status(400).json({ ok: false, error: '配信ユーザーIDが設定されていません。' });
        }

        setAutoReconnectEnabled(true);
        connectToTikTok().catch(() => {});
        res.json({ ok: true });
    });

    app.post('/api/tiktok/disconnect', async (req, res) => {
        if (!isLoopbackRequest(req)) {
            return res.status(403).json({ error: 'This endpoint is available only from localhost.' });
        }

        setAutoReconnectEnabled(false);
        await resetTikTokConnection();
        setTikTokConnectionState('idle', '手動切断しました。再接続するには接続ボタンを押してください。', {
            transportMethod: 'unknown',
            websocketReasonCode: 'manual_disconnect',
            websocketReasonLabel: '手動切断済みです。',
            websocketReasonDetail: 'ユーザーが手動で切断しました。'
        });
        res.json({ ok: true });
    });

    app.post('/api/app/exit', (req, res) => {
        if (!isLoopbackRequest(req)) {
            return res.status(403).json({ error: 'This endpoint is available only from localhost.' });
        }

        res.status(202).json({ ok: true, shuttingDown: true });

        setImmediate(() => {
            shutdownApplication('api_request')
                .then(() => { process.exit(0); })
                .catch((error) => {
                    console.error('❌ Failed during graceful shutdown:', error);
                    process.exit(1);
                });
        });
    });
};
