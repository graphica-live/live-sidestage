'use strict';

module.exports = function registerDataRoutes({
    app,
    dbStore,
    pendingGiftsByComboKey,
    cachedTikTokGiftCatalog,
    getAvailableDays,
    getDisplayDayKey,
    getBroadcasterId,
    hasConfiguredBroadcasterId,
    getTikTokConnectionState,
    getTodayDayKey,
    getYesterdayDayKey,
    normalizeDayKey,
    normalizeWholeNumber,
    normalizePositiveWholeNumber,
    normalizeNickname,
    getAdminContributorsForDay,
    hydrateStoredGiftEvent,
    buildOverlayContributorsSnapshot,
    insertTestGiftEventsForDay,
    insertCustomTestGiftEventForDay,
    insertCustomTestContributorForDay,
    fetchTikTokGiftCatalog,
    setContributorTotal,
    setContributorNickname,
    deleteGiftEvent,
    deleteContributor,
    resetContributorsForDay,
    getGiftDisplayNameJa,
    setGiftDisplayNameJa,
    giftNameJaReferenceList,
}) {
    app.get('/api/days', (req, res) => {
        res.json({
            days: getAvailableDays(),
            displayDayKey: getDisplayDayKey(),
            broadcasterId: getBroadcasterId(),
            broadcasterIdConfigured: hasConfiguredBroadcasterId(),
            tiktokConnection: getTikTokConnectionState(),
            todayDayKey: getTodayDayKey(),
            yesterdayDayKey: getYesterdayDayKey()
        });
    });

    app.get('/api/contributors', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.query.dayKey) || getDisplayDayKey();
        res.json({
            dayKey: requestedDayKey,
            contributors: getAdminContributorsForDay(requestedDayKey)
        });
    });

    app.get('/api/users/recent', (req, res) => {
        const broadcasterId = getBroadcasterId();
        if (!broadcasterId) {
            return res.json({ users: [] });
        }
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - 30);
        const sinceDay = sinceDate.toISOString().slice(0, 10);
        const users = dbStore.getRecentGiftSenders(broadcasterId, sinceDay, 200);
        return res.json({ users });
    });

    app.get('/api/gifts', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.query.dayKey) || getDisplayDayKey();
        const broadcasterId = getBroadcasterId();
        const confirmedGifts = dbStore.getAdminGiftEventsByDay(requestedDayKey, broadcasterId).map(hydrateStoredGiftEvent);

        // 今日のデータ表示中の場合、メモリ上のpendingギフト（repeatEnd前のコンボ）も含める
        const todayDayKey = getTodayDayKey();
        const pendingGifts = requestedDayKey === todayDayKey
            ? [...pendingGiftsByComboKey.values()].filter((pg) => pg.dayKey === requestedDayKey)
            : [];

        res.json({
            dayKey: requestedDayKey,
            gifts: [...pendingGifts, ...confirmedGifts]
        });
    });

    app.get('/api/overlay/contributors/snapshot', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.query.dayKey) || getDisplayDayKey();
        res.json(buildOverlayContributorsSnapshot(requestedDayKey));
    });

    app.get('/api/gift-suggestions', (req, res) => {
        const rawLimit = Number(req.query.limit);
        const limit = Number.isFinite(rawLimit)
            ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200)
            : 100;
        const gifts = dbStore.getKnownGiftNames(getBroadcasterId(), limit).map((gift) => gift.giftName);
        res.json({ gifts });
    });

    app.post('/api/test-data/contributors', (req, res) => {
        try {
            const result = insertTestGiftEventsForDay(req.body?.dayKey || getDisplayDayKey(), 'contributors');
            return res.json({ ok: true, ...result });
        } catch (error) {
            return res.status(400).json({ ok: false, error: error?.message || 'テストデータの追加に失敗しました。' });
        }
    });

    app.post('/api/test-data/gifts', (req, res) => {
        try {
            const result = insertTestGiftEventsForDay(req.body?.dayKey || getDisplayDayKey(), 'gifts');
            return res.json({ ok: true, ...result });
        } catch (error) {
            return res.status(400).json({ ok: false, error: error?.message || 'テストデータの追加に失敗しました。' });
        }
    });

    app.post('/api/test-data/gifts/custom', (req, res) => {
        try {
            const result = insertCustomTestGiftEventForDay(req.body?.dayKey || getDisplayDayKey(), req.body || {});
            return res.json({ ok: true, ...result });
        } catch (error) {
            return res.status(400).json({ ok: false, error: error?.message || 'テストデータの追加に失敗しました。' });
        }
    });

    app.post('/api/test-data/contributors/custom', (req, res) => {
        try {
            const result = insertCustomTestContributorForDay(req.body?.dayKey || getDisplayDayKey(), req.body || {});
            return res.json({ ok: true, ...result });
        } catch (error) {
            return res.status(400).json({ ok: false, error: error?.message || 'テストデータの追加に失敗しました。' });
        }
    });

    app.get('/api/tiktok/gifts', async (req, res) => {
        try {
            const gifts = await fetchTikTokGiftCatalog({ forceRefresh: req.query.force === '1' });
            return res.json({
                gifts,
                fetchedAt: cachedTikTokGiftCatalog.fetchedAt,
                broadcasterId: getBroadcasterId()
            });
        } catch (error) {
            return res.status(500).json({ ok: false, error: error?.message || 'TikTok ギフト一覧の取得に失敗しました。' });
        }
    });

    app.get('/api/gift-name-ja/reference-list', (req, res) => {
        return res.json({ list: giftNameJaReferenceList || [] });
    });

    app.post('/api/gift-name-ja', (req, res) => {
        const name = typeof req.body?.name === 'string' ? req.body.name : '';
        const value = typeof req.body?.value === 'string' ? req.body.value : '';

        if (!name.trim()) {
            return res.status(400).json({ ok: false, error: 'name is required' });
        }

        try {
            const result = setGiftDisplayNameJa(name, value);
            if (!result.ok) {
                return res.status(400).json(result);
            }
            return res.json({ ok: true, name, nameJa: getGiftDisplayNameJa(name) });
        } catch (error) {
            return res.status(500).json({ ok: false, error: error?.message || '保存に失敗しました。' });
        }
    });

    app.patch('/api/contributors', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.body.dayKey);
        const uniqueId = typeof req.body.uniqueId === 'string' ? req.body.uniqueId.trim() : '';
        const totalCoins = normalizeWholeNumber(req.body.total);

        if (!requestedDayKey || !uniqueId || totalCoins === null) {
            return res.status(400).json({ ok: false, error: 'dayKey, uniqueId and non-negative integer total are required' });
        }

        const contributor = setContributorTotal(requestedDayKey, uniqueId, totalCoins);
        if (!contributor) {
            return res.status(404).json({ ok: false, error: 'Contributor not found' });
        }
        return res.json({ ok: true, contributor });
    });

    app.patch('/api/contributors/nickname', (req, res) => {
        const uniqueId = typeof req.body.uniqueId === 'string' ? req.body.uniqueId.trim() : '';
        const nickname = normalizeNickname(req.body.nickname);

        if (!uniqueId || !nickname) {
            return res.status(400).json({ ok: false, error: 'uniqueId and valid nickname are required' });
        }

        const result = setContributorNickname(uniqueId, nickname);
        if (!result) {
            return res.status(404).json({ ok: false, error: 'Contributor not found' });
        }
        return res.json({ ok: true, ...result });
    });

    app.delete('/api/gifts', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.query.dayKey);
        const giftEventId = normalizePositiveWholeNumber(req.query.giftEventId);

        if (!requestedDayKey || !giftEventId) {
            return res.status(400).json({ ok: false, error: 'dayKey and giftEventId are required' });
        }

        const result = deleteGiftEvent(requestedDayKey, giftEventId);
        if (!result?.giftEvent) {
            return res.status(404).json({ ok: false, error: 'Gift event not found' });
        }
        return res.json({ ok: true, ...result });
    });

    app.delete('/api/contributors', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.query.dayKey);
        const uniqueId = typeof req.query.uniqueId === 'string' ? req.query.uniqueId.trim() : '';

        if (!requestedDayKey || !uniqueId) {
            return res.status(400).json({ ok: false, error: 'dayKey and uniqueId are required' });
        }

        const changes = deleteContributor(requestedDayKey, uniqueId);
        return res.json({ ok: true, deletedCount: changes });
    });

    app.delete('/api/contributors/day', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.query.dayKey);

        if (!requestedDayKey) {
            return res.status(400).json({ ok: false, error: 'dayKey must be YYYY-MM-DD' });
        }

        const changes = resetContributorsForDay(requestedDayKey);
        return res.json({ ok: true, deletedCount: changes });
    });
};
