'use strict';

module.exports = function registerShogoMonthlyMvpRoutes({
    app,
    monthlyMvpClient,
    getMonthlyMvpStatus,
    checkAndRunMonthlyMvpUpdate,
}) {
    app.get('/api/widgets/shogo/monthly-mvp/settings', (req, res) => {
        res.json({ settings: monthlyMvpClient.getSettings(), status: getMonthlyMvpStatus() });
    });

    app.patch('/api/widgets/shogo/monthly-mvp/settings', (req, res) => {
        const settings = monthlyMvpClient.setSettings(req.body || {});
        res.json({ ok: true, settings, status: getMonthlyMvpStatus() });
    });

    app.post('/api/widgets/shogo/monthly-mvp/test-connection', async (req, res) => {
        const result = await monthlyMvpClient.testConnection();
        res.json(result);
    });

    app.post('/api/widgets/shogo/monthly-mvp/run-now', async (req, res) => {
        const result = await checkAndRunMonthlyMvpUpdate({ force: true });
        res.json({ ...result, status: getMonthlyMvpStatus() });
    });

    app.get('/api/widgets/shogo/monthly-mvp/status', (req, res) => {
        res.json({ status: getMonthlyMvpStatus() });
    });
};
