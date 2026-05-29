'use strict';

module.exports = function registerStateRoutes({
    app,
    IS_ELECTRON,
    IS_PACKAGED_ELECTRON,
    APP_VERSION,
    getDisplayDayKey,
    getBroadcasterId,
    hasConfiguredBroadcasterId,
    getTikTokConnectionState,
    getTodayDayKey,
    getYesterdayDayKey,
    normalizeDayKey,
    respondWithDisplayChange,
}) {
    app.get('/api/state', (req, res) => {
        res.json({
            displayDayKey: getDisplayDayKey(),
            broadcasterId: getBroadcasterId(),
            broadcasterIdConfigured: hasConfiguredBroadcasterId(),
            tiktokConnection: getTikTokConnectionState(),
            todayDayKey: getTodayDayKey(),
            yesterdayDayKey: getYesterdayDayKey(),
            isElectron: IS_ELECTRON,
            isPackagedElectron: IS_PACKAGED_ELECTRON,
            appVersion: APP_VERSION
        });
    });

    app.post('/api/display/day', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.body.dayKey);
        if (!requestedDayKey) {
            return res.status(400).json({ ok: false, error: 'dayKey must be YYYY-MM-DD' });
        }
        respondWithDisplayChange(res, requestedDayKey);
    });

    app.get('/display/today', (req, res) => {
        respondWithDisplayChange(res, getTodayDayKey(), 'today');
    });

    app.get('/display/yesterday', (req, res) => {
        respondWithDisplayChange(res, getYesterdayDayKey(), 'yesterday');
    });

    app.get('/display/day/:dayKey', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.params.dayKey);
        if (!requestedDayKey) {
            return res.status(400).json({ ok: false, error: 'dayKey must be YYYY-MM-DD' });
        }
        respondWithDisplayChange(res, requestedDayKey);
    });
};
