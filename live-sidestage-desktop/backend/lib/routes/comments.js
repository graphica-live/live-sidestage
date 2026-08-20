'use strict';

module.exports = function registerCommentsRoutes({
    app,
    getCommentFeedSettings,
    getObservedCommentEmoteCatalog,
    getObservedCommentEmojiCatalog,
    getCommentFeedTypes,
    normalizeCommentReadAloudVoices,
    commentReadAloudVoiceProvider,
    clearCommentReadAloudRandomVoiceAssignments,
    stopCommentReadAloud,
    setCommentFeedSettings,
    emitAdminCommentsUpdate,
    emitCommentReadAloudTest,
}) {
    app.get('/api/comments/config', (req, res) => {
        res.json({
            settings: getCommentFeedSettings(),
            observedEmotes: getObservedCommentEmoteCatalog(),
            observedEmojis: getObservedCommentEmojiCatalog(),
            commentTypes: getCommentFeedTypes()
        });
    });

    app.get('/api/comments/read-aloud-voices', async (req, res) => {
        try {
            const forceRefresh = req.query?.refresh === '1';
            const voices = normalizeCommentReadAloudVoices(await Promise.resolve(commentReadAloudVoiceProvider({ forceRefresh })));
            res.json({ voices });
        } catch (error) {
            console.error('❌ Failed to load read aloud voices:', error);
            res.status(500).json({ error: '読み上げ音声の取得に失敗しました。' });
        }
    });

    app.post('/api/comments/read-aloud-random-voices/reset', (req, res) => {
        const clearedCount = clearCommentReadAloudRandomVoiceAssignments();
        res.json({ ok: true, clearedCount });
    });

    app.post('/api/comments/read-aloud-stop', (req, res) => {
        const payload = stopCommentReadAloud();
        res.json({ ok: true, payload });
    });

    app.patch('/api/comments/config', (req, res) => {
        const previousSettings = getCommentFeedSettings();
        const settings = setCommentFeedSettings(req.body || {});

        if (previousSettings.readAloudEnabled && !settings.readAloudEnabled) {
            stopCommentReadAloud();
        }

        emitAdminCommentsUpdate();
        res.json({
            ok: true,
            settings,
            commentTypes: getCommentFeedTypes()
        });
    });

    app.post('/api/comments/read-aloud-test', (req, res) => {
        const payload = emitCommentReadAloudTest(req.body);
        res.json({ ok: true, payload });
    });
};
