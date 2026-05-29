'use strict';

module.exports = function registerLikeContributionRoutes({
    app, io,
    buildLikeContributionWidgetPayload,
    buildLikeContributionTestNotification,
    setWidgetLikeContributionSettings,
    setLikeContributionWidgetTextAppearance,
}) {
    app.get('/api/widgets/like-contribution/config', (req, res) => {
        res.json(buildLikeContributionWidgetPayload());
    });

    app.patch('/api/widgets/like-contribution', (req, res) => {
        const settings = setWidgetLikeContributionSettings(req.body || {});
        if (req.body?.appearance) setLikeContributionWidgetTextAppearance(req.body.appearance);
        const payload = buildLikeContributionWidgetPayload();
        io.emit('widgets:like-contribution:config', payload);
        res.json({ ok: true, settings, ...payload });
    });

    app.post('/api/widgets/like-contribution/test-notification', (req, res) => {
        const payload = buildLikeContributionTestNotification();
        io.emit('widgets:like-contribution:test-notification', payload);
        res.json({ ok: true, ...payload });
    });
};
