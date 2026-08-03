'use strict';

module.exports = function registerTimerRoutes({
    app, io,
    buildTimerPayload,
    setTimerSettings, setTimerWidgetTextAppearance,
    startTimer, pauseTimer, resetTimer, adjustTimerByMinutes,
    emitTimerEndSound, emitTimerBlockSound, emitTimerCountdownSound,
}) {
    function emitTimerUpdate() {
        const payload = buildTimerPayload();
        io.emit('widgets:timer:updated', payload);
        return payload;
    }

    app.get('/api/widgets/timer/config', (req, res) => {
        res.json(buildTimerPayload());
    });

    app.patch('/api/widgets/timer', (req, res) => {
        const settings = setTimerSettings(req.body || {});
        if (req.body?.appearance) setTimerWidgetTextAppearance(req.body.appearance);
        const payload = emitTimerUpdate();
        res.json({ ok: true, settings, ...payload });
    });

    app.post('/api/widgets/timer/start', (req, res) => {
        startTimer();
        res.json({ ok: true, ...emitTimerUpdate() });
    });

    app.post('/api/widgets/timer/pause', (req, res) => {
        pauseTimer();
        res.json({ ok: true, ...emitTimerUpdate() });
    });

    app.post('/api/widgets/timer/reset', (req, res) => {
        resetTimer();
        res.json({ ok: true, ...emitTimerUpdate() });
    });

    app.post('/api/widgets/timer/test', (req, res) => {
        const minutes = Math.max(-180, Math.min(180, Math.round(Number(req.body?.minutes) || 0)));
        const { blocked } = adjustTimerByMinutes(minutes);
        if (blocked) emitTimerBlockSound();
        const payload = emitTimerUpdate();
        io.emit('widgets:timer:adjusted', { minutesDelta: minutes, giftName: 'テスト', blocked });
        res.json({ ok: true, ...payload });
    });

    app.post('/api/widgets/timer/test-end-sound', (req, res) => {
        const played = emitTimerEndSound();
        res.json({ ok: true, played });
    });

    app.post('/api/widgets/timer/test-countdown-sound', (req, res) => {
        const played = emitTimerCountdownSound();
        res.json({ ok: true, played });
    });
};
