'use strict';

module.exports = function registerTapListRoutes({
    app, io,
    getTodayDayKey,
    buildTapListPayload,
    setWidgetTapListSettings, setTapListWidgetTextAppearance,
    getLikeContributionUserTotalsState, setLikeContributionUserTotalsState,
}) {
    app.get('/api/widgets/tap-list/config', (req, res) => {
        res.json(buildTapListPayload());
    });

    app.patch('/api/widgets/tap-list', (req, res) => {
        const settings = setWidgetTapListSettings(req.body || {});
        if (req.body?.appearance) setTapListWidgetTextAppearance(req.body.appearance);
        const payload = buildTapListPayload();
        io.emit('widgets:tap-list:updated', payload);
        res.json({ ok: true, settings, ...payload });
    });

    app.post('/api/widgets/tap-list/reset', (req, res) => {
        const userTotalsState = getLikeContributionUserTotalsState();
        const dayKey = getTodayDayKey();
        const next = { ...userTotalsState };
        delete next[dayKey];
        setLikeContributionUserTotalsState(next);
        const payload = buildTapListPayload();
        io.emit('widgets:tap-list:updated', payload);
        res.json({ ok: true, ...payload });
    });
};
