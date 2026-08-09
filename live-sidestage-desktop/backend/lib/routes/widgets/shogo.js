'use strict';

module.exports = function registerShogoRoutes({
    app, io,
    setWidgetShogoSettings,
    buildShogoPayload,
    setShogoTitle,
    deleteShogoTitle,
    emitShogoTest,
}) {
    app.get('/api/widgets/shogo/config', (req, res) => {
        res.json(buildShogoPayload());
    });

    app.patch('/api/widgets/shogo', (req, res) => {
        const settings = setWidgetShogoSettings(req.body || {});
        const payload = buildShogoPayload();
        io.emit('widgets:shogo:config', payload);
        res.json({ ok: true, settings, ...payload });
    });

    app.patch('/api/widgets/shogo/titles', (req, res) => {
        const entry = setShogoTitle(req.body || {});

        if (!entry) {
            return res.status(400).json({ error: 'ユーザーIDと称号を入力してください。' });
        }

        const payload = buildShogoPayload();
        io.emit('widgets:shogo:config', payload);
        res.json({ ok: true, entry, ...payload });
    });

    app.delete('/api/widgets/shogo/titles', (req, res) => {
        deleteShogoTitle(req.query?.uniqueId);
        const payload = buildShogoPayload();
        io.emit('widgets:shogo:config', payload);
        res.json({ ok: true, ...payload });
    });

    app.post('/api/widgets/shogo/test', (req, res) => {
        emitShogoTest();
        res.json({ ok: true });
    });
};
