'use strict';

module.exports = function registerTriggerX5Routes({
    app, io,
    setWidgetTriggerX5Settings,
    buildTriggerX5Payload,
    emitTriggerX5Win,
}) {
    app.get('/api/widgets/trigger-x5/config', (req, res) => {
        res.json(buildTriggerX5Payload());
    });

    app.patch('/api/widgets/trigger-x5', (req, res) => {
        const settings = setWidgetTriggerX5Settings(req.body || {});
        const payload = buildTriggerX5Payload();
        io.emit('widgets:trigger-x5:updated', payload);
        res.json({ ok: true, settings, ...payload });
    });

    // 当選エフェクトの見た目だけを試写する（実際のギフト受信やトリガー発火は伴わない）
    app.post('/api/widgets/trigger-x5/test', (req, res) => {
        emitTriggerX5Win({ nickname: 'テストリスナー', image: '' });
        res.json({ ok: true });
    });
};
