'use strict';

module.exports = function registerSongBattleRoutes({ app, vdjClient, songBattleRuntime, buildWidgetUrls }) {
    app.get('/api/widgets/song-battle/snapshot', (req, res) => {
        res.json({
            settings: songBattleRuntime.getSettings(),
            round: songBattleRuntime.getRoundSnapshot(),
            widgetUrls: buildWidgetUrls(req)
        });
    });

    app.patch('/api/widgets/song-battle', (req, res) => {
        const settings = songBattleRuntime.setSettings(req.body || {});
        res.json({ ok: true, settings });
    });

    app.post('/api/widgets/song-battle/start', async (req, res) => {
        try {
            const round = await songBattleRuntime.startRound();
            res.json({ ok: true, round });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/widgets/song-battle/end', async (req, res) => {
        const round = await songBattleRuntime.endRoundNow();
        res.json({ ok: true, round });
    });

    app.post('/api/widgets/song-battle/cancel', async (req, res) => {
        const round = await songBattleRuntime.cancelRound();
        res.json({ ok: true, round });
    });

    app.post('/api/widgets/song-battle/test-vote', (req, res) => {
        try {
            const round = songBattleRuntime.testVote(req.body?.side);
            res.json({ ok: true, round });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.get('/api/vdj/connection', (req, res) => {
        res.json(vdjClient.getConnectionSettings());
    });

    app.patch('/api/vdj/connection', (req, res) => {
        const settings = vdjClient.setConnectionSettings(req.body || {});
        res.json({ ok: true, ...settings });
    });

    app.post('/api/vdj/test-connection', async (req, res) => {
        const result = await vdjClient.testConnection();
        res.json(result);
    });
};
