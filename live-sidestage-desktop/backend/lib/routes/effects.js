'use strict';

const { repairMojibakeFilename } = require('../utils');
const { listMidiOutputDevices } = require('../midi-helpers');
const { searchMyinstants, downloadMyinstantsSound } = require('../myinstants');
const { EFFECT_DEFAULT_CATEGORY_ID, WIDGET_TRIGGER_GIFTS_APPEARANCE_STATE_KEY } = require('../constants');

function normalizeTriggerGiftsFontSize(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 12) {
        return 20;
    }
    return Math.min(parsed, 48);
}

function normalizeTriggerGiftsBackgroundOpacity(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return 46;
    }
    return Math.min(parsed, 100);
}

module.exports = function registerEffectsRoutes({
    app,
    io,
    getTimestamp,
    getEffectEvents,
    getEffectTriggers,
    buildEffectOverlayUrls,
    buildTriggerGiftsOverlayUrlBase,
    fetchTikTokGiftCatalog,
    getScopedStateValue,
    setScopedStateValue,
    normalizeSharedWidgetFontKey,
    normalizeDisplayColorTheme,
    normalizeDisplayStrokeWidth,
    normalizeEffectEvent,
    emitEffectPlayback,
    effectMediaUpload,
    buildEffectMediaUrl,
    normalizeUserIdForFilename,
    findUserVideoFile,
    USER_VIDEO_MIME_TYPES,
    getEffectsGloballyPaused,
    setEffectsGloballyPaused,
    setEffectEvents,
    setEffectTriggers,
    normalizeEffectTriggerEventIds,
    resolveEffectAssetFilePath,
    getEffectMediaDirectory,
    getEffectCategories,
    setEffectCategories,
    path,
    fs,
}) {
    app.get('/api/effects/categories', (req, res) => {
        res.json({ categories: getEffectCategories() });
    });

    app.post('/api/effects/categories', (req, res) => {
        const name = String(req.body?.name || '').trim();

        if (!name) {
            return res.status(400).json({ ok: false, error: 'カテゴリ名を入力してください。' });
        }

        const id = `category-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const categories = setEffectCategories([...getEffectCategories(), { id, name }]);
        const category = categories.find((item) => item.id === id);

        io.emit('effects:trigger-gifts:updated', {});
        return res.json({ ok: true, categories, category });
    });

    app.patch('/api/effects/categories/:id', (req, res) => {
        const id = String(req.params.id || '');
        const existing = getEffectCategories();
        const target = existing.find((item) => item.id === id);

        if (!target) {
            return res.status(404).json({ ok: false, error: 'カテゴリが見つかりません。' });
        }

        const updates = {};

        if (req.body?.name !== undefined) {
            const name = String(req.body.name || '').trim();

            if (!name) {
                return res.status(400).json({ ok: false, error: 'カテゴリ名を入力してください。' });
            }

            updates.name = name;
        }

        if (req.body?.enabled !== undefined) {
            updates.enabled = Boolean(req.body.enabled);
        }

        const categories = setEffectCategories(existing.map((item) => item.id === id ? { ...item, ...updates } : item));

        io.emit('effects:trigger-gifts:updated', {});
        return res.json({ ok: true, categories });
    });

    app.delete('/api/effects/categories/:id', (req, res) => {
        const id = String(req.params.id || '');
        const existing = getEffectCategories();

        if (!existing.some((item) => item.id === id)) {
            return res.status(404).json({ ok: false, error: 'カテゴリが見つかりません。' });
        }

        // 削除するカテゴリに属していたイベント・トリガーは「初期」カテゴリへ移動する
        const events = setEffectEvents(getEffectEvents().map((item) =>
            item.categoryId === id ? { ...item, categoryId: EFFECT_DEFAULT_CATEGORY_ID } : item));
        const triggers = setEffectTriggers(getEffectTriggers().map((item) =>
            item.categoryId === id ? { ...item, categoryId: EFFECT_DEFAULT_CATEGORY_ID } : item));
        const categories = setEffectCategories(existing.filter((item) => item.id !== id));

        io.emit('effects:trigger-gifts:updated', {});
        return res.json({ ok: true, categories, events, triggers });
    });

    app.get('/api/effects/midi/devices', (req, res) => {
        res.json({ devices: listMidiOutputDevices() });
    });

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
            screenUrls: buildEffectOverlayUrls(req),
            triggerGiftsOverlayUrlBase: buildTriggerGiftsOverlayUrlBase(req)
        });
    });

    function normalizeTriggerGiftsAppearance(value) {
        let source = value;

        if (typeof source === 'string') {
            try {
                source = JSON.parse(source);
            } catch {
                source = null;
            }
        }

        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            source = {};
        }

        return {
            fontKey: normalizeSharedWidgetFontKey(source.fontKey),
            textStyleKey: normalizeDisplayColorTheme(source.textStyleKey),
            strokeWidth: normalizeDisplayStrokeWidth(source.strokeWidth),
            fontSize: normalizeTriggerGiftsFontSize(source.fontSize),
            layout: String(source.layout || '').trim().toLowerCase() === 'column' ? 'column' : 'grid',
            backgroundOpacity: normalizeTriggerGiftsBackgroundOpacity(source.backgroundOpacity)
        };
    }

    function getTriggerGiftsAppearance() {
        return normalizeTriggerGiftsAppearance(getScopedStateValue(WIDGET_TRIGGER_GIFTS_APPEARANCE_STATE_KEY));
    }

    function setTriggerGiftsAppearance(value) {
        const normalized = normalizeTriggerGiftsAppearance(value);
        setScopedStateValue(WIDGET_TRIGGER_GIFTS_APPEARANCE_STATE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    app.get('/api/effects/trigger-gifts/appearance', (req, res) => {
        res.json({ ok: true, appearance: getTriggerGiftsAppearance() });
    });

    app.patch('/api/effects/trigger-gifts/appearance', (req, res) => {
        const appearance = setTriggerGiftsAppearance(req.body?.appearance);
        io.emit('effects:trigger-gifts:updated', {});
        res.json({ ok: true, appearance });
    });

    app.get('/api/effects/trigger-gifts', async (req, res) => {
        const categoryId = String(req.query.category || '').trim() || EFFECT_DEFAULT_CATEGORY_ID;
        const category = getEffectCategories().find((item) => item.id === categoryId) || null;
        const catalogGifts = await fetchTikTokGiftCatalog().catch(() => []);

        const items = getEffectTriggers()
            .filter((trigger) => trigger.enabled
                && trigger.giftName
                && (trigger.categoryId || EFFECT_DEFAULT_CATEGORY_ID) === categoryId)
            .map((trigger) => {
                const matchedGift = catalogGifts.find((gift) =>
                    String(gift.name || '').trim().toLowerCase() === trigger.giftName);

                return {
                    id: trigger.id,
                    triggerName: trigger.name || matchedGift?.name || trigger.giftName,
                    giftName: matchedGift?.name || trigger.giftName,
                    giftImageUrl: matchedGift?.imageUrl || ''
                };
            });

        return res.json({
            ok: true,
            category: category ? { id: category.id, name: category.name, enabled: category.enabled !== false } : null,
            items,
            appearance: getTriggerGiftsAppearance()
        });
    });

    app.post('/api/effects/preview', (req, res) => {
        const effectEvent = normalizeEffectEvent(req.body?.event, 0);

        if (!effectEvent.videoAssetUrl && !effectEvent.audioAssetUrl && !effectEvent.midiEnabled) {
            return res.status(400).json({ ok: false, error: '動画・音声・MIDIのいずれかを設定したイベントだけ再生できます。' });
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
                    name: repairMojibakeFilename(req.file.originalname),
                    url: buildEffectMediaUrl(kind, req.file.filename),
                    mimeType: req.file.mimetype,
                    size: req.file.size
                }
            });
        });
    });

    app.get('/api/effects/myinstants/search', async (req, res) => {
        const query = String(req.query.q || '').trim();

        if (!query) {
            return res.status(400).json({ ok: false, error: '検索キーワードを入力してください。' });
        }

        try {
            const results = await searchMyinstants(query);
            return res.json({ ok: true, results });
        } catch (error) {
            return res.status(502).json({ ok: false, error: error.message || 'myinstants検索に失敗しました。' });
        }
    });

    app.post('/api/effects/myinstants/import', async (req, res) => {
        const mp3Url = String(req.body?.mp3Url || '').trim();
        const name = String(req.body?.name || '').trim() || 'myinstants-sound';
        const rawEventId = String(req.query.eventId || req.body?.eventId || '').trim();

        if (!mp3Url) {
            return res.status(400).json({ ok: false, error: 'mp3Url is required' });
        }

        try {
            const buffer = await downloadMyinstantsSound(mp3Url);
            const directory = getEffectMediaDirectory('audio');
            fs.mkdirSync(directory, { recursive: true });

            const safeEventId = rawEventId.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 80);
            const fileName = safeEventId.length >= 4
                ? `${safeEventId}-audio.mp3`
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.mp3`;

            fs.writeFileSync(path.join(directory, fileName), buffer);

            return res.json({
                ok: true,
                asset: {
                    kind: 'audio',
                    name: repairMojibakeFilename(`${name}.mp3`),
                    url: buildEffectMediaUrl('audio', fileName),
                    mimeType: 'audio/mpeg',
                    size: buffer.length
                }
            });
        } catch (error) {
            return res.status(502).json({ ok: false, error: error.message || '音声の取り込みに失敗しました。' });
        }
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

    app.patch('/api/effects/config', (req, res) => {
        if (!Array.isArray(req.body?.events) || !Array.isArray(req.body?.triggers)) {
            return res.status(400).json({ ok: false, error: 'events and triggers must be arrays' });
        }

        const oldEvents = getEffectEvents();
        const events = setEffectEvents(req.body.events);
        const eventIds = new Set(events.map((item) => item.id));
        const triggers = setEffectTriggers(req.body.triggers.map((item) => {
            // eventIds 内の存在しないイベントIDを除去（旧 eventId フォーマットも考慮）
            const normalizedEventIds = normalizeEffectTriggerEventIds(item).filter((id) => eventIds.has(id));
            return { ...item, eventIds: normalizedEventIds, eventId: undefined };
        }));

        // 旧イベントにあって新イベントに存在しない（または差し替えられた）アセットを削除
        const newAssetUrls = new Set();
        for (const ev of events) {
            if (ev.videoAssetUrl) newAssetUrls.add(ev.videoAssetUrl);
            if (ev.audioAssetUrl) newAssetUrls.add(ev.audioAssetUrl);
        }
        for (const oldEv of oldEvents) {
            for (const url of [oldEv.videoAssetUrl, oldEv.audioAssetUrl]) {
                if (url && !newAssetUrls.has(url)) {
                    const filePath = resolveEffectAssetFilePath(url);
                    if (filePath) {
                        fs.unlink(filePath, () => {});
                    }
                }
            }
        }

        io.emit('effects:trigger-gifts:updated', {});
        return res.json({
            ok: true,
            events,
            triggers,
            screenUrls: buildEffectOverlayUrls(req)
        });
    });
};
