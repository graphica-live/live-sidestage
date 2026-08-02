        const socket = io();

        const broadcasterStatus = document.getElementById('broadcaster-status');
        const todayStatus = document.getElementById('today-status');
        const saveStatus = document.getElementById('save-status');
        const contributorsUrl = document.getElementById('contributors-url');
        const contributorsDayLabel = document.getElementById('contributors-day-label');
        const contributorsDayPickerRow = document.getElementById('contributors-day-picker-row');
        const contributorsRangeModeSelect = document.getElementById('contributors-range-mode');
        const contributorsThresholdInput = document.getElementById('contributors-threshold');
        const contributorsGoalCountInput = document.getElementById('contributors-goal-count');
        const contributorsAvatarVisibilitySelect = document.getElementById('contributors-avatar-visibility');
        const contributorsFontSelect = document.getElementById('contributors-font');
        const contributorsTextStyleSelect = document.getElementById('contributors-text-style');
        const contributorsStrokeWidthInput = document.getElementById('contributors-stroke-width');
        const topGiftFontSelect = document.getElementById('top-gift-font');
        const topGiftTextStyleSelect = document.getElementById('top-gift-text-style');
        const topGiftStrokeWidthInput = document.getElementById('top-gift-stroke-width');
        const likeContributionFontSelect = document.getElementById('like-contribution-font');
        const likeContributionTextStyleSelect = document.getElementById('like-contribution-text-style');
        const likeContributionStrokeWidthInput = document.getElementById('like-contribution-stroke-width');
        const tapListFontSelect = document.getElementById('tap-list-font');
        const tapListTextStyleSelect = document.getElementById('tap-list-text-style');
        const tapListStrokeWidthInput = document.getElementById('tap-list-stroke-width');
        const giftJarFontSelect = document.getElementById('gift-jar-font');
        const giftJarTextStyleSelect = document.getElementById('gift-jar-text-style');
        const giftJarStrokeWidthInput = document.getElementById('gift-jar-stroke-width');
        const pushPullFontSelect = document.getElementById('push-pull-font');
        const pushPullTextStyleSelect = document.getElementById('push-pull-text-style');
        const pushPullStrokeWidthInput = document.getElementById('push-pull-stroke-width');
        const pushPullGiftSizeInput = document.getElementById('push-pull-gift-size');
        const pushPullGiftPtsSizeInput = document.getElementById('push-pull-gift-pts-size');
        const pushPullScoreModeSelect = document.getElementById('push-pull-score-mode');
        const tapGoalFontSelect = document.getElementById('tap-goal-font');
        const tapGoalTextStyleSelect = document.getElementById('tap-goal-text-style');
        const tapGoalStrokeWidthInput = document.getElementById('tap-goal-stroke-width');
        const tapGoalOrientationSelect = document.getElementById('tap-goal-orientation');
        const tapGoalHeadingTextInput = document.getElementById('tap-goal-heading-text');
        const tapGoalTargetCountInput = document.getElementById('tap-goal-target-count');
        const tapGoalSoundPickerButton = document.getElementById('tap-goal-myinstants-button');
        const tapGoalSoundPreviewButton = document.getElementById('tap-goal-sound-preview-button');
        const tapGoalSoundClearButton = document.getElementById('tap-goal-sound-clear-button');
        const tapGoalSoundNameEl = document.getElementById('tap-goal-sound-name');
        const tapGoalSoundVolumeInput = document.getElementById('tap-goal-sound-volume');
        const tapGoalSoundVolumeValueEl = document.getElementById('tap-goal-sound-volume-value');
        const tapGoalUrl = document.getElementById('tap-goal-url');
        const tapGoalPreviewFrame = document.getElementById('tap-goal-preview-frame');
        const tapGoalProgressLabel = document.getElementById('tap-goal-progress-label');
        const timerFontSelect = document.getElementById('timer-font');
        const timerTextStyleSelect = document.getElementById('timer-text-style');
        const timerStrokeWidthInput = document.getElementById('timer-stroke-width');
        const timerHeadingTextInput = document.getElementById('timer-heading-text');
        const timerDurationMinutesInput = document.getElementById('timer-duration-minutes');
        const timerDurationSecondsInput = document.getElementById('timer-duration-seconds');
        const timerEndSoundPickerButton = document.getElementById('timer-myinstants-button');
        const timerEndSoundPreviewButton = document.getElementById('timer-end-sound-preview-button');
        const timerEndSoundClearButton = document.getElementById('timer-end-sound-clear-button');
        const timerEndSoundNameEl = document.getElementById('timer-end-sound-name');
        const timerEndSoundVolumeInput = document.getElementById('timer-end-sound-volume');
        const timerEndSoundVolumeValueEl = document.getElementById('timer-end-sound-volume-value');
        const timerGiftRowsEl = document.getElementById('timer-gift-rows');
        const timerUrl = document.getElementById('timer-url');
        const timerPreviewFrame = document.getElementById('timer-preview-frame');
        const timerStatusLabel = document.getElementById('timer-status-label');
        const timerSuggestPanel = document.getElementById('timer-suggest-panel');
        const myinstantsModal = document.getElementById('myinstants-modal');
        const myinstantsSearchInput = document.getElementById('myinstants-search-input');
        const myinstantsSearchButton = document.getElementById('myinstants-search-button');
        const myinstantsStatus = document.getElementById('myinstants-status');
        const myinstantsResults = document.getElementById('myinstants-results');
        const goalGiftFontSelect = document.getElementById('goal-gift-font');
        const goalGiftTextStyleSelect = document.getElementById('goal-gift-text-style');
        const goalGiftStrokeWidthInput = document.getElementById('goal-gift-stroke-width');
        const goalGiftNoteFontSizeInput = document.getElementById('goal-gift-note-font-size');
        const goalGiftAchievementBadgeSizeInput = document.getElementById('goal-gift-achievement-badge-size');
        const goalGiftAchievementBadgeStyleSelect = document.getElementById('goal-gift-achievement-badge-style');
        const goalGiftProgressRingColorInput = document.getElementById('goal-gift-progress-ring-color');
        const goalGiftProgressBgOpacityInput = document.getElementById('goal-gift-progress-bg-opacity');
        const goalGiftProgressBgOpacityValue = document.getElementById('goal-gift-progress-bg-opacity-value');
        const goalGiftLayoutSelect = document.getElementById('goal-gift-layout');
        const goalGiftHeadingTextInput = document.getElementById('goal-gift-heading-text');
        const goalGiftHeadingScrollInput = document.getElementById('goal-gift-heading-scroll');
        const goalGiftHeadingFontSizeInput = document.getElementById('goal-gift-heading-font-size');
        const sharedSoundKeySelect = document.getElementById('shared-sound-key');
        const sharedEffectKeySelect = document.getElementById('shared-effect-key');
        const testSharedSoundButton = document.getElementById('test-shared-sound-button');
        const topGiftUrl = document.getElementById('top-gift-url');
        const likeContributionUrl = document.getElementById('like-contribution-url');
        const giftJarUrl = document.getElementById('gift-jar-url');
        const contributorsPreviewFrame = document.getElementById('contributors-preview-frame');
        const topGiftPreviewFrame = document.getElementById('top-gift-preview-frame');
        const likeContributionPreviewFrame = document.getElementById('like-contribution-preview-frame');
        const tapListUrl = document.getElementById('tap-list-url');
        const tapListPreviewFrame = document.getElementById('tap-list-preview-frame');
        const tapListBgStyleSelect = document.getElementById('tap-list-bg-style');
        const tapListMaxEntriesInput = document.getElementById('tap-list-max-entries');
        const tapListRowGapInput = document.getElementById('tap-list-row-gap');
        const coinListFontSelect = document.getElementById('coin-list-font');
        const coinListTextStyleSelect = document.getElementById('coin-list-text-style');
        const coinListStrokeWidthInput = document.getElementById('coin-list-stroke-width');
        const coinListUrl = document.getElementById('coin-list-url');
        const coinListPreviewFrame = document.getElementById('coin-list-preview-frame');
        const coinListBgStyleSelect = document.getElementById('coin-list-bg-style');
        const coinListSortOrderSelect = document.getElementById('coin-list-sort-order');
        const coinListMaxEntriesInput = document.getElementById('coin-list-max-entries');
        const coinListRowGapInput = document.getElementById('coin-list-row-gap');
        const giftJarPreviewFrame = document.getElementById('gift-jar-preview-frame');
        const customJarUrl = document.getElementById('custom-jar-url');
        const customJarPreviewFrame = document.getElementById('custom-jar-preview-frame');
        const giftJarWallEditor = document.getElementById('gift-jar-wall-editor');
        const giftJarWallEditorNote = document.getElementById('gift-jar-wall-editor-note');
        const giftJarWallEditorStatus = document.getElementById('gift-jar-wall-editor-status');
        const giftJarWallEditorBackground = document.getElementById('gift-jar-wall-editor-background');
        const giftJarWallEditorCanvas = document.getElementById('gift-jar-wall-editor-canvas');
        const giftJarWallPaintButton = document.getElementById('gift-jar-wall-paint-button');
        const giftJarWallEraseButton = document.getElementById('gift-jar-wall-erase-button');
        const giftJarWallBrushSizeInput = document.getElementById('gift-jar-wall-brush-size');
        const giftJarWallBrushSizeValue = document.getElementById('gift-jar-wall-brush-size-value');
        const giftJarWallLoadButton = document.getElementById('gift-jar-wall-load-button');
        const giftJarWallClearButton = document.getElementById('gift-jar-wall-clear-button');
        const giftJarWallDeleteButton = document.getElementById('gift-jar-wall-delete-button');
        const giftJarWallSaveButton = document.getElementById('gift-jar-wall-save-button');
        const giftJarWallEditorContext = giftJarWallEditorCanvas.getContext('2d', { willReadFrequently: true });
        const GIFT_JAR_EDITOR_CANVAS_SIZE = 540;
        const GIFT_JAR_EDITOR_WIDGET_SIZE = 1080;
        const GIFT_JAR_EDITOR_SCALE = GIFT_JAR_EDITOR_WIDGET_SIZE / GIFT_JAR_EDITOR_CANVAS_SIZE;
        const GIFT_JAR_EDITOR_BACKGROUND_BY_THEME = {
            pig: {
                src: '/widgets/pig.png',
                left: -10,
                top: 75,
                width: 560,
                height: 373
            }
        };
        let giftJarWallProfiles = {};
        let giftJarWallEditorEnabled = false;
        let giftJarWallEditorTool = 'paint';
        let giftJarWallEditorIsDrawing = false;
        let giftJarWallEditorLastPoint = null;

        function resizeJarPreviewFrame(frame) {
            const container = frame && frame.parentElement;
            if (!container) return;
            const s = container.clientWidth / 1080;
            frame.style.transform = `scale(${s})`;
            container.style.height = (1080 * s) + 'px';
        }
        function resizeGiftJarPreview() {
            resizeJarPreviewFrame(giftJarPreviewFrame);
            resizeJarPreviewFrame(customJarPreviewFrame);
        }
        resizeGiftJarPreview();
        window.addEventListener('resize', resizeGiftJarPreview);
        const goalGiftPreviewFrame = document.getElementById('goal-gift-preview-frame');
        const goalGiftList = document.getElementById('goal-gift-list');
        const goalGiftAllUrlBox = document.getElementById('goal-gift-all-url');
        const goalGiftSuggestionPanel = document.getElementById('goal-gift-suggestion-panel');
        const titleInput = document.getElementById('top-gift-title');
        const senderDisplayModeInput = document.getElementById('top-gift-sender-display-mode');
        const metalEffectEnabledInput = document.getElementById('top-gift-metal-effect-enabled');
        const likeContributionTitleInput = document.getElementById('like-contribution-title');
        const likeContributionIntervalInput = document.getElementById('like-contribution-interval');
        const likeContributionBalloonDesignSelect = document.getElementById('like-contribution-balloon-design');
        const likeContributionVolumeInput = document.getElementById('like-contribution-volume');
        const likeContributionVolumeValue = document.getElementById('like-contribution-volume-value');
        const likeContributionCountFontSizeInput = document.getElementById('like-contribution-count-font-size');
        const likeContributionNameFontSizeInput = document.getElementById('like-contribution-name-font-size');
        const testLikeContributionButton = document.getElementById('test-like-contribution-button');
        const contributorsPrevDayButton = document.getElementById('contributors-prev-day-button');
        const contributorsNextDayButton = document.getElementById('contributors-next-day-button');

        const state = {
            broadcasterId: null,
            todayDayKey: '',
            displayDayKey: '',
            contributorsDisplayRangeMode: 'today',
            liveSession: {
                startedAt: null,
                endedAt: null,
                isActive: false
            },
            widgetUrls: {
                contributorsOverlayUrl: '',
                contributorsLoaderUrl: '',
                topGiftOverlayUrl: '',
                topGiftLoaderUrl: '',
                likeContributionOverlayUrl: '',
                likeContributionLoaderUrl: '',
                goalGiftsOverlayUrl: '',
                goalGiftsLoaderUrl: '',
                giftJarOverlayUrl: '',
                giftJarLoaderUrl: '',
                tapListOverlayUrl: '',
                tapListLoaderUrl: '',
                coinListOverlayUrl: '',
                coinListLoaderUrl: '',
                pushPullOverlayUrl: '',
                pushPullLoaderUrl: '',
                tapGoalOverlayUrl: '',
                tapGoalLoaderUrl: '',
                timerOverlayUrl: '',
                timerLoaderUrl: ''
            },
            contributorsDisplayThreshold: 1000,
            contributorsGoalCount: 10,
            contributorsAvatarVisibility: 'avatar-and-name',
            contributorsFontKey: 'default',
            contributorsColorTheme: 'gold-night',
            contributorsStrokeWidth: 4,
            contributorsAppearance: { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 },
            topGiftAppearance: { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 },
            likeContributionAppearance: { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 },
            tapListAppearance: { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 },
            giftJarAppearance: { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 },
            pushPullAppearance: { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 },
            goalGiftAppearance: { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 },
            tapGoalAppearance: { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 },
            tapGoalProgress: { count: 0, target: 100 },
            timerAppearance: { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 6 },
            timerSettings: { durationMinutes: 10, durationSeconds: 0, headingText: '', slots: [], endSound: { name: '', url: '' }, endSoundVolume: 100 },
            timerRuntime: { running: false, endsAt: null, remainingMs: 600000 },
            goalGiftNoteFontSize: 28,
            goalGiftAchievementBadgeSize: 152,
            goalGiftAchievementBadgeStyle: 'stamp-red',
            goalGiftProgressRingColor: '#f59e0b',
            goalGiftProgressBackgroundOpacity: 46,
            goalGiftLayout: 'row',
            goalGiftHeadingText: '',
            goalGiftHeadingScroll: false,
            goalGiftHeadingFontSize: 32,
            sharedWidgetFeedback: {
                soundEnabled: true,
                effectEnabled: true,
                soundKey: 'business08',
                effectKey: 'glow'
            },
            topGiftSettings: null,
            likeContributionSettings: null,
            tapListSettings: null,
            tapGoalSettings: null,
            coinListSettings: null,
            goalGiftItems: [],
            giftCatalog: [],
            giftCatalogByName: new Map()
        };
        const goalGiftSystemImageUrls = {
            like: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
                    <defs>
                        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#fb7185"/>
                            <stop offset="100%" stop-color="#f59e0b"/>
                        </linearGradient>
                        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                            <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#7c2d12" flood-opacity="0.28"/>
                        </filter>
                    </defs>
                    <rect width="320" height="320" rx="72" fill="url(#bg)"/>
                    <circle cx="242" cy="82" r="30" fill="rgba(255,255,255,0.18)"/>
                    <circle cx="254" cy="70" r="10" fill="rgba(255,255,255,0.48)"/>
                    <g filter="url(#shadow)">
                        <path d="M160 250c-8 0-16-3-22-9l-50-47c-22-21-24-56-4-78 19-20 50-23 72-7l4 3 4-3c22-16 53-13 72 7 20 22 18 57-4 78l-50 47c-6 6-14 9-22 9z" fill="#fff7ed"/>
                        <path d="M204 108c14 0 27 6 36 16 14 16 13 41-3 56l-50 47c-7 7-18 7-25 0l-50-47c-16-15-17-40-3-56 15-16 40-18 57-6l14 10 14-10c7-6 16-10 25-10z" fill="#ffffff" opacity="0.3"/>
                        <circle cx="103" cy="104" r="14" fill="none" stroke="#fff7ed" stroke-width="10" stroke-linecap="round" opacity="0.9"/>
                        <path d="M88 74c10-14 21-22 34-26" fill="none" stroke="#fff7ed" stroke-width="10" stroke-linecap="round" opacity="0.82"/>
                        <path d="M118 60c8-4 16-6 26-7" fill="none" stroke="#fff7ed" stroke-width="10" stroke-linecap="round" opacity="0.68"/>
                    </g>
                </svg>
            `)}`,
            follow: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
                    <defs>
                        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stop-color="#38bdf8"/>
                            <stop offset="100%" stop-color="#14b8a6"/>
                        </linearGradient>
                        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                            <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#164e63" flood-opacity="0.26"/>
                        </filter>
                    </defs>
                    <rect width="320" height="320" rx="72" fill="url(#bg)"/>
                    <circle cx="242" cy="94" r="56" fill="rgba(255,255,255,0.16)"/>
                    <g filter="url(#shadow)">
                        <circle cx="136" cy="118" r="42" fill="#ecfeff"/>
                        <path d="M64 244c0-36 29-65 65-65h14c36 0 65 29 65 65v14H64z" fill="#ecfeff"/>
                        <circle cx="230" cy="186" r="42" fill="#ffffff"/>
                        <path d="M230 162v48" stroke="#0f766e" stroke-width="14" stroke-linecap="round"/>
                        <path d="M206 186h48" stroke="#0f766e" stroke-width="14" stroke-linecap="round"/>
                    </g>
                </svg>
            `)}`
        };
        const goalGiftSystemSuggestions = [
            {
                id: '__system__:like',
                name: 'タップ',
                describe: 'いいね回数を目標としてカウントします',
                diamondCount: null,
                imageUrl: goalGiftSystemImageUrls.like
            },
            {
                id: '__system__:follow',
                name: 'フォロー',
                describe: 'フォロー回数を目標としてカウントします',
                diamondCount: null,
                imageUrl: goalGiftSystemImageUrls.follow
            }
        ];
        const goalGiftNotePlaceholderChoices = [
            '30人から1個貰う。',
            '全員1個ちょうだい！',
            '〇〇日まで(極)',
            'イベントミッション'
        ];
        let activeGoalGiftInput = null;
        let visibleGoalGiftSuggestions = [];
        let activeGoalGiftSuggestionIndex = -1;
        let topGiftAutosaveTimer = null;
        let topGiftAutosavePromise = null;
        let likeContributionAutosaveTimer = null;
        let likeContributionAutosavePromise = null;
        let tapListAutosaveTimer = null;
        let tapListAutosavePromise = null;
        let coinListAutosaveTimer = null;
        let coinListAutosavePromise = null;
        let goalGiftAutosaveTimer = null;
        let goalGiftAutosavePromise = null;
        let tapGoalAutosaveTimer = null;
        let tapGoalAutosavePromise = null;
        let timerAutosaveTimer = null;
        let timerAutosavePromise = null;
        let timerStatusInterval = null;
        let pendingTopGiftSettings = null;
        let pendingGoalGiftItems = null;
        const goalGiftNotePlaceholderByRow = new Map();

        function getGiftJarWallTheme() {
            const themeSelect = document.getElementById('gift-jar-theme');
            return themeSelect ? themeSelect.value : 'glass';
        }

        function setGiftJarWallEditorStatus(text) {
            giftJarWallEditorStatus.textContent = text;
        }

        function setGiftJarWallEditorTool(nextTool) {
            giftJarWallEditorTool = nextTool === 'erase' ? 'erase' : 'paint';
            giftJarWallPaintButton.classList.toggle('is-active', giftJarWallEditorTool === 'paint');
            giftJarWallEraseButton.classList.toggle('is-active', giftJarWallEditorTool === 'erase');
        }

        function setGiftJarWallEditorControlsDisabled(disabled) {
            giftJarWallPaintButton.disabled = disabled;
            giftJarWallEraseButton.disabled = disabled;
            giftJarWallBrushSizeInput.disabled = disabled;
            giftJarWallLoadButton.disabled = disabled;
            giftJarWallClearButton.disabled = disabled;
            giftJarWallDeleteButton.disabled = disabled;
            giftJarWallSaveButton.disabled = disabled;
            giftJarWallEditorCanvas.style.pointerEvents = disabled ? 'none' : 'auto';
            giftJarWallEditorCanvas.style.opacity = disabled ? '0.55' : '1';
        }

        function clearGiftJarWallEditorCanvas() {
            giftJarWallEditorContext.clearRect(0, 0, GIFT_JAR_EDITOR_CANVAS_SIZE, GIFT_JAR_EDITOR_CANVAS_SIZE);
            setGiftJarWallEditorStatus('キャンバスを初期化しました');
        }

        function paintGiftJarWallEditorFromProfile(profile) {
            giftJarWallEditorContext.clearRect(0, 0, GIFT_JAR_EDITOR_CANVAS_SIZE, GIFT_JAR_EDITOR_CANVAS_SIZE);
            if (!profile || !Array.isArray(profile.wallPoints) || profile.wallPoints.length < 4) {
                setGiftJarWallEditorStatus('保存済み壁はありません');
                return;
            }
            giftJarWallEditorContext.save();
            giftJarWallEditorContext.strokeStyle = 'rgba(194, 65, 12, 0.65)';
            giftJarWallEditorContext.lineWidth = 6;
            giftJarWallEditorContext.lineCap = 'round';
            giftJarWallEditorContext.lineJoin = 'round';
            giftJarWallEditorContext.beginPath();
            for (let index = 0; index < profile.wallPoints.length; index++) {
                const point = profile.wallPoints[index];
                const x = Math.max(0, Math.min(GIFT_JAR_EDITOR_CANVAS_SIZE - 1, point[0] / GIFT_JAR_EDITOR_SCALE));
                const y = Math.max(0, Math.min(GIFT_JAR_EDITOR_CANVAS_SIZE - 1, point[1] / GIFT_JAR_EDITOR_SCALE));
                if (index === 0) {
                    giftJarWallEditorContext.moveTo(x, y);
                } else {
                    giftJarWallEditorContext.lineTo(x, y);
                }
            }
            giftJarWallEditorContext.closePath();
            giftJarWallEditorContext.stroke();
            giftJarWallEditorContext.restore();
            setGiftJarWallEditorStatus('保存済み壁を読み込みました');
        }

        function getGiftJarWallEditorBrushRadius() {
            return Math.max(2, Number(giftJarWallBrushSizeInput.value) || 18);
        }

        function getGiftJarWallEditorPoint(event) {
            const rect = giftJarWallEditorCanvas.getBoundingClientRect();
            const scaleX = GIFT_JAR_EDITOR_CANVAS_SIZE / Math.max(rect.width, 1);
            const scaleY = GIFT_JAR_EDITOR_CANVAS_SIZE / Math.max(rect.height, 1);
            return {
                x: Math.max(0, Math.min(GIFT_JAR_EDITOR_CANVAS_SIZE - 1, (event.clientX - rect.left) * scaleX)),
                y: Math.max(0, Math.min(GIFT_JAR_EDITOR_CANVAS_SIZE - 1, (event.clientY - rect.top) * scaleY))
            };
        }

        function drawGiftJarWallEditorStroke(fromPoint, toPoint) {
            const isErase = giftJarWallEditorTool === 'erase';
            giftJarWallEditorContext.save();
            giftJarWallEditorContext.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';
            giftJarWallEditorContext.strokeStyle = 'rgba(194, 65, 12, 0.42)';
            giftJarWallEditorContext.lineWidth = getGiftJarWallEditorBrushRadius() * 2;
            giftJarWallEditorContext.lineCap = 'round';
            giftJarWallEditorContext.lineJoin = 'round';
            giftJarWallEditorContext.beginPath();
            giftJarWallEditorContext.moveTo(fromPoint.x, fromPoint.y);
            giftJarWallEditorContext.lineTo(toPoint.x, toPoint.y);
            giftJarWallEditorContext.stroke();
            giftJarWallEditorContext.restore();
        }

        function simplifyGiftJarRows(rows) {
            if (rows.length <= 2) return rows;
            const simplified = [rows[0]];
            let lastKept = rows[0];
            for (let i = 1; i < rows.length - 1; i++) {
                const row = rows[i];
                const yGap = row.y - lastKept.y;
                const leftGap = Math.abs(row.left - lastKept.left);
                const rightGap = Math.abs(row.right - lastKept.right);
                if (yGap >= 14 || leftGap >= 10 || rightGap >= 10) {
                    simplified.push(row);
                    lastKept = row;
                }
            }
            simplified.push(rows[rows.length - 1]);
            return simplified;
        }

        function buildGiftJarProfileFromWallRuns(rows) {
            const passableRows = [];
            for (const row of rows) {
                if (!Array.isArray(row.runs) || row.runs.length < 2) continue;
                const leftRun = row.runs[0];
                const rightRun = row.runs[row.runs.length - 1];
                const left = leftRun.end + 1;
                const right = rightRun.start - 1;
                if (right - left < 3) continue;
                passableRows.push({
                    y: Math.max(0, Math.min(1080, Math.round((row.y + 0.5) * GIFT_JAR_EDITOR_SCALE))),
                    left: Math.max(0, Math.min(1080, Math.round(left * GIFT_JAR_EDITOR_SCALE))),
                    right: Math.max(0, Math.min(1080, Math.round((right + 1) * GIFT_JAR_EDITOR_SCALE)))
                });
            }

            if (passableRows.length < 4) {
                throw new Error('壁線が足りません。左右の壁を線で描いてください。');
            }

            const widthStops = simplifyGiftJarRows(passableRows);
            const leftPoints = widthStops.map((row) => [row.left, row.y]);
            const rightPoints = widthStops.map((row) => [row.right, row.y]).reverse();
            const firstRow = widthStops[0];
            return {
                dropSlot: {
                    y: firstRow.y,
                    left: firstRow.left,
                    right: firstRow.right
                },
                widthStops,
                wallPoints: leftPoints.concat(rightPoints)
            };
        }

        function buildGiftJarWallProfileFromCanvas() {
            const { data, width, height } = giftJarWallEditorContext.getImageData(0, 0, GIFT_JAR_EDITOR_CANVAS_SIZE, GIFT_JAR_EDITOR_CANVAS_SIZE);
            const rows = [];
            for (let y = 0; y < height; y++) {
                const runs = [];
                let runStart = -1;
                for (let x = 0; x < width; x++) {
                    const alpha = data[(y * width + x) * 4 + 3];
                    if (alpha > 20) {
                        if (runStart === -1) runStart = x;
                    } else if (runStart !== -1) {
                        runs.push({ start: runStart, end: x - 1 });
                        runStart = -1;
                    }
                }
                if (runStart !== -1) runs.push({ start: runStart, end: width - 1 });
                if (runs.length === 0) continue;
                rows.push({ y, runs });
            }
            return buildGiftJarProfileFromWallRuns(rows);
        }

        function refreshGiftJarWallEditorThemeState() {
            if (!giftJarWallEditorEnabled) {
                giftJarWallEditor.hidden = true;
                return;
            }
            giftJarWallEditor.hidden = false;
            const theme = getGiftJarWallTheme();
            const background = GIFT_JAR_EDITOR_BACKGROUND_BY_THEME[theme];
            const supported = Boolean(background);
            setGiftJarWallEditorControlsDisabled(!supported);
            if (!supported) {
                giftJarWallEditorBackground.hidden = true;
                clearGiftJarWallEditorCanvas();
                giftJarWallEditorNote.textContent = 'このエディタは豚テーマ専用です。瓶テーマを「豚のガラス瓶」に切り替えると使えます。';
                setGiftJarWallEditorStatus('豚テーマに切り替えてください');
                return;
            }
            giftJarWallEditorBackground.hidden = false;
            giftJarWallEditorBackground.src = background.src;
            giftJarWallEditorBackground.style.left = `${background.left}px`;
            giftJarWallEditorBackground.style.top = `${background.top}px`;
            giftJarWallEditorBackground.style.width = `${background.width}px`;
            giftJarWallEditorBackground.style.height = `${background.height}px`;
            giftJarWallEditorNote.textContent = '豚テーマ専用。ギフトを止めたい壁だけをマウスで線描きして保存します。線を描いていない場所は出入りできます。保存はローカル管理端末からのみ許可します。';
            paintGiftJarWallEditorFromProfile(giftJarWallProfiles[theme] || null);
        }

        async function saveGiftJarWallProfile() {
            const theme = getGiftJarWallTheme();
            if (!GIFT_JAR_EDITOR_BACKGROUND_BY_THEME[theme]) {
                setStatus(saveStatus, '設定状態: このテーマの壁エディタはまだ用意していません。', 'warn');
                return;
            }
            const customProfile = buildGiftJarWallProfileFromCanvas();
            setStatus(saveStatus, '設定状態: 壁プロファイルを保存中...', 'warn');
            const response = await fetch('/api/widgets/gift-jar/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customProfileTheme: theme, customProfile })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || '壁プロファイルを保存できませんでした。');
            giftJarWallProfiles = payload.customProfiles || {};
            setGiftJarWallEditorStatus('保存しました');
            setStatus(saveStatus, '設定状態: 壁プロファイルを保存しました。', 'ok');
            refreshGiftJarPreview({ forceReload: true });
        }

        async function deleteGiftJarWallProfile() {
            const theme = getGiftJarWallTheme();
            setStatus(saveStatus, '設定状態: 保存済み壁を削除中...', 'warn');
            const response = await fetch('/api/widgets/gift-jar/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clearCustomProfileTheme: theme })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || '保存済み壁を削除できませんでした。');
            giftJarWallProfiles = payload.customProfiles || {};
            clearGiftJarWallEditorCanvas();
            setGiftJarWallEditorStatus('保存済み壁を削除しました');
            setStatus(saveStatus, '設定状態: 保存済み壁を削除しました。', 'ok');
            refreshGiftJarPreview({ forceReload: true });
        }
        const sharedFontOptions = [
            {
                key: 'default',
                label: 'M PLUS Rounded 1c',
                family: '"M PLUS Rounded 1c", sans-serif'
            },
            {
                key: 'gothic',
                label: 'Noto Sans JP',
                family: '"Noto Sans JP", sans-serif'
            },
            {
                key: 'ui-gothic',
                label: 'Zen Kaku Gothic New',
                family: '"Zen Kaku Gothic New", sans-serif'
            },
            {
                key: 'mincho',
                label: 'Noto Serif JP',
                family: '"Noto Serif JP", serif'
            },
            {
                key: 'ud-gothic',
                label: 'Kosugi',
                family: '"Kosugi", sans-serif'
            },
            {
                key: 'ud-mincho',
                label: 'Zen Old Mincho',
                family: '"Zen Old Mincho", serif'
            },
            {
                key: 'meiryo',
                label: 'Klee One',
                family: '"Klee One", cursive'
            },
            {
                key: 'rounded',
                label: 'Zen Maru Gothic',
                family: '"Zen Maru Gothic", sans-serif'
            },
            {
                key: 'kyokasho',
                label: '教科書風 Klee One',
                family: '"Klee One", cursive'
            },
            {
                key: 'gyosho',
                label: 'Yuji Syuku',
                family: '"Yuji Syuku", cursive'
            },
            {
                key: 'togarie',
                label: 'トガリエ',
                family: '"Dela Gothic One", sans-serif'
            },
            {
                key: 'ln-pop',
                label: 'ラノベポップ',
                family: '"Mochiy Pop One", sans-serif'
            },
            {
                key: 'comic-impact',
                label: 'コミックインパクト',
                family: '"Rampart One", sans-serif'
            },
            {
                key: 'pop-idol',
                label: 'Hachi Maru Pop',
                family: '"Hachi Maru Pop", cursive'
            },
            {
                key: 'entame',
                label: 'RocknRoll One',
                family: '"RocknRoll One", sans-serif'
            },
            {
                key: 'marker',
                label: 'Yusei Magic',
                family: '"Yusei Magic", cursive'
            },
            {
                key: 'retro-bold',
                label: 'Kaisei Decol',
                family: '"Kaisei Decol", serif'
            },
            {
                key: 'luxury-mincho',
                label: 'Shippori Mincho B1',
                family: '"Shippori Mincho B1", serif'
            },
            {
                key: 'antique-modern',
                label: 'Zen Antique',
                family: '"Zen Antique", serif'
            },
            {
                key: 'atelier-brush',
                label: 'Yuji Mai',
                family: '"Yuji Mai", cursive'
            },
            {
                key: 'pixel-code',
                label: 'PIXEL CODE',
                family: '"DotGothic16", "Noto Sans JP", sans-serif'
            },
            {
                key: 'sawarabi-mincho',
                label: 'Sawarabi Mincho「さわらび明朝」',
                family: '"Sawarabi Mincho", serif'
            },
            {
                key: 'potta-one',
                label: 'Potta One「ボールドインパクト」',
                family: '"Potta One", sans-serif'
            },
            {
                key: 'murecho-thin',
                label: 'Murecho Thin「モダン細字」',
                family: '"Murecho", sans-serif'
            },
            {
                key: 'stick',
                label: 'Stick「超細字」',
                family: '"Stick", sans-serif'
            }
        ];
        const sharedFontOptionMap = new Map(sharedFontOptions.map((option) => [option.key, option]));
        const goalGiftFontOptions = sharedFontOptions;
        const goalGiftFontOptionMap = new Map(goalGiftFontOptions.map((option) => [option.key, option]));
        const contributorsFontOptions = sharedFontOptions;
        const contributorsFontOptionMap = sharedFontOptionMap;
        const sharedTextStyleOptions = [
            { key: 'gold-night', label: 'LIVE Gold', preview: 'color:#fbbf24;-webkit-text-stroke:3px #0f172a;' },
            { key: 'ice-night', label: 'Ice Blue', preview: 'color:#dbeafe;-webkit-text-stroke:3px #172554;' },
            { key: 'candy-pop', label: 'Candy Pop', preview: 'color:#f9a8d4;-webkit-text-stroke:3px #831843;' },
            { key: 'mint-lime', label: 'Mint Shot', preview: 'color:#d9f99d;-webkit-text-stroke:3px #14532d;' },
            { key: 'sunset-party', label: 'Sunset Glow', preview: 'color:#fdba74;-webkit-text-stroke:3px #7c2d12;' },
            { key: 'violet-flash', label: 'Violet Beat', preview: 'color:#c4b5fd;-webkit-text-stroke:3px #312e81;' },
            { key: 'mono-impact', label: 'Mono Impact', preview: 'color:#ffffff;-webkit-text-stroke:3px #111827;' },
            { key: 'sakura-bloom', label: 'Sakura Glow', preview: 'color:#fbcfe8;-webkit-text-stroke:3px #9d174d;' },
            { key: 'ocean-glow', label: 'Ocean Beam', preview: 'color:#67e8f9;-webkit-text-stroke:3px #164e63;' },
            { key: 'emerald-city', label: 'Emerald Neon', preview: 'color:#6ee7b7;-webkit-text-stroke:3px #064e3b;' },
            { key: 'ruby-flare', label: 'Ruby Flame', preview: 'color:#fb7185;-webkit-text-stroke:3px #3f0d12;' },
            { key: 'lemon-pop', label: 'Lemon Punch', preview: 'color:#fde047;-webkit-text-stroke:3px #1e3a8a;' },
            { key: 'midnight-aqua', label: 'Midnight Aqua', preview: 'color:#99f6e4;-webkit-text-stroke:3px #0f172a;' },
            { key: 'peach-fizz', label: 'Peach Fizz', preview: 'color:#fdba74;-webkit-text-stroke:3px #7f1d1d;' },
            { key: 'festival-red', label: 'Festival Red', preview: 'color:#fca5a5;-webkit-text-stroke:3px #1f2937;' },
            { key: 'rose-gold', label: 'Rose Luxe', preview: 'color:#f8b4a6;-webkit-text-stroke:3px #5b342e;' },
            { key: 'cyber-teal', label: 'Cyber Teal', preview: 'color:#67e8f9;-webkit-text-stroke:3px #0f2740;' },
            { key: 'aurora-dream', label: 'Aurora Dream', preview: 'color:#e9d5ff;-webkit-text-stroke:3px #4c1d95;' },
            { key: 'coral-soda', label: 'Coral Soda', preview: 'color:#fb7185;-webkit-text-stroke:3px #7f1d1d;' },
            { key: 'platinum-pop', label: 'Platinum Pop', preview: 'color:#e2e8f0;-webkit-text-stroke:3px #334155;' },
            { key: 'champagne-shine', label: 'Champagne Shine', preview: 'color:#f8e7b5;-webkit-text-stroke:3px #6b4f2a;' },
            { key: 'royal-velvet', label: 'Royal Velvet', preview: 'color:#d8b4fe;-webkit-text-stroke:3px #312e81;' },
            { key: 'emerald-luxe', label: 'Emerald Luxe', preview: 'color:#a7f3d0;-webkit-text-stroke:3px #14532d;' },
            { key: 'sunrise-opal', label: 'Sunrise Opal', preview: 'color:#fdba74;-webkit-text-stroke:3px #9a3412;' },
            { key: 'prism-burst', label: 'Prism Burst', preview: 'color:#7dd3fc;-webkit-text-stroke:3px #4338ca;' },
            { key: 'tropical-punch', label: 'Tropical Punch', preview: 'color:#fb7185;-webkit-text-stroke:3px #7f1d1d;' },
            { key: 'lagoon-shine', label: 'Lagoon Shine', preview: 'color:#2dd4bf;-webkit-text-stroke:3px #155e75;' },
            { key: 'berry-mist', label: 'Berry Mist', preview: 'color:#f472b6;-webkit-text-stroke:3px #701a75;' },
            { key: 'polar-neon', label: 'Polar Neon', preview: 'color:#67e8f9;-webkit-text-stroke:3px #1e293b;' },
            { key: 'citrus-splash', label: 'Citrus Splash', preview: 'color:#a3e635;-webkit-text-stroke:3px #166534;' }
        ];
        const goalGiftTextStyleOptions = sharedTextStyleOptions;
        const goalGiftTextStyleOptionMap = new Map(goalGiftTextStyleOptions.map((option) => [option.key, option]));
        const MAX_GOAL_GIFT_STROKE_WIDTH = 24;
        const DEFAULT_GOAL_GIFT_NOTE_FONT_SIZE = 28;
        const MIN_GOAL_GIFT_NOTE_FONT_SIZE = 8;
        const MAX_GOAL_GIFT_NOTE_FONT_SIZE = 96;
        const DEFAULT_GOAL_GIFT_ACHIEVEMENT_BADGE_SIZE = 152;
        const MIN_GOAL_GIFT_ACHIEVEMENT_BADGE_SIZE = 40;
        const MAX_GOAL_GIFT_ACHIEVEMENT_BADGE_SIZE = 400;
        const DEFAULT_GOAL_GIFT_ACHIEVEMENT_BADGE_STYLE = 'stamp-red';
        const ALLOWED_GOAL_GIFT_ACHIEVEMENT_BADGE_STYLES = new Set(['stamp-red', 'stamp-blue', 'stamp-gold', 'stamp-green', 'stamp-dark']);
        const DEFAULT_GOAL_GIFT_LAYOUT = 'row';
        const ALLOWED_GOAL_GIFT_LAYOUTS = new Set(['row', 'column']);
        const DEFAULT_GOAL_GIFT_PROGRESS_RING_COLOR = '#f59e0b';
        const DEFAULT_GOAL_GIFT_PROGRESS_BG_OPACITY = 46;
        const MIN_GOAL_GIFT_PROGRESS_BG_OPACITY = 0;
        const MAX_GOAL_GIFT_PROGRESS_BG_OPACITY = 100;
        const contributorsTextStyleOptions = sharedTextStyleOptions;
        const contributorsTextStyleOptionMap = new Map(contributorsTextStyleOptions.map((option) => [option.key, option]));
        const MAX_CONTRIBUTORS_STROKE_WIDTH = 12;
        const sharedFeedbackSoundOptions = [
            { key: 'business08', label: 'Business 08' },
            { key: 'business09', label: 'Business 09' },
            { key: 'business10', label: 'Business 10' },
            { key: 'business11', label: 'Business 11' },
            { key: 'bush-warbler', label: 'Bush Warbler' },
            { key: 'cow', label: 'Cow Synthetic' },
            { key: 'hyoshigi', label: 'Hyoshigi' },
            { key: 'xylophone', label: 'Xylophone' },
            { key: 'glocken01', label: 'Glocken 01' },
            { key: 'glocken02', label: 'Glocken 02' },
            { key: 'glocken03', label: 'Glocken 03' },
            { key: 'electronic-chime02', label: 'Electronic Chime 02' },
            { key: 'electronic-chime03', label: 'Electronic Chime 03' }
        ];
        const sharedFeedbackEffectOptions = [
            { key: 'glow', label: 'Glow Pulse' },
            { key: 'magic', label: 'Magic Orbit' },
            { key: 'luxury', label: 'Luxury Halo' }
        ];
        const SHARED_FEEDBACK_DISABLED_VALUE = '__off__';
        const sharedFeedbackSoundOptionMap = new Map(sharedFeedbackSoundOptions.map((option) => [option.key, option]));
        const sharedFeedbackEffectOptionMap = new Map(sharedFeedbackEffectOptions.map((option) => [option.key, option]));

        function normalizeContributorsDisplayThreshold(value) {
            const normalizedValue = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(normalizedValue) || normalizedValue <= 0 || normalizedValue % 100 !== 0) {
                return 1000;
            }

            return normalizedValue;
        }

        function normalizeContributorsGoalCount(value) {
            const normalizedValue = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(normalizedValue) || normalizedValue < 0) {
                return 10;
            }

            return normalizedValue;
        }

        function normalizeContributorsAvatarVisibility(value) {
            if (value === 'count-only') return 'count-only';
            if (value === 'name-only' || value === 'hide') return 'name-only';
            return 'avatar-and-name';
        }

        function normalizeContributorsDisplayRangeMode(value) {
            return value === 'session' ? 'session' : 'today';
        }

        function normalizeLiveSession(value) {
            return {
                startedAt: typeof value?.startedAt === 'string' && value.startedAt ? value.startedAt : null,
                endedAt: typeof value?.endedAt === 'string' && value.endedAt ? value.endedAt : null,
                isActive: Boolean(value?.isActive)
            };
        }

        function normalizeFeedbackSettings(value) {
            const normalizedSoundKey = String(value?.soundKey || '').trim().toLowerCase();
            const normalizedEffectKey = String(value?.effectKey || '').trim().toLowerCase();

            return {
                soundEnabled: value?.soundEnabled !== false,
                effectEnabled: value?.effectEnabled !== false,
                soundKey: sharedFeedbackSoundOptionMap.has(normalizedSoundKey) ? normalizedSoundKey : 'business08',
                effectKey: sharedFeedbackEffectOptionMap.has(normalizedEffectKey) ? normalizedEffectKey : 'glow'
            };
        }

        function getSharedFeedbackSoundOptionsMarkup(selectedKey) {
            const normalizedKey = normalizeFeedbackSettings({ soundKey: selectedKey }).soundKey;
            return [`
                <option value="${SHARED_FEEDBACK_DISABLED_VALUE}">オフ</option>
            `, ...sharedFeedbackSoundOptions.map((option) => `
                <option value="${escapeHtml(option.key)}" ${option.key === normalizedKey ? 'selected' : ''}>${escapeHtml(option.label)}</option>
            `)].join('');
        }

        function getSharedFeedbackEffectOptionsMarkup(selectedKey) {
            const normalizedKey = normalizeFeedbackSettings({ effectKey: selectedKey }).effectKey;
            return [`
                <option value="${SHARED_FEEDBACK_DISABLED_VALUE}">オフ</option>
            `, ...sharedFeedbackEffectOptions.map((option) => `
                <option value="${escapeHtml(option.key)}" ${option.key === normalizedKey ? 'selected' : ''}>${escapeHtml(option.label)}</option>
            `)].join('');
        }

        function getSharedSoundSelectionState() {
            const selectedValue = String(sharedSoundKeySelect.value || '').trim().toLowerCase();
            return {
                soundEnabled: selectedValue !== SHARED_FEEDBACK_DISABLED_VALUE,
                soundKey: sharedFeedbackSoundOptionMap.has(selectedValue) ? selectedValue : 'business08'
            };
        }

        function getSharedEffectSelectionState() {
            const selectedValue = String(sharedEffectKeySelect.value || '').trim().toLowerCase();
            return {
                effectEnabled: selectedValue !== SHARED_FEEDBACK_DISABLED_VALUE,
                effectKey: sharedFeedbackEffectOptionMap.has(selectedValue) ? selectedValue : 'glow'
            };
        }


        function normalizeGoalGiftFontKey(value) {
            const normalizedValue = String(value || '').trim().toLowerCase();
            return goalGiftFontOptionMap.has(normalizedValue) ? normalizedValue : 'default';
        }

        function getGoalGiftFontFamily(value) {
            return goalGiftFontOptionMap.get(normalizeGoalGiftFontKey(value))?.family || goalGiftFontOptions[0].family;
        }

        function normalizeContributorsFontKey(value) {
            const normalizedValue = String(value || '').trim().toLowerCase();
            const aliases = {
                notosans: 'gothic',
                roboto: 'gothic',
                robot: 'gothic',
                rounded: 'default',
                mincho: 'ud-mincho',
                decol: 'retro-bold',
                magic: 'marker',
                gothic_heavy: 'togarie',
                maru_pop: 'pop-idol',
                dot: 'default',
                display: 'comic-impact',
                klee: 'kyokasho',
                shippori: 'luxury-mincho',
                reggae: 'entame',
                'cyber-core': 'pixel-code',
                'neon-grid': 'pixel-code',
                'signal-runner': 'pixel-code'
            };
            const resolvedValue = aliases[normalizedValue] || normalizedValue;
            return contributorsFontOptionMap.has(resolvedValue) ? resolvedValue : 'default';
        }

        function getContributorsFontFamily(value) {
            return contributorsFontOptionMap.get(normalizeContributorsFontKey(value))?.family || contributorsFontOptions[0].family;
        }

        function normalizeGoalGiftTextStyleKey(value) {
            const normalizedValue = String(value || '').trim().toLowerCase();
            return goalGiftTextStyleOptionMap.has(normalizedValue) ? normalizedValue : 'gold-night';
        }

        function normalizeGoalGiftStrokeWidth(value) {
            const normalizedValue = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(normalizedValue) || normalizedValue < 0) {
                return 3;
            }

            return Math.min(normalizedValue, MAX_GOAL_GIFT_STROKE_WIDTH);
        }

        function normalizeGoalGiftNoteFontSize(value) {
            const normalizedValue = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(normalizedValue) || normalizedValue < MIN_GOAL_GIFT_NOTE_FONT_SIZE) {
                return DEFAULT_GOAL_GIFT_NOTE_FONT_SIZE;
            }

            return Math.min(normalizedValue, MAX_GOAL_GIFT_NOTE_FONT_SIZE);
        }

        function normalizeGoalGiftAchievementBadgeSize(value) {
            const normalizedValue = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(normalizedValue) || normalizedValue < MIN_GOAL_GIFT_ACHIEVEMENT_BADGE_SIZE) {
                return DEFAULT_GOAL_GIFT_ACHIEVEMENT_BADGE_SIZE;
            }

            return Math.min(normalizedValue, MAX_GOAL_GIFT_ACHIEVEMENT_BADGE_SIZE);
        }

        function normalizeGoalGiftAchievementBadgeStyle(value) {
            const normalizedValue = String(value || '').trim().toLowerCase();
            return ALLOWED_GOAL_GIFT_ACHIEVEMENT_BADGE_STYLES.has(normalizedValue) ? normalizedValue : DEFAULT_GOAL_GIFT_ACHIEVEMENT_BADGE_STYLE;
        }

        function normalizeGoalGiftLayout(value) {
            const normalizedValue = String(value || '').trim().toLowerCase();
            return ALLOWED_GOAL_GIFT_LAYOUTS.has(normalizedValue) ? normalizedValue : DEFAULT_GOAL_GIFT_LAYOUT;
        }

        function normalizeGoalGiftProgressRingColor(value) {
            const normalizedValue = String(value || '').trim().toLowerCase();
            return /^#[0-9a-f]{6}$/.test(normalizedValue) ? normalizedValue : DEFAULT_GOAL_GIFT_PROGRESS_RING_COLOR;
        }

        function normalizeGoalGiftProgressBackgroundOpacity(value) {
            const normalizedValue = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(normalizedValue) || normalizedValue < MIN_GOAL_GIFT_PROGRESS_BG_OPACITY) {
                return DEFAULT_GOAL_GIFT_PROGRESS_BG_OPACITY;
            }

            return Math.min(normalizedValue, MAX_GOAL_GIFT_PROGRESS_BG_OPACITY);
        }

        function normalizeGoalGiftHeadingText(value) {
            return typeof value === 'string' ? value.trim().slice(0, 40) : '';
        }

        function normalizeGoalGiftHeadingFontSize(value) {
            const parsed = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(parsed) || parsed < 12) {
                return 32;
            }

            return Math.min(parsed, 160);
        }

        function normalizeContributorsTextStyleKey(value) {
            const normalizedValue = String(value || '').trim().toLowerCase();
            const aliases = {
                gold_black: 'gold-night',
                white_black: 'mono-impact',
                mint_navy: 'mint-lime',
                pink_burgundy: 'candy-pop',
                sky_royal: 'ice-night',
                neon_lime: 'lemon-pop',
                sakura_plum: 'sakura-bloom',
                sunset_fire: 'sunset-party',
                ice_silver: 'ice-night',
                citrus_forest: 'emerald-city'
            };
            const resolvedValue = aliases[normalizedValue] || normalizedValue;
            return contributorsTextStyleOptionMap.has(resolvedValue) ? resolvedValue : 'gold-night';
        }

        function normalizeContributorsStrokeWidth(value) {
            const normalizedValue = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(normalizedValue) || normalizedValue < 1) {
                return 4;
            }

            return Math.min(normalizedValue, MAX_CONTRIBUTORS_STROKE_WIDTH);
        }

        function normalizeDisplayFontKey(value) {
            const normalizedValue = String(value || '').trim().toLowerCase();
            return sharedFontOptionMap.has(normalizedValue) ? normalizedValue : 'default';
        }

        function normalizeDisplayTextStyleKey(value) {
            const normalizedValue = String(value || '').trim().toLowerCase();
            return goalGiftTextStyleOptionMap.has(normalizedValue) ? normalizedValue : 'gold-night';
        }

        function normalizeDisplayStrokeWidth(value) {
            const normalizedValue = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(normalizedValue) || normalizedValue < 0) return 4;
            return Math.min(normalizedValue, 24);
        }

        function getWidgetFontFamily(value) {
            return sharedFontOptionMap.get(normalizeDisplayFontKey(value))?.family || sharedFontOptions[0].family;
        }

        function getContributorsFontOptionsMarkup(selectedKey) {
            const normalizedKey = normalizeContributorsFontKey(selectedKey);
            return contributorsFontOptions.map((option) => `
                <option value="${escapeHtml(option.key)}" style="font-family: ${escapeHtml(option.family)};" ${option.key === normalizedKey ? 'selected' : ''}>${escapeHtml(option.label)}</option>
            `).join('');
        }

        function getContributorsTextStyleOptionsMarkup(selectedKey) {
            const normalizedKey = normalizeContributorsTextStyleKey(selectedKey);
            return contributorsTextStyleOptions.map((option) => `
                <option value="${escapeHtml(option.key)}" style="${option.preview}" ${option.key === normalizedKey ? 'selected' : ''}>${escapeHtml(option.label)}</option>
            `).join('');
        }

        function syncContributorsFontControl() {
            contributorsFontSelect.innerHTML = getContributorsFontOptionsMarkup(state.contributorsFontKey);
            contributorsFontSelect.value = normalizeContributorsFontKey(state.contributorsFontKey);
            contributorsFontSelect.style.fontFamily = getContributorsFontFamily(state.contributorsFontKey);
        }

        function syncContributorsThresholdControl() {
            contributorsThresholdInput.value = String(normalizeContributorsDisplayThreshold(state.contributorsDisplayThreshold));
        }

        function syncContributorsRangeControl() {
            contributorsRangeModeSelect.value = normalizeContributorsDisplayRangeMode(state.contributorsDisplayRangeMode);
            contributorsDayPickerRow.hidden = normalizeContributorsDisplayRangeMode(state.contributorsDisplayRangeMode) === 'session';
        }

        function syncContributorsGoalCountControl() {
            contributorsGoalCountInput.value = String(normalizeContributorsGoalCount(state.contributorsGoalCount));
        }

        function syncContributorsAvatarVisibilityControl() {
            contributorsAvatarVisibilitySelect.value = normalizeContributorsAvatarVisibility(state.contributorsAvatarVisibility);
        }

        function syncContributorsTextStyleControl() {
            contributorsTextStyleSelect.innerHTML = getContributorsTextStyleOptionsMarkup(state.contributorsColorTheme);
            contributorsTextStyleSelect.value = normalizeContributorsTextStyleKey(state.contributorsColorTheme);
        }

        function syncContributorsStrokeWidthControl() {
            contributorsStrokeWidthInput.value = String(normalizeContributorsStrokeWidth(state.contributorsStrokeWidth));
        }

        function getWidgetFontOptionsMarkup(selectedKey) {
            const normalizedKey = normalizeDisplayFontKey(selectedKey);
            return sharedFontOptions.map((option) => `
                <option value="${escapeHtml(option.key)}" style="font-family: ${escapeHtml(option.family)};" ${option.key === normalizedKey ? 'selected' : ''}>${escapeHtml(option.label)}</option>
            `).join('');
        }

        function getWidgetTextStyleOptionsMarkup(selectedKey) {
            const normalizedKey = normalizeDisplayTextStyleKey(selectedKey);
            return sharedTextStyleOptions.map((option) => `
                <option value="${escapeHtml(option.key)}" style="${option.preview}" ${option.key === normalizedKey ? 'selected' : ''}>${escapeHtml(option.label)}</option>
            `).join('');
        }

        function syncWidgetAppearanceControls(fontSelect, textStyleSelect, strokeWidthInput, appearance) {
            const fontKey = appearance?.fontKey || 'default';
            const textStyleKey = appearance?.textStyleKey || 'gold-night';
            const strokeWidth = appearance?.strokeWidth ?? 4;
            fontSelect.innerHTML = getWidgetFontOptionsMarkup(fontKey);
            fontSelect.value = normalizeDisplayFontKey(fontKey);
            fontSelect.style.fontFamily = getWidgetFontFamily(fontKey);
            textStyleSelect.innerHTML = getWidgetTextStyleOptionsMarkup(textStyleKey);
            textStyleSelect.value = normalizeDisplayTextStyleKey(textStyleKey);
            strokeWidthInput.value = String(normalizeDisplayStrokeWidth(strokeWidth));
        }

        function syncContributorsAppearanceControls() {
            syncWidgetAppearanceControls(contributorsFontSelect, contributorsTextStyleSelect, contributorsStrokeWidthInput, state.contributorsAppearance);
        }
        function syncTopGiftAppearanceControls() {
            syncWidgetAppearanceControls(topGiftFontSelect, topGiftTextStyleSelect, topGiftStrokeWidthInput, state.topGiftAppearance);
        }
        function syncLikeContributionAppearanceControls() {
            syncWidgetAppearanceControls(likeContributionFontSelect, likeContributionTextStyleSelect, likeContributionStrokeWidthInput, state.likeContributionAppearance);
        }
        function syncTapListAppearanceControls() {
            syncWidgetAppearanceControls(tapListFontSelect, tapListTextStyleSelect, tapListStrokeWidthInput, state.tapListAppearance);
        }
        function syncCoinListAppearanceControls() {
            syncWidgetAppearanceControls(coinListFontSelect, coinListTextStyleSelect, coinListStrokeWidthInput, state.coinListAppearance);
        }
        function syncGiftJarAppearanceControls() {
            syncWidgetAppearanceControls(giftJarFontSelect, giftJarTextStyleSelect, giftJarStrokeWidthInput, state.giftJarAppearance);
        }
        function syncPushPullAppearanceControls() {
            syncWidgetAppearanceControls(pushPullFontSelect, pushPullTextStyleSelect, pushPullStrokeWidthInput, state.pushPullAppearance);
            pushPullGiftSizeInput.value = state.pushPullAppearance?.giftSize ?? 88;
            pushPullGiftPtsSizeInput.value = state.pushPullAppearance?.giftPtsSize ?? 15;
            pushPullScoreModeSelect.value = state.pushPullScoreMode || 'absolute';
        }
        function syncGoalGiftAppearanceControls() {
            syncWidgetAppearanceControls(goalGiftFontSelect, goalGiftTextStyleSelect, goalGiftStrokeWidthInput, state.goalGiftAppearance);
        }
        function syncTapGoalAppearanceControls() {
            syncWidgetAppearanceControls(tapGoalFontSelect, tapGoalTextStyleSelect, tapGoalStrokeWidthInput, state.tapGoalAppearance);
        }

        function syncTimerAppearanceControls() {
            syncWidgetAppearanceControls(timerFontSelect, timerTextStyleSelect, timerStrokeWidthInput, state.timerAppearance);
        }

        function syncGoalGiftNoteFontSizeControl() {
            goalGiftNoteFontSizeInput.value = String(normalizeGoalGiftNoteFontSize(state.goalGiftNoteFontSize));
        }

        function syncGoalGiftAchievementBadgeControls() {
            goalGiftAchievementBadgeSizeInput.value = String(normalizeGoalGiftAchievementBadgeSize(state.goalGiftAchievementBadgeSize));
            goalGiftAchievementBadgeStyleSelect.value = normalizeGoalGiftAchievementBadgeStyle(state.goalGiftAchievementBadgeStyle);
            goalGiftProgressRingColorInput.value = normalizeGoalGiftProgressRingColor(state.goalGiftProgressRingColor);
            goalGiftProgressBgOpacityInput.value = String(normalizeGoalGiftProgressBackgroundOpacity(state.goalGiftProgressBackgroundOpacity));
            goalGiftProgressBgOpacityValue.textContent = `${goalGiftProgressBgOpacityInput.value}%`;
            goalGiftLayoutSelect.value = normalizeGoalGiftLayout(state.goalGiftLayout);
            goalGiftHeadingTextInput.value = normalizeGoalGiftHeadingText(state.goalGiftHeadingText);
            goalGiftHeadingScrollInput.checked = Boolean(state.goalGiftHeadingScroll);
            goalGiftHeadingFontSizeInput.value = String(normalizeGoalGiftHeadingFontSize(state.goalGiftHeadingFontSize));
        }

        function syncSharedFeedbackControls() {
            const feedback = normalizeFeedbackSettings(state.sharedWidgetFeedback);
            sharedSoundKeySelect.innerHTML = getSharedFeedbackSoundOptionsMarkup(feedback.soundKey);
            sharedEffectKeySelect.innerHTML = getSharedFeedbackEffectOptionsMarkup(feedback.effectKey);
            sharedSoundKeySelect.value = feedback.soundEnabled ? feedback.soundKey : SHARED_FEEDBACK_DISABLED_VALUE;
            sharedEffectKeySelect.value = feedback.effectEnabled ? feedback.effectKey : SHARED_FEEDBACK_DISABLED_VALUE;
        }

        function openWindow(path, name, size = { width: 1240, height: 900 }) {
            const features = ['popup=yes', `width=${size.width}`, `height=${size.height}`, 'resizable=yes', 'scrollbars=yes'].join(',');
            window.open(path, name, features);
        }

        function setStatus(element, text, tone = '') {
            element.className = 'status';
            if (tone) {
                element.classList.add(tone);
            }
            element.textContent = text;
        }

        function getGoalGiftNotePlaceholder(rowIndex) {
            if (!goalGiftNotePlaceholderByRow.has(rowIndex)) {
                const randomIndex = Math.floor(Math.random() * goalGiftNotePlaceholderChoices.length);
                goalGiftNotePlaceholderByRow.set(rowIndex, goalGiftNotePlaceholderChoices[randomIndex]);
            }

            return goalGiftNotePlaceholderByRow.get(rowIndex);
        }

        function formatDisplayDayLabel(dayKey) {
            const match = String(dayKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) {
                return dayKey || '未設定';
            }

            return `${match[1]}/${Number(match[2])}/${Number(match[3])}`;
        }

        function formatSessionLabel(timestamp) {
            const dateValue = timestamp ? new Date(timestamp) : null;

            if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
                return '未取得';
            }

            return new Intl.DateTimeFormat('ja-JP', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }).format(dateValue);
        }

        function shiftDayKey(dayKey, offsetDays) {
            const match = String(dayKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!match) {
                return dayKey;
            }

            const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
            value.setUTCDate(value.getUTCDate() + offsetDays);
            return value.toISOString().slice(0, 10);
        }

        function getContributorsOverlayUrl() {
            return state.widgetUrls.contributorsOverlayUrl || '';
        }

        function buildGoalGiftOverlayUrl(slot, options = {}) {
            const baseUrl = options.preview
                ? '/overlays/goal-gifts'
                : (state.widgetUrls.goalGiftsLoaderUrl || state.widgetUrls.goalGiftsOverlayUrl || '');
            if (!baseUrl) {
                return '';
            }

            const separator = baseUrl.includes('?') ? '&' : '?';
            const params = [`slot=${encodeURIComponent(String(slot))}`];
            if (options.preview) {
                params.push('preview=1');
                params.push('sample=1');
                params.push('card=1');
            }
            if (options.forceReload) {
                params.push(`v=${encodeURIComponent(String(Date.now()))}`);
            }
            return `${baseUrl}${separator}${params.join('&')}`;
        }

        function buildPreviewUrl(url, options = {}) {
            if (!url) {
                return '';
            }

            try {
                const previewUrl = new URL(url, window.location.origin);
                if (options.forceReload) {
                    previewUrl.searchParams.set('previewTs', String(Date.now()));
                }
                return previewUrl.toString();
            } catch {
                return url;
            }
        }

        function updatePreviewFrame(frame, url, options = {}) {
            if (!frame) {
                return;
            }

            const nextUrl = buildPreviewUrl(url, options);
            if (!nextUrl) {
                frame.removeAttribute('src');
                delete frame.dataset.previewSrc;
                return;
            }

            if (!options.forceReload && frame.dataset.previewSrc === nextUrl) {
                return;
            }

            frame.dataset.previewSrc = nextUrl;
            frame.removeAttribute('srcdoc');
            frame.src = nextUrl;
        }

        function refreshContributorsPreview(options = {}) {
            const baseUrl = getContributorsOverlayUrl() || '/overlays/contributors';

            try {
                const previewUrl = new URL(baseUrl, window.location.origin);
                previewUrl.searchParams.set('preview', '1');
                previewUrl.searchParams.set('sample', '1');
                previewUrl.searchParams.set('card', '1');
                updatePreviewFrame(contributorsPreviewFrame, previewUrl.toString(), options);
            } catch {
                const separator = baseUrl.includes('?') ? '&' : '?';
                updatePreviewFrame(contributorsPreviewFrame, `${baseUrl}${separator}preview=1&sample=1&card=1`, options);
            }
        }

        function buildTopGiftPreviewUrl() {
            const baseUrl = state.widgetUrls.topGiftOverlayUrl || '/overlays/top-gift';

            try {
                const previewUrl = new URL(baseUrl, window.location.origin);
                previewUrl.searchParams.set('preview', '1');
                previewUrl.searchParams.set('sample', '1');
                previewUrl.searchParams.set('card', '1');
                return previewUrl.toString();
            } catch {
                const separator = baseUrl.includes('?') ? '&' : '?';
                return `${baseUrl}${separator}preview=1&sample=1&card=1`;
            }
        }

        function refreshTopGiftPreview(options = {}) {
            updatePreviewFrame(topGiftPreviewFrame, buildTopGiftPreviewUrl(), options);
        }

        function buildLikeContributionPreviewUrl() {
            const baseUrl = state.widgetUrls.likeContributionOverlayUrl || '/overlays/like-contribution';

            try {
                const previewUrl = new URL(baseUrl, window.location.origin);
                previewUrl.searchParams.set('preview', '1');
                previewUrl.searchParams.set('sample', '1');
                previewUrl.searchParams.set('card', '1');
                return previewUrl.toString();
            } catch {
                const separator = baseUrl.includes('?') ? '&' : '?';
                return `${baseUrl}${separator}preview=1&sample=1&card=1`;
            }
        }

        function refreshLikeContributionPreview(options = {}) {
            updatePreviewFrame(likeContributionPreviewFrame, buildLikeContributionPreviewUrl(), options);
        }

        function buildGiftJarPreviewUrl() {
            const baseUrl = state.widgetUrls.giftJarOverlayUrl || '/overlays/gift-jar';
            try {
                const u = new URL(baseUrl, window.location.origin);
                u.searchParams.set('preview', '1');
                return u.pathname + u.search;
            } catch {
                return baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'preview=1';
            }
        }
        function buildGiftJarSlaveUrl() {
            const baseUrl = state.widgetUrls.giftJarOverlayUrl || '/overlays/gift-jar';
            try {
                const u = new URL(baseUrl, window.location.origin);
                u.searchParams.set('slave', '1');
                return u.pathname + u.search;
            } catch {
                return baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'slave=1';
            }
        }
        function buildGiftJarSlaveFullUrl() {
            const baseUrl = state.widgetUrls.giftJarOverlayUrl || '/overlays/gift-jar';
            try {
                const u = new URL(baseUrl, window.location.origin);
                u.searchParams.set('slave', '1');
                return u.toString();
            } catch {
                return baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'slave=1';
            }
        }

        function refreshGiftJarPreview(options = {}) {
            return; // 瓶詰めウィジェット非表示中につき処理停止（PC負荷軽減）
            updatePreviewFrame(giftJarPreviewFrame, buildGiftJarPreviewUrl(), options);
        }
        function refreshCustomJarPreview(options = {}) {
            return; // オリジナル瓶詰めウィジェット非表示中につき処理停止（PC負荷軽減）
            updatePreviewFrame(customJarPreviewFrame, '/overlays/custom-jar?jar=custom&preview=1', options);
        }

        function refreshGoalGiftPreviews(options = {}) {
            goalGiftAllUrlBox.textContent = state.widgetUrls.goalGiftsLoaderUrl || state.widgetUrls.goalGiftsOverlayUrl || '未取得';
            const slot1 = Array.isArray(state.goalGiftItems) ? state.goalGiftItems[0] : null;
            const baseUrl = buildGoalGiftOverlayUrl(1, { preview: true });
            let url = baseUrl;
            if (slot1?.giftImage) {
                url += '&previewGiftImage=' + encodeURIComponent(slot1.giftImage);
            }
            if (slot1?.giftName || slot1?.displayName) {
                url += '&previewGiftName=' + encodeURIComponent(slot1.displayName || slot1.giftName);
            }
            updatePreviewFrame(goalGiftPreviewFrame, url, options);
        }

        function refreshContributorsOverlayControls() {
            if (normalizeContributorsDisplayRangeMode(state.contributorsDisplayRangeMode) === 'session') {
                if (state.liveSession.startedAt) {
                    const startedAtLabel = formatSessionLabel(state.liveSession.startedAt);
                    const endedAtLabel = state.liveSession.isActive
                        ? '配信中'
                        : formatSessionLabel(state.liveSession.endedAt);
                    contributorsDayLabel.textContent = `現在表示: 配信ごとにリセット (${startedAtLabel} - ${endedAtLabel})`;
                } else {
                    contributorsDayLabel.textContent = '現在表示: 配信ごとにリセット (配信待機中)';
                }
            } else {
                contributorsDayLabel.textContent = `現在表示: 0時～24時 (${formatDisplayDayLabel(state.displayDayKey || state.todayDayKey)})`;
            }

            contributorsUrl.textContent = state.widgetUrls.contributorsLoaderUrl || getContributorsOverlayUrl() || '未取得';
            refreshContributorsPreview();
        }

        async function setContributorsDisplayDay(dayKey) {
            const response = await fetch('/api/display/day', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dayKey })
            });
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload.error || '表示日の変更に失敗しました。');
            }

            state.displayDayKey = payload.displayDayKey || dayKey;
            refreshContributorsOverlayControls();
            setStatus(saveStatus, `設定状態: 貢献リストの表示日を ${state.displayDayKey} に変更しました。`, 'ok');
        }

        async function setContributorsDisplayRangeMode(displayRangeMode) {
            const response = await fetch('/api/widgets/contributors-range', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayRangeMode })
            });
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload.error || '集計範囲の変更に失敗しました。');
            }

            state.contributorsDisplayRangeMode = normalizeContributorsDisplayRangeMode(payload.displayRangeMode || displayRangeMode);
            state.liveSession = normalizeLiveSession(payload.liveSession);
            syncContributorsRangeControl();
            refreshContributorsOverlayControls();
            setStatus(
                saveStatus,
                `設定状態: 貢献リストの集計範囲を${state.contributorsDisplayRangeMode === 'session' ? '配信ごとにリセット' : '0時～24時'}に変更しました。`,
                'ok'
            );
        }

        function applyTopGiftSettingsToForm(settings) {
            if (!settings) {
                return;
            }

            if (titleInput === document.activeElement || senderDisplayModeInput === document.activeElement) {
                pendingTopGiftSettings = settings;
                return;
            }

            titleInput.value = settings.title || '';
            senderDisplayModeInput.value = settings.senderDisplayMode === 'all' ? 'all' : 'latest';
            metalEffectEnabledInput.checked = settings.metalEffectKey === 'glow';
            pendingTopGiftSettings = null;
            refreshTopGiftPreview();
        }

        function normalizeLikeContributionInterval(value) {
            const parsed = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                return 50;
            }

            return Math.min(parsed, 100000);
        }

        // バルーンデザインキーは select#like-contribution-balloon-design の option から動的に取得。
        // 追加時は <select> に option を足すだけでよい。
        // backend/index.js の ALLOWED_BALLOON_DESIGN_KEYS と
        // widgets/like-contribution.html の BALLOON_DESIGN_KEYS も同時に更新すること。
        function normalizeLikeContributionBalloonDesignKey(value) {
            const key = String(value || '').trim().toLowerCase();
            const validKeys = Array.from(likeContributionBalloonDesignSelect.options).map((o) => o.value);
            return validKeys.includes(key) ? key : 'dark-glass';
        }

        function normalizeLikeContributionSoundVolume(value) {
            const parsed = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(parsed)) {
                return 100;
            }

            return Math.max(0, Math.min(100, parsed));
        }

        function normalizeLikeContributionCountFontSize(value) {
            const parsed = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(parsed) || parsed < 10) return 42;
            return Math.min(parsed, 200);
        }

        function normalizeLikeContributionNameFontSize(value) {
            const parsed = Number.parseInt(String(value ?? ''), 10);
            if (!Number.isInteger(parsed) || parsed < 8) return 34;
            return Math.min(parsed, 120);
        }

        function syncLikeContributionVolumeControl(value) {
            const normalizedValue = normalizeLikeContributionSoundVolume(value);
            likeContributionVolumeInput.value = String(normalizedValue);
            likeContributionVolumeValue.textContent = `${normalizedValue}%`;
        }

        function applyLikeContributionSettingsToForm(settings) {
            if (!settings) {
                return;
            }

            likeContributionTitleInput.value = settings.title || '';
            likeContributionIntervalInput.value = String(normalizeLikeContributionInterval(settings.interval));
            syncLikeContributionVolumeControl(settings.soundVolume);
            likeContributionBalloonDesignSelect.value = normalizeLikeContributionBalloonDesignKey(settings.balloonDesignKey);
            likeContributionCountFontSizeInput.value = String(normalizeLikeContributionCountFontSize(settings.countFontSize ?? 42));
            likeContributionNameFontSizeInput.value = String(normalizeLikeContributionNameFontSize(settings.nameFontSize ?? 34));
            refreshLikeContributionPreview();
        }

        function applyTapListSettingsToForm(settings) {
            if (!settings) return;
            tapListBgStyleSelect.value = settings.bgStyle === 'semi' ? 'semi' : 'transparent';
            tapListMaxEntriesInput.value = String(Number.parseInt(String(settings.maxEntries ?? 20), 10) || 20);
            tapListRowGapInput.value = String(Number.parseInt(String(settings.rowGap ?? 8), 10));
            refreshTapListPreview();
        }

        function buildTapListPreviewUrl() {
            const baseUrl = state.widgetUrls.tapListOverlayUrl || '/overlays/tap-list';
            const bgStyle = tapListBgStyleSelect ? tapListBgStyleSelect.value : 'semi';
            try {
                const u = new URL(baseUrl, window.location.origin);
                u.searchParams.set('bg', bgStyle);
                u.searchParams.set('preview', '1');
                return u.pathname + u.search;
            } catch {
                return `${baseUrl}?bg=${bgStyle}&preview=1`;
            }
        }

        function refreshTapListPreview(options = {}) {
            updatePreviewFrame(tapListPreviewFrame, buildTapListPreviewUrl(), options);
        }

        function getDraftTapListSettings() {
            return {
                bgStyle: tapListBgStyleSelect ? tapListBgStyleSelect.value : 'transparent',
                maxEntries: Number.parseInt(tapListMaxEntriesInput ? tapListMaxEntriesInput.value : '20', 10) || 20,
                rowGap: Number.parseInt(tapListRowGapInput ? tapListRowGapInput.value : '8', 10),
                appearance: {
                    fontKey: normalizeDisplayFontKey(tapListFontSelect.value),
                    textStyleKey: normalizeDisplayTextStyleKey(tapListTextStyleSelect.value),
                    strokeWidth: normalizeDisplayStrokeWidth(tapListStrokeWidthInput.value)
                }
            };
        }

        async function saveTapListSettings() {
            setStatus(saveStatus, '設定状態: タップ一覧を保存中...', 'warn');
            try {
                const response = await fetch('/api/widgets/tap-list', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(getDraftTapListSettings())
                });
                const payload = await response.json();
                if (!payload.ok) throw new Error(payload.error || 'タップ一覧の保存に失敗しました。');
                state.tapListSettings = payload.settings || state.tapListSettings;
                state.tapListAppearance = payload.appearance || state.tapListAppearance;
                applyTapListSettingsToForm(state.tapListSettings);
                syncTapListAppearanceControls();
                refreshTapListPreview({ forceReload: true });
                setStatus(saveStatus, '設定状態: タップ一覧を保存しました。', 'ok');
            } catch (err) {
                setStatus(saveStatus, `設定状態: ${err.message}`, 'error');
            }
        }

        function saveTapListSettingsImmediately() {
            if (tapListAutosaveTimer) {
                window.clearTimeout(tapListAutosaveTimer);
                tapListAutosaveTimer = null;
            }
            tapListAutosavePromise = saveTapListSettings();
            return tapListAutosavePromise;
        }

        function applyTapGoalSettingsToForm(settings) {
            if (!settings) return;
            tapGoalOrientationSelect.value = settings.orientation === 'vertical' ? 'vertical' : 'horizontal';
            tapGoalHeadingTextInput.value = settings.headingText || '';
            tapGoalTargetCountInput.value = String(Number.parseInt(String(settings.targetCount ?? 100), 10) || 100);
            tapGoalSoundNameEl.textContent = settings.sound?.name || '未設定';
            const volume = Number.isInteger(settings.soundVolume) ? settings.soundVolume : 100;
            tapGoalSoundVolumeInput.value = String(volume);
            tapGoalSoundVolumeValueEl.textContent = `${volume}%`;
            refreshTapGoalPreview();
        }

        function buildTapGoalPreviewUrl() {
            const baseUrl = state.widgetUrls.tapGoalOverlayUrl || '/overlays/tap-goal';
            try {
                const u = new URL(baseUrl, window.location.origin);
                u.searchParams.set('preview', '1');
                return u.pathname + u.search;
            } catch {
                return `${baseUrl}?preview=1`;
            }
        }

        function refreshTapGoalPreview(options = {}) {
            updatePreviewFrame(tapGoalPreviewFrame, buildTapGoalPreviewUrl(), options);
        }

        function updateTapGoalProgressLabel() {
            const count = Number(state.tapGoalProgress?.count) || 0;
            const target = Number(state.tapGoalProgress?.target) || 0;
            tapGoalProgressLabel.textContent = `進捗: ${count.toLocaleString()} / ${target.toLocaleString()}`;
        }

        function getDraftTapGoalSettings() {
            return {
                orientation: tapGoalOrientationSelect.value === 'vertical' ? 'vertical' : 'horizontal',
                headingText: tapGoalHeadingTextInput.value,
                targetCount: Number.parseInt(tapGoalTargetCountInput.value, 10) || 100,
                sound: state.tapGoalSettings?.sound || { name: '', url: '' },
                soundVolume: Number.parseInt(tapGoalSoundVolumeInput.value, 10) || 100,
                appearance: {
                    fontKey: normalizeDisplayFontKey(tapGoalFontSelect.value),
                    textStyleKey: normalizeDisplayTextStyleKey(tapGoalTextStyleSelect.value),
                    strokeWidth: normalizeDisplayStrokeWidth(tapGoalStrokeWidthInput.value)
                }
            };
        }

        async function saveTapGoalSettings() {
            setStatus(saveStatus, '設定状態: タップ目標を保存中...', 'warn');
            try {
                const response = await fetch('/api/widgets/tap-goal', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(getDraftTapGoalSettings())
                });
                const payload = await response.json();
                if (!payload.ok) throw new Error(payload.error || 'タップ目標の保存に失敗しました。');
                state.tapGoalSettings = payload.settings || state.tapGoalSettings;
                state.tapGoalAppearance = payload.appearance || state.tapGoalAppearance;
                state.tapGoalProgress = payload.progress || state.tapGoalProgress;
                applyTapGoalSettingsToForm(state.tapGoalSettings);
                syncTapGoalAppearanceControls();
                updateTapGoalProgressLabel();
                refreshTapGoalPreview({ forceReload: true });
                setStatus(saveStatus, '設定状態: タップ目標を保存しました。', 'ok');
            } catch (err) {
                setStatus(saveStatus, `設定状態: ${err.message}`, 'error');
            }
        }

        function saveTapGoalSettingsImmediately() {
            if (tapGoalAutosaveTimer) {
                window.clearTimeout(tapGoalAutosaveTimer);
                tapGoalAutosaveTimer = null;
            }
            tapGoalAutosavePromise = saveTapGoalSettings();
            return tapGoalAutosavePromise;
        }

        const MAX_TIMER_GIFT_SLOTS = 3;
        let timerGiftSlots = [null, null, null];
        let timerActivePicker = null; // {index, anchorEl}
        let timerActiveSuggestionIndex = -1;
        let visibleTimerSuggestions = [];

        function renderTimerGiftRows() {
            timerGiftRowsEl.innerHTML = '';

            for (let i = 0; i < MAX_TIMER_GIFT_SLOTS; i++) {
                const gift = timerGiftSlots[i] || null;
                const row = document.createElement('div');
                row.className = 'push-pull-gift-row';
                row.dataset.index = String(i);

                const imgEl = document.createElement('div');
                imgEl.className = 'push-pull-gift-img' + (gift ? '' : ' empty');
                imgEl.title = 'ギフトを選ぶ';
                imgEl.tabIndex = 0;
                imgEl.setAttribute('role', 'button');
                if (gift && gift.giftImage) {
                    const img = document.createElement('img');
                    img.src = gift.giftImage;
                    img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:5px;';
                    imgEl.appendChild(img);
                } else {
                    imgEl.textContent = '+';
                }
                imgEl.addEventListener('click', () => nameEl.focus());
                imgEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nameEl.focus(); } });

                const nameEl = document.createElement('input');
                nameEl.type = 'text';
                nameEl.className = 'push-pull-gift-name' + (gift ? '' : ' empty');
                nameEl.value = gift ? gift.giftName : '';
                nameEl.placeholder = 'ギフトを選ぶ';
                nameEl.autocomplete = 'off';
                nameEl.maxLength = 80;
                nameEl.addEventListener('focus', () => {
                    if (!state.giftCatalog.length) return;
                    timerActivePicker = { index: i, anchorEl: nameEl };
                    renderTimerSuggestItems(nameEl.value);
                });
                nameEl.addEventListener('input', () => {
                    if (!timerActivePicker) timerActivePicker = { index: i, anchorEl: nameEl };
                    renderTimerSuggestItems(nameEl.value);
                });
                nameEl.addEventListener('keydown', (e) => {
                    if (timerSuggestPanel.hidden) {
                        if (e.key === 'ArrowDown' && state.giftCatalog.length) { e.preventDefault(); timerActivePicker = { index: i, anchorEl: nameEl }; renderTimerSuggestItems(nameEl.value); }
                        return;
                    }
                    if (e.key === 'ArrowDown') { e.preventDefault(); updateTimerActiveSuggestion(timerActiveSuggestionIndex + 1); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); updateTimerActiveSuggestion(timerActiveSuggestionIndex - 1); }
                    else if (e.key === 'Enter') { e.preventDefault(); if (timerActiveSuggestionIndex >= 0 && visibleTimerSuggestions[timerActiveSuggestionIndex]) selectTimerGift(visibleTimerSuggestions[timerActiveSuggestionIndex]); }
                    else if (e.key === 'Escape') { closeTimerSuggestPanel(); }
                });
                nameEl.addEventListener('blur', () => {
                    window.setTimeout(() => {
                        if (!timerSuggestPanel.contains(document.activeElement)) closeTimerSuggestPanel();
                    }, 100);
                });

                const minutesEl = document.createElement('input');
                minutesEl.type = 'number';
                minutesEl.className = 'push-pull-points-input';
                minutesEl.min = '-180';
                minutesEl.max = '180';
                minutesEl.placeholder = '分';
                minutesEl.value = gift ? String(gift.minutesDelta) : '';
                minutesEl.addEventListener('change', () => {
                    if (!timerGiftSlots[i]) return;
                    timerGiftSlots[i].minutesDelta = Math.max(-180, Math.min(180, parseInt(minutesEl.value, 10) || 0));
                    scheduleTimerSave();
                });

                row.appendChild(imgEl);
                row.appendChild(nameEl);
                row.appendChild(minutesEl);
                timerGiftRowsEl.appendChild(row);
            }
        }

        function renderTimerSuggestItems(query) {
            if (!timerActivePicker) return;
            const { index, anchorEl } = timerActivePicker;
            const current = timerGiftSlots[index];
            visibleTimerSuggestions = getFilteredPushPullSuggestions(query).slice(0, 80);
            if (!visibleTimerSuggestions.length) { closeTimerSuggestPanel(); return; }
            timerActiveSuggestionIndex = 0;
            timerSuggestPanel.innerHTML = '';
            for (const [idx, gift] of visibleTimerSuggestions.entries()) {
                const btn = document.createElement('button');
                btn.type = 'button';
                const isCurrentGift = current && current.giftId === String(gift.id || '');
                btn.className = 'push-pull-suggest-item' + (isCurrentGift || idx === 0 ? ' is-active' : '');
                const img = document.createElement('img');
                img.src = gift.imageUrl;
                img.className = 'push-pull-suggest-img';
                img.alt = '';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'push-pull-suggest-name';
                nameSpan.textContent = gift.name || '(名前なし)';
                const costSpan = document.createElement('span');
                costSpan.className = 'push-pull-suggest-cost';
                costSpan.textContent = gift.diamondCount != null ? `${gift.diamondCount}コイン` : '';
                btn.appendChild(img);
                btn.appendChild(nameSpan);
                btn.appendChild(costSpan);
                btn.addEventListener('mousedown', (e) => e.preventDefault());
                btn.addEventListener('click', () => selectTimerGift(gift));
                timerSuggestPanel.appendChild(btn);
            }
            if (current) {
                const activeIdx = visibleTimerSuggestions.findIndex((g) => String(g.id || '') === current.giftId);
                if (activeIdx >= 0) {
                    timerActiveSuggestionIndex = activeIdx;
                    const items = timerSuggestPanel.querySelectorAll('.push-pull-suggest-item');
                    items.forEach((btn, i) => btn.classList.toggle('is-active', i === activeIdx));
                }
            }
            timerSuggestPanel.hidden = false;
            positionTimerSuggestPanel(anchorEl);
        }

        function updateTimerActiveSuggestion(nextIndex) {
            const items = [...timerSuggestPanel.querySelectorAll('.push-pull-suggest-item')];
            if (!items.length) return;
            const clampedIndex = Math.max(0, Math.min(nextIndex, items.length - 1));
            items.forEach((btn, i) => btn.classList.toggle('is-active', i === clampedIndex));
            timerActiveSuggestionIndex = clampedIndex;
            items[clampedIndex]?.scrollIntoView({ block: 'nearest' });
        }

        function positionTimerSuggestPanel(anchorEl) {
            const rect = anchorEl.getBoundingClientRect();
            const panelH = Math.min(240, timerSuggestPanel.scrollHeight);
            const spaceBelow = window.innerHeight - rect.bottom - 8;
            const top = spaceBelow >= panelH ? rect.bottom + 4 : rect.top - panelH - 4;
            timerSuggestPanel.style.left = rect.left + 'px';
            timerSuggestPanel.style.top = Math.max(4, top) + 'px';
            timerSuggestPanel.style.width = Math.max(260, rect.width + 100) + 'px';
        }

        function selectTimerGift(catalogGift) {
            if (!timerActivePicker) return;
            const { index } = timerActivePicker;
            const existing = timerGiftSlots[index];
            timerGiftSlots[index] = {
                giftId: String(catalogGift.id || ''),
                giftName: String(catalogGift.name || ''),
                giftImage: String(catalogGift.imageUrl || ''),
                minutesDelta: existing ? existing.minutesDelta : 1,
            };
            closeTimerSuggestPanel();
            renderTimerGiftRows();
            scheduleTimerSave();
        }

        function closeTimerSuggestPanel() {
            timerSuggestPanel.hidden = true;
            timerActivePicker = null;
            timerActiveSuggestionIndex = -1;
            visibleTimerSuggestions = [];
        }

        document.addEventListener('click', (e) => {
            if (!timerSuggestPanel.hidden &&
                !timerSuggestPanel.contains(e.target) &&
                !e.target.closest('.push-pull-gift-name') &&
                !e.target.closest('.push-pull-gift-img')) {
                closeTimerSuggestPanel();
            }
        });

        function applyTimerSettingsToForm(settings) {
            if (!settings) return;
            timerHeadingTextInput.value = settings.headingText || '';
            timerDurationMinutesInput.value = String(Number.parseInt(String(settings.durationMinutes ?? 10), 10) || 0);
            timerDurationSecondsInput.value = String(Number.parseInt(String(settings.durationSeconds ?? 0), 10) || 0);
            timerEndSoundNameEl.textContent = settings.endSound?.name || '未設定';
            const volume = Number.isFinite(Number(settings.endSoundVolume)) ? Math.max(0, Math.min(100, Number(settings.endSoundVolume))) : 100;
            timerEndSoundVolumeInput.value = String(volume);
            timerEndSoundVolumeValueEl.textContent = `${volume}%`;
            timerGiftSlots = Array.from({ length: MAX_TIMER_GIFT_SLOTS }, (_, i) => {
                const slot = settings.slots?.[i];
                return slot && slot.giftId ? { giftId: slot.giftId, giftName: slot.giftName, giftImage: slot.giftImage, minutesDelta: slot.minutesDelta } : null;
            });
            renderTimerGiftRows();
            refreshTimerPreview();
        }

        function buildTimerPreviewUrl() {
            const baseUrl = state.widgetUrls.timerOverlayUrl || '/overlays/timer';
            try {
                const u = new URL(baseUrl, window.location.origin);
                u.searchParams.set('preview', '1');
                return u.pathname + u.search;
            } catch {
                return `${baseUrl}?preview=1`;
            }
        }

        function refreshTimerPreview(options = {}) {
            updatePreviewFrame(timerPreviewFrame, buildTimerPreviewUrl(), options);
        }

        function getTimerCurrentRemainingMs() {
            const runtime = state.timerRuntime || {};
            if (!runtime.running || runtime.endsAt == null) return Math.max(0, Number(runtime.remainingMs) || 0);
            return Math.max(0, runtime.endsAt - Date.now());
        }

        function formatTimerRemaining(ms) {
            const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            const pad = (n) => String(n).padStart(2, '0');
            return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
        }

        function updateTimerStatusLabel() {
            const running = Boolean(state.timerRuntime?.running);
            timerStatusLabel.textContent = `残り時間: ${formatTimerRemaining(getTimerCurrentRemainingMs())}（${running ? '稼働中' : '停止中'}）`;
        }

        if (!timerStatusInterval) {
            timerStatusInterval = window.setInterval(updateTimerStatusLabel, 1000);
        }

        function getDraftTimerSettings() {
            return {
                headingText: timerHeadingTextInput.value,
                durationMinutes: Number.parseInt(timerDurationMinutesInput.value, 10) || 0,
                durationSeconds: Number.parseInt(timerDurationSecondsInput.value, 10) || 0,
                slots: timerGiftSlots.filter(Boolean).map((g) => ({ ...g })),
                endSound: state.timerSettings.endSound || { name: '', url: '' },
                endSoundVolume: Number.parseInt(timerEndSoundVolumeInput.value, 10),
                appearance: {
                    fontKey: normalizeDisplayFontKey(timerFontSelect.value),
                    textStyleKey: normalizeDisplayTextStyleKey(timerTextStyleSelect.value),
                    strokeWidth: normalizeDisplayStrokeWidth(timerStrokeWidthInput.value)
                }
            };
        }

        async function saveTimerSettings() {
            setStatus(saveStatus, '設定状態: タイマーを保存中...', 'warn');
            try {
                const response = await fetch('/api/widgets/timer', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(getDraftTimerSettings())
                });
                const payload = await response.json();
                if (!payload.ok) throw new Error(payload.error || 'タイマーの保存に失敗しました。');
                state.timerSettings = payload.settings || state.timerSettings;
                state.timerAppearance = payload.appearance || state.timerAppearance;
                state.timerRuntime = payload.runtime || state.timerRuntime;
                applyTimerSettingsToForm(state.timerSettings);
                syncTimerAppearanceControls();
                updateTimerStatusLabel();
                refreshTimerPreview({ forceReload: true });
                setStatus(saveStatus, '設定状態: タイマーを保存しました。', 'ok');
            } catch (err) {
                setStatus(saveStatus, `設定状態: ${err.message}`, 'error');
            }
        }

        function scheduleTimerSave() {
            if (timerAutosaveTimer) clearTimeout(timerAutosaveTimer);
            timerAutosaveTimer = window.setTimeout(() => { timerAutosavePromise = saveTimerSettings(); }, 600);
        }

        function saveTimerSettingsImmediately() {
            if (timerAutosaveTimer) {
                window.clearTimeout(timerAutosaveTimer);
                timerAutosaveTimer = null;
            }
            timerAutosavePromise = saveTimerSettings();
            return timerAutosavePromise;
        }

        async function callTimerAction(path, body) {
            const response = await fetch(`/api/widgets/timer/${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {})
            });
            const payload = await response.json();
            if (payload.ok) {
                state.timerRuntime = payload.runtime || state.timerRuntime;
                updateTimerStatusLabel();
            }
            return payload;
        }

        document.getElementById('start-timer-button').addEventListener('click', () => { callTimerAction('start').catch(() => {}); });
        document.getElementById('pause-timer-button').addEventListener('click', () => { callTimerAction('pause').catch(() => {}); });
        document.getElementById('reset-timer-button').addEventListener('click', () => { callTimerAction('reset').catch(() => {}); });
        document.getElementById('test-timer-plus-button').addEventListener('click', () => { callTimerAction('test', { minutes: 1 }).catch(() => {}); });
        document.getElementById('test-timer-minus-button').addEventListener('click', () => { callTimerAction('test', { minutes: -1 }).catch(() => {}); });
        document.getElementById('test-timer-end-sound-button').addEventListener('click', () => { callTimerAction('test-end-sound').catch(() => {}); });

        document.getElementById('open-timer-overlay-button').addEventListener('click', () => {
            const url = state.widgetUrls.timerOverlayUrl || '/overlays/timer';
            openWindow(url, 'timer-overlay-window', { width: 480, height: 320 });
        });
        document.getElementById('copy-timer-url-button').addEventListener('click', async () => {
            await copyText(state.widgetUrls.timerLoaderUrl || state.widgetUrls.timerOverlayUrl || '');
        });

        timerHeadingTextInput.addEventListener('change', () => { saveTimerSettingsImmediately().catch(() => {}); });
        timerDurationMinutesInput.addEventListener('change', () => { saveTimerSettingsImmediately().catch(() => {}); });
        timerDurationSecondsInput.addEventListener('change', () => { saveTimerSettingsImmediately().catch(() => {}); });
        timerFontSelect.addEventListener('input', () => { timerFontSelect.style.fontFamily = getWidgetFontFamily(timerFontSelect.value); });
        timerFontSelect.addEventListener('change', () => { timerFontSelect.style.fontFamily = getWidgetFontFamily(timerFontSelect.value); saveTimerSettingsImmediately().catch(() => {}); });
        timerTextStyleSelect.addEventListener('change', () => { saveTimerSettingsImmediately().catch(() => {}); });
        timerStrokeWidthInput.addEventListener('input', () => { saveTimerSettingsImmediately().catch(() => {}); });
        timerStrokeWidthInput.addEventListener('change', () => { saveTimerSettingsImmediately().catch(() => {}); });

        // --- myinstants.com 音声ピッカー（複数機能で共有） ---
        // 使い方: openMyinstantsPicker({ eventIdHint, onImported: (asset) => { ... } })
        // asset は { name, url } (取り込み後にサーバー側で保存されたローカルアセット)
        let myinstantsPickerContext = null;

        function openMyinstantsPicker({ eventIdHint = 'sound', onImported }) {
            myinstantsPickerContext = { eventIdHint, onImported };
            myinstantsSearchInput.value = '';
            myinstantsStatus.textContent = '';
            myinstantsResults.innerHTML = '';
            myinstantsModal.classList.add('is-open');
            myinstantsModal.setAttribute('aria-hidden', 'false');
            myinstantsSearchInput.focus();
        }

        function closeMyinstantsPicker() {
            myinstantsModal.classList.remove('is-open');
            myinstantsModal.setAttribute('aria-hidden', 'true');
            myinstantsPickerContext = null;
        }

        function renderMyinstantsResults(results) {
            if (!results.length) {
                myinstantsResults.innerHTML = '';
                myinstantsStatus.textContent = '該当するサウンドが見つかりませんでした。';
                return;
            }
            myinstantsStatus.textContent = `${results.length}件見つかりました。`;
            myinstantsResults.innerHTML = results.map((result, index) => `
                <div class="myinstants-result-item">
                    <span class="myinstants-result-name">${escapeHtml(result.name)}</span>
                    <div class="myinstants-result-actions">
                        <button type="button" class="ghost-button icon-button" data-preview-index="${index}" title="試聴" aria-label="試聴">▶</button>
                        <button type="button" class="ghost-button" data-import-index="${index}">これを使う</button>
                    </div>
                </div>
            `).join('');

            myinstantsResults.querySelectorAll('[data-preview-index]').forEach((button) => {
                button.addEventListener('click', () => {
                    const result = results[Number(button.dataset.previewIndex)];
                    if (!result) return;
                    new Audio(result.mp3Url).play().catch(() => {});
                });
            });

            myinstantsResults.querySelectorAll('[data-import-index]').forEach((button) => {
                button.addEventListener('click', async () => {
                    const result = results[Number(button.dataset.importIndex)];
                    const context = myinstantsPickerContext;
                    if (!result || !context) return;
                    myinstantsStatus.textContent = `${result.name} を取り込み中です。`;
                    try {
                        const params = `?eventId=${encodeURIComponent(context.eventIdHint)}`;
                        const response = await fetch(`/api/effects/myinstants/import${params}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ mp3Url: result.mp3Url, name: result.name })
                        });
                        const payload = await response.json();
                        if (!payload.ok) throw new Error(payload.error || '音声の取り込みに失敗しました。');
                        context.onImported?.(payload.asset);
                        closeMyinstantsPicker();
                    } catch (error) {
                        myinstantsStatus.textContent = error.message || '音声の取り込みに失敗しました。';
                    }
                });
            });
        }

        async function runMyinstantsSearch() {
            const query = myinstantsSearchInput.value.trim();
            if (!query) {
                myinstantsStatus.textContent = 'キーワードを入力してください。';
                return;
            }
            myinstantsStatus.textContent = '検索中です。';
            myinstantsResults.innerHTML = '';
            try {
                const response = await fetch(`/api/effects/myinstants/search?q=${encodeURIComponent(query)}`);
                const payload = await response.json();
                if (!payload.ok) throw new Error(payload.error || '検索に失敗しました。');
                renderMyinstantsResults(payload.results || []);
            } catch (error) {
                myinstantsStatus.textContent = error.message || '検索に失敗しました。';
            }
        }

        myinstantsSearchButton.addEventListener('click', runMyinstantsSearch);
        myinstantsSearchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); runMyinstantsSearch(); }
        });
        document.querySelectorAll('[data-action="close-myinstants-modal"]').forEach((button) => {
            button.addEventListener('click', closeMyinstantsPicker);
        });

        timerEndSoundPickerButton.addEventListener('click', () => {
            closeTimerSuggestPanel();
            openMyinstantsPicker({
                eventIdHint: 'timer-end-sound',
                onImported: (asset) => {
                    state.timerSettings = { ...state.timerSettings, endSound: { name: asset.name, url: asset.url } };
                    timerEndSoundNameEl.textContent = asset.name;
                    saveTimerSettingsImmediately().catch(() => {});
                }
            });
        });

        tapGoalSoundPickerButton.addEventListener('click', () => {
            openMyinstantsPicker({
                eventIdHint: 'tap-goal-sound',
                onImported: (asset) => {
                    state.tapGoalSettings = { ...state.tapGoalSettings, sound: { name: asset.name, url: asset.url } };
                    tapGoalSoundNameEl.textContent = asset.name;
                    saveTapGoalSettingsImmediately().catch(() => {});
                }
            });
        });

        tapGoalSoundPreviewButton.addEventListener('click', () => {
            const url = state.tapGoalSettings?.sound?.url;
            if (!url) return;
            const audio = new Audio(url);
            audio.volume = Math.max(0, Math.min(100, Number.parseInt(tapGoalSoundVolumeInput.value, 10) || 0)) / 100;
            audio.play().catch(() => {});
        });

        tapGoalSoundVolumeInput.addEventListener('input', () => {
            tapGoalSoundVolumeValueEl.textContent = `${tapGoalSoundVolumeInput.value}%`;
        });
        tapGoalSoundVolumeInput.addEventListener('change', () => { saveTapGoalSettingsImmediately().catch(() => {}); });

        tapGoalSoundClearButton.addEventListener('click', () => {
            state.tapGoalSettings = { ...state.tapGoalSettings, sound: { name: '', url: '' } };
            tapGoalSoundNameEl.textContent = '未設定';
            saveTapGoalSettingsImmediately().catch(() => {});
        });

        timerEndSoundPreviewButton.addEventListener('click', () => {
            const url = state.timerSettings?.endSound?.url;
            if (!url) return;
            const audio = new Audio(url);
            audio.volume = Math.max(0, Math.min(100, Number.parseInt(timerEndSoundVolumeInput.value, 10) || 0)) / 100;
            audio.play().catch(() => {});
        });

        timerEndSoundVolumeInput.addEventListener('input', () => {
            timerEndSoundVolumeValueEl.textContent = `${timerEndSoundVolumeInput.value}%`;
        });
        timerEndSoundVolumeInput.addEventListener('change', () => { saveTimerSettingsImmediately().catch(() => {}); });

        timerEndSoundClearButton.addEventListener('click', () => {
            state.timerSettings = { ...state.timerSettings, endSound: { name: '', url: '' } };
            timerEndSoundNameEl.textContent = '未設定';
            saveTimerSettingsImmediately().catch(() => {});
        });

        socket.on('widgets:timer:updated', (payload) => {
            if (!payload) return;
            state.timerRuntime = payload.runtime || state.timerRuntime;
            updateTimerStatusLabel();
        });

        function applyCoinListSettingsToForm(settings) {
            if (!settings) return;
            coinListBgStyleSelect.value = settings.bgStyle === 'semi' ? 'semi' : 'transparent';
            coinListSortOrderSelect.value = settings.sortOrder === 'asc' ? 'asc' : 'desc';
            coinListMaxEntriesInput.value = String(Number.parseInt(String(settings.maxEntries ?? 20), 10) || 20);
            coinListRowGapInput.value = String(Number.parseInt(String(settings.rowGap ?? 8), 10));
            refreshCoinListPreview();
        }

        function buildCoinListPreviewUrl() {
            const baseUrl = state.widgetUrls.coinListOverlayUrl || '/overlays/coin-list';
            const bgStyle = coinListBgStyleSelect ? coinListBgStyleSelect.value : 'semi';
            try {
                const u = new URL(baseUrl, window.location.origin);
                u.searchParams.set('bg', bgStyle);
                u.searchParams.set('preview', '1');
                return u.pathname + u.search;
            } catch {
                return `${baseUrl}?bg=${bgStyle}&preview=1`;
            }
        }

        function refreshCoinListPreview(options = {}) {
            updatePreviewFrame(coinListPreviewFrame, buildCoinListPreviewUrl(), options);
        }

        function getDraftCoinListSettings() {
            return {
                bgStyle: coinListBgStyleSelect ? coinListBgStyleSelect.value : 'transparent',
                sortOrder: coinListSortOrderSelect ? coinListSortOrderSelect.value : 'desc',
                maxEntries: Number.parseInt(coinListMaxEntriesInput ? coinListMaxEntriesInput.value : '20', 10) || 20,
                rowGap: Number.parseInt(coinListRowGapInput ? coinListRowGapInput.value : '8', 10),
                appearance: {
                    fontKey: normalizeDisplayFontKey(coinListFontSelect.value),
                    textStyleKey: normalizeDisplayTextStyleKey(coinListTextStyleSelect.value),
                    strokeWidth: normalizeDisplayStrokeWidth(coinListStrokeWidthInput.value)
                }
            };
        }

        async function saveCoinListSettings() {
            setStatus(saveStatus, '設定状態: コイン一覧を保存中...', 'warn');
            try {
                const response = await fetch('/api/widgets/coin-list', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(getDraftCoinListSettings())
                });
                const payload = await response.json();
                if (!payload.ok) throw new Error(payload.error || 'コイン一覧の保存に失敗しました。');
                state.coinListSettings = payload.settings || state.coinListSettings;
                state.coinListAppearance = payload.appearance || state.coinListAppearance;
                applyCoinListSettingsToForm(state.coinListSettings);
                syncCoinListAppearanceControls();
                refreshCoinListPreview({ forceReload: true });
                setStatus(saveStatus, '設定状態: コイン一覧を保存しました。', 'ok');
            } catch (err) {
                setStatus(saveStatus, `設定状態: ${err.message}`, 'error');
            }
        }

        function saveCoinListSettingsImmediately() {
            if (coinListAutosaveTimer) {
                window.clearTimeout(coinListAutosaveTimer);
                coinListAutosaveTimer = null;
            }
            coinListAutosavePromise = saveCoinListSettings();
            return coinListAutosavePromise;
        }

        function getDraftTopGiftSettings() {
            return {
                title: titleInput.value,
                senderDisplayMode: senderDisplayModeInput.value === 'all' ? 'all' : 'latest',
                metalEffectKey: metalEffectEnabledInput.checked ? 'glow' : 'none',
                appearance: {
                    fontKey: normalizeDisplayFontKey(topGiftFontSelect.value),
                    textStyleKey: normalizeDisplayTextStyleKey(topGiftTextStyleSelect.value),
                    strokeWidth: normalizeDisplayStrokeWidth(topGiftStrokeWidthInput.value)
                }
            };
        }

        function getDraftLikeContributionSettings() {
            return {
                title: likeContributionTitleInput.value,
                interval: normalizeLikeContributionInterval(likeContributionIntervalInput.value),
                soundVolume: normalizeLikeContributionSoundVolume(likeContributionVolumeInput.value),
                balloonDesignKey: normalizeLikeContributionBalloonDesignKey(likeContributionBalloonDesignSelect.value),
                countFontSize: normalizeLikeContributionCountFontSize(likeContributionCountFontSizeInput.value),
                nameFontSize: normalizeLikeContributionNameFontSize(likeContributionNameFontSizeInput.value),
                appearance: {
                    fontKey: normalizeDisplayFontKey(likeContributionFontSelect.value),
                    textStyleKey: normalizeDisplayTextStyleKey(likeContributionTextStyleSelect.value),
                    strokeWidth: normalizeDisplayStrokeWidth(likeContributionStrokeWidthInput.value)
                }
            };
        }

        function resolveGiftFromCatalog(giftName) {
            const normalizedName = String(giftName || '').trim();
            return state.giftCatalogByName.get(normalizedName)
                || goalGiftSystemSuggestions.find((gift) => gift.name === normalizedName)
                || null;
        }

        function parseCoinFilter(query) {
            let match = query.match(/^>=\s*(\d+)$/);
            if (match) return (coins) => coins >= Number(match[1]);
            match = query.match(/^<=\s*(\d+)$/);
            if (match) return (coins) => coins <= Number(match[1]);
            match = query.match(/^>\s*(\d+)$/);
            if (match) return (coins) => coins > Number(match[1]);
            match = query.match(/^<\s*(\d+)$/);
            if (match) return (coins) => coins < Number(match[1]);
            match = query.match(/^(\d+)\s*[-~]\s*(\d+)$/);
            if (match) {
                const minimum = Number(match[1]);
                const maximum = Number(match[2]);
                return (coins) => coins >= minimum && coins <= maximum;
            }
            match = query.match(/^\d+$/);
            if (match) {
                const exact = Number(match[0]);
                return (coins) => coins === exact;
            }
            return null;
        }

        function getFilteredGoalGiftSuggestions(query) {
            const normalizedQuery = String(query || '').trim().toLowerCase();
            const catalog = [...goalGiftSystemSuggestions, ...state.giftCatalog];

            if (!normalizedQuery) {
                return catalog;
            }

            const coinFilter = parseCoinFilter(normalizedQuery);
            if (coinFilter) {
                return state.giftCatalog.filter((gift) => Number.isFinite(gift.diamondCount) && coinFilter(gift.diamondCount));
            }

            return catalog.filter((gift) => {
                const name = String(gift.name || '').toLowerCase();
                const description = String(gift.describe || '').toLowerCase();
                return name.includes(normalizedQuery) || description.includes(normalizedQuery);
            });
        }

        function positionGoalGiftSuggestionPanel() {
            if (!activeGoalGiftInput) {
                return;
            }

            const rect = activeGoalGiftInput.getBoundingClientRect();
            const panelHeight = 260;
            const spaceBelow = window.innerHeight - rect.bottom - 8;
            if (spaceBelow >= 80 || spaceBelow >= panelHeight) {
                goalGiftSuggestionPanel.style.top = `${rect.bottom + 6}px`;
                goalGiftSuggestionPanel.style.bottom = '';
            } else {
                goalGiftSuggestionPanel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
                goalGiftSuggestionPanel.style.top = '';
            }

            goalGiftSuggestionPanel.style.left = `${rect.left}px`;
            goalGiftSuggestionPanel.style.width = `${rect.width}px`;
        }

        function hideGoalGiftSuggestionPanel() {
            goalGiftSuggestionPanel.hidden = true;
            goalGiftSuggestionPanel.innerHTML = '';
            visibleGoalGiftSuggestions = [];
            activeGoalGiftSuggestionIndex = -1;
            activeGoalGiftInput = null;
        }

        function applyGoalGiftSuggestion(gift) {
            if (!gift || !activeGoalGiftInput) {
                return;
            }

            activeGoalGiftInput.value = gift.name || '';
            syncGoalRowCatalogMatch(activeGoalGiftInput.closest('[data-goal-row]'));
            activeGoalGiftInput.focus();
            hideGoalGiftSuggestionPanel();
            scheduleGoalGiftAutosave();
        }

        function updateActiveGoalGiftSuggestion(nextIndex) {
            if (!visibleGoalGiftSuggestions.length) {
                return;
            }

            activeGoalGiftSuggestionIndex = Math.max(0, Math.min(nextIndex, visibleGoalGiftSuggestions.length - 1));
            goalGiftSuggestionPanel.querySelectorAll('[data-goal-gift-index]').forEach((button, index) => {
                button.classList.toggle('is-active', index === activeGoalGiftSuggestionIndex);
                if (index === activeGoalGiftSuggestionIndex) {
                    button.scrollIntoView({ block: 'nearest' });
                }
            });
        }

        function renderGoalGiftSuggestions(input, query = input?.value || '') {
            if (!input) {
                hideGoalGiftSuggestionPanel();
                return;
            }

            activeGoalGiftInput = input;
            visibleGoalGiftSuggestions = getFilteredGoalGiftSuggestions(query);

            if (!visibleGoalGiftSuggestions.length) {
                hideGoalGiftSuggestionPanel();
                return;
            }

            activeGoalGiftSuggestionIndex = 0;
            goalGiftSuggestionPanel.innerHTML = visibleGoalGiftSuggestions.map((gift, index) => {
                const imageMarkup = gift.imageUrl
                    ? `<img class="gift-suggestion-image" src="${escapeHtml(gift.imageUrl)}" alt="${escapeHtml(gift.name)}">`
                    : '<div class="gift-suggestion-image is-empty">NO IMG</div>';
                const idPart = gift.id ? `ID: ${escapeHtml(String(gift.id))}` : '';
                const descPart = gift.describe ? escapeHtml(gift.describe) : '';
                const description = [idPart, descPart].filter(Boolean).join('  ·  ') || '&nbsp;';
                const costText = Number.isFinite(gift.diamondCount) ? `${gift.diamondCount} coins` : '-';

                return `
                    <button type="button" class="gift-suggestion-item${index === activeGoalGiftSuggestionIndex ? ' is-active' : ''}" data-goal-gift-index="${index}">
                        ${imageMarkup}
                        <div class="gift-suggestion-meta">
                            <div class="gift-suggestion-name">${escapeHtml(gift.name)}</div>
                            <div class="gift-suggestion-desc">${description}</div>
                        </div>
                        <div class="gift-suggestion-cost">${escapeHtml(costText)}</div>
                    </button>
                `;
            }).join('');

            goalGiftSuggestionPanel.hidden = false;
            positionGoalGiftSuggestionPanel();

            goalGiftSuggestionPanel.querySelectorAll('[data-goal-gift-index]').forEach((button) => {
                button.addEventListener('mousedown', (event) => {
                    event.preventDefault();
                    const selectedGift = visibleGoalGiftSuggestions[Number(button.dataset.goalGiftIndex)];
                    applyGoalGiftSuggestion(selectedGift);
                });
            });
        }

        function captureGoalGiftFocusState() {
            const activeElement = document.activeElement;
            if (!activeElement || !goalGiftList.contains(activeElement)) {
                return null;
            }

            const row = activeElement.closest('[data-goal-row]');
            if (!row) {
                return null;
            }

            const field = activeElement.matches('[data-goal-name]')
                ? 'name'
                : activeElement.matches('[data-goal-display-name]')
                    ? 'display-name'
                    : activeElement.matches('[data-goal-note]')
                        ? 'note'
                        : activeElement.matches('[data-goal-current]')
                            ? 'current'
                            : activeElement.matches('[data-goal-count-unique-users]')
                                ? 'count-unique-users'
                            : activeElement.matches('[data-goal-reset-at-midnight]')
                                ? 'reset-at-midnight'
                            : activeElement.matches('[data-goal-target]')
                                ? 'target'
                                    : '';

            if (!field) {
                return null;
            }

            return {
                rowIndex: row.dataset.goalRow,
                field,
                selectionStart: typeof activeElement.selectionStart === 'number' ? activeElement.selectionStart : null,
                selectionEnd: typeof activeElement.selectionEnd === 'number' ? activeElement.selectionEnd : null
            };
        }

        function restoreGoalGiftFocusState(focusState) {
            if (!focusState) {
                return;
            }

            const row = goalGiftList.querySelector(`[data-goal-row="${focusState.rowIndex}"]`);
            if (!row) {
                return;
            }

            const fieldSelector = focusState.field === 'name'
                ? '[data-goal-name]'
                : focusState.field === 'display-name'
                    ? '[data-goal-display-name]'
                    : focusState.field === 'note'
                        ? '[data-goal-note]'
                        : focusState.field === 'current'
                            ? '[data-goal-current]'
                            : focusState.field === 'count-unique-users'
                                ? '[data-goal-count-unique-users]'
                            : focusState.field === 'reset-at-midnight'
                                ? '[data-goal-reset-at-midnight]'
                            : focusState.field === 'target'
                                    ? '[data-goal-target]'
                                    : '';

            const field = row.querySelector(fieldSelector);
            if (!field) {
                return;
            }

            field.focus({ preventScroll: true });
            if (typeof focusState.selectionStart === 'number' && typeof field.setSelectionRange === 'function') {
                field.setSelectionRange(focusState.selectionStart, focusState.selectionEnd ?? focusState.selectionStart);
            }
        }

        function renderGoalGiftRows() {
            if (goalGiftList.contains(document.activeElement) || (typeof goalRowSettingsModal !== 'undefined' && !goalRowSettingsModal.hidden)) {
                pendingGoalGiftItems = Array.isArray(state.goalGiftItems) ? state.goalGiftItems : [];
                return;
            }

            const focusState = captureGoalGiftFocusState();
            const items = Array.from({ length: 10 }, (_, index) => state.goalGiftItems[index] || {
                slot: index + 1,
                giftId: '',
                giftName: '',
                displayName: '',
                note: '',
                giftImage: '',
                targetCount: 1,
                countUniqueUsers: false,
                resetAtMidnight: false,
                missionUnitCount: 0,
                currentCount: 0,
                observedCount: 0,
                completed: false,
                progressRatio: 0
            });

            goalGiftList.innerHTML = `
                <div class="goal-table-head" aria-hidden="true">
                    <div class="goal-table-head-cell">対象ギフト</div>
                    <div class="goal-table-head-cell">ギフト名(任意)</div>
                    <div class="goal-table-head-cell">現在個数</div>
                    <div class="goal-table-head-cell">目標個数</div>
                    <div class="goal-table-head-cell">URL</div>
                    <div class="goal-table-head-cell"></div>
                </div>
            ` + items.map((item, index) => `
                <div class="goal-row ${item.completed ? 'is-complete' : ''}" data-goal-row="${index}" data-goal-gift-id="${escapeHtml(item.giftId || '')}" data-goal-gift-image="${escapeHtml(item.giftImage || '')}">
                    <div class="goal-cell goal-name-cell">
                        <div class="goal-name-main">
                            <img class="goal-gift-image" data-goal-image-preview src="${escapeHtml(item.giftImage || '')}" alt="gift" ${item.giftImage ? '' : 'style="visibility:hidden"'}>
                            <div class="gift-suggest-shell">
                                <input type="text" data-goal-name maxlength="80" autocomplete="off" value="${escapeHtml(item.giftName || '')}" placeholder="例: Rose / 5 / 100-500 / >=100" aria-label="対象ギフト">
                            </div>
                        </div>
                    </div>
                    <div class="goal-cell">
                        <input type="text" data-goal-display-name maxlength="80" value="${escapeHtml(item.displayName || '')}" placeholder="表示名を上書きするときだけ入力" aria-label="ギフト名(任意)">
                    </div>
                    <div class="goal-cell">
                        <input type="number" data-goal-current min="0" step="1" value="${escapeHtml(item.currentCount || 0)}" aria-label="現在個数">
                    </div>
                    <div class="goal-cell">
                        <input type="number" data-goal-target min="1" step="1" value="${escapeHtml(item.targetCount || 1)}" aria-label="目標個数">
                    </div>
                    <div class="goal-cell">
                        <div class="goal-action-row">
                            <button type="button" class="ghost-button icon-button goal-url-button" data-goal-open-overlay aria-label="オーバーレイを開く" title="オーバーレイを開く">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M1.5 12s3.8-6.5 10.5-6.5S22.5 12 22.5 12 18.7 18.5 12 18.5 1.5 12 1.5 12z"></path>
                                    <circle cx="12" cy="12" r="3.2"></circle>
                                </svg>
                            </button>
                            <button type="button" class="ghost-button icon-button goal-url-button" data-goal-copy-url aria-label="URLをコピー" title="URLをコピー">
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <rect x="9" y="9" width="11" height="11" rx="2"></rect>
                                    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="goal-cell">
                        <button type="button" class="ghost-button icon-button goal-url-button" data-goal-row-settings aria-label="詳細設定" title="詳細設定">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                        </button>
                    </div>
                    <div style="display:none">
                        <input type="text" data-goal-note maxlength="120" value="${escapeHtml(item.note || '')}" aria-label="備考">
                        <input type="checkbox" data-goal-count-unique-users ${item.countUniqueUsers ? 'checked' : ''} aria-label="1人1個">
                        <input type="checkbox" data-goal-reset-at-midnight ${item.resetAtMidnight ? 'checked' : ''} aria-label="0時リセット">
                        <input type="text" data-goal-mission-unit-count value="${escapeHtml(item.missionUnitCount || 0)}" aria-label="1ミッションあたりの個数">
                    </div>
                </div>
            `).join('');

            goalGiftList.querySelectorAll('[data-goal-name]').forEach((input) => {
                input.addEventListener('focus', (event) => {
                    if (state.giftCatalog.length) {
                        renderGoalGiftSuggestions(event.target);
                    }
                });
                input.addEventListener('input', (event) => {
                    renderGoalGiftSuggestions(event.target, event.target.value);
                    syncGoalRowCatalogMatch(event.target.closest('[data-goal-row]'));
                });
                input.addEventListener('keydown', (event) => {
                    if (goalGiftSuggestionPanel.hidden || activeGoalGiftInput !== event.target) {
                        if (event.key === 'ArrowDown' && state.giftCatalog.length) {
                            event.preventDefault();
                            renderGoalGiftSuggestions(event.target, event.target.value);
                        }
                        return;
                    }

                    if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        updateActiveGoalGiftSuggestion(activeGoalGiftSuggestionIndex + 1);
                        return;
                    }

                    if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        updateActiveGoalGiftSuggestion(activeGoalGiftSuggestionIndex - 1);
                        return;
                    }

                    if (event.key === 'Enter') {
                        const selectedGift = visibleGoalGiftSuggestions[activeGoalGiftSuggestionIndex];
                        if (selectedGift) {
                            event.preventDefault();
                            applyGoalGiftSuggestion(selectedGift);
                        }
                        return;
                    }

                    if (event.key === 'Escape') {
                        hideGoalGiftSuggestionPanel();
                    }
                });
                input.addEventListener('change', (event) => {
                    syncGoalRowCatalogMatch(event.target.closest('[data-goal-row]'));
                    scheduleGoalGiftAutosave();
                });
                input.addEventListener('blur', (event) => {
                    syncGoalRowCatalogMatch(event.target.closest('[data-goal-row]'));
                    scheduleGoalGiftAutosave();
                });
            });

            goalGiftList.querySelectorAll('[data-goal-target], [data-goal-current], [data-goal-display-name], [data-goal-note], [data-goal-count-unique-users], [data-goal-reset-at-midnight]').forEach((input) => {
                input.addEventListener('input', scheduleGoalGiftAutosave);
                input.addEventListener('change', scheduleGoalGiftAutosave);
            });

            goalGiftList.querySelectorAll('[data-goal-open-overlay]').forEach((button) => {
                button.addEventListener('click', async (event) => {
                    const row = event.target.closest('[data-goal-row]');
                    const slot = Number(row?.dataset.goalRow || '0') + 1;
                    await flushGoalGiftAutosave();
                    const url = buildGoalGiftOverlayUrl(slot, { preview: true });
                    openWindow(url || '/overlays/goal-gifts', `goal-gift-overlay-window-${slot}`, { width: 1080, height: 900 });
                });
            });

            goalGiftList.querySelectorAll('[data-goal-copy-url]').forEach((button) => {
                button.addEventListener('click', async (event) => {
                    const row = event.target.closest('[data-goal-row]');
                    const slot = Number(row?.dataset.goalRow || '0') + 1;
                    await flushGoalGiftAutosave();
                    await copyText(buildGoalGiftOverlayUrl(slot));
                });
            });

            goalGiftList.querySelectorAll('[data-goal-row-settings]').forEach((button) => {
                button.addEventListener('click', (event) => {
                    const row = event.target.closest('[data-goal-row]');
                    openGoalRowSettingsModal(row);
                });
            });

            restoreGoalGiftFocusState(focusState);
            refreshGoalGiftPreviews();
            pendingGoalGiftItems = null;
        }

        function flushDeferredWidgetFormUpdates() {
            if (pendingTopGiftSettings && titleInput !== document.activeElement && senderDisplayModeInput !== document.activeElement) {
                const nextTopGiftSettings = pendingTopGiftSettings;
                pendingTopGiftSettings = null;
                applyTopGiftSettingsToForm(nextTopGiftSettings);
            }

            if (pendingGoalGiftItems && !goalGiftList.contains(document.activeElement)) {
                const nextGoalGiftItems = pendingGoalGiftItems;
                pendingGoalGiftItems = null;
                state.goalGiftItems = Array.isArray(nextGoalGiftItems) ? nextGoalGiftItems : [];
                renderGoalGiftRows();
            }
        }

        function syncGoalRowCatalogMatch(row) {
            if (!row) {
                return;
            }
            const nameInput = row.querySelector('[data-goal-name]');
            const catalogGift = resolveGiftFromCatalog(nameInput.value);
            const imagePreview = row.querySelector('[data-goal-image-preview]');

            if (!catalogGift) {
                row.dataset.goalGiftId = '';
                row.dataset.goalGiftImage = '';
                imagePreview.removeAttribute('src');
                imagePreview.style.visibility = 'hidden';
                if (!imagePreview.getAttribute('src')) {
                    imagePreview.style.visibility = 'hidden';
                }
                return;
            }

            row.dataset.goalGiftId = String(catalogGift.id || '');
            row.dataset.goalGiftImage = catalogGift.imageUrl || '';
            if (catalogGift.imageUrl) {
                imagePreview.src = catalogGift.imageUrl;
                imagePreview.style.visibility = 'visible';
            }
        }

        function getDraftGoalGiftItems() {
            return Array.from(goalGiftList.querySelectorAll('[data-goal-row]')).map((row) => {
                const nameInput = row.querySelector('[data-goal-name]');
                const catalogGift = resolveGiftFromCatalog(nameInput.value);
                const targetValue = Number.parseInt(row.querySelector('[data-goal-target]').value, 10);
                const currentValue = Number.parseInt(row.querySelector('[data-goal-current]').value, 10);
                const giftName = nameInput.value.trim();
                const giftId = row.dataset.goalGiftId || String(catalogGift?.id || '');
                const targetCount = Number.isInteger(targetValue) && targetValue > 0 ? targetValue : 1;
                const missionUnitValue = Number.parseInt(row.querySelector('[data-goal-mission-unit-count]').value, 10);
                const missionUnitCount = Number.isInteger(missionUnitValue) && missionUnitValue > 0
                    && targetCount % missionUnitValue === 0 && missionUnitValue < targetCount
                    ? missionUnitValue
                    : 0;

                return {
                    enabled: Boolean(giftId || giftName),
                    giftId,
                    giftName,
                    displayName: row.querySelector('[data-goal-display-name]').value.trim(),
                    note: row.querySelector('[data-goal-note]').value.trim(),
                    giftImage: row.dataset.goalGiftImage || catalogGift?.imageUrl || '',
                    targetCount,
                    countUniqueUsers: row.querySelector('[data-goal-count-unique-users]').checked,
                    resetAtMidnight: row.querySelector('[data-goal-reset-at-midnight]').checked,
                    missionUnitCount,
                    currentCount: Number.isInteger(currentValue) && currentValue >= 0 ? currentValue : 0
                };
            });
        }

        async function copyText(value) {
            await navigator.clipboard.writeText(value);
            setStatus(saveStatus, '設定状態: URLをコピーしました。', 'ok');
        }

        async function loadGiftCatalog() {
            try {
                const response = await fetch('/api/tiktok/gifts');
                const payload = await response.json();
                state.giftCatalog = Array.isArray(payload.gifts)
                    ? payload.gifts.filter((gift) => typeof gift?.name === 'string' && gift.name.trim())
                    : [];
                state.giftCatalogByName = new Map(state.giftCatalog.map((gift) => [String(gift.name || ''), gift]));
            } catch {
                state.giftCatalog = [];
                state.giftCatalogByName = new Map();
            }
        }

        async function loadConfig() {
            const response = await fetch('/api/widgets/config');
            const payload = await response.json();

            state.broadcasterId = payload.broadcasterId || null;
            state.todayDayKey = payload.todayDayKey || '';
            state.displayDayKey = payload.displayDayKey || '';
            giftJarWallEditorEnabled = payload.giftJarWallEditorEnabled === true;
            state.contributorsDisplayRangeMode = normalizeContributorsDisplayRangeMode(payload.contributorsDisplayRangeMode);
            state.liveSession = normalizeLiveSession(payload.liveSession);
            state.widgetUrls = payload.widgetUrls || state.widgetUrls;
            state.contributorsDisplayThreshold = normalizeContributorsDisplayThreshold(payload.contributorsDisplayThreshold);
            state.contributorsGoalCount = normalizeContributorsGoalCount(payload.contributorsGoalCount);
            state.contributorsAvatarVisibility = normalizeContributorsAvatarVisibility(payload.contributorsAvatarVisibility);
            state.contributorsAppearance = payload.contributorsAppearance || { fontKey: payload.contributorsFontKey || 'default', textStyleKey: payload.contributorsColorTheme || 'gold-night', strokeWidth: payload.contributorsStrokeWidth ?? 4 };
            state.topGiftAppearance = payload.topGiftAppearance || { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 };
            state.likeContributionAppearance = payload.likeContributionAppearance || { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 };
            state.tapListAppearance = payload.tapListAppearance || { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 };
            state.coinListAppearance = payload.coinListAppearance || { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 };
            state.giftJarAppearance = payload.giftJarAppearance || { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 };
            state.pushPullAppearance = payload.pushPullAppearance || { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 };
            state.goalGiftAppearance = payload.goalGiftAppearance || { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 };
            state.tapGoalAppearance = payload.tapGoalAppearance || { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 4 };
            state.timerAppearance = payload.timerAppearance || { fontKey: 'default', textStyleKey: 'gold-night', strokeWidth: 6 };
            state.goalGiftNoteFontSize = normalizeGoalGiftNoteFontSize(payload.goalGiftNoteFontSize);
            state.goalGiftAchievementBadgeSize = normalizeGoalGiftAchievementBadgeSize(payload.goalGiftAchievementBadgeSize);
            state.goalGiftAchievementBadgeStyle = normalizeGoalGiftAchievementBadgeStyle(payload.goalGiftAchievementBadgeStyle);
            state.goalGiftProgressRingColor = normalizeGoalGiftProgressRingColor(payload.goalGiftProgressRingColor);
            state.goalGiftProgressBackgroundOpacity = normalizeGoalGiftProgressBackgroundOpacity(payload.goalGiftProgressBackgroundOpacity);
            state.goalGiftLayout = normalizeGoalGiftLayout(payload.goalGiftLayout);
            state.goalGiftHeadingText = normalizeGoalGiftHeadingText(payload.goalGiftHeadingText);
            state.goalGiftHeadingScroll = Boolean(payload.goalGiftHeadingScroll);
            state.goalGiftHeadingFontSize = normalizeGoalGiftHeadingFontSize(payload.goalGiftHeadingFontSize);
            state.sharedWidgetFeedback = normalizeFeedbackSettings(payload.sharedWidgetFeedback || payload.contributorsFeedback || payload.goalGiftFeedback);
            state.topGiftSettings = payload.topGiftSettings || state.topGiftSettings;
            state.likeContributionSettings = payload.likeContributionSettings || state.likeContributionSettings;
            state.tapListSettings = payload.tapListSettings || state.tapListSettings;
            state.tapGoalSettings = payload.tapGoalSettings || state.tapGoalSettings;
            state.tapGoalProgress = payload.tapGoalPayload?.progress || state.tapGoalProgress;
            state.timerSettings = payload.timerPayload?.settings || state.timerSettings;
            state.timerRuntime = payload.timerPayload?.runtime || state.timerRuntime;
            state.coinListSettings = payload.coinListSettings || state.coinListSettings;
            state.goalGiftItems = Array.isArray(payload.goalGiftItems) ? payload.goalGiftItems : [];

            refreshContributorsOverlayControls();
            syncContributorsRangeControl();
            syncContributorsThresholdControl();
            syncContributorsGoalCountControl();
            syncContributorsAvatarVisibilityControl();
            syncContributorsAppearanceControls();
            syncTopGiftAppearanceControls();
            syncLikeContributionAppearanceControls();
            syncTapListAppearanceControls();
            syncCoinListAppearanceControls();
            syncGiftJarAppearanceControls();
            syncPushPullAppearanceControls();
            syncGoalGiftAppearanceControls();
            syncTapGoalAppearanceControls();
            syncTimerAppearanceControls();
            syncGoalGiftNoteFontSizeControl();
            syncGoalGiftAchievementBadgeControls();
            syncSharedFeedbackControls();
            topGiftUrl.textContent = state.widgetUrls.topGiftLoaderUrl || state.widgetUrls.topGiftOverlayUrl || '未取得';
            likeContributionUrl.textContent = state.widgetUrls.likeContributionLoaderUrl || state.widgetUrls.likeContributionOverlayUrl || '未取得';
            tapListUrl.textContent = state.widgetUrls.tapListLoaderUrl || state.widgetUrls.tapListOverlayUrl || '未取得';
            tapGoalUrl.textContent = state.widgetUrls.tapGoalLoaderUrl || state.widgetUrls.tapGoalOverlayUrl || '未取得';
            timerUrl.textContent = state.widgetUrls.timerLoaderUrl || state.widgetUrls.timerOverlayUrl || '未取得';
            coinListUrl.textContent = state.widgetUrls.coinListLoaderUrl || state.widgetUrls.coinListOverlayUrl || '未取得';
            giftJarUrl.textContent = state.widgetUrls.giftJarLoaderUrl || state.widgetUrls.giftJarOverlayUrl || '未取得';
            if (customJarUrl) customJarUrl.textContent = window.location.origin + '/overlays/custom-jar?jar=custom';
            pushPullUrl.textContent = state.widgetUrls.pushPullLoaderUrl || state.widgetUrls.pushPullOverlayUrl || '未取得';
            broadcasterStatus.textContent = state.broadcasterId ? `配信ユーザーID: @${state.broadcasterId}` : '配信ユーザーID: 未設定';
            todayStatus.textContent = state.todayDayKey ? `本日: ${state.todayDayKey}` : '本日: 未取得';
            setStatus(saveStatus, '設定状態: 準備完了', 'ok');
            applyTopGiftSettingsToForm(state.topGiftSettings);
            applyLikeContributionSettingsToForm(state.likeContributionSettings);
            applyTapListSettingsToForm(state.tapListSettings);
            applyTapGoalSettingsToForm(state.tapGoalSettings);
            updateTapGoalProgressLabel();
            applyTimerSettingsToForm(state.timerSettings);
            updateTimerStatusLabel();
            applyCoinListSettingsToForm(state.coinListSettings);
            renderGoalGiftRows();
            refreshContributorsPreview();
            refreshTopGiftPreview();
            refreshLikeContributionPreview();
            refreshGiftJarPreview();
            refreshCustomJarPreview();
            refreshPushPullPreview();
            refreshCoinListPreview();
            refreshTapGoalPreview();
        }

        async function refreshGoalGiftSnapshot() {
            const response = await fetch('/api/widgets/goal-gifts/snapshot');
            const payload = await response.json();
            const nextItems = Array.isArray(payload.snapshot?.goals) ? payload.snapshot.goals : state.goalGiftItems;

            // 編集中(フォーカス中 or オートセーブ未完了)にここで即描画すると、
            // ユーザーが今クリアした入力がサーバーの古いスナップショットで
            // 上書きされてしまう(未保存の編集が消える)。編集が落ち着くまで保留する。
            if (goalGiftList.contains(document.activeElement) || goalGiftAutosaveTimer || goalGiftAutosavePromise) {
                pendingGoalGiftItems = nextItems;
                return;
            }

            state.goalGiftItems = nextItems;
            renderGoalGiftRows();
        }

        function scheduleGoalGiftAutosave() {
            if (goalGiftAutosaveTimer) {
                clearTimeout(goalGiftAutosaveTimer);
            }

            setStatus(saveStatus, '設定状態: 目標ギフトを自動保存待機中...', 'warn');
            goalGiftAutosaveTimer = setTimeout(() => {
                goalGiftAutosaveTimer = null;
                goalGiftAutosavePromise = saveGoalGiftSettings(true)
                    .catch(() => {})
                    .finally(() => {
                        goalGiftAutosavePromise = null;
                        flushDeferredWidgetFormUpdates();
                    });
            }, 450);
        }

        async function flushGoalGiftAutosave() {
            if (goalGiftAutosaveTimer) {
                clearTimeout(goalGiftAutosaveTimer);
                goalGiftAutosaveTimer = null;
                goalGiftAutosavePromise = saveGoalGiftSettings(true)
                    .catch(() => {})
                    .finally(() => {
                        goalGiftAutosavePromise = null;
                        flushDeferredWidgetFormUpdates();
                    });
            }

            if (goalGiftAutosavePromise) {
                await goalGiftAutosavePromise;
            }
        }

        async function saveGoalGiftSettingsImmediately() {
            if (goalGiftAutosaveTimer) {
                clearTimeout(goalGiftAutosaveTimer);
                goalGiftAutosaveTimer = null;
            }

            if (goalGiftAutosavePromise) {
                await goalGiftAutosavePromise;
            }

            goalGiftAutosavePromise = saveGoalGiftSettings(true)
                .catch(() => {})
                .finally(() => {
                    goalGiftAutosavePromise = null;
                    flushDeferredWidgetFormUpdates();
                });

            await goalGiftAutosavePromise;
        }

        async function saveTopGiftSettings() {
            setStatus(saveStatus, '設定状態: 本日最高ギフトを保存中...', 'warn');
            try {
                const response = await fetch('/api/widgets/top-gift', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(getDraftTopGiftSettings())
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.error || 'ウィジェット設定の保存に失敗しました。');
                }
                state.topGiftSettings = payload.settings;
                state.topGiftAppearance = payload.settings?.appearance || state.topGiftAppearance;
                applyTopGiftSettingsToForm(state.topGiftSettings);
                syncTopGiftAppearanceControls();
                refreshTopGiftPreview({ forceReload: true });
                setStatus(saveStatus, '設定状態: 本日最高ギフトを保存しました。', 'ok');
            } catch (error) {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            }
        }

        function saveTopGiftSettingsImmediately() {
            if (topGiftAutosaveTimer) {
                window.clearTimeout(topGiftAutosaveTimer);
                topGiftAutosaveTimer = null;
            }

            topGiftAutosavePromise = saveTopGiftSettings();
            return topGiftAutosavePromise;
        }

        function scheduleTopGiftSettingsAutosave(delay = 250) {
            if (topGiftAutosaveTimer) {
                window.clearTimeout(topGiftAutosaveTimer);
            }

            topGiftAutosaveTimer = window.setTimeout(() => {
                topGiftAutosaveTimer = null;
                topGiftAutosavePromise = saveTopGiftSettings();
            }, delay);

            return topGiftAutosavePromise;
        }

        async function saveLikeContributionSettings() {
            setStatus(saveStatus, '設定状態: Like貢献通知を保存中...', 'warn');
            try {
                const response = await fetch('/api/widgets/like-contribution', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(getDraftLikeContributionSettings())
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.error || 'Like貢献通知の保存に失敗しました。');
                }
                state.likeContributionSettings = payload.settings || state.likeContributionSettings;
                state.likeContributionAppearance = payload.settings?.appearance || state.likeContributionAppearance;
                applyLikeContributionSettingsToForm(state.likeContributionSettings);
                syncLikeContributionAppearanceControls();
                refreshLikeContributionPreview({ forceReload: true });
                setStatus(saveStatus, '設定状態: Like貢献通知を保存しました。', 'ok');
            } catch (error) {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            }
        }

        function saveLikeContributionSettingsImmediately() {
            if (likeContributionAutosaveTimer) {
                window.clearTimeout(likeContributionAutosaveTimer);
                likeContributionAutosaveTimer = null;
            }

            likeContributionAutosavePromise = saveLikeContributionSettings();
            return likeContributionAutosavePromise;
        }

        function scheduleLikeContributionSettingsAutosave(delay = 250) {
            if (likeContributionAutosaveTimer) {
                window.clearTimeout(likeContributionAutosaveTimer);
            }

            likeContributionAutosaveTimer = window.setTimeout(() => {
                likeContributionAutosaveTimer = null;
                likeContributionAutosavePromise = saveLikeContributionSettings();
            }, delay);

            return likeContributionAutosavePromise;
        }

        async function testLikeContributionNotification() {
            setStatus(saveStatus, '設定状態: Like貢献通知デモを送信中...', 'warn');

            try {
                await saveLikeContributionSettingsImmediately();

                const response = await fetch('/api/widgets/like-contribution/test-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const payload = await response.json();

                if (!response.ok) {
                    throw new Error(payload.error || 'Like貢献通知デモの送信に失敗しました。');
                }

                setStatus(saveStatus, '設定状態: Like貢献通知デモを表示しました。', 'ok');
            } catch (error) {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            }
        }

        async function saveContributorsStyleSettingsImmediately() {
            setStatus(saveStatus, '設定状態: ウィジェット共通設定を保存中...', 'warn');
            try {
                const soundSelection = getSharedSoundSelectionState();
                const effectSelection = getSharedEffectSelectionState();
                const response = await fetch('/api/widgets/contributors-style', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        displayThreshold: normalizeContributorsDisplayThreshold(contributorsThresholdInput.value),
                        goalCount: normalizeContributorsGoalCount(contributorsGoalCountInput.value),
                        avatarVisibility: normalizeContributorsAvatarVisibility(contributorsAvatarVisibilitySelect.value),
                        appearance: {
                            fontKey: normalizeContributorsFontKey(contributorsFontSelect.value),
                            textStyleKey: normalizeContributorsTextStyleKey(contributorsTextStyleSelect.value),
                            strokeWidth: normalizeContributorsStrokeWidth(contributorsStrokeWidthInput.value)
                        },
                        feedback: {
                            soundEnabled: soundSelection.soundEnabled,
                            effectEnabled: effectSelection.effectEnabled,
                            soundKey: soundSelection.soundKey,
                            effectKey: effectSelection.effectKey
                        }
                    })
                });
                const payload = await response.json();

                if (!response.ok) {
                    throw new Error(payload.error || '貢献リスト設定の保存に失敗しました。');
                }

                state.contributorsDisplayThreshold = normalizeContributorsDisplayThreshold(payload.displayThreshold ?? contributorsThresholdInput.value);
                state.contributorsGoalCount = normalizeContributorsGoalCount(payload.goalCount ?? contributorsGoalCountInput.value);
                state.contributorsAvatarVisibility = normalizeContributorsAvatarVisibility(payload.avatarVisibility ?? contributorsAvatarVisibilitySelect.value);
                state.contributorsAppearance = payload.appearance || state.contributorsAppearance;
                state.sharedWidgetFeedback = normalizeFeedbackSettings(payload.feedback);
                syncContributorsThresholdControl();
                syncContributorsGoalCountControl();
                syncContributorsAvatarVisibilityControl();
                syncContributorsAppearanceControls();
                syncSharedFeedbackControls();
                refreshContributorsPreview({ forceReload: true });
                setStatus(saveStatus, '設定状態: ウィジェット共通設定を保存しました。', 'ok');
            } catch (error) {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            }
        }

        async function testSharedFeedbackSound() {
            const soundSelection = getSharedSoundSelectionState();

            if (!soundSelection.soundEnabled) {
                setStatus(saveStatus, '設定状態: 共通通知音がオフなのでテスト再生できません。', 'warn');
                return;
            }

            setStatus(saveStatus, '設定状態: 目標ギフト1オーバーレイを更新してからテスト再生を送信中...', 'warn');

            try {
                const previewUrl = buildGoalGiftOverlayUrl(1, { preview: true, forceReload: true });
                openWindow(previewUrl || '/overlays/goal-gifts?slot=1&preview=1', 'goal-gift-overlay-window-1', { width: 1080, height: 900 });
                await new Promise((resolve) => {
                    window.setTimeout(resolve, 400);
                });

                const response = await fetch('/api/widgets/goal-gifts/test-feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        slot: 1,
                        feedback: {
                            soundEnabled: soundSelection.soundEnabled,
                            effectEnabled: false,
                            soundKey: soundSelection.soundKey,
                            effectKey: getSharedEffectSelectionState().effectKey
                        }
                    })
                });
                const payload = await response.json();

                if (!response.ok) {
                    throw new Error(payload.error || '通知音テストの送信に失敗しました。');
                }

                setStatus(saveStatus, '設定状態: 目標ギフト1オーバーレイを更新し、テスト再生を送信しました。', 'ok');
            } catch (error) {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            }
        }

        async function saveGoalGiftSettings(isAutosave = false) {
            setStatus(saveStatus, `設定状態: 目標ギフトを${isAutosave ? '自動' : ''}保存中...`, 'warn');
            try {
                const response = await fetch('/api/widgets/goal-gifts', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        noteFontSize: normalizeGoalGiftNoteFontSize(goalGiftNoteFontSizeInput.value),
                        achievementBadgeSize: normalizeGoalGiftAchievementBadgeSize(goalGiftAchievementBadgeSizeInput.value),
                        achievementBadgeStyle: normalizeGoalGiftAchievementBadgeStyle(goalGiftAchievementBadgeStyleSelect.value),
                        progressRingColor: normalizeGoalGiftProgressRingColor(goalGiftProgressRingColorInput.value),
                        progressBackgroundOpacity: normalizeGoalGiftProgressBackgroundOpacity(goalGiftProgressBgOpacityInput.value),
                        layout: normalizeGoalGiftLayout(goalGiftLayoutSelect.value),
                        headingText: normalizeGoalGiftHeadingText(goalGiftHeadingTextInput.value),
                        headingScroll: goalGiftHeadingScrollInput.checked,
                        headingFontSize: normalizeGoalGiftHeadingFontSize(goalGiftHeadingFontSizeInput.value),
                        appearance: {
                            fontKey: normalizeGoalGiftFontKey(goalGiftFontSelect.value),
                            textStyleKey: normalizeGoalGiftTextStyleKey(goalGiftTextStyleSelect.value),
                            strokeWidth: normalizeGoalGiftStrokeWidth(goalGiftStrokeWidthInput.value)
                        },
                        items: getDraftGoalGiftItems()
                    })
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload.error || '目標ギフト設定の保存に失敗しました。');
                }
                state.goalGiftNoteFontSize = normalizeGoalGiftNoteFontSize(payload.snapshot?.noteFontSize ?? goalGiftNoteFontSizeInput.value);
                state.goalGiftAchievementBadgeSize = normalizeGoalGiftAchievementBadgeSize(payload.snapshot?.achievementBadgeSize ?? goalGiftAchievementBadgeSizeInput.value);
                state.goalGiftAchievementBadgeStyle = normalizeGoalGiftAchievementBadgeStyle(payload.snapshot?.achievementBadgeStyle ?? goalGiftAchievementBadgeStyleSelect.value);
                state.goalGiftProgressRingColor = normalizeGoalGiftProgressRingColor(payload.snapshot?.progressRingColor ?? goalGiftProgressRingColorInput.value);
                state.goalGiftProgressBackgroundOpacity = normalizeGoalGiftProgressBackgroundOpacity(payload.snapshot?.progressBackgroundOpacity ?? goalGiftProgressBgOpacityInput.value);
                state.goalGiftLayout = normalizeGoalGiftLayout(payload.snapshot?.layout ?? goalGiftLayoutSelect.value);
                state.goalGiftHeadingText = normalizeGoalGiftHeadingText(payload.snapshot?.headingText ?? goalGiftHeadingTextInput.value);
                state.goalGiftHeadingScroll = Boolean(payload.snapshot?.headingScroll ?? goalGiftHeadingScrollInput.checked);
                state.goalGiftHeadingFontSize = normalizeGoalGiftHeadingFontSize(payload.snapshot?.headingFontSize ?? goalGiftHeadingFontSizeInput.value);
                state.goalGiftAppearance = payload.appearance || state.goalGiftAppearance;
                state.goalGiftItems = Array.isArray(payload.items) ? payload.items : [];
                syncGoalGiftNoteFontSizeControl();
                syncGoalGiftAchievementBadgeControls();
                syncGoalGiftAppearanceControls();
                renderGoalGiftRows();
                refreshGoalGiftPreviews({ forceReload: true });
                setStatus(saveStatus, `設定状態: 目標ギフトを${isAutosave ? '自動' : ''}保存しました。`, 'ok');
            } catch (error) {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            }
        }

        document.getElementById('open-goal-gift-all-overlay-button').addEventListener('click', () => {
            const url = state.widgetUrls.goalGiftsLoaderUrl || state.widgetUrls.goalGiftsOverlayUrl || '/overlays/goal-gifts';
            openWindow(url, 'goal-gift-all-overlay-window', { width: 1680, height: 700 });
        });
        document.getElementById('copy-goal-gift-all-url-button').addEventListener('click', async () => {
            await copyText(state.widgetUrls.goalGiftsLoaderUrl || state.widgetUrls.goalGiftsOverlayUrl || '/overlays/goal-gifts');
        });

        document.getElementById('open-contributors-overlay-button').addEventListener('click', () => {
            openWindow('/overlays/contributors', 'contributors-overlay-window', { width: 1180, height: 880 });
        });
        document.getElementById('copy-contributors-url-button').addEventListener('click', async () => {
            await copyText(state.widgetUrls.contributorsLoaderUrl || getContributorsOverlayUrl() || '');
        });
        contributorsThresholdInput.addEventListener('input', () => {
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        contributorsThresholdInput.addEventListener('change', () => {
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        contributorsGoalCountInput.addEventListener('input', () => {
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        contributorsGoalCountInput.addEventListener('change', () => {
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        contributorsAvatarVisibilitySelect.addEventListener('change', () => {
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        sharedSoundKeySelect.addEventListener('change', () => {
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        sharedEffectKeySelect.addEventListener('change', () => {
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        testSharedSoundButton.addEventListener('click', () => {
            testSharedFeedbackSound().catch(() => {});
        });
        contributorsFontSelect.addEventListener('input', () => {
            contributorsFontSelect.style.fontFamily = getContributorsFontFamily(contributorsFontSelect.value);
        });
        contributorsFontSelect.addEventListener('change', () => {
            contributorsFontSelect.style.fontFamily = getContributorsFontFamily(contributorsFontSelect.value);
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        contributorsTextStyleSelect.addEventListener('change', () => {
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        contributorsStrokeWidthInput.addEventListener('input', () => {
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        contributorsStrokeWidthInput.addEventListener('change', () => {
            saveContributorsStyleSettingsImmediately().catch(() => {});
        });
        goalGiftNoteFontSizeInput.addEventListener('input', scheduleGoalGiftAutosave);
        goalGiftNoteFontSizeInput.addEventListener('change', scheduleGoalGiftAutosave);
        goalGiftAchievementBadgeSizeInput.addEventListener('blur', () => { saveGoalGiftSettingsImmediately().catch(() => {}); });
        goalGiftAchievementBadgeSizeInput.addEventListener('change', () => { saveGoalGiftSettingsImmediately().catch(() => {}); });
        goalGiftAchievementBadgeStyleSelect.addEventListener('change', () => { saveGoalGiftSettingsImmediately().catch(() => {}); });
        goalGiftProgressRingColorInput.addEventListener('input', scheduleGoalGiftAutosave);
        goalGiftProgressRingColorInput.addEventListener('change', () => { saveGoalGiftSettingsImmediately().catch(() => {}); });
        goalGiftProgressBgOpacityInput.addEventListener('input', () => {
            goalGiftProgressBgOpacityValue.textContent = `${goalGiftProgressBgOpacityInput.value}%`;
            scheduleGoalGiftAutosave();
        });
        goalGiftProgressBgOpacityInput.addEventListener('change', () => { saveGoalGiftSettingsImmediately().catch(() => {}); });
        goalGiftLayoutSelect.addEventListener('change', () => { saveGoalGiftSettingsImmediately().catch(() => {}); });
        goalGiftHeadingTextInput.addEventListener('input', scheduleGoalGiftAutosave);
        goalGiftHeadingTextInput.addEventListener('change', () => { saveGoalGiftSettingsImmediately().catch(() => {}); });
        goalGiftHeadingScrollInput.addEventListener('change', () => { saveGoalGiftSettingsImmediately().catch(() => {}); });
        goalGiftHeadingFontSizeInput.addEventListener('input', scheduleGoalGiftAutosave);
        goalGiftHeadingFontSizeInput.addEventListener('change', scheduleGoalGiftAutosave);
        goalGiftFontSelect.addEventListener('input', () => { goalGiftFontSelect.style.fontFamily = getGoalGiftFontFamily(goalGiftFontSelect.value); });
        goalGiftFontSelect.addEventListener('change', () => { goalGiftFontSelect.style.fontFamily = getGoalGiftFontFamily(goalGiftFontSelect.value); saveGoalGiftSettingsImmediately().catch(() => {}); });
        goalGiftTextStyleSelect.addEventListener('change', () => { saveGoalGiftSettingsImmediately().catch(() => {}); });
        goalGiftStrokeWidthInput.addEventListener('input', scheduleGoalGiftAutosave);
        goalGiftStrokeWidthInput.addEventListener('change', () => { saveGoalGiftSettingsImmediately().catch(() => {}); });
        topGiftFontSelect.addEventListener('input', () => { topGiftFontSelect.style.fontFamily = getWidgetFontFamily(topGiftFontSelect.value); });
        topGiftFontSelect.addEventListener('change', () => { topGiftFontSelect.style.fontFamily = getWidgetFontFamily(topGiftFontSelect.value); saveTopGiftSettingsImmediately().catch(() => {}); });
        topGiftTextStyleSelect.addEventListener('change', () => { saveTopGiftSettingsImmediately().catch(() => {}); });
        topGiftStrokeWidthInput.addEventListener('input', () => { scheduleTopGiftSettingsAutosave(); });
        topGiftStrokeWidthInput.addEventListener('change', () => { saveTopGiftSettingsImmediately().catch(() => {}); });
        likeContributionFontSelect.addEventListener('input', () => { likeContributionFontSelect.style.fontFamily = getWidgetFontFamily(likeContributionFontSelect.value); });
        likeContributionFontSelect.addEventListener('change', () => { likeContributionFontSelect.style.fontFamily = getWidgetFontFamily(likeContributionFontSelect.value); saveLikeContributionSettingsImmediately().catch(() => {}); });
        likeContributionTextStyleSelect.addEventListener('change', () => { saveLikeContributionSettingsImmediately().catch(() => {}); });
        likeContributionStrokeWidthInput.addEventListener('input', () => { scheduleLikeContributionSettingsAutosave(); });
        likeContributionStrokeWidthInput.addEventListener('change', () => { saveLikeContributionSettingsImmediately().catch(() => {}); });
        tapListFontSelect.addEventListener('input', () => { tapListFontSelect.style.fontFamily = getWidgetFontFamily(tapListFontSelect.value); });
        tapListFontSelect.addEventListener('change', () => { tapListFontSelect.style.fontFamily = getWidgetFontFamily(tapListFontSelect.value); saveTapListSettingsImmediately().catch(() => {}); });
        tapListTextStyleSelect.addEventListener('change', () => { saveTapListSettingsImmediately().catch(() => {}); });
        tapListStrokeWidthInput.addEventListener('input', () => { saveTapListSettingsImmediately().catch(() => {}); });
        tapListStrokeWidthInput.addEventListener('change', () => { saveTapListSettingsImmediately().catch(() => {}); });
        coinListFontSelect.addEventListener('input', () => { coinListFontSelect.style.fontFamily = getWidgetFontFamily(coinListFontSelect.value); });
        coinListFontSelect.addEventListener('change', () => { coinListFontSelect.style.fontFamily = getWidgetFontFamily(coinListFontSelect.value); saveCoinListSettingsImmediately().catch(() => {}); });
        coinListTextStyleSelect.addEventListener('change', () => { saveCoinListSettingsImmediately().catch(() => {}); });
        coinListStrokeWidthInput.addEventListener('input', () => { saveCoinListSettingsImmediately().catch(() => {}); });
        coinListStrokeWidthInput.addEventListener('change', () => { saveCoinListSettingsImmediately().catch(() => {}); });
        giftJarFontSelect.addEventListener('input', () => { giftJarFontSelect.style.fontFamily = getWidgetFontFamily(giftJarFontSelect.value); });
        giftJarFontSelect.addEventListener('change', () => {
            giftJarFontSelect.style.fontFamily = getWidgetFontFamily(giftJarFontSelect.value);
            fetch('/api/widgets/gift-jar/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: { fontKey: normalizeDisplayFontKey(giftJarFontSelect.value), textStyleKey: normalizeDisplayTextStyleKey(giftJarTextStyleSelect.value), strokeWidth: normalizeDisplayStrokeWidth(giftJarStrokeWidthInput.value) } }) }).catch(() => {});
        });
        giftJarTextStyleSelect.addEventListener('change', () => {
            fetch('/api/widgets/gift-jar/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: { fontKey: normalizeDisplayFontKey(giftJarFontSelect.value), textStyleKey: normalizeDisplayTextStyleKey(giftJarTextStyleSelect.value), strokeWidth: normalizeDisplayStrokeWidth(giftJarStrokeWidthInput.value) } }) }).catch(() => {});
        });
        giftJarStrokeWidthInput.addEventListener('change', () => {
            fetch('/api/widgets/gift-jar/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appearance: { fontKey: normalizeDisplayFontKey(giftJarFontSelect.value), textStyleKey: normalizeDisplayTextStyleKey(giftJarTextStyleSelect.value), strokeWidth: normalizeDisplayStrokeWidth(giftJarStrokeWidthInput.value) } }) }).catch(() => {});
        });
        pushPullFontSelect.addEventListener('input', () => { pushPullFontSelect.style.fontFamily = getWidgetFontFamily(pushPullFontSelect.value); });
        pushPullFontSelect.addEventListener('change', () => { pushPullFontSelect.style.fontFamily = getWidgetFontFamily(pushPullFontSelect.value); schedulePushPullSave(); });
        pushPullTextStyleSelect.addEventListener('change', schedulePushPullSave);
        pushPullStrokeWidthInput.addEventListener('input', schedulePushPullSave);
        pushPullStrokeWidthInput.addEventListener('change', schedulePushPullSave);
        pushPullGiftSizeInput.addEventListener('input', schedulePushPullSave);
        pushPullGiftSizeInput.addEventListener('change', schedulePushPullSave);
        pushPullGiftPtsSizeInput.addEventListener('input', schedulePushPullSave);
        pushPullGiftPtsSizeInput.addEventListener('change', schedulePushPullSave);
        pushPullScoreModeSelect.addEventListener('change', schedulePushPullSave);
        contributorsRangeModeSelect.addEventListener('change', () => {
            setContributorsDisplayRangeMode(contributorsRangeModeSelect.value).catch((error) => {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            });
        });
        contributorsPrevDayButton.addEventListener('click', () => {
            const nextDayKey = shiftDayKey(state.displayDayKey || state.todayDayKey, -1);
            setContributorsDisplayDay(nextDayKey).catch((error) => {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            });
        });
        contributorsNextDayButton.addEventListener('click', () => {
            const nextDayKey = shiftDayKey(state.displayDayKey || state.todayDayKey, 1);
            setContributorsDisplayDay(nextDayKey).catch((error) => {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            });
        });
        document.getElementById('open-admin-button').addEventListener('click', () => {
            openWindow('/admin', 'user-coins-window', { width: 1320, height: 920 });
        });
        document.getElementById('open-top-gift-overlay-button').addEventListener('click', () => {
            openWindow('/overlays/top-gift', 'top-gift-overlay-window', { width: 980, height: 660 });
        });
        document.getElementById('copy-top-gift-url-button').addEventListener('click', async () => {
            await copyText(state.widgetUrls.topGiftLoaderUrl || state.widgetUrls.topGiftOverlayUrl || '');
        });
        document.getElementById('open-like-contribution-overlay-button').addEventListener('click', () => {
            openWindow('/overlays/like-contribution', 'like-contribution-overlay-window', { width: 900, height: 520 });
        });
        document.getElementById('copy-like-contribution-url-button').addEventListener('click', async () => {
            await copyText(state.widgetUrls.likeContributionLoaderUrl || state.widgetUrls.likeContributionOverlayUrl || '');
        });
        testLikeContributionButton.addEventListener('click', () => {
            testLikeContributionNotification().catch(() => {});
        });
        document.getElementById('open-tap-list-overlay-button').addEventListener('click', () => {
            const url = state.widgetUrls.tapListOverlayUrl || '/overlays/tap-list';
            openWindow(url, 'tap-list-overlay-window', { width: 420, height: 560 });
        });
        document.getElementById('copy-tap-list-url-button').addEventListener('click', async () => {
            await copyText(state.widgetUrls.tapListLoaderUrl || state.widgetUrls.tapListOverlayUrl || '');
        });
        tapListBgStyleSelect.addEventListener('change', () => {
            saveTapListSettingsImmediately().catch(() => {});
        });
        tapListMaxEntriesInput.addEventListener('change', () => {
            saveTapListSettingsImmediately().catch(() => {});
        });
        tapListRowGapInput.addEventListener('change', () => {
            saveTapListSettingsImmediately().catch(() => {});
        });
        document.getElementById('reset-tap-list-button').addEventListener('click', () => {
            if (!confirm('本日のタップ数をリセットしますか？')) return;
            fetch('/api/widgets/tap-list/reset', { method: 'POST' }).catch(() => {});
        });
        document.getElementById('open-tap-goal-overlay-button').addEventListener('click', () => {
            const url = state.widgetUrls.tapGoalOverlayUrl || '/overlays/tap-goal';
            openWindow(url, 'tap-goal-overlay-window', { width: 480, height: 320 });
        });
        document.getElementById('copy-tap-goal-url-button').addEventListener('click', async () => {
            await copyText(state.widgetUrls.tapGoalLoaderUrl || state.widgetUrls.tapGoalOverlayUrl || '');
        });
        tapGoalOrientationSelect.addEventListener('change', () => {
            saveTapGoalSettingsImmediately().catch(() => {});
            refreshTapGoalPreview({ forceReload: true });
        });
        tapGoalHeadingTextInput.addEventListener('change', () => { saveTapGoalSettingsImmediately().catch(() => {}); });
        tapGoalTargetCountInput.addEventListener('change', () => { saveTapGoalSettingsImmediately().catch(() => {}); });
        tapGoalFontSelect.addEventListener('input', () => { tapGoalFontSelect.style.fontFamily = getWidgetFontFamily(tapGoalFontSelect.value); });
        tapGoalFontSelect.addEventListener('change', () => { tapGoalFontSelect.style.fontFamily = getWidgetFontFamily(tapGoalFontSelect.value); saveTapGoalSettingsImmediately().catch(() => {}); });
        tapGoalTextStyleSelect.addEventListener('change', () => { saveTapGoalSettingsImmediately().catch(() => {}); });
        tapGoalStrokeWidthInput.addEventListener('input', () => { saveTapGoalSettingsImmediately().catch(() => {}); });
        tapGoalStrokeWidthInput.addEventListener('change', () => { saveTapGoalSettingsImmediately().catch(() => {}); });
        document.getElementById('reset-tap-goal-button').addEventListener('click', () => {
            if (!confirm('タップ目標の進捗をリセットしますか？')) return;
            fetch('/api/widgets/tap-goal/reset', { method: 'POST' })
                .then((r) => r.json())
                .then((payload) => {
                    if (payload?.progress) {
                        state.tapGoalProgress = payload.progress;
                        updateTapGoalProgressLabel();
                    }
                })
                .catch(() => {});
        });
        document.getElementById('test-tap-goal-button').addEventListener('click', () => {
            fetch('/api/widgets/tap-goal/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: 10 })
            })
                .then((r) => r.json())
                .then((payload) => {
                    if (payload?.progress) {
                        state.tapGoalProgress = payload.progress;
                        updateTapGoalProgressLabel();
                    }
                })
                .catch(() => {});
        });
        document.getElementById('open-coin-list-overlay-button').addEventListener('click', () => {
            const url = state.widgetUrls.coinListOverlayUrl || '/overlays/coin-list';
            openWindow(url, 'coin-list-overlay-window', { width: 420, height: 560 });
        });
        document.getElementById('copy-coin-list-url-button').addEventListener('click', async () => {
            await copyText(state.widgetUrls.coinListLoaderUrl || state.widgetUrls.coinListOverlayUrl || '');
        });
        coinListBgStyleSelect.addEventListener('change', () => { saveCoinListSettingsImmediately().catch(() => {}); });
        coinListSortOrderSelect.addEventListener('change', () => { saveCoinListSettingsImmediately().catch(() => {}); });
        coinListMaxEntriesInput.addEventListener('change', () => { saveCoinListSettingsImmediately().catch(() => {}); });
        coinListRowGapInput.addEventListener('change', () => { saveCoinListSettingsImmediately().catch(() => {}); });
        document.getElementById('open-gift-jar-overlay-button').addEventListener('click', () => {
            const url = state.widgetUrls.giftJarOverlayUrl || '/overlays/gift-jar';
            openWindow(url, 'gift-jar-overlay-window', { width: 700, height: 560 });
        });
        document.getElementById('copy-gift-jar-url-button').addEventListener('click', async () => {
            const url = state.widgetUrls.giftJarLoaderUrl || state.widgetUrls.giftJarOverlayUrl || '/overlays/gift-jar';
            await copyText(url);
        });
        document.getElementById('open-custom-jar-overlay-button').addEventListener('click', () => {
            openWindow('/overlays/custom-jar?jar=custom', 'custom-jar-overlay-window', { width: 700, height: 560 });
        });
        document.getElementById('copy-custom-jar-url-button').addEventListener('click', async () => {
            await copyText(window.location.origin + '/overlays/custom-jar?jar=custom');
        });
        document.getElementById('test-custom-jar-single-button').addEventListener('click', () => {
            fetch('/api/widgets/custom-jar/test-single', { method: 'POST' }).catch(() => {});
        });
        document.getElementById('reset-custom-jar-button').addEventListener('click', () => {
            fetch('/api/widgets/custom-jar/reset', { method: 'POST' }).catch(() => {});
        });
        document.getElementById('shake-custom-jar-button').addEventListener('click', () => {
            fetch('/api/widgets/custom-jar/shake', { method: 'POST' }).catch(() => {});
        });

        const customJarDropHeightInput = document.getElementById('custom-jar-drop-height');
        const customJarDropHeightValue = document.getElementById('custom-jar-drop-height-value');
        const customJarSizeMultiplierInput = document.getElementById('custom-jar-size-multiplier');

        customJarDropHeightInput.addEventListener('input', () => {
            customJarDropHeightValue.textContent = `${customJarDropHeightInput.value} px`;
        });
        customJarDropHeightInput.addEventListener('change', () => {
            fetch('/api/widgets/custom-jar/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dropAboveJar: Number(customJarDropHeightInput.value) })
            }).catch(() => {});
        });
        customJarSizeMultiplierInput.addEventListener('change', () => {
            fetch('/api/widgets/custom-jar/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sizeMultiplier: Number(customJarSizeMultiplierInput.value) })
            }).catch(() => {});
        });

        const customJarSizeRatioCoeffInput = document.getElementById('custom-jar-size-ratio-coeff');
        const customJarSizeRatioCoeffValue = document.getElementById('custom-jar-size-ratio-coeff-value');
        customJarSizeRatioCoeffInput.addEventListener('input', () => {
            customJarSizeRatioCoeffValue.textContent = Number(customJarSizeRatioCoeffInput.value).toFixed(1);
        });
        customJarSizeRatioCoeffInput.addEventListener('change', () => {
            fetch('/api/widgets/custom-jar/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sizeRatioCoeff: Number(customJarSizeRatioCoeffInput.value) })
            }).catch(() => {});
        });
        document.getElementById('test-gift-jar-single-button').addEventListener('click', () => {
            fetch('/api/widgets/gift-jar/test-single', { method: 'POST' }).catch(() => {});
        });
        document.getElementById('reset-gift-jar-button').addEventListener('click', () => {
            fetch('/api/widgets/gift-jar/reset', { method: 'POST' }).catch(() => {});
        });
        document.getElementById('shake-gift-jar-button').addEventListener('click', () => {
            fetch('/api/widgets/gift-jar/shake', { method: 'POST' }).catch(() => {});
        });

        giftJarWallBrushSizeInput.addEventListener('input', () => {
            giftJarWallBrushSizeValue.textContent = `${giftJarWallBrushSizeInput.value} px`;
        });
        giftJarWallPaintButton.addEventListener('click', () => {
            setGiftJarWallEditorTool('paint');
        });
        giftJarWallEraseButton.addEventListener('click', () => {
            setGiftJarWallEditorTool('erase');
        });
        giftJarWallClearButton.addEventListener('click', () => {
            clearGiftJarWallEditorCanvas();
        });
        giftJarWallLoadButton.addEventListener('click', () => {
            paintGiftJarWallEditorFromProfile(giftJarWallProfiles[getGiftJarWallTheme()] || null);
        });
        giftJarWallSaveButton.addEventListener('click', () => {
            saveGiftJarWallProfile().catch((error) => {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            });
        });
        giftJarWallDeleteButton.addEventListener('click', () => {
            deleteGiftJarWallProfile().catch((error) => {
                setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
            });
        });
        giftJarWallEditorCanvas.addEventListener('pointerdown', (event) => {
            if (giftJarWallEditor.hidden) return;
            giftJarWallEditorIsDrawing = true;
            giftJarWallEditorLastPoint = getGiftJarWallEditorPoint(event);
            drawGiftJarWallEditorStroke(giftJarWallEditorLastPoint, giftJarWallEditorLastPoint);
            giftJarWallEditorCanvas.setPointerCapture(event.pointerId);
            setGiftJarWallEditorStatus(giftJarWallEditorTool === 'erase' ? '消去中...' : '描画中...');
        });
        giftJarWallEditorCanvas.addEventListener('pointermove', (event) => {
            if (!giftJarWallEditorIsDrawing || !giftJarWallEditorLastPoint) return;
            const nextPoint = getGiftJarWallEditorPoint(event);
            drawGiftJarWallEditorStroke(giftJarWallEditorLastPoint, nextPoint);
            giftJarWallEditorLastPoint = nextPoint;
        });
        const finishGiftJarWallEditorStroke = () => {
            if (!giftJarWallEditorIsDrawing) return;
            giftJarWallEditorIsDrawing = false;
            giftJarWallEditorLastPoint = null;
            setGiftJarWallEditorStatus('未保存の変更があります');
        };
        giftJarWallEditorCanvas.addEventListener('pointerup', finishGiftJarWallEditorStroke);
        giftJarWallEditorCanvas.addEventListener('pointercancel', finishGiftJarWallEditorStroke);
        giftJarWallEditorCanvas.addEventListener('pointerleave', finishGiftJarWallEditorStroke);

        const giftJarDropHeightInput = document.getElementById('gift-jar-drop-height');
        const giftJarDropHeightValue = document.getElementById('gift-jar-drop-height-value');

        giftJarDropHeightInput.addEventListener('input', () => {
            giftJarDropHeightValue.textContent = `${giftJarDropHeightInput.value} px`;
        });
        giftJarDropHeightInput.addEventListener('change', () => {
            fetch('/api/widgets/gift-jar/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dropAboveJar: Number(giftJarDropHeightInput.value) })
            }).catch(() => {});
        });


        const giftJarSizeMultiplierInput = document.getElementById('gift-jar-size-multiplier');
        const DEFAULT_GIFT_JAR_SIZE_MULTIPLIER = 0.4;
        const FLASK_DEFAULT_SIZE_MULTIPLIER = 0.4;

        giftJarSizeMultiplierInput.addEventListener('change', () => {
            fetch('/api/widgets/gift-jar/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sizeMultiplier: Number(giftJarSizeMultiplierInput.value) })
            }).catch(() => {});
        });

        const giftJarSizeRatioCoeffInput = document.getElementById('gift-jar-size-ratio-coeff');
        const giftJarSizeRatioCoeffValue = document.getElementById('gift-jar-size-ratio-coeff-value');
        giftJarSizeRatioCoeffInput.addEventListener('input', () => {
            giftJarSizeRatioCoeffValue.textContent = Number(giftJarSizeRatioCoeffInput.value).toFixed(1);
        });
        giftJarSizeRatioCoeffInput.addEventListener('change', () => {
            fetch('/api/widgets/gift-jar/config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sizeRatioCoeff: Number(giftJarSizeRatioCoeffInput.value) })
            }).catch(() => {});
        });

        const giftJarThemeSelect = document.getElementById('gift-jar-theme');

        giftJarThemeSelect.addEventListener('change', () => {
            const body = { jarTheme: giftJarThemeSelect.value };
            const nextSizeMultiplier = giftJarThemeSelect.value === 'flask'
                ? FLASK_DEFAULT_SIZE_MULTIPLIER
                : giftJarThemeSelect.value === 'bee'
                    ? 0.40
                    : DEFAULT_GIFT_JAR_SIZE_MULTIPLIER;
            giftJarSizeMultiplierInput.value = String(nextSizeMultiplier);
            body.sizeMultiplier = nextSizeMultiplier;
            fetch('/api/widgets/gift-jar/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).catch(() => {});
            refreshGiftJarWallEditorThemeState();
        });

        fetch('/api/widgets/gift-jar/config').then(r => r.json()).then(cfg => {
            if (typeof cfg.dropAboveJar === 'number') {
                giftJarDropHeightInput.value = cfg.dropAboveJar;
                giftJarDropHeightValue.textContent = `${cfg.dropAboveJar} px`;
            }

            if (typeof cfg.sizeMultiplier === 'number') {
                giftJarSizeMultiplierInput.value = cfg.sizeMultiplier;
            }
            if (typeof cfg.sizeRatioCoeff === 'number') {
                giftJarSizeRatioCoeffInput.value = cfg.sizeRatioCoeff;
                giftJarSizeRatioCoeffValue.textContent = cfg.sizeRatioCoeff.toFixed(1);
            }
            if (typeof cfg.jarTheme === 'string') {
                giftJarThemeSelect.value = cfg.jarTheme;
            }
            if (cfg && cfg.customProfiles && typeof cfg.customProfiles === 'object') {
                giftJarWallProfiles = cfg.customProfiles;
            }
            if (cfg.appearance) {
                state.giftJarAppearance = cfg.appearance;
                syncGiftJarAppearanceControls();
            }
            refreshGiftJarWallEditorThemeState();
        }).catch(() => {});

        titleInput.addEventListener('input', () => {
            scheduleTopGiftSettingsAutosave();
        });
        titleInput.addEventListener('change', () => {
            saveTopGiftSettingsImmediately().catch(() => {});
        });
        titleInput.addEventListener('blur', () => {
            flushDeferredWidgetFormUpdates();
        });
        senderDisplayModeInput.addEventListener('change', () => {
            saveTopGiftSettingsImmediately().catch(() => {});
            flushDeferredWidgetFormUpdates();
        });
        metalEffectEnabledInput.addEventListener('change', () => {
            saveTopGiftSettingsImmediately().catch(() => {});
        });
        likeContributionTitleInput.addEventListener('input', () => {
            scheduleLikeContributionSettingsAutosave();
        });
        likeContributionTitleInput.addEventListener('change', () => {
            saveLikeContributionSettingsImmediately().catch(() => {});
        });
        likeContributionIntervalInput.addEventListener('input', () => {
            scheduleLikeContributionSettingsAutosave();
        });
        likeContributionIntervalInput.addEventListener('change', () => {
            likeContributionIntervalInput.value = String(normalizeLikeContributionInterval(likeContributionIntervalInput.value));
            saveLikeContributionSettingsImmediately().catch(() => {});
        });
        likeContributionVolumeInput.addEventListener('input', () => {
            syncLikeContributionVolumeControl(likeContributionVolumeInput.value);
            scheduleLikeContributionSettingsAutosave();
        });
        likeContributionVolumeInput.addEventListener('change', () => {
            syncLikeContributionVolumeControl(likeContributionVolumeInput.value);
            saveLikeContributionSettingsImmediately().catch(() => {});
        });
        likeContributionBalloonDesignSelect.addEventListener('change', () => {
            saveLikeContributionSettingsImmediately().catch(() => {});
        });
        likeContributionCountFontSizeInput.addEventListener('input', () => {
            scheduleLikeContributionSettingsAutosave();
        });
        likeContributionCountFontSizeInput.addEventListener('change', () => {
            likeContributionCountFontSizeInput.value = String(normalizeLikeContributionCountFontSize(likeContributionCountFontSizeInput.value));
            saveLikeContributionSettingsImmediately().catch(() => {});
        });
        likeContributionNameFontSizeInput.addEventListener('input', () => {
            scheduleLikeContributionSettingsAutosave();
        });
        likeContributionNameFontSizeInput.addEventListener('change', () => {
            likeContributionNameFontSizeInput.value = String(normalizeLikeContributionNameFontSize(likeContributionNameFontSizeInput.value));
            saveLikeContributionSettingsImmediately().catch(() => {});
        });
        socket.on('admin_day_updated', (payload) => {
            state.todayDayKey = payload?.todayDayKey || state.todayDayKey || '';
            state.displayDayKey = payload?.displayDayKey || state.displayDayKey || state.todayDayKey || '';
            state.contributorsDisplayRangeMode = normalizeContributorsDisplayRangeMode(payload?.displayRangeMode || state.contributorsDisplayRangeMode);
            state.liveSession = normalizeLiveSession(payload?.liveSession);
            syncContributorsRangeControl();
            refreshContributorsOverlayControls();
            refreshGoalGiftSnapshot().catch(() => {});
        });

        socket.on('widgets:tap-goal:updated', (payload) => {
            if (payload?.progress) {
                state.tapGoalProgress = payload.progress;
                updateTapGoalProgressLabel();
            }
        });

        document.addEventListener('click', (event) => {
            if (!event.target.closest('.gift-suggest-shell') && !goalGiftSuggestionPanel.contains(event.target)) {
                hideGoalGiftSuggestionPanel();
            }
        });

        goalGiftList.addEventListener('focusout', () => {
            window.setTimeout(() => {
                flushDeferredWidgetFormUpdates();
            }, 0);
        });

        window.addEventListener('resize', () => {
            if (!goalGiftSuggestionPanel.hidden) {
                positionGoalGiftSuggestionPanel();
            }
        });

        window.addEventListener('scroll', () => {
            if (!goalGiftSuggestionPanel.hidden) {
                positionGoalGiftSuggestionPanel();
            }
        }, true);

        Promise.all([loadGiftCatalog(), loadConfig()]).catch((error) => {
            setStatus(saveStatus, `設定状態: ${error.message}`, 'error');
        });

        const widgetSettingsModal = document.getElementById('widget-settings-modal');
        const widgetModalTitle = document.getElementById('widget-settings-modal-title');
        const widgetModalBody = document.getElementById('widget-settings-modal-body');
        const widgetModalClose = document.getElementById('widget-settings-modal-close');

        let _activePanel = null;
        let _activePlaceholder = null;

        function openWidgetSettingsModal(btn) {
            const panelId = btn.dataset.panelId;
            const panel = document.getElementById(panelId);
            if (!panel) return;
            const card = btn.closest('article.card, section.panel, .panel');
            const title = card?.querySelector('h2')?.textContent?.trim() || '設定';
            widgetModalTitle.textContent = title + ' の設定';
            _activePlaceholder = document.createComment('wsp:' + panelId);
            panel.parentNode.insertBefore(_activePlaceholder, panel);
            panel.hidden = false;
            widgetModalBody.appendChild(panel);
            _activePanel = panel;
            widgetSettingsModal.hidden = false;
            document.body.style.overflow = 'hidden';
        }

        function closeWidgetSettingsModal() {
            if (_activePlaceholder && _activePanel) {
                _activePlaceholder.parentNode.insertBefore(_activePanel, _activePlaceholder);
                _activePlaceholder.remove();
                _activePanel.hidden = true;
                _activePanel = null;
                _activePlaceholder = null;
            }
            widgetSettingsModal.hidden = true;
            document.body.style.overflow = '';
        }

        widgetModalClose.addEventListener('click', closeWidgetSettingsModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !widgetSettingsModal.hidden) closeWidgetSettingsModal();
        });

        document.querySelectorAll('.settings-toggle-btn').forEach((btn) => {
            btn.addEventListener('click', () => openWidgetSettingsModal(btn));
        });

        // ---- goal row settings modal ----
        const goalRowSettingsModal = document.getElementById('goal-row-settings-modal');
        const goalRowModalTitle = document.getElementById('goal-row-settings-modal-title');
        const goalRowModalClose = document.getElementById('goal-row-settings-modal-close');
        const goalRowModalNote = document.getElementById('goal-row-modal-note');
        const goalRowModalCountUnique = document.getElementById('goal-row-modal-count-unique');
        const goalRowModalResetAtMidnight = document.getElementById('goal-row-modal-reset-at-midnight');
        const goalRowModalMissionUnitCount = document.getElementById('goal-row-modal-mission-unit-count');

        let _activeGoalRow = null;

        function getGoalTargetCountDivisors(targetCount) {
            const divisors = new Set();
            for (let candidate = 1; candidate * candidate <= targetCount; candidate += 1) {
                if (targetCount % candidate === 0) {
                    divisors.add(candidate);
                    divisors.add(targetCount / candidate);
                }
            }
            return Array.from(divisors).sort((a, b) => a - b);
        }

        function populateGoalRowModalMissionUnitCount(targetCount, missionUnitCount) {
            const divisors = getGoalTargetCountDivisors(targetCount).filter((divisor) => divisor < targetCount);
            const options = [`<option value="0">分割なし(1周で達成)</option>`]
                .concat(divisors.map((divisor) => {
                    const steps = targetCount / divisor;
                    return `<option value="${divisor}">${divisor}個ごと(ミッション最大${steps}周)</option>`;
                }));
            goalRowModalMissionUnitCount.innerHTML = options.join('');
            goalRowModalMissionUnitCount.value = divisors.includes(missionUnitCount) ? String(missionUnitCount) : '0';
        }

        function openGoalRowSettingsModal(row) {
            if (!row) return;
            _activeGoalRow = row;
            const slot = Number(row.dataset.goalRow || '0') + 1;
            const targetCount = Number.parseInt(row.querySelector('[data-goal-target]').value, 10) || 1;
            const missionUnitCount = Number.parseInt(row.querySelector('[data-goal-mission-unit-count]').value, 10) || 0;
            goalRowModalTitle.textContent = `スロット ${slot} の詳細設定`;
            goalRowModalNote.value = row.querySelector('[data-goal-note]').value;
            goalRowModalCountUnique.checked = row.querySelector('[data-goal-count-unique-users]').checked;
            goalRowModalResetAtMidnight.checked = row.querySelector('[data-goal-reset-at-midnight]').checked;
            populateGoalRowModalMissionUnitCount(targetCount, missionUnitCount);
            goalRowSettingsModal.hidden = false;
            document.body.style.overflow = 'hidden';
            goalRowModalNote.focus();
        }

        function closeGoalRowSettingsModal() {
            syncGoalRowModalToRow();
            goalRowSettingsModal.hidden = true;
            document.body.style.overflow = '';
            _activeGoalRow = null;
        }

        function syncGoalRowModalToRow() {
            if (!_activeGoalRow) return;
            _activeGoalRow.querySelector('[data-goal-note]').value = goalRowModalNote.value;
            _activeGoalRow.querySelector('[data-goal-count-unique-users]').checked = goalRowModalCountUnique.checked;
            _activeGoalRow.querySelector('[data-goal-reset-at-midnight]').checked = goalRowModalResetAtMidnight.checked;
            _activeGoalRow.querySelector('[data-goal-mission-unit-count]').value = goalRowModalMissionUnitCount.value;
            scheduleGoalGiftAutosave();
        }

        goalRowModalClose.addEventListener('click', closeGoalRowSettingsModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !goalRowSettingsModal.hidden) closeGoalRowSettingsModal();
        });
        goalRowModalNote.addEventListener('input', syncGoalRowModalToRow);
        goalRowModalNote.addEventListener('change', syncGoalRowModalToRow);
        goalRowModalCountUnique.addEventListener('change', syncGoalRowModalToRow);
        goalRowModalResetAtMidnight.addEventListener('change', syncGoalRowModalToRow);
        goalRowModalMissionUnitCount.addEventListener('change', syncGoalRowModalToRow);

        // ---- Push & Pull widget ----
        const pushPullUrl = document.getElementById('push-pull-url');
        const pushPullPreviewFrame = document.getElementById('push-pull-preview-frame');
        const pushPullPushLabel = document.getElementById('push-pull-push-label');
        const pushPullPullLabel = document.getElementById('push-pull-pull-label');
        const pushPullPushGiftsEl = document.getElementById('push-pull-push-gifts');
        const pushPullPullGiftsEl = document.getElementById('push-pull-pull-gifts');
        const pushPullSuggestPanel = document.getElementById('push-pull-suggest-panel');

        const MAX_PUSH_PULL_GIFTS = 5;
        let pushPullPushGifts = [];
        let pushPullPullGifts = [];
        let pushPullActivePicker = null; // {side, index, anchorEl}
        let pushPullActiveSuggestionIndex = -1;
        let visiblePushPullSuggestions = [];
        let pushPullSaveTimer = null;

        function buildPushPullPreviewUrl() {
            const base = state.widgetUrls.pushPullOverlayUrl || '/overlays/push-pull';
            try {
                const u = new URL(base, window.location.origin);
                u.searchParams.set('sample', '1');
                return u.pathname + u.search;
            } catch {
                return base + (base.includes('?') ? '&' : '?') + 'sample=1';
            }
        }

        function refreshPushPullPreview(options = {}) {
            updatePreviewFrame(pushPullPreviewFrame, buildPushPullPreviewUrl(), options);
        }

        function renderPushPullGiftRows(side) {
            const container = side === 'push' ? pushPullPushGiftsEl : pushPullPullGiftsEl;
            const gifts = side === 'push' ? pushPullPushGifts : pushPullPullGifts;
            container.innerHTML = '';

            for (let i = 0; i < MAX_PUSH_PULL_GIFTS; i++) {
                const gift = gifts[i] || null;
                const row = document.createElement('div');
                row.className = 'push-pull-gift-row';
                row.dataset.side = side;
                row.dataset.index = String(i);

                const imgEl = document.createElement('div');
                imgEl.className = 'push-pull-gift-img' + (gift ? '' : ' empty');
                imgEl.title = 'ギフトを選ぶ';
                imgEl.tabIndex = 0;
                imgEl.setAttribute('role', 'button');
                if (gift && gift.giftImage) {
                    const img = document.createElement('img');
                    img.src = gift.giftImage;
                    img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:5px;';
                    imgEl.appendChild(img);
                } else {
                    imgEl.textContent = '+';
                }
                imgEl.addEventListener('click', () => nameEl.focus());
                imgEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nameEl.focus(); } });

                const nameEl = document.createElement('input');
                nameEl.type = 'text';
                nameEl.className = 'push-pull-gift-name' + (gift ? '' : ' empty');
                nameEl.value = gift ? gift.giftName : '';
                nameEl.placeholder = 'ギフトを選ぶ';
                nameEl.autocomplete = 'off';
                nameEl.maxLength = 80;
                nameEl.addEventListener('focus', () => {
                    if (!state.giftCatalog.length) return;
                    pushPullActivePicker = { side, index: i, anchorEl: nameEl };
                    renderPushPullSuggestItems(nameEl.value);
                });
                nameEl.addEventListener('input', () => {
                    if (!pushPullActivePicker) pushPullActivePicker = { side, index: i, anchorEl: nameEl };
                    renderPushPullSuggestItems(nameEl.value);
                });
                nameEl.addEventListener('keydown', (e) => {
                    if (pushPullSuggestPanel.hidden) {
                        if (e.key === 'ArrowDown' && state.giftCatalog.length) { e.preventDefault(); pushPullActivePicker = { side, index: i, anchorEl: nameEl }; renderPushPullSuggestItems(nameEl.value); }
                        return;
                    }
                    if (e.key === 'ArrowDown') { e.preventDefault(); updatePushPullActiveSuggestion(pushPullActiveSuggestionIndex + 1); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); updatePushPullActiveSuggestion(pushPullActiveSuggestionIndex - 1); }
                    else if (e.key === 'Enter') { e.preventDefault(); if (pushPullActiveSuggestionIndex >= 0 && visiblePushPullSuggestions[pushPullActiveSuggestionIndex]) selectPushPullGift(visiblePushPullSuggestions[pushPullActiveSuggestionIndex]); }
                    else if (e.key === 'Escape') { closePushPullSuggestPanel(); }
                });
                nameEl.addEventListener('blur', () => {
                    window.setTimeout(() => {
                        if (!pushPullSuggestPanel.contains(document.activeElement)) closePushPullSuggestPanel();
                    }, 100);
                });

                const pointsEl = document.createElement('input');
                pointsEl.type = 'number';
                pointsEl.className = 'push-pull-points-input';
                pointsEl.min = '1';
                pointsEl.max = '99999';
                pointsEl.placeholder = 'pt';
                pointsEl.value = gift ? String(gift.points) : '';
                pointsEl.disabled = !gift;
                pointsEl.addEventListener('change', () => {
                    const list = side === 'push' ? pushPullPushGifts : pushPullPullGifts;
                    if (list[i]) {
                        list[i].points = Math.max(1, Math.min(99999, parseInt(pointsEl.value, 10) || 1));
                        schedulePushPullSave();
                    }
                });

                row.appendChild(imgEl);
                row.appendChild(nameEl);
                row.appendChild(pointsEl);
                container.appendChild(row);
            }
        }

        function renderPushPullRows() {
            renderPushPullGiftRows('push');
            renderPushPullGiftRows('pull');
        }

        function getFilteredPushPullSuggestions(query) {
            const catalog = (state.giftCatalog || []).filter((g) => g.imageUrl);
            const normalizedQuery = String(query || '').trim().toLowerCase();
            if (!normalizedQuery) return catalog;
            const coinFilter = parseCoinFilter(normalizedQuery);
            if (coinFilter) return catalog.filter((g) => Number.isFinite(g.diamondCount) && coinFilter(g.diamondCount));
            return catalog.filter((g) => String(g.name || '').toLowerCase().includes(normalizedQuery));
        }

        function renderPushPullSuggestItems(query) {
            if (!pushPullActivePicker) return;
            const { side, index, anchorEl } = pushPullActivePicker;
            const gifts = side === 'push' ? pushPullPushGifts : pushPullPullGifts;
            const current = gifts[index];
            visiblePushPullSuggestions = getFilteredPushPullSuggestions(query).slice(0, 80);
            if (!visiblePushPullSuggestions.length) { closePushPullSuggestPanel(); return; }
            pushPullActiveSuggestionIndex = 0;
            pushPullSuggestPanel.innerHTML = '';
            for (const [idx, gift] of visiblePushPullSuggestions.entries()) {
                const btn = document.createElement('button');
                btn.type = 'button';
                const isCurrentGift = current && current.giftId === String(gift.id || '');
                btn.className = 'push-pull-suggest-item' + (isCurrentGift || idx === 0 ? ' is-active' : '');
                const img = document.createElement('img');
                img.src = gift.imageUrl;
                img.className = 'push-pull-suggest-img';
                img.alt = '';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'push-pull-suggest-name';
                nameSpan.textContent = gift.name || '(名前なし)';
                const costSpan = document.createElement('span');
                costSpan.className = 'push-pull-suggest-cost';
                costSpan.textContent = gift.diamondCount != null ? `${gift.diamondCount}コイン` : '';
                btn.appendChild(img);
                btn.appendChild(nameSpan);
                btn.appendChild(costSpan);
                btn.addEventListener('mousedown', (e) => e.preventDefault());
                btn.addEventListener('click', () => selectPushPullGift(gift));
                pushPullSuggestPanel.appendChild(btn);
            }
            if (current) {
                const activeIdx = visiblePushPullSuggestions.findIndex((g) => String(g.id || '') === current.giftId);
                if (activeIdx >= 0) {
                    pushPullActiveSuggestionIndex = activeIdx;
                    const items = pushPullSuggestPanel.querySelectorAll('.push-pull-suggest-item');
                    items.forEach((btn, i) => btn.classList.toggle('is-active', i === activeIdx));
                }
            }
            pushPullSuggestPanel.hidden = false;
            positionPushPullSuggestPanel(anchorEl);
        }

        function updatePushPullActiveSuggestion(nextIndex) {
            const items = [...pushPullSuggestPanel.querySelectorAll('.push-pull-suggest-item')];
            if (!items.length) return;
            const clampedIndex = Math.max(0, Math.min(nextIndex, items.length - 1));
            items.forEach((btn, i) => btn.classList.toggle('is-active', i === clampedIndex));
            pushPullActiveSuggestionIndex = clampedIndex;
            items[clampedIndex]?.scrollIntoView({ block: 'nearest' });
        }

        function positionPushPullSuggestPanel(anchorEl) {
            const rect = anchorEl.getBoundingClientRect();
            const panelH = Math.min(240, pushPullSuggestPanel.scrollHeight);
            const spaceBelow = window.innerHeight - rect.bottom - 8;
            const top = spaceBelow >= panelH ? rect.bottom + 4 : rect.top - panelH - 4;
            pushPullSuggestPanel.style.left = rect.left + 'px';
            pushPullSuggestPanel.style.top = Math.max(4, top) + 'px';
            pushPullSuggestPanel.style.width = Math.max(260, rect.width + 100) + 'px';
        }

        function selectPushPullGift(catalogGift) {
            if (!pushPullActivePicker) return;
            const { side, index } = pushPullActivePicker;
            const list = side === 'push' ? pushPullPushGifts : pushPullPullGifts;
            const existing = list[index];
            list[index] = {
                giftId: String(catalogGift.id || ''),
                giftName: String(catalogGift.name || ''),
                giftImage: String(catalogGift.imageUrl || ''),
                points: existing ? existing.points : 10,
            };
            while (list.length < index + 1) list.push(null);
            closePushPullSuggestPanel();
            renderPushPullGiftRows(side);
            schedulePushPullSave();
        }

        function closePushPullSuggestPanel() {
            pushPullSuggestPanel.hidden = true;
            pushPullActivePicker = null;
            pushPullActiveSuggestionIndex = -1;
            visiblePushPullSuggestions = [];
        }

        function schedulePushPullSave() {
            if (pushPullSaveTimer) clearTimeout(pushPullSaveTimer);
            pushPullSaveTimer = setTimeout(() => savePushPullConfig().catch(() => {}), 600);
        }

        async function savePushPullConfig() {
            const pushLabel = pushPullPushLabel.value.trim() || 'プッシュ';
            const pullLabel = pushPullPullLabel.value.trim() || 'プル';
            const pushGifts = pushPullPushGifts.filter(Boolean).map((g) => ({ ...g }));
            const pullGifts = pushPullPullGifts.filter(Boolean).map((g) => ({ ...g }));

            const response = await fetch('/api/widgets/push-pull', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pushLabel, pullLabel, pushGifts, pullGifts,
                    scoreMode: pushPullScoreModeSelect.value,
                    appearance: {
                        fontKey: normalizeDisplayFontKey(pushPullFontSelect.value),
                        textStyleKey: normalizeDisplayTextStyleKey(pushPullTextStyleSelect.value),
                        strokeWidth: normalizeDisplayStrokeWidth(pushPullStrokeWidthInput.value),
                        giftSize: parseInt(pushPullGiftSizeInput.value, 10) || 88,
                        giftPtsSize: parseInt(pushPullGiftPtsSizeInput.value, 10) || 15
                    }
                })
            });
            if (!response.ok) throw new Error('プッシュ＆プル設定の保存に失敗しました');
        }

        async function loadPushPullConfig() {
            const res = await fetch('/api/widgets/push-pull/snapshot');
            const data = await res.json();
            pushPullPushLabel.value = data.pushLabel || 'プッシュ';
            pushPullPullLabel.value = data.pullLabel || 'プル';
            pushPullPushGifts = Array.isArray(data.pushGifts) ? data.pushGifts.slice(0, MAX_PUSH_PULL_GIFTS) : [];
            pushPullPullGifts = Array.isArray(data.pullGifts) ? data.pullGifts.slice(0, MAX_PUSH_PULL_GIFTS) : [];
            if (data.appearance) {
                state.pushPullAppearance = data.appearance;
            }
            state.pushPullScoreMode = data.scoreMode || 'absolute';
            syncPushPullAppearanceControls();
            renderPushPullRows();
        }

        document.addEventListener('click', (e) => {
            if (!pushPullSuggestPanel.hidden &&
                !pushPullSuggestPanel.contains(e.target) &&
                !e.target.closest('.push-pull-gift-name') &&
                !e.target.closest('.push-pull-gift-img')) {
                closePushPullSuggestPanel();
            }
        });

        window.addEventListener('resize', () => {
            if (!pushPullSuggestPanel.hidden && pushPullActivePicker) {
                positionPushPullSuggestPanel(pushPullActivePicker.anchorEl);
            }
        });

        window.addEventListener('scroll', () => {
            if (!pushPullSuggestPanel.hidden && pushPullActivePicker) {
                positionPushPullSuggestPanel(pushPullActivePicker.anchorEl);
            }
        }, true);

        pushPullPushLabel.addEventListener('input', schedulePushPullSave);
        pushPullPullLabel.addEventListener('input', schedulePushPullSave);

        document.getElementById('open-push-pull-overlay-button').addEventListener('click', () => {
            const url = state.widgetUrls.pushPullOverlayUrl || '/overlays/push-pull';
            openWindow(url, 'push-pull-overlay-window', { width: 720, height: 120 });
        });

        document.getElementById('copy-push-pull-url-button').addEventListener('click', async () => {
            const url = state.widgetUrls.pushPullLoaderUrl || state.widgetUrls.pushPullOverlayUrl || '/overlays/push-pull';
            await copyText(url);
        });

        document.getElementById('push-pull-test-push-button').addEventListener('click', () => {
            fetch('/api/widgets/push-pull/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ side: 'push', points: 10 })
            }).catch(() => {});
        });

        document.getElementById('push-pull-test-pull-button').addEventListener('click', () => {
            fetch('/api/widgets/push-pull/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ side: 'pull', points: 10 })
            }).catch(() => {});
        });

        document.getElementById('push-pull-reset-button').addEventListener('click', () => {
            if (!confirm('プッシュ＆プルのポイントをリセットしますか？')) return;
            fetch('/api/widgets/push-pull/reset', { method: 'POST' }).catch(() => {});
        });

        loadPushPullConfig().catch(() => {});
        refreshPushPullPreview();

        // ======== オリジナル瓶詰めギフト ========
        {
            const CUJ_CANVAS_SIZE = 540;
            const CUJ_WIDGET_SIZE = 1080;
            const CUJ_SCALE = CUJ_WIDGET_SIZE / CUJ_CANVAS_SIZE;

            const cujModal = document.getElementById('cuj-modal');
            const cujModalClose = document.getElementById('cuj-modal-close');
            const cujOpenModalBtn = document.getElementById('cuj-open-modal-btn');
            const cujStep1 = document.getElementById('cuj-step1');
            const cujStep2 = document.getElementById('cuj-step2');
            const cujFileInput = document.getElementById('cuj-file-input');
            const cujFileDrop = document.getElementById('cuj-file-drop');
            const cujStep1Preview = document.getElementById('cuj-step1-preview');
            const cujStep1Img = document.getElementById('cuj-step1-img');
            const cujStep1Filename = document.getElementById('cuj-step1-filename');
            const cujStep1NextBtn = document.getElementById('cuj-step1-next-btn');
            const cujThemeName = document.getElementById('cuj-theme-name');
            const cujBgImg = document.getElementById('cuj-bg-img');
            const cujDropMarker = document.getElementById('cuj-drop-marker');
            const cujDropLine = document.getElementById('cuj-drop-line');
            const cujWallCanvas = document.getElementById('cuj-wall-canvas');
            const cujWallCtx = cujWallCanvas.getContext('2d', { willReadFrequently: true });
            const cujPaintBtn = document.getElementById('cuj-paint-btn');
            const cujEraseBtn = document.getElementById('cuj-erase-btn');
            const cujBrushSize = document.getElementById('cuj-brush-size');
            const cujBrushSizeValue = document.getElementById('cuj-brush-size-value');
            const cujBackBtn = document.getElementById('cuj-back-btn');
            const cujClearBtn = document.getElementById('cuj-clear-btn');
            const cujSaveBtn = document.getElementById('cuj-save-btn');
            const cujErrorMsg = document.getElementById('cuj-error-msg');
            const cujThemeListEl = document.getElementById('cuj-theme-list');

            let cujSelectedDataUrl = null;
            let cujTool = 'paint';
            let cujIsDrawing = false;
            let cujLastPoint = null;
            let cujDropMarkerPct = 50; // 0-100 (%)
            let cujCustomUserThemes = []; // { id, label, imageUrl } (from server)

            function cujShowError(msg) {
                cujErrorMsg.textContent = msg;
                cujErrorMsg.style.display = msg ? '' : 'none';
            }

            function cujOpenModal() {
                cujStep1.hidden = false;
                cujStep2.hidden = true;
                cujStep1Preview.style.display = 'none';
                cujStep1Img.src = '';
                cujStep1Filename.textContent = '';
                cujSelectedDataUrl = null;
                cujShowError('');
                cujModal.hidden = false;
                document.body.style.overflow = 'hidden';
            }

            function cujCloseModal() {
                cujModal.hidden = true;
                document.body.style.overflow = '';
            }

            cujOpenModalBtn.addEventListener('click', cujOpenModal);
            cujModalClose.addEventListener('click', cujCloseModal);
            cujModal.addEventListener('click', (e) => { if (e.target === cujModal) cujCloseModal(); });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !cujModal.hidden) cujCloseModal(); });

            // ---- File picker ----
            cujFileDrop.addEventListener('click', () => cujFileInput.click());
            cujFileDrop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') cujFileInput.click(); });

            cujFileDrop.addEventListener('dragover', (e) => { e.preventDefault(); cujFileDrop.classList.add('drag-over'); });
            cujFileDrop.addEventListener('dragleave', () => cujFileDrop.classList.remove('drag-over'));
            cujFileDrop.addEventListener('drop', (e) => {
                e.preventDefault();
                cujFileDrop.classList.remove('drag-over');
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) cujLoadFile(file);
            });

            cujFileInput.addEventListener('change', () => {
                const file = cujFileInput.files[0];
                if (file) cujLoadFile(file);
                cujFileInput.value = '';
            });

            function cujLoadFile(file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    cujSelectedDataUrl = e.target.result;
                    cujStep1Img.src = cujSelectedDataUrl;
                    cujStep1Filename.textContent = file.name;
                    cujStep1Preview.style.display = '';
                };
                reader.readAsDataURL(file);
            }

            cujStep1NextBtn.addEventListener('click', () => {
                if (!cujSelectedDataUrl) return;
                cujStep1.hidden = true;
                cujStep2.hidden = false;
                cujBgImg.src = cujSelectedDataUrl;
                cujWallCtx.clearRect(0, 0, CUJ_CANVAS_SIZE, CUJ_CANVAS_SIZE);
                cujDropMarkerPct = 50;
                cujUpdateDropMarker();
                cujShowError('');
                if (!cujThemeName.value.trim()) cujThemeName.value = 'マイボトル';
            });

            cujBackBtn.addEventListener('click', () => {
                cujStep2.hidden = true;
                cujStep1.hidden = false;
            });

            // ---- Drop marker drag ----
            function cujUpdateDropMarker() {
                cujDropMarker.style.left = cujDropMarkerPct + '%';
                cujDropLine.style.left = cujDropMarkerPct + '%';
            }

            cujDropMarker.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                cujDropMarker.setPointerCapture(e.pointerId);

                function onMove(ev) {
                    const rect = document.getElementById('cuj-stage').getBoundingClientRect();
                    const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
                    cujDropMarkerPct = (x / rect.width) * 100;
                    cujUpdateDropMarker();
                }
                function onUp() {
                    cujDropMarker.removeEventListener('pointermove', onMove);
                    cujDropMarker.removeEventListener('pointerup', onUp);
                }
                cujDropMarker.addEventListener('pointermove', onMove);
                cujDropMarker.addEventListener('pointerup', onUp);
            });

            // ---- Wall drawing ----
            function cujSetTool(tool) {
                cujTool = tool;
                cujPaintBtn.classList.toggle('is-active', tool === 'paint');
                cujEraseBtn.classList.toggle('is-active', tool === 'erase');
            }
            cujPaintBtn.addEventListener('click', () => cujSetTool('paint'));
            cujEraseBtn.addEventListener('click', () => cujSetTool('erase'));

            cujBrushSize.addEventListener('input', () => {
                cujBrushSizeValue.textContent = cujBrushSize.value + ' px';
            });

            cujClearBtn.addEventListener('click', () => {
                cujWallCtx.clearRect(0, 0, CUJ_CANVAS_SIZE, CUJ_CANVAS_SIZE);
            });

            function cujGetPoint(e) {
                const rect = cujWallCanvas.getBoundingClientRect();
                return {
                    x: Math.max(0, Math.min(CUJ_CANVAS_SIZE - 1, (e.clientX - rect.left) * CUJ_CANVAS_SIZE / Math.max(rect.width, 1))),
                    y: Math.max(0, Math.min(CUJ_CANVAS_SIZE - 1, (e.clientY - rect.top) * CUJ_CANVAS_SIZE / Math.max(rect.height, 1)))
                };
            }

            function cujDrawStroke(from, to) {
                cujWallCtx.save();
                cujWallCtx.globalCompositeOperation = cujTool === 'erase' ? 'destination-out' : 'source-over';
                cujWallCtx.strokeStyle = 'rgba(194, 65, 12, 0.55)';
                cujWallCtx.lineWidth = Math.max(2, Number(cujBrushSize.value)) * 2;
                cujWallCtx.lineCap = 'round';
                cujWallCtx.lineJoin = 'round';
                cujWallCtx.beginPath();
                cujWallCtx.moveTo(from.x, from.y);
                cujWallCtx.lineTo(to.x, to.y);
                cujWallCtx.stroke();
                cujWallCtx.restore();
            }

            cujWallCanvas.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                cujIsDrawing = true;
                cujLastPoint = cujGetPoint(e);
                cujWallCanvas.setPointerCapture(e.pointerId);
            });
            cujWallCanvas.addEventListener('pointermove', (e) => {
                if (!cujIsDrawing) return;
                const pt = cujGetPoint(e);
                cujDrawStroke(cujLastPoint, pt);
                cujLastPoint = pt;
            });
            cujWallCanvas.addEventListener('pointerup', () => { cujIsDrawing = false; cujLastPoint = null; });
            cujWallCanvas.addEventListener('pointercancel', () => { cujIsDrawing = false; cujLastPoint = null; });

            // ---- Build wall profile from canvas ----
            function cujBuildProfile() {
                const { data, width, height } = cujWallCtx.getImageData(0, 0, CUJ_CANVAS_SIZE, CUJ_CANVAS_SIZE);
                const rows = [];
                for (let y = 0; y < height; y++) {
                    const runs = [];
                    let runStart = -1;
                    for (let x = 0; x < width; x++) {
                        const alpha = data[(y * width + x) * 4 + 3];
                        if (alpha > 20) {
                            if (runStart === -1) runStart = x;
                        } else if (runStart !== -1) {
                            runs.push({ start: runStart, end: x - 1 });
                            runStart = -1;
                        }
                    }
                    if (runStart !== -1) runs.push({ start: runStart, end: width - 1 });
                    if (runs.length >= 2) rows.push({ y, runs });
                }

                if (rows.length < 4) throw new Error('壁線が足りません。瓶の左右の内壁をマウスでなぞって描いてください。');

                const passable = [];
                for (const row of rows) {
                    const leftRun = row.runs[0];
                    const rightRun = row.runs[row.runs.length - 1];
                    const left = leftRun.end + 1;
                    const right = rightRun.start - 1;
                    if (right - left < 3) continue;
                    passable.push({
                        y: Math.round((row.y + 0.5) * CUJ_SCALE),
                        left: Math.round(left * CUJ_SCALE),
                        right: Math.round((right + 1) * CUJ_SCALE)
                    });
                }

                if (passable.length < 4) throw new Error('左右の壁が分かれている行が少なすぎます。もう少し長く壁を描いてください。');

                // Simplify
                const simplified = [passable[0]];
                let last = passable[0];
                for (let i = 1; i < passable.length - 1; i++) {
                    const r = passable[i];
                    if (r.y - last.y >= 14 || Math.abs(r.left - last.left) >= 10 || Math.abs(r.right - last.right) >= 10) {
                        simplified.push(r);
                        last = r;
                    }
                }
                simplified.push(passable[passable.length - 1]);

                // Offset wall centres outward by half WALL_T (=15) so collision surface
                // aligns with the painted inner edge rather than 15px inside it.
                const WALL_HALF = 15;
                const leftPoints = simplified.map(r => [r.left - WALL_HALF, r.y]);
                const rightPoints = simplified.map(r => [r.right + WALL_HALF, r.y]).reverse();

                // Drop slot: use marker X, Y from first passable row
                const firstRow = simplified[0];
                const markerX = Math.round((cujDropMarkerPct / 100) * CUJ_WIDGET_SIZE);
                const slotHalf = Math.max(40, Math.round((firstRow.right - firstRow.left) * 0.15));
                const dropSlot = {
                    y: firstRow.y,
                    left: Math.max(firstRow.left, markerX - slotHalf),
                    right: Math.min(firstRow.right, markerX + slotHalf)
                };
                if (dropSlot.right - dropSlot.left < 8) {
                    dropSlot.left = markerX - slotHalf;
                    dropSlot.right = markerX + slotHalf;
                }

                return { widthStops: simplified, wallPoints: leftPoints.concat(rightPoints), dropSlot };
            }

            // ---- Save ----
            cujSaveBtn.addEventListener('click', async () => {
                cujShowError('');
                const label = cujThemeName.value.trim() || 'マイボトル';
                let profile;
                try {
                    profile = cujBuildProfile();
                } catch (err) {
                    cujShowError(err.message);
                    return;
                }
                cujSaveBtn.disabled = true;
                cujSaveBtn.textContent = '保存中...';
                try {
                    const resp = await fetch('/api/widgets/custom-jar/themes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'add', label, imageDataUrl: cujSelectedDataUrl, profile })
                    });
                    const json = await resp.json().catch(() => ({}));
                    if (!resp.ok) throw new Error(json.error || '保存に失敗しました。');
                    cujCustomUserThemes = json.themes || [];
                    cujRenderThemeList();
                    cujCloseModal();
                    refreshCustomJarPreview({ forceReload: true });
                } catch (err) {
                    cujShowError(err.message);
                } finally {
                    cujSaveBtn.disabled = false;
                    cujSaveBtn.textContent = '完了・テーマに追加';
                }
            });

            // ---- Theme list rendering ----
            function cujRenderThemeList() {
                cujThemeListEl.innerHTML = '';
                if (cujCustomUserThemes.length === 0) {
                    cujThemeListEl.innerHTML = '<p style="margin:0;font-size:13px;color:var(--muted);">登録済みのオリジナルテーマはありません。</p>';
                    return;
                }
                for (const t of cujCustomUserThemes) {
                    const row = document.createElement('div');
                    row.className = 'cuj-theme-row';

                    const thumb = document.createElement('img');
                    thumb.className = 'cuj-theme-thumb';
                    thumb.alt = t.label;
                    thumb.src = t.imageUrl || '';

                    const label = document.createElement('span');
                    label.className = 'cuj-theme-label';
                    label.textContent = t.label;

                    const useBtn = document.createElement('button');
                    useBtn.type = 'button';
                    useBtn.className = 'ghost-button';
                    useBtn.textContent = 'このテーマを使用';
                    useBtn.addEventListener('click', () => {
                        fetch('/api/widgets/custom-jar/themes', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'activate', id: t.id })
                        }).then(() => refreshCustomJarPreview({ forceReload: true })).catch(() => {});
                    });

                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'ghost-button';
                    delBtn.title = '削除';
                    delBtn.textContent = '削除';
                    delBtn.style.color = 'var(--error)';
                    delBtn.addEventListener('click', async () => {
                        if (!confirm(`「${t.label}」を削除しますか？`)) return;
                        try {
                            const resp = await fetch('/api/widgets/custom-jar/themes', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: 'delete', id: t.id })
                            });
                            const json = await resp.json().catch(() => ({}));
                            if (!resp.ok) throw new Error(json.error || '削除に失敗しました。');
                            cujCustomUserThemes = json.themes || [];
                            cujRenderThemeList();
                            refreshCustomJarPreview({ forceReload: true });
                        } catch (err) {
                            alert(err.message);
                        }
                    });

                    row.append(thumb, label, useBtn, delBtn);
                    cujThemeListEl.appendChild(row);
                }
            }

            // ---- Load existing custom themes on page load ----
            fetch('/api/widgets/custom-jar/config').then(r => r.json()).then(cfg => {
                if (Array.isArray(cfg.themes)) {
                    cujCustomUserThemes = cfg.themes;
                }
                cujRenderThemeList();
                if (typeof cfg.dropAboveJar === 'number') {
                    customJarDropHeightInput.value = cfg.dropAboveJar;
                    customJarDropHeightValue.textContent = `${cfg.dropAboveJar} px`;
                }

                if (typeof cfg.sizeMultiplier === 'number') customJarSizeMultiplierInput.value = cfg.sizeMultiplier;
                if (typeof cfg.sizeRatioCoeff === 'number') {
                    customJarSizeRatioCoeffInput.value = cfg.sizeRatioCoeff;
                    customJarSizeRatioCoeffValue.textContent = cfg.sizeRatioCoeff.toFixed(1);
                }
            }).catch(() => {});
        }
        // ======== /オリジナル瓶詰めギフト ========
