'use strict';

module.exports = function registerCoinListRoutes({
    app, io,
    buildCoinListPayload,
    setWidgetCoinListSettings, setCoinListWidgetTextAppearance,
}) {
    app.get('/api/widgets/coin-list/config', (req, res) => {
        res.json(buildCoinListPayload());
    });

    app.patch('/api/widgets/coin-list', (req, res) => {
        const settings = setWidgetCoinListSettings(req.body || {});
        if (req.body?.appearance) setCoinListWidgetTextAppearance(req.body.appearance);
        const payload = buildCoinListPayload();
        io.emit('widgets:coin-list:updated', payload);
        res.json({ ok: true, settings, ...payload });
    });
};
