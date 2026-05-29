'use strict';

module.exports = function registerEffectsRoutes({
    app,
    io,
    getTimestamp,
    getEffectEvents,
    getEffectTriggers,
    buildEffectOverlayUrls,
    normalizeEffectEvent,
    emitEffectPlayback,
    effectMediaUpload,
    buildEffectMediaUrl,
    normalizeUserIdForFilename,
    findUserVideoFile,
    USER_VIDEO_MIME_TYPES,
    getEffectsGloballyPaused,
    setEffectsGloballyPaused,
}) {
    app.get('/api/effects/global-pause', (req, res) => {
        res.json({ paused: getEffectsGloballyPaused() });
    });

    app.post('/api/effects/global-pause', (req, res) => {
        const paused = req.body?.paused === true;
        setEffectsGloballyPaused(paused);

        if (paused) {
            const stopPayload = { timestamp: getTimestamp() };
            io.emit('effects:playback:stop', stopPayload);
            io.emit('effects:tts:stop', stopPayload);
        }

        io.emit('effects:global-pause-changed', { paused: getEffectsGloballyPaused() });
        res.json({ ok: true, paused: getEffectsGloballyPaused() });
    });

    app.get('/api/effects/config', (req, res) => {
        res.json({
            events: getEffectEvents(),
            triggers: getEffectTriggers(),
            screenUrls: buildEffectOverlayUrls(req)
        });
    });

    app.post('/api/effects/preview', (req, res) => {
        const effectEvent = normalizeEffectEvent(req.body?.event, 0);

        if (!effectEvent.videoAssetUrl && !effectEvent.audioAssetUrl) {
            return res.status(400).json({ ok: false, error: '動画または音声を設定したイベントだけ再生できます。' });
        }

        emitEffectPlayback(effectEvent, null, null);

        return res.json({ ok: true, event: effectEvent });
    });

    app.post('/api/effects/media', (req, res) => {
        effectMediaUpload.single('media')(req, res, (error) => {
            if (error) {
                return res.status(400).json({ ok: false, error: error.message || 'メディアの取り込みに失敗しました。' });
            }

            if (!req.file) {
                return res.status(400).json({ ok: false, error: 'media file is required' });
            }

            const isVideo = String(req.file.mimetype || '').toLowerCase().startsWith('video/');
            const kind = isVideo ? 'video' : 'audio';

            return res.json({
                ok: true,
                asset: {
                    kind,
                    name: req.file.originalname,
                    url: buildEffectMediaUrl(kind, req.file.filename),
                    mimeType: req.file.mimetype,
                    size: req.file.size
                }
            });
        });
    });

    app.get('/api/effects/user-video/:triggerId/:userId', (req, res) => {
        const triggerId = String(req.params.triggerId || '');
        const userId = String(req.params.userId || '');

        const normalizedUserId = normalizeUserIdForFilename(userId);

        if (!normalizedUserId) {
            return res.status(400).end();
        }

        const triggers = getEffectTriggers();
        const trigger = triggers.find((t) => t.id === triggerId);

        if (!trigger || trigger.userTargetMode !== 'file-map' || !trigger.userIdToFileDir) {
            return res.status(404).end();
        }

        const videoInfo = findUserVideoFile(trigger.userIdToFileDir, normalizedUserId);

        if (!videoInfo) {
            return res.status(404).end();
        }

        const mimeType = USER_VIDEO_MIME_TYPES[videoInfo.ext] || 'video/mp4';

        res.setHeader('Content-Type', mimeType);
        return res.sendFile(videoInfo.filePath);
    });
};
