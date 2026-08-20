'use strict';

module.exports = function registerTriggerX6Routes({
    app, io,
    setWidgetTriggerX6Settings,
    buildTriggerX6Payload,
    emitTriggerX6Win,
}) {
    app.get('/api/widgets/trigger-x6/config', (req, res) => {
        res.json(buildTriggerX6Payload());
    });

    app.patch('/api/widgets/trigger-x6', (req, res) => {
        const settings = setWidgetTriggerX6Settings(req.body || {});
        const payload = buildTriggerX6Payload();
        io.emit('widgets:trigger-x6:updated', payload);
        res.json({ ok: true, settings, ...payload });
    });

    // 当選エフェクトの見た目だけを試写する（実際のギフト受信やトリガー発火は伴わない）
    app.post('/api/widgets/trigger-x6/test', (req, res) => {
        emitTriggerX6Win({ nickname: 'テストリスナー', image: '', giftImage: '' });
        res.json({ ok: true });
    });
};
