'use strict';

module.exports = function registerGoalGiftsRoutes({
    app, io,
    normalizeDayKey, getTodayDayKey, getTimestamp,
    normalizeWholeNumber, normalizeWidgetFeedbackSettings,
    buildGoalGiftProgressSnapshot,
    getGoalGiftFeedbackSettings, setGoalGiftFeedbackSettings,
    getGoalGiftsWidgetTextAppearance, setGoalGiftsWidgetTextAppearance,
    getGoalGiftWidgetNoteFontSize, setGoalGiftWidgetNoteFontSize,
    getGoalGiftWidgetAchievementBadgeSize, setGoalGiftWidgetAchievementBadgeSize,
    getGoalGiftWidgetAchievementBadgeStyle, setGoalGiftWidgetAchievementBadgeStyle,
    getGoalGiftWidgetLayout, setGoalGiftWidgetLayout,
    getGoalGiftWidgetHeadingText, setGoalGiftWidgetHeadingText,
    getGoalGiftWidgetHeadingScroll, setGoalGiftWidgetHeadingScroll,
    getGoalGiftWidgetHeadingFontSize, setGoalGiftWidgetHeadingFontSize,
    getGoalGiftWidgetProgressRingColor, setGoalGiftWidgetProgressRingColor,
    getGoalGiftWidgetProgressBackgroundOpacity, setGoalGiftWidgetProgressBackgroundOpacity,
    setGoalGiftWidgetItems,
}) {
    app.get('/api/widgets/goal-gifts/snapshot', (req, res) => {
        const requestedDayKey = normalizeDayKey(req.query.dayKey) || getTodayDayKey();
        res.json({ snapshot: buildGoalGiftProgressSnapshot(requestedDayKey) });
    });

    app.post('/api/widgets/goal-gifts/test-feedback', (req, res) => {
        const requestedSlot = normalizeWholeNumber(req.body?.slot) || 1;
        const feedback = normalizeWidgetFeedbackSettings(req.body?.feedback || getGoalGiftFeedbackSettings());

        if (requestedSlot <= 0) {
            return res.status(400).json({ ok: false, error: 'slot must be a positive integer' });
        }

        io.emit('widgets:goal-gifts:test-feedback', {
            slot: requestedSlot,
            feedback,
            requestedAt: getTimestamp()
        });

        return res.json({ ok: true, slot: requestedSlot, feedback });
    });

    app.patch('/api/widgets/goal-gifts', (req, res) => {
        if (!Array.isArray(req.body?.items)) {
            return res.status(400).json({ ok: false, error: 'items must be an array' });
        }

        const goalGiftsAppearance = req.body?.appearance !== undefined
            ? setGoalGiftsWidgetTextAppearance(req.body.appearance)
            : getGoalGiftsWidgetTextAppearance();
        const { fontKey, textStyleKey, strokeWidth } = goalGiftsAppearance;
        const noteFontSize = req.body?.noteFontSize !== undefined
            ? setGoalGiftWidgetNoteFontSize(req.body.noteFontSize)
            : getGoalGiftWidgetNoteFontSize();
        const achievementBadgeSize = req.body?.achievementBadgeSize !== undefined
            ? setGoalGiftWidgetAchievementBadgeSize(req.body.achievementBadgeSize)
            : getGoalGiftWidgetAchievementBadgeSize();
        const achievementBadgeStyle = req.body?.achievementBadgeStyle !== undefined
            ? setGoalGiftWidgetAchievementBadgeStyle(req.body.achievementBadgeStyle)
            : getGoalGiftWidgetAchievementBadgeStyle();
        const layout = req.body?.layout !== undefined
            ? setGoalGiftWidgetLayout(req.body.layout)
            : getGoalGiftWidgetLayout();
        const headingText = req.body?.headingText !== undefined
            ? setGoalGiftWidgetHeadingText(req.body.headingText)
            : getGoalGiftWidgetHeadingText();
        const headingScroll = req.body?.headingScroll !== undefined
            ? setGoalGiftWidgetHeadingScroll(req.body.headingScroll)
            : getGoalGiftWidgetHeadingScroll();
        const headingFontSize = req.body?.headingFontSize !== undefined
            ? setGoalGiftWidgetHeadingFontSize(req.body.headingFontSize)
            : getGoalGiftWidgetHeadingFontSize();
        const progressRingColor = req.body?.progressRingColor !== undefined
            ? setGoalGiftWidgetProgressRingColor(req.body.progressRingColor)
            : getGoalGiftWidgetProgressRingColor();
        const progressBackgroundOpacity = req.body?.progressBackgroundOpacity !== undefined
            ? setGoalGiftWidgetProgressBackgroundOpacity(req.body.progressBackgroundOpacity)
            : getGoalGiftWidgetProgressBackgroundOpacity();
        const feedback = req.body?.feedback !== undefined
            ? setGoalGiftFeedbackSettings(req.body.feedback)
            : getGoalGiftFeedbackSettings();
        const items = setGoalGiftWidgetItems(req.body.items);
        const snapshot = buildGoalGiftProgressSnapshot(getTodayDayKey(), items, fontKey, textStyleKey, strokeWidth, noteFontSize, achievementBadgeSize, achievementBadgeStyle, layout, headingText, headingScroll, headingFontSize, progressRingColor, progressBackgroundOpacity);

        io.emit('widgets:goal-gifts:updated', { snapshot });

        res.json({
            ok: true,
            items: snapshot.goals,
            feedback,
            snapshot,
            appearance: goalGiftsAppearance
        });
    });
};
