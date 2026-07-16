'use strict';

const ALLOWED_AVATAR_HOST_RE = /^p\d+(?:-[a-z0-9]+)*\.(?:tiktokcdn(?:-us)?\.com|ibyteimg\.com)$/;

module.exports = function registerWidgetsConfigRoutes({
    app,
    GIFT_JAR_WALL_EDITOR_ENABLED,
    getBroadcasterId,
    getDisplayDayKey,
    getTodayDayKey,
    getContributorsDisplayRange,
    getContributorsSessionState,
    buildWidgetUrls,
    getDisplayThreshold,
    getDisplayGoalCount,
    getDisplayAvatarVisibility,
    getSharedWidgetTextAppearance,
    getSharedWidgetFeedbackSettings,
    getContributorsWidgetTextAppearance,
    getWidgetTopGiftSettings,
    getTopGiftWidgetTextAppearance,
    buildTopGiftSnapshot,
    getWidgetLikeContributionSettings,
    getLikeContributionWidgetTextAppearance,
    getWidgetTapListSettings,
    getTapListWidgetTextAppearance,
    getWidgetCoinListSettings,
    getCoinListWidgetTextAppearance,
    getGiftJarWidgetTextAppearance,
    getPushPullWidgetTextAppearance,
    getGoalGiftsWidgetTextAppearance,
    getGoalGiftWidgetNoteFontSize,
    getGoalGiftWidgetAchievementBadgeSize,
    getGoalGiftWidgetAchievementBadgeStyle,
    getGoalGiftWidgetLayout,
    getGoalGiftWidgetHeadingText,
    getGoalGiftWidgetHeadingScroll,
    buildGoalGiftProgressSnapshot,
}) {
    app.get('/api/widgets/config', (req, res) => {
        const sharedWidgetAppearance = getSharedWidgetTextAppearance();
        const sharedWidgetFeedback = getSharedWidgetFeedbackSettings();
        const contributorsAppearance = getContributorsWidgetTextAppearance();
        res.json({
            broadcasterId: getBroadcasterId(),
            displayDayKey: getDisplayDayKey(),
            todayDayKey: getTodayDayKey(),
            giftJarWallEditorEnabled: GIFT_JAR_WALL_EDITOR_ENABLED,
            contributorsDisplayRangeMode: getContributorsDisplayRange(),
            liveSession: getContributorsSessionState(),
            widgetUrls: buildWidgetUrls(req),
            contributorsDisplayThreshold: getDisplayThreshold(),
            contributorsGoalCount: getDisplayGoalCount(),
            contributorsAvatarVisibility: getDisplayAvatarVisibility(),
            contributorsFontKey: contributorsAppearance.fontKey,
            contributorsColorTheme: contributorsAppearance.textStyleKey,
            contributorsStrokeWidth: contributorsAppearance.strokeWidth,
            contributorsFeedback: sharedWidgetFeedback,
            sharedWidgetFeedback,
            sharedWidgetAppearance,
            topGiftSettings: getWidgetTopGiftSettings(),
            topGiftAppearance: getTopGiftWidgetTextAppearance(),
            likeContributionSettings: getWidgetLikeContributionSettings(),
            likeContributionAppearance: getLikeContributionWidgetTextAppearance(),
            tapListSettings: getWidgetTapListSettings(),
            tapListAppearance: getTapListWidgetTextAppearance(),
            coinListSettings: getWidgetCoinListSettings(),
            coinListAppearance: getCoinListWidgetTextAppearance(),
            giftJarAppearance: getGiftJarWidgetTextAppearance(),
            pushPullAppearance: getPushPullWidgetTextAppearance(),
            topGiftSnapshot: buildTopGiftSnapshot(getTodayDayKey()),
            goalGiftAppearance: getGoalGiftsWidgetTextAppearance(),
            goalGiftFontKey: getGoalGiftsWidgetTextAppearance().fontKey,
            goalGiftTextStyleKey: getGoalGiftsWidgetTextAppearance().textStyleKey,
            goalGiftStrokeWidth: getGoalGiftsWidgetTextAppearance().strokeWidth,
            goalGiftNoteFontSize: getGoalGiftWidgetNoteFontSize(),
            goalGiftAchievementBadgeSize: getGoalGiftWidgetAchievementBadgeSize(),
            goalGiftAchievementBadgeStyle: getGoalGiftWidgetAchievementBadgeStyle(),
            goalGiftLayout: getGoalGiftWidgetLayout(),
            goalGiftHeadingText: getGoalGiftWidgetHeadingText(),
            goalGiftHeadingScroll: getGoalGiftWidgetHeadingScroll(),
            goalGiftFeedback: sharedWidgetFeedback,
            goalGiftItems: buildGoalGiftProgressSnapshot(getTodayDayKey()).goals
        });
    });

    app.get('/api/proxy/avatar', async (req, res) => {
        const url = String(req.query.url || '');
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch {
            return res.status(400).end();
        }
        if (parsedUrl.protocol !== 'https:' || !ALLOWED_AVATAR_HOST_RE.test(parsedUrl.hostname)) {
            return res.status(400).end();
        }
        try {
            const upstream = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': '' },
                signal: AbortSignal.timeout(6000)
            });
            if (!upstream.ok) return res.status(upstream.status).end();
            const ct = upstream.headers.get('content-type') || 'image/jpeg';
            if (!ct.startsWith('image/')) return res.status(400).end();
            res.setHeader('Content-Type', ct);
            res.setHeader('Cache-Control', 'public, max-age=600');
            const buf = await upstream.arrayBuffer();
            res.end(Buffer.from(buf));
        } catch {
            res.status(502).end();
        }
    });
};
