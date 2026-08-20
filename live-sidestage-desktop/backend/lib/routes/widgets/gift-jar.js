'use strict';

function buildGiftJarFallbackImage() {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f59e0b"/>' +
        '<text y="44" x="32" text-anchor="middle" font-size="36" font-family="sans-serif">🎁</text></svg>'
    )}`;
}

module.exports = function registerGiftJarRoutes({
    app, io,
    dbStore,
    cachedTikTokGiftCatalog,
    giftJarConfig, giftJarHistory,
    getGiftJarLastPositions, setGiftJarLastPositions,
    customJarConfig, customJarHistory,
    getCustomJarLastPositions, setCustomJarLastPositions,
    GIFT_JAR_THEMES, GIFT_JAR_WALL_EDITOR_ENABLED,
    getGiftJarWidgetTextAppearance, setGiftJarWidgetTextAppearance,
    normalizeGiftJarProfile,
    persistGiftJarCustomProfiles, persistCustomJarConfig,
    saveCustomJarImageFile, deleteCustomJarImageFile,
    buildCustomJarPayload,
    isLoopbackRequest,
}) {
    // ---- gift-jar ----
    app.get('/api/widgets/gift-jar/catalog', (req, res) => {
        const catalog = Array.isArray(cachedTikTokGiftCatalog?.gifts) ? cachedTikTokGiftCatalog.gifts : [];
        const gifts = catalog
            .filter((g) => g.imageUrl)
            .map((g) => ({ imageUrl: g.imageUrl, diamondCount: g.diamondCount, name: g.name || '' }));
        res.json({ gifts });
    });

    app.get('/api/widgets/gift-jar/config', (req, res) => {
        res.json({ ...giftJarConfig, appearance: getGiftJarWidgetTextAppearance() });
    });

    app.post('/api/widgets/gift-jar/config', (req, res) => {
        const {
            dropAboveJar, sizeMultiplier, sizeRatioCoeff, jarTheme,
            customProfileTheme, customProfile, clearCustomProfileTheme, appearance
        } = req.body || {};
        if (appearance) setGiftJarWidgetTextAppearance(appearance);
        if (typeof dropAboveJar === 'number' && Number.isFinite(dropAboveJar)) {
            giftJarConfig.dropAboveJar = Math.max(0, Math.min(Math.round(dropAboveJar), 400));
            dbStore.setGlobalStateValue('gift_jar_drop_above_jar', giftJarConfig.dropAboveJar, Date.now());
        }
        if (typeof sizeMultiplier === 'number' && Number.isFinite(sizeMultiplier)) {
            giftJarConfig.sizeMultiplier = Math.max(0.1, Math.min(sizeMultiplier, 5.0));
            dbStore.setGlobalStateValue('gift_jar_size_multiplier', giftJarConfig.sizeMultiplier, Date.now());
        }
        if (typeof sizeRatioCoeff === 'number' && Number.isFinite(sizeRatioCoeff)) {
            giftJarConfig.sizeRatioCoeff = Math.max(0, Math.min(sizeRatioCoeff, 5.0));
            dbStore.setGlobalStateValue('gift_jar_size_ratio_coeff', giftJarConfig.sizeRatioCoeff, Date.now());
        }
        let jarThemeChanged = false;
        if (typeof jarTheme === 'string' && GIFT_JAR_THEMES.includes(jarTheme)) {
            if (giftJarConfig.jarTheme !== jarTheme) jarThemeChanged = true;
            giftJarConfig.jarTheme = jarTheme;
            dbStore.setGlobalStateValue('gift_jar_theme', giftJarConfig.jarTheme, Date.now());
        }
        if (typeof customProfileTheme === 'string' || typeof clearCustomProfileTheme === 'string') {
            if (!GIFT_JAR_WALL_EDITOR_ENABLED) {
                return res.status(403).json({ ok: false, error: 'gift jar wall editor is disabled in packaged builds' });
            }
            if (!isLoopbackRequest(req)) {
                return res.status(403).json({ ok: false, error: 'custom gift jar wall editing is only available from the local admin machine' });
            }
        }
        if (typeof customProfileTheme === 'string' && GIFT_JAR_THEMES.includes(customProfileTheme)) {
            const normalizedProfile = normalizeGiftJarProfile(customProfile);
            if (!normalizedProfile) {
                return res.status(400).json({ ok: false, error: 'invalid gift jar wall profile' });
            }
            giftJarConfig.customProfiles = { ...giftJarConfig.customProfiles, [customProfileTheme]: normalizedProfile };
            persistGiftJarCustomProfiles();
        }
        if (typeof clearCustomProfileTheme === 'string' && GIFT_JAR_THEMES.includes(clearCustomProfileTheme)) {
            if (giftJarConfig.customProfiles[clearCustomProfileTheme]) {
                delete giftJarConfig.customProfiles[clearCustomProfileTheme];
                persistGiftJarCustomProfiles();
            }
        }
        if (jarThemeChanged) {
            giftJarHistory.length = 0;
            setGiftJarLastPositions(null);
            try { dbStore.setGlobalStateValue('gift_jar_history_v2', '[]', new Date().toISOString()); } catch {}
            try { dbStore.setGlobalStateValue('gift_jar_last_positions', '[]', new Date().toISOString()); } catch {}
            io.to('gift-jar').emit('widgets:gift-jar:reset');
        }
        const giftJarAppearance = getGiftJarWidgetTextAppearance();
        io.to('gift-jar').emit('widgets:gift-jar:config', { ...giftJarConfig, appearance: giftJarAppearance });
        res.json({ ok: true, ...giftJarConfig, appearance: giftJarAppearance });
    });

    app.post('/api/widgets/gift-jar/reset', (req, res) => {
        giftJarHistory.length = 0;
        setGiftJarLastPositions(null);
        try { dbStore.setGlobalStateValue('gift_jar_history_v2', '[]', new Date().toISOString()); } catch {}
        try { dbStore.setGlobalStateValue('gift_jar_last_positions', '[]', new Date().toISOString()); } catch {}
        io.to('gift-jar').emit('widgets:gift-jar:reset');
        res.json({ ok: true });
    });

    app.post('/api/widgets/gift-jar/shake', (req, res) => {
        io.to('gift-jar').emit('widgets:gift-jar:shake');
        res.json({ ok: true });
    });

    app.post('/api/widgets/gift-jar/test-single', (req, res) => {
        const catalog = Array.isArray(cachedTikTokGiftCatalog?.gifts) ? cachedTikTokGiftCatalog.gifts : [];
        const catalogWithImages = catalog.filter((g) => g.imageUrl);
        if (catalogWithImages.length === 0) {
            const payload = {
                giftId: 'demo-single', giftName: 'デモギフト',
                giftImage: buildGiftJarFallbackImage(),
                diamondCount: 15, repeatCount: 1, uniqueId: '__test__', nickname: 'テスト'
            };
            io.to('gift-jar').emit('widgets:gift-jar:notify', payload);
            return res.json({ ok: true, giftName: payload.giftName, diamondCount: payload.diamondCount, source: 'fallback' });
        }
        const TIERS = [
            { min: 1, max: 1 }, { min: 2, max: 4 }, { min: 5, max: 14 },
            { min: 15, max: 49 }, { min: 50, max: 199 }, { min: 200, max: 999 }, { min: 1000, max: Infinity }
        ];
        const buckets = TIERS.map((t) => catalogWithImages.filter((g) => g.diamondCount >= t.min && g.diamondCount <= t.max));
        const nonEmpty = buckets.filter((b) => b.length > 0);
        const bucket = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
        const gift = bucket[Math.floor(Math.random() * bucket.length)];
        const payload = {
            giftId: gift.id, giftName: gift.name, giftImage: gift.imageUrl,
            diamondCount: gift.diamondCount, repeatCount: 1, uniqueId: '__test__', nickname: 'テスト'
        };
        io.to('gift-jar').emit('widgets:gift-jar:notify', payload);
        res.json({ ok: true, giftName: gift.name, diamondCount: gift.diamondCount });
    });

    app.post('/api/widgets/gift-jar/test', (req, res) => {
        const catalog = Array.isArray(cachedTikTokGiftCatalog?.gifts) ? cachedTikTokGiftCatalog.gifts : [];
        const catalogWithImages = catalog.filter((g) => g.imageUrl);
        if (catalogWithImages.length > 0) {
            const DEMO_TIERS = [
                { min: 1, max: 1 }, { min: 2, max: 4 }, { min: 5, max: 14 },
                { min: 15, max: 49 }, { min: 50, max: 199 }, { min: 200, max: 999 }, { min: 1000, max: Infinity }
            ];
            const picks = [];
            for (const tier of DEMO_TIERS) {
                const bucket = catalogWithImages.filter((g) => g.diamondCount >= tier.min && g.diamondCount <= tier.max);
                if (bucket.length > 0) {
                    const pick = bucket[Math.floor(Math.random() * bucket.length)];
                    if (!picks.some((p) => p.id === pick.id)) picks.push(pick);
                }
            }
            picks.slice(0, 10).forEach((gift, index) => {
                setTimeout(() => {
                    io.to('gift-jar').emit('widgets:gift-jar:notify', {
                        giftId: gift.id, giftName: gift.name, giftImage: gift.imageUrl,
                        diamondCount: gift.diamondCount, repeatCount: 1, uniqueId: '__demo__', nickname: 'デモ'
                    });
                }, index * 220);
            });
            return res.json({ ok: true, count: Math.min(picks.length, 10), source: 'catalog' });
        }
        const DEMO_COINS = [1, 5, 1, 15, 1, 50, 1, 5, 200];
        const FALLBACK_IMAGE = buildGiftJarFallbackImage();
        DEMO_COINS.forEach((diamondCount, index) => {
            setTimeout(() => {
                io.to('gift-jar').emit('widgets:gift-jar:notify', {
                    giftId: `demo-${index}`, giftName: 'デモギフト', giftImage: FALLBACK_IMAGE,
                    diamondCount, repeatCount: 1, uniqueId: '__demo__', nickname: 'デモ'
                });
            }, index * 180);
        });
        res.json({ ok: true, count: DEMO_COINS.length, source: 'fallback' });
    });

    // ======== オリジナル瓶詰めギフト API ========
    app.get('/api/widgets/custom-jar/config', (req, res) => {
        res.json(buildCustomJarPayload());
    });

    app.post('/api/widgets/custom-jar/config', (req, res) => {
        if (!isLoopbackRequest(req)) return res.status(403).json({ ok: false, error: 'ローカル管理端末からのみ操作できます' });
        const { dropAboveJar, sizeMultiplier, sizeRatioCoeff } = req.body || {};
        if (typeof dropAboveJar === 'number') customJarConfig.dropAboveJar = Math.max(0, Math.min(400, dropAboveJar));
        if (typeof sizeMultiplier === 'number') customJarConfig.sizeMultiplier = Math.max(0.1, Math.min(5.0, sizeMultiplier));
        if (typeof sizeRatioCoeff === 'number') customJarConfig.sizeRatioCoeff = Math.max(0, Math.min(5.0, sizeRatioCoeff));
        persistCustomJarConfig();
        io.to('custom-jar').emit('widgets:custom-jar:config', buildCustomJarPayload());
        res.json({ ok: true });
    });

    app.post('/api/widgets/custom-jar/themes', (req, res) => {
        if (!isLoopbackRequest(req)) {
            return res.status(403).json({ ok: false, error: 'ローカル管理端末からのみ操作できます' });
        }
        const { action, id, label, imageDataUrl, profile } = req.body || {};
        if (action === 'add') {
            if (typeof label !== 'string' || !label.trim()) {
                return res.status(400).json({ ok: false, error: 'テーマ名が必要です' });
            }
            if (typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
                return res.status(400).json({ ok: false, error: '画像データが無効です' });
            }
            const normalizedProfile = normalizeGiftJarProfile(profile);
            if (!normalizedProfile) {
                return res.status(400).json({ ok: false, error: '壁プロファイルが無効です（壁線が少なすぎます）' });
            }
            const newId = 'cjar-' + Date.now();
            let imageUrl;
            try {
                imageUrl = saveCustomJarImageFile(newId, imageDataUrl);
            } catch (e) {
                return res.status(500).json({ ok: false, error: '画像の保存に失敗しました: ' + e.message });
            }
            customJarConfig.themes.push({ id: newId, label: label.trim().slice(0, 40), imageUrl, profile: normalizedProfile });
            if (!customJarConfig.activeThemeId) customJarConfig.activeThemeId = newId;
            persistCustomJarConfig();
            io.to('custom-jar').emit('widgets:custom-jar:config', buildCustomJarPayload());
            return res.json({ ok: true, id: newId, themes: customJarConfig.themes.map(t => ({ id: t.id, label: t.label, imageUrl: t.imageUrl })) });
        }
        if (action === 'activate') {
            if (typeof id !== 'string') return res.status(400).json({ ok: false, error: 'id が必要です' });
            if (!customJarConfig.themes.find(t => t.id === id)) {
                return res.status(404).json({ ok: false, error: 'テーマが見つかりません' });
            }
            customJarConfig.activeThemeId = id;
            customJarHistory.length = 0;
            setCustomJarLastPositions(null);
            persistCustomJarConfig();
            io.to('custom-jar').emit('widgets:custom-jar:config', buildCustomJarPayload());
            io.to('custom-jar').emit('widgets:custom-jar:reset');
            return res.json({ ok: true });
        }
        if (action === 'delete') {
            if (typeof id !== 'string') return res.status(400).json({ ok: false, error: 'id が必要です' });
            const idx = customJarConfig.themes.findIndex(t => t.id === id);
            if (idx !== -1) {
                deleteCustomJarImageFile(id);
                customJarConfig.themes.splice(idx, 1);
                if (customJarConfig.activeThemeId === id) {
                    customJarConfig.activeThemeId = customJarConfig.themes[0]?.id || null;
                }
                persistCustomJarConfig();
                io.to('custom-jar').emit('widgets:custom-jar:config', buildCustomJarPayload());
                io.to('custom-jar').emit('widgets:custom-jar:reset');
            }
            return res.json({ ok: true, themes: customJarConfig.themes.map(t => ({ id: t.id, label: t.label, imageUrl: t.imageUrl })) });
        }
        return res.status(400).json({ ok: false, error: '不明なアクションです' });
    });

    app.post('/api/widgets/custom-jar/reset', (req, res) => {
        customJarHistory.length = 0;
        setCustomJarLastPositions(null);
        io.to('custom-jar').emit('widgets:custom-jar:reset');
        res.json({ ok: true });
    });

    app.post('/api/widgets/custom-jar/shake', (req, res) => {
        io.to('custom-jar').emit('widgets:custom-jar:shake');
        res.json({ ok: true });
    });

    app.post('/api/widgets/custom-jar/test-single', (req, res) => {
        if (!customJarConfig.activeThemeId) {
            return res.status(400).json({ ok: false, error: 'アクティブなテーマがありません' });
        }
        const catalog = Array.isArray(cachedTikTokGiftCatalog?.gifts) ? cachedTikTokGiftCatalog.gifts : [];
        const catalogWithImages = catalog.filter((g) => g.imageUrl);
        let payload;
        if (catalogWithImages.length === 0) {
            payload = {
                giftId: 'demo-single', giftName: 'デモギフト',
                giftImage: buildGiftJarFallbackImage(),
                diamondCount: 15, repeatCount: 1, uniqueId: '__test__', nickname: 'テスト'
            };
        } else {
            const TIERS = [
                { min: 1, max: 1 }, { min: 2, max: 4 }, { min: 5, max: 14 },
                { min: 15, max: 49 }, { min: 50, max: 199 }, { min: 200, max: 999 }, { min: 1000, max: Infinity }
            ];
            const buckets = TIERS.map((t) => catalogWithImages.filter((g) => g.diamondCount >= t.min && g.diamondCount <= t.max));
            const nonEmpty = buckets.filter((b) => b.length > 0);
            const bucket = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
            const gift = bucket[Math.floor(Math.random() * bucket.length)];
            payload = {
                giftId: gift.id, giftName: gift.name, giftImage: gift.imageUrl,
                diamondCount: gift.diamondCount, repeatCount: 1, uniqueId: '__test__', nickname: 'テスト'
            };
        }
        const customJarRoom = io.sockets.adapter.rooms.get('custom-jar');
        const giftJarRoom   = io.sockets.adapter.rooms.get('gift-jar');
        console.log('[custom-jar test] rooms — custom-jar:', customJarRoom?.size ?? 0, 'gift-jar:', giftJarRoom?.size ?? 0);
        io.to('custom-jar').emit('widgets:custom-jar:notify', payload);
        res.json({ ok: true, giftName: payload.giftName, diamondCount: payload.diamondCount });
    });
};
