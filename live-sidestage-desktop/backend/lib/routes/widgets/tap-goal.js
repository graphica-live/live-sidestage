'use strict';

module.exports = function registerTapGoalRoutes({
    app, io,
    getEffectEvents, emitEffectPlayback,
    buildTapGoalPayload,
    setWidgetTapGoalSettings, setTapGoalWidgetTextAppearance,
    addTapGoalTaps, resetTapGoalProgress,
}) {
    function fireTapGoalEffect(effectEventId, crossings) {
        if (crossings <= 0 || !effectEventId) return;
        const effectEvent = getEffectEvents().find((e) => e.id === effectEventId);
        if (!effectEvent) return;
        for (let i = 0; i < crossings; i++) {
            emitEffectPlayback(effectEvent, null, null);
        }
    }

    app.get('/api/widgets/tap-goal/config', (req, res) => {
        res.json(buildTapGoalPayload());
    });

    app.patch('/api/widgets/tap-goal', (req, res) => {
        const settings = setWidgetTapGoalSettings(req.body || {});
        if (req.body?.appearance) setTapGoalWidgetTextAppearance(req.body.appearance);
        const payload = buildTapGoalPayload();
        io.emit('widgets:tap-goal:updated', payload);
        res.json({ ok: true, settings, ...payload });
    });

    app.post('/api/widgets/tap-goal/reset', (req, res) => {
        resetTapGoalProgress();
        const payload = buildTapGoalPayload();
        io.emit('widgets:tap-goal:updated', payload);
        res.json({ ok: true, ...payload });
    });

    app.post('/api/widgets/tap-goal/test', (req, res) => {
        const amount = Math.max(1, Math.min(1000000, Math.round(Number(req.body?.amount) || 10)));
        const result = addTapGoalTaps(amount);
        const payload = buildTapGoalPayload();

        fireTapGoalEffect(payload.settings.effectEventId, result.crossings);

        io.emit('widgets:tap-goal:updated', payload);
        res.json({ ok: true, ...payload });
    });
};
