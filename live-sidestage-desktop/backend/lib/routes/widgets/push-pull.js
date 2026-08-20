'use strict';

module.exports = function registerPushPullRoutes({
    app, io,
    pushPullConfig, pushPullState,
    buildPushPullSnapshot,
    normalizePushPullGifts,
    setPushPullWidgetTextAppearance,
    persistPushPullConfig, persistPushPullState,
}) {
    app.get('/api/widgets/push-pull/snapshot', (req, res) => {
        res.json(buildPushPullSnapshot());
    });

    app.patch('/api/widgets/push-pull', (req, res) => {
        const { pushLabel, pullLabel, pushGifts, pullGifts, scoreMode, appearance } = req.body || {};
        if (scoreMode === 'relative' || scoreMode === 'absolute') pushPullConfig.scoreMode = scoreMode;
        if (typeof pushLabel === 'string') pushPullConfig.pushLabel = pushLabel.trim().slice(0, 30) || 'プッシュ';
        if (typeof pullLabel === 'string') pushPullConfig.pullLabel = pullLabel.trim().slice(0, 30) || 'プル';
        if (Array.isArray(pushGifts)) pushPullConfig.pushGifts = normalizePushPullGifts(pushGifts);
        if (Array.isArray(pullGifts)) pushPullConfig.pullGifts = normalizePushPullGifts(pullGifts);
        if (appearance) setPushPullWidgetTextAppearance(appearance);
        persistPushPullConfig();
        const snapshot = buildPushPullSnapshot();
        io.emit('widgets:push-pull:updated', snapshot);
        res.json({ ok: true, ...snapshot });
    });

    app.post('/api/widgets/push-pull/reset', (req, res) => {
        pushPullState.pushPoints = 0;
        pushPullState.pullPoints = 0;
        persistPushPullState();
        const snapshot = buildPushPullSnapshot();
        io.emit('widgets:push-pull:updated', snapshot);
        res.json({ ok: true, ...snapshot });
    });

    app.post('/api/widgets/push-pull/test', (req, res) => {
        const side = String(req.body?.side || 'push').trim();
        const points = Math.max(1, Math.min(9999, Math.round(Number(req.body?.points) || 10)));
        if (side === 'pull') {
            pushPullState.pullPoints += points;
        } else {
            pushPullState.pushPoints += points;
        }
        persistPushPullState();
        const snapshot = buildPushPullSnapshot();
        io.emit('widgets:push-pull:updated', snapshot);
        res.json({ ok: true, ...snapshot });
    });
};
