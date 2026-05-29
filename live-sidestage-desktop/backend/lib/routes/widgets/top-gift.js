'use strict';

module.exports = function registerTopGiftRoutes({
    app, io,
    normalizeDayKey, getTodayDayKey,
    buildTopGiftWidgetPayload,
    setWidgetTopGiftSettings, setTopGiftWidgetTextAppearance,
}) {
    app.get('/api/widgets/top-gift/snapshot', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.query.dayKey) || getTodayDayKey();
        res.json(buildTopGiftWidgetPayload(requestedDayKey));
    });

    app.patch('/api/widgets/top-gift', (req, res) => {
        setWidgetTopGiftSettings(req.body || {});
        if (req.body?.appearance) setTopGiftWidgetTextAppearance(req.body.appearance);
        const payload = buildTopGiftWidgetPayload(getTodayDayKey());
        io.emit('widgets:top-gift:updated', payload);
        res.json({ ok: true, ...payload });
    });
};
