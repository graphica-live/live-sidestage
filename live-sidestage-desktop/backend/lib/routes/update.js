'use strict';

module.exports = function registerUpdateRoutes({ app, io, serverEvents, IS_PACKAGED_ELECTRON, getPendingUpdateInfo, setPendingUpdateInfo }) {
    app.get('/api/update/status', (req, res) => {
        const pendingUpdateInfo = getPendingUpdateInfo();
        if (pendingUpdateInfo) {
            res.json({ available: true, version: pendingUpdateInfo.version });
        } else {
            res.json({ available: false });
        }
    });

    app.post('/api/update/install', (req, res) => {
        if (!getPendingUpdateInfo()) {
            return res.status(409).json({ error: 'no_pending_update' });
        }
        res.json({ ok: true });
        serverEvents.emit('install-update-requested');
    });

    // 開発用: アップデートバナーの表示をシミュレートする（本番環境では無効）
    app.post('/api/debug/simulate-update', (req, res) => {
        if (IS_PACKAGED_ELECTRON) {
            return res.status(403).json({ error: 'not_available_in_production' });
        }
        const version = String(req.body?.version || '9.9.9');
        setPendingUpdateInfo({ version });
        io.emit('app:update-ready', { version });
        res.json({ ok: true, version });
    });

    // 開発用: シミュレートしたアップデートをリセットする（本番環境では無効）
    app.post('/api/debug/reset-update', (req, res) => {
        if (IS_PACKAGED_ELECTRON) {
            return res.status(403).json({ error: 'not_available_in_production' });
        }
        setPendingUpdateInfo(null);
        res.json({ ok: true });
    });
};
