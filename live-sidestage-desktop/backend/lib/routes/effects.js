'use strict';

const { repairMojibakeFilename } = require('../utils');
const { listMidiOutputDevices } = require('../midi-helpers');
const { searchMyinstants, downloadMyinstantsSound } = require('../myinstants');
const { searchSoundEffectLab, downloadSoundEffectLabSound, SOUNDEFFECT_LAB_HOST } = require('../soundeffect-lab');
const {
    EFFECT_DEFAULT_CATEGORY_ID,
    WIDGET_TRIGGER_GIFTS_APPEARANCE_STATE_KEY,
    EFFECT_TRIGGER_FOLLOW_GIFT_NAME,
    EFFECT_TRIGGER_FOLLOW_GIFT_IMAGE_URL
} = require('../constants');

function normalizeTriggerGiftsStrokeWidth(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return 4;
    }
    return Math.min(parsed, 48);
}

function normalizeTriggerGiftsFontSize(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 12) {
        return 20;
    }
    return Math.min(parsed, 96);
}

function normalizeTriggerGiftsBackgroundOpacity(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return 46;
    }
    return Math.min(parsed, 100);
}

function normalizeTriggerGiftsImageSize(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 48) {
        return 132;
    }
    return Math.min(parsed, 500);
}

function normalizeTriggerGiftsGridCount(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.min(parsed, 20);
}

function normalizeTriggerGiftsSlideSpeed(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 5) {
        return 60;
    }
    return Math.min(parsed, 500);
}

function normalizeTriggerGiftsCoinSize(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 10) {
        return 14;
    }
    return Math.min(parsed, 64);
}

function normalizeTriggerGiftsSlideDirection(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['left', 'right', 'up', 'down'].includes(normalized) ? normalized : 'left';
}

module.exports = function registerEffectsRoutes({
    app,
    io,
    getTimestamp,
    getTodayDayKey,
    getTriggerGiftsDailyCoinTotals,
    getEffectEvents,
    getEffectTriggers,
    buildEffectOverlayUrls,
    buildTriggerGiftsOverlayUrlBase,
    buildTriggerPendingOverlayUrls,
    fetchTikTokGiftCatalog,
    getScopedStateValue,
    setScopedStateValue,
    normalizeSharedWidgetFontKey,
    normalizeDisplayColorTheme,
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
    tryRunEffectTriggersForGift,
    tryRunEffectTriggersForGiftCombo,
    getLiveStudioStatus,
    getLiveStudioSettings,
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

    app.post('/api/effects/categories/reorder', (req, res) => {
        const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map(String) : null;

        if (!orderedIds) {
            return res.status(400).json({ ok: false, error: '並び順が不正です。' });
        }

        const existing = getEffectCategories();
        const byId = new Map(existing.map((item) => [item.id, item]));
        const visibleIdSet = new Set(orderedIds);
        const queue = [...orderedIds];
        const reordered = existing.map((item) => (visibleIdSet.has(item.id) ? byId.get(queue.shift()) : item));
        const categories = setEffectCategories(reordered);

        io.emit('effects:trigger-gifts:updated', {});
        return res.json({ ok: true, categories });
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

    app.get('/api/effects/livestudio/status', (req, res) => {
        res.json({ ok: true, ...getLiveStudioStatus() });
    });

    app.get('/api/effects/livestudio/settings', (req, res) => {
        res.json({ ok: true, ...getLiveStudioStatus(), settings: getLiveStudioSettings() });
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
            triggerGiftsOverlayUrlBase: buildTriggerGiftsOverlayUrlBase(req),
            triggerPendingScreenUrls: buildTriggerPendingOverlayUrls(req)
        });
    });

    // トリガー保留オーバーレイ用: triggerId → ギフト画像の解決。
    // トリガー一覧オーバーレイと違い、無効化/カテゴリ変更後のトリガーが
    // 発火した直後の残像（保留中）を表示する可能性があるため、
    // enabled や categoryId でのフィルタは行わない。
    async function buildTriggerGiftImageMap() {
        const catalogGifts = await fetchTikTokGiftCatalog().catch(() => []);
        const map = {};

        getEffectTriggers().forEach((trigger) => {
            if (!trigger.giftName) return;

            if (trigger.giftName === EFFECT_TRIGGER_FOLLOW_GIFT_NAME) {
                map[trigger.id] = {
                    giftName: trigger.giftName,
                    giftImageUrl: EFFECT_TRIGGER_FOLLOW_GIFT_IMAGE_URL
                };
                return;
            }

            const matchedGift = catalogGifts.find((gift) =>
                String(gift.name || '').trim().toLowerCase() === trigger.giftName);

            map[trigger.id] = {
                giftName: matchedGift?.name || trigger.giftName,
                giftImageUrl: matchedGift?.imageUrl || ''
            };
        });

        return map;
    }

    app.get('/api/effects/trigger-gift-images', async (req, res) => {
        res.json({ ok: true, images: await buildTriggerGiftImageMap() });
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
            strokeWidth: normalizeTriggerGiftsStrokeWidth(source.strokeWidth),
            fontSize: normalizeTriggerGiftsFontSize(source.fontSize),
            backgroundOpacity: normalizeTriggerGiftsBackgroundOpacity(source.backgroundOpacity),
            giftImageSize: normalizeTriggerGiftsImageSize(source.giftImageSize),
            columns: normalizeTriggerGiftsGridCount(source.columns, 3),
            rows: normalizeTriggerGiftsGridCount(source.rows, 2),
            slideEnabled: Boolean(source.slideEnabled),
            slideSpeed: normalizeTriggerGiftsSlideSpeed(source.slideSpeed),
            slideDirection: normalizeTriggerGiftsSlideDirection(source.slideDirection),
            showCoinCount: Boolean(source.showCoinCount),
            coinCountSize: normalizeTriggerGiftsCoinSize(source.coinCountSize)
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
        const dailyCoinTotals = getTriggerGiftsDailyCoinTotals(getTodayDayKey());

        const items = getEffectTriggers()
            .filter((trigger) => trigger.enabled
                && trigger.giftName
                && (trigger.categoryId || EFFECT_DEFAULT_CATEGORY_ID) === categoryId)
            .map((trigger) => {
                if (trigger.giftName === EFFECT_TRIGGER_FOLLOW_GIFT_NAME) {
                    return {
                        id: trigger.id,
                        triggerName: trigger.name || trigger.giftName,
                        giftName: trigger.giftName,
                        giftImageUrl: EFFECT_TRIGGER_FOLLOW_GIFT_IMAGE_URL,
                        diamondCount: 0,
                        dailyCoinTotal: 0
                    };
                }

                const matchedGift = catalogGifts.find((gift) =>
                    String(gift.name || '').trim().toLowerCase() === trigger.giftName);
                const giftNameKey = String(matchedGift?.name || trigger.giftName || '').trim().toLowerCase();

                return {
                    id: trigger.id,
                    triggerName: trigger.name || matchedGift?.name || trigger.giftName,
                    giftName: matchedGift?.name || trigger.giftName,
                    giftImageUrl: matchedGift?.imageUrl || '',
                    diamondCount: Number.isFinite(matchedGift?.diamondCount) ? matchedGift.diamondCount : 0,
                    dailyCoinTotal: dailyCoinTotals.get(giftNameKey) || 0
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

        if (!effectEvent.videoAssetUrl && !effectEvent.audioAssetUrl && !effectEvent.midiEnabled && !effectEvent.timerWidgetEnabled) {
            return res.status(400).json({ ok: false, error: '動画・音声・MIDI・タイマーウィジェット連携のいずれかを設定したイベントだけ再生できます。' });
        }

        emitEffectPlayback(effectEvent, null, null);

        return res.json({ ok: true, event: effectEvent });
    });

    app.post('/api/effects/gift-test', (req, res) => {
        const giftName = String(req.body?.giftName || '').trim();

        if (!giftName) {
            return res.status(400).json({ ok: false, error: 'ギフト名を入力してください。' });
        }

        const diamondCount = Math.max(0, Number(req.body?.diamondCount) || 0);
        const repeatCount = Math.max(1, Number.parseInt(req.body?.repeatCount, 10) || 1);
        const uniqueId = String(req.body?.uniqueId || '').trim() || 'test_user';
        const nickname = String(req.body?.nickname || '').trim() || uniqueId;
        const image = String(req.body?.image || '').trim().slice(0, 500);
        const giftId = req.body?.giftId ? String(req.body.giftId) : null;

        let triggered = false;

        if (repeatCount > 1) {
            // 実際のコンボギフトは tick ごとに個別の効果発火イベントが飛ぶため、
            // 1回にまとめて repeatCount 分の playbackCount を積むと「連射」（rapidFireEnabled）
            // のキャンセル挙動が働かない。tick を分けて発火させ、本番のコンボと同じ経路で検証できるようにする。
            for (let tick = 1; tick <= repeatCount; tick += 1) {
                const tickEvent = {
                    giftName,
                    giftId,
                    totalGifts: diamondCount * tick,
                    repeatCount: tick,
                    uniqueId,
                    nickname,
                    image,
                    comment: '',
                    timestamp: getTimestamp()
                };

                if (tryRunEffectTriggersForGiftCombo(tickEvent, { isFirstTick: tick === 1, deltaRepeat: 1 })) {
                    triggered = true;
                }
            }
        } else {
            const giftEvent = {
                giftName,
                giftId,
                totalGifts: diamondCount,
                repeatCount: 1,
                uniqueId,
                nickname,
                image,
                comment: '',
                timestamp: getTimestamp()
            };

            triggered = tryRunEffectTriggersForGift(giftEvent);
        }

        return res.json({ ok: true, triggered });
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
            const assetUrl = buildEffectMediaUrl(kind, req.file.filename);

            // eventIdHint 由来の固定ファイル名（テンプレート音声取り込み等と同じ命名規則）は
            // 再アップロード時に同じURLを上書きするため、オーバーレイ側の mediaBlobCache が
            // 旧メディアのBlobを保持したままになる。該当URLのキャッシュを破棄させて再取得させる。
            const rawEventId = String(req.query.eventId || '').trim();
            const safeEventId = rawEventId.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 80);
            if (safeEventId.length >= 4) {
                io.emit('effects:media-updated', { url: assetUrl });
            }

            return res.json({
                ok: true,
                asset: {
                    kind,
                    name: repairMojibakeFilename(req.file.originalname),
                    url: assetUrl,
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

        const [myinstantsResult, soundEffectLabResult] = await Promise.allSettled([
            searchMyinstants(query),
            searchSoundEffectLab(query),
        ]);

        const results = [
            ...(myinstantsResult.status === 'fulfilled' ? myinstantsResult.value.map((r) => ({ ...r, source: 'myinstants' })) : []),
            ...(soundEffectLabResult.status === 'fulfilled' ? soundEffectLabResult.value.map((r) => ({ ...r, source: 'soundeffect-lab' })) : []),
        ];

        if (myinstantsResult.status === 'rejected' && soundEffectLabResult.status === 'rejected') {
            return res.status(502).json({ ok: false, error: myinstantsResult.reason?.message || '検索に失敗しました。' });
        }

        return res.json({ ok: true, results });
    });

    app.post('/api/effects/myinstants/import', async (req, res) => {
        const mp3Url = String(req.body?.mp3Url || '').trim();
        const name = String(req.body?.name || '').trim() || 'myinstants-sound';
        const rawEventId = String(req.query.eventId || req.body?.eventId || '').trim();

        if (!mp3Url) {
            return res.status(400).json({ ok: false, error: 'mp3Url is required' });
        }

        try {
            let hostname = '';
            try { hostname = new URL(mp3Url).hostname; } catch { /* downloadで検証・エラー化される */ }
            const buffer = hostname === SOUNDEFFECT_LAB_HOST
                ? await downloadSoundEffectLabSound(mp3Url)
                : await downloadMyinstantsSound(mp3Url);
            const directory = getEffectMediaDirectory('audio');
            fs.mkdirSync(directory, { recursive: true });

            const safeEventId = rawEventId.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 80);
            const fileName = safeEventId.length >= 4
                ? `${safeEventId}-audio.mp3`
                : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.mp3`;

            fs.writeFileSync(path.join(directory, fileName), buffer);

            const assetUrl = buildEffectMediaUrl('audio', fileName);

            // eventIdHint 由来の固定ファイル名は再取り込み時に同じURLを上書きするため、
            // オーバーレイ側の mediaBlobCache が旧音声のBlobを保持したままになる。
            // 該当URLのキャッシュを破棄させて新しい音声を再取得させる。
            if (safeEventId.length >= 4) {
                io.emit('effects:media-updated', { url: assetUrl });
            }

            return res.json({
                ok: true,
                asset: {
                    kind: 'audio',
                    name: repairMojibakeFilename(`${name}.mp3`),
                    url: assetUrl,
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
