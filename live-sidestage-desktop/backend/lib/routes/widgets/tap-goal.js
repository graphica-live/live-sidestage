'use strict';

module.exports = function registerTapGoalRoutes({
    app, io,
    buildTapGoalPayload,
    setWidgetTapGoalSettings, setTapGoalWidgetTextAppearance,
    addTapGoalTaps, resetTapGoalProgress,
    emitTapGoalReached,
    getLikeContributionUserAvatars, getLikeContributionUserNicknames,
}) {
    // タップテスト用: 既知のリスナーからランダムに1人選んでダミーのタップ主にする
    function pickRandomKnownTapper() {
        const nicknames = getLikeContributionUserNicknames();
        const avatars = getLikeContributionUserAvatars();
        const uniqueIds = Object.keys(nicknames);

        if (uniqueIds.length === 0) {
            return { nickname: 'テスト', avatarUrl: '' };
        }

        const pick = uniqueIds[Math.floor(Math.random() * uniqueIds.length)];
        return { nickname: nicknames[pick] || pick, avatarUrl: avatars[pick] || '' };
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

        if (result.crossings > 0) {
            emitTapGoalReached();
        }

        io.emit('widgets:tap-goal:updated', { ...payload, actor: pickRandomKnownTapper() });
        res.json({ ok: true, ...payload });
    });

    app.post('/api/widgets/tap-goal/test-sound', (req, res) => {
        const payload = buildTapGoalPayload();
        if (payload.settings.soundEnabled && payload.settings.sound?.url) {
            emitTapGoalReached();
        }
        res.json({ ok: true, ...payload });
    });
};
