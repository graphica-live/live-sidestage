'use strict';

const path = require('path');

module.exports = function registerPageRoutes({
    app,
    express,
    DB_STATIC_DIRECTORY,
    PUBLIC_DIRECTORY,
    EFFECT_MEDIA_ROOT_DIRECTORY,
    EFFECT_VIDEO_ROOT_DIRECTORY,
    LEGACY_VIDEO_ROOT_DIRECTORY,
    EFFECT_SOUND_ROOT_DIRECTORY,
    LEGACY_SOUND_ROOT_DIRECTORY,
    EFFECT_SCREEN_COUNT,
    hasConfiguredBroadcasterId,
    sendContributorsOverlayHtml,
    getEffectEvents,
    createDefaultEffectEvent,
    buildEffectOverlayHtml,
}) {
    app.get('/', (req, res) => {
        return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'home.html'));
    });

    app.get('/index.html', (req, res) => {
        return res.redirect('/');
    });

    app.get('/setup', (req, res) => {
        return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'setup.html'));
    });

    app.get('/setup.html', (req, res) => {
        return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'setup.html'));
    });

    app.get('/quick-access', (req, res) => {
        return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'quick-access.html'));
    });

    app.get('/quick-access.html', (req, res) => {
        return res.redirect('/quick-access');
    });

    app.get('/comments', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'comments.html'));
    });

    app.get('/comments.html', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.redirect('/comments');
    });

    app.get('/gifts', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'gifts.html'));
    });

    app.get('/gifts.html', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.redirect('/gifts');
    });

    app.get('/effects', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'effects.html'));
    });

    app.get('/effects.html', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.redirect('/effects');
    });

    app.get('/widgets', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'widgets.html'));
    });

    app.get('/widgets.html', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.redirect('/widgets');
    });

    app.get('/user-coins', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'user-coins.html'));
    });

    app.get('/user-coins.html', (req, res) => {
        return res.redirect('/user-coins');
    });

    app.get('/admin', (req, res) => { return res.redirect('/'); });
    app.get('/admin.html', (req, res) => { return res.redirect('/'); });

    app.use('/media/effects', express.static(EFFECT_MEDIA_ROOT_DIRECTORY, {
        setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
    }));

    app.use('/video', express.static(EFFECT_VIDEO_ROOT_DIRECTORY, {
        setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
    }));
    app.use('/video', express.static(LEGACY_VIDEO_ROOT_DIRECTORY, {
        setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
    }));

    app.use('/sound', express.static(EFFECT_SOUND_ROOT_DIRECTORY, {
        setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
    }));
    app.use('/sound', express.static(LEGACY_SOUND_ROOT_DIRECTORY, {
        setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); }
    }));

    app.get('/overlays/contributors', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return sendContributorsOverlayHtml(res);
    });

    app.get('/overlays/contributors/index.html', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return sendContributorsOverlayHtml(res);
    });

    app.get('/overlays/effects/:slot', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        const slot = Number.parseInt(req.params.slot, 10);
        if (!Number.isInteger(slot) || slot < 1 || slot > EFFECT_SCREEN_COUNT) {
            return res.status(404).send('Effect overlay slot not found');
        }
        const config = getEffectEvents().find((item) => item.screen === slot) || createDefaultEffectEvent(slot);
        return res.type('html').send(buildEffectOverlayHtml(slot, config, {
            readAloudOnly: req.query?.readAloudOnly === '1',
            readAloudSpeakerEnabled: req.query?.speaker === '1'
        }));
    });

    app.get('/overlays/effects/:slot/index.html', (req, res) => {
        return res.redirect(`/overlays/effects/${req.params.slot}`);
    });

    app.get(['/overlays/top-gift', '/overlays/widgets/top-gift'], (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'top-gift.html'));
    });
    app.get(['/overlays/top-gift/index.html', '/overlays/widgets/top-gift/index.html'], (req, res) => {
        return res.redirect('/overlays/top-gift');
    });

    app.get(['/overlays/like-contribution', '/overlays/widgets/like-contribution'], (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'like-contribution.html'));
    });
    app.get(['/overlays/like-contribution/index.html', '/overlays/widgets/like-contribution/index.html'], (req, res) => {
        return res.redirect('/overlays/like-contribution');
    });

    app.get(['/overlays/tap-list', '/overlays/widgets/tap-list'], (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'tap-list.html'));
    });
    app.get(['/overlays/tap-list/index.html', '/overlays/widgets/tap-list/index.html'], (req, res) => {
        return res.redirect('/overlays/tap-list');
    });

    app.get(['/overlays/coin-list', '/overlays/widgets/coin-list'], (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'coin-list.html'));
    });
    app.get(['/overlays/coin-list/index.html', '/overlays/widgets/coin-list/index.html'], (req, res) => {
        return res.redirect('/overlays/coin-list');
    });

    app.get(['/overlays/goal-gifts', '/overlays/widgets/goal-gifts'], (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'goal-gifts.html'));
    });
    app.get(['/overlays/goal-gifts/index.html', '/overlays/widgets/goal-gifts/index.html'], (req, res) => {
        return res.redirect('/overlays/goal-gifts');
    });

    app.get(['/overlays/gift-jar', '/overlays/widgets/gift-jar'], (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'gift-jar.html'));
    });
    app.get('/overlays/custom-jar', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'gift-jar.html'));
    });
    app.get(['/overlays/gift-jar/index.html', '/overlays/widgets/gift-jar/index.html'], (req, res) => {
        return res.redirect('/overlays/gift-jar');
    });

    app.get(['/overlays/push-pull', '/overlays/widgets/push-pull'], (req, res) => {
        return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'push-pull.html'));
    });
    app.get(['/overlays/push-pull/index.html', '/overlays/widgets/push-pull/index.html'], (req, res) => {
        return res.redirect('/overlays/push-pull');
    });

    app.get(['/overlays/song-battle', '/overlays/widgets/song-battle'], (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(PUBLIC_DIRECTORY, 'widgets', 'song-battle.html'));
    });
    app.get(['/overlays/song-battle/index.html', '/overlays/widgets/song-battle/index.html'], (req, res) => {
        return res.redirect('/overlays/song-battle');
    });

    app.get('/virtualdj', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.sendFile(path.join(DB_STATIC_DIRECTORY, 'virtualdj.html'));
    });

    app.get('/virtualdj.html', (req, res) => {
        if (!hasConfiguredBroadcasterId()) return res.redirect('/setup');
        return res.redirect('/virtualdj');
    });

    app.use(express.static(PUBLIC_DIRECTORY, {
        setHeaders(res) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }));
};
