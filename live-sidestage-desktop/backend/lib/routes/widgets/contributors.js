'use strict';

module.exports = function registerContributorsWidgetRoutes({
    app,
    normalizePositiveHundreds, normalizeWholeNumber, normalizeDisplayAvatarVisibility,
    getDisplayThreshold, setDisplayThreshold,
    getDisplayGoalCount, setDisplayGoalCount,
    getDisplayAvatarVisibility, setDisplayAvatarVisibility,
    getContributorsFeedbackSettings, setContributorsFeedbackSettings,
    getContributorsWidgetTextAppearance, setContributorsWidgetTextAppearance,
    getContributorsDisplayRange, setContributorsDisplayRange,
    getContributorsSessionState,
    getDisplayDayKey,
    buildOverlayContributorsSnapshot,
    emitDisplayThresholdChanges,
    emitSnapshot, emitAdminDayUpdate,
}) {
    app.patch('/api/widgets/contributors-style', (req, res) => {
        const displayThreshold = normalizePositiveHundreds(req.body?.displayThreshold);
        if (req.body?.displayThreshold !== undefined && displayThreshold === null) {
            return res.status(400).json({ ok: false, error: 'displayThreshold must be a positive multiple of 100' });
        }

        const goalCount = normalizeWholeNumber(req.body?.goalCount);
        if (req.body?.goalCount !== undefined && goalCount === null) {
            return res.status(400).json({ ok: false, error: 'goalCount must be a non-negative integer' });
        }

        const avatarVisibility = req.body?.avatarVisibility !== undefined
            ? normalizeDisplayAvatarVisibility(req.body.avatarVisibility)
            : getDisplayAvatarVisibility();

        const savedDisplayThreshold = req.body?.displayThreshold !== undefined ? setDisplayThreshold(displayThreshold) : getDisplayThreshold();
        const savedGoalCount = req.body?.goalCount !== undefined ? setDisplayGoalCount(goalCount) : getDisplayGoalCount();
        const savedAvatarVisibility = req.body?.avatarVisibility !== undefined ? setDisplayAvatarVisibility(avatarVisibility) : getDisplayAvatarVisibility();
        const feedback = req.body?.feedback !== undefined
            ? setContributorsFeedbackSettings(req.body.feedback)
            : getContributorsFeedbackSettings();
        const contributorsAppearance = req.body?.appearance !== undefined
            ? setContributorsWidgetTextAppearance(req.body.appearance)
            : getContributorsWidgetTextAppearance();

        emitDisplayThresholdChanges();

        res.json({
            ok: true,
            fontFamily: contributorsAppearance.fontKey,
            displayRangeMode: getContributorsDisplayRange(),
            displayThreshold: savedDisplayThreshold,
            goalCount: savedGoalCount,
            avatarVisibility: savedAvatarVisibility,
            colorTheme: contributorsAppearance.textStyleKey,
            strokeWidth: contributorsAppearance.strokeWidth,
            appearance: contributorsAppearance,
            feedback,
            liveSession: getContributorsSessionState(),
            snapshot: buildOverlayContributorsSnapshot(getDisplayDayKey())
        });
    });

    app.patch('/api/widgets/contributors-range', (req, res) => {
        const displayRangeMode = setContributorsDisplayRange(req.body?.displayRangeMode);
        const snapshot = buildOverlayContributorsSnapshot();
        emitSnapshot(getDisplayDayKey());
        emitAdminDayUpdate(getDisplayDayKey());

        res.json({
            ok: true,
            displayRangeMode,
            liveSession: getContributorsSessionState(),
            snapshot
        });
    });
};
