'use strict';

module.exports = function registerTapGoalRoutes({
    app, io,
    buildTapGoalPayload,
    setWidgetTapGoalSettings, setTapGoalWidgetTextAppearance,
    addTapGoalTaps, resetTapGoalProgress,
    getLikeContributionUserAvatars, getLikeContributionUserNicknames,
}) {
    function emitTapGoalReached(settings) {
        const target = settings.soundTarget || 'tap-goal';
        const hasSound = Boolean(settings.soundEnabled && settings.sound?.url);
        const playsOnWidget = hasSound && target === 'tap-goal';

        io.emit('widgets:tap-goal:reached', playsOnWidget
            ? { url: settings.sound.url, volume: settings.soundVolume }
            : {});

        if (hasSound && target !== 'tap-goal') {
            const screen = Number(String(target).replace('screen', ''));
            if (screen >= 1 && screen <= 10) {
                io.emit('effects:playback', {
                    screen,
                    audioUrl: settings.sound.url,
                    mediaVolume: settings.soundVolume,
                    eventName: 'タップ目標達成',
                    playbackId: `tap-goal-${Date.now()}`,
                });
            }
        }
    }

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
            emitTapGoalReached(payload.settings);
        }

        io.emit('widgets:tap-goal:updated', { ...payload, actor: pickRandomKnownTapper() });
        res.json({ ok: true, ...payload });
    });

    app.post('/api/widgets/tap-goal/test-sound', (req, res) => {
        const payload = buildTapGoalPayload();
        if (payload.settings.soundEnabled && payload.settings.sound?.url) {
            emitTapGoalReached(payload.settings);
        }
        res.json({ ok: true, ...payload });
    });
};
