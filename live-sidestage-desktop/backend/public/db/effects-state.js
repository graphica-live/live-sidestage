const eventList = document.getElementById('event-list');
const triggerList = document.getElementById('trigger-list');
const urlList = document.getElementById('url-list');
const eventTemplate = document.getElementById('event-template');
const triggerTemplate = document.getElementById('trigger-template');
const addEventButton = document.getElementById('add-event-button');
const addTriggerButton = document.getElementById('add-trigger-button');
const eventModal = document.getElementById('event-modal');
const eventModalTitle = document.getElementById('event-modal-title');
const eventModalDescription = document.getElementById('event-modal-description');
const eventModalName = document.getElementById('event-modal-name');
const eventModalScreen = document.getElementById('event-modal-screen');
const eventModalVideoEnabled = document.getElementById('event-modal-video-enabled');
const eventModalUploadVideoButton = document.getElementById('event-modal-upload-video-button');
const eventModalClearVideoButton = document.getElementById('event-modal-clear-video-button');
const eventModalVideoFile = document.getElementById('event-modal-video-file');
const eventModalVideoName = document.getElementById('event-modal-video-name');
const eventModalAudioEnabled = document.getElementById('event-modal-audio-enabled');
const eventModalUploadAudioButton = document.getElementById('event-modal-upload-audio-button');
const eventModalClearAudioButton = document.getElementById('event-modal-clear-audio-button');
const eventModalAudioFile = document.getElementById('event-modal-audio-file');
const eventModalAudioName = document.getElementById('event-modal-audio-name');
const eventModalTemplateAudioButton = document.getElementById('event-modal-template-audio-button');
const eventModalMediaVolume = document.getElementById('event-modal-media-volume');
const eventModalMediaVolumeValue = document.getElementById('event-modal-media-volume-value');
const eventModalMidiEnabled = document.getElementById('event-modal-midi-enabled');
const eventModalMidiDevice = document.getElementById('event-modal-midi-device');
const eventModalMidiMessageType = document.getElementById('event-modal-midi-message-type');
const eventModalMidiChannel = document.getElementById('event-modal-midi-channel');
const eventModalMidiData1 = document.getElementById('event-modal-midi-data1');
const eventModalMidiData2 = document.getElementById('event-modal-midi-data2');
const eventModalMidiData1Label = document.getElementById('event-modal-midi-data1-label');
const eventModalMidiData2Label = document.getElementById('event-modal-midi-data2-label');
const eventModalLsAccordion = document.getElementById('event-modal-ls-accordion');
const eventModalLsEnabled = document.getElementById('event-modal-ls-enabled');
const eventModalLsStatus = document.getElementById('event-modal-ls-status');
const eventModalLsActionType = document.getElementById('event-modal-ls-action-type');
const eventModalLsSceneRow = document.getElementById('event-modal-ls-scene-row');
const eventModalLsScene = document.getElementById('event-modal-ls-scene');
const eventModalLsCameraRow = document.getElementById('event-modal-ls-camera-row');
const eventModalLsCameraSource = document.getElementById('event-modal-ls-camera-source');
const eventModalLsCameraType = document.getElementById('event-modal-ls-camera-type');
const eventModalLsCameraEffect = document.getElementById('event-modal-ls-camera-effect');
const eventModalLsSoundRow = document.getElementById('event-modal-ls-sound-row');
const eventModalLsSoundEffect = document.getElementById('event-modal-ls-sound-effect');
const eventModalLsVibeRow = document.getElementById('event-modal-ls-vibe-row');
const eventModalLsVibe = document.getElementById('event-modal-ls-vibe');
const eventModalVdjEnabled = document.getElementById('event-modal-vdj-enabled');
const eventModalVdjCommand = document.getElementById('event-modal-vdj-command');
const eventModalForceInterruptEnabled = document.getElementById('event-modal-force-interrupt-enabled');
const eventModalSubmit = document.getElementById('event-modal-submit');
const triggerModal = document.getElementById('trigger-modal');
const triggerModalTitle = document.getElementById('trigger-modal-title');
const triggerModalDescription = document.getElementById('trigger-modal-description');
const triggerModalName = document.getElementById('trigger-modal-name');
const triggerModalListOverlayName = document.getElementById('trigger-modal-list-overlay-name');
const triggerModalEvent = document.getElementById('trigger-modal-event');
const triggerEventSuggestionPanel = document.getElementById('trigger-event-suggestion-panel');
const triggerModalPlaySequential = document.getElementById('trigger-modal-play-sequential');
const triggerModalPlayRandom = document.getElementById('trigger-modal-play-random');
const triggerModalEventIdsList = document.getElementById('trigger-modal-event-ids-list');
const triggerModalGiftName = document.getElementById('trigger-modal-gift-name');
const triggerGiftSuggestionPanel = document.getElementById('trigger-gift-suggestion-panel');
const triggerModalMinCoins = document.getElementById('trigger-modal-min-coins');
const triggerModalRapidFireEnabled = document.getElementById('trigger-modal-rapid-fire-enabled');
const triggerModalRapidFireCancelMs = document.getElementById('trigger-modal-rapid-fire-cancel-ms');
const triggerModalTreatComboSingle = document.getElementById('trigger-modal-treat-combo-single');
const triggerModalExcludeFromOverlay = document.getElementById('trigger-modal-exclude-from-overlay');
const triggerModalListOverlayBgColor = document.getElementById('trigger-modal-list-overlay-bg-color');
const triggerModalListOverlayHighlight = document.getElementById('trigger-modal-list-overlay-highlight');
const triggerModalCommentMode = document.getElementById('trigger-modal-comment-mode');
const triggerModalCommentText = document.getElementById('trigger-modal-comment-text');
const triggerModalUserIds = document.getElementById('trigger-modal-user-ids');
const triggerUserSuggestionPanel = document.getElementById('trigger-user-suggestion-panel');
const triggerModalUserTargetList = document.getElementById('trigger-modal-user-target-list');
const triggerModalUserTargetFilemap = document.getElementById('trigger-modal-user-target-filemap');
const triggerModalUserListSection = document.getElementById('trigger-modal-user-list-section');
const triggerModalUserFilemapSection = document.getElementById('trigger-modal-user-filemap-section');
const triggerModalFilemapDirDisplay = document.getElementById('trigger-modal-filemap-dir-display');
const triggerModalFilemapDirButton = document.getElementById('trigger-modal-filemap-dir-button');
const triggerModalFilemapDir = document.getElementById('trigger-modal-filemap-dir');
const triggerModalSubmit = document.getElementById('trigger-modal-submit');
const backToCategoriesButton = document.getElementById('back-to-categories-button');
const categoryNameLabel = document.getElementById('category-name-label');
const giftTestNameInput = document.getElementById('gift-test-name');
const giftTestSuggestionPanel = document.getElementById('gift-test-suggestion-panel');
const giftTestRepeatCountInput = document.getElementById('gift-test-repeat-count');
const giftTestUniqueIdInput = document.getElementById('gift-test-unique-id');
const giftTestUniqueIdSuggestionPanel = document.getElementById('gift-test-unique-id-suggestion-panel');
const giftTestSendButton = document.getElementById('gift-test-send-button');
const giftTestStatus = document.getElementById('gift-test-status');

const DEFAULT_CATEGORY_ID = 'default';
const currentCategoryId = new URLSearchParams(window.location.search).get('category') || DEFAULT_CATEGORY_ID;

function belongsToCurrentCategory(item) {
    return (item.categoryId || DEFAULT_CATEGORY_ID) === currentCategoryId;
}

let allEvents = [];
let allTriggers = [];
let currentEvents = [];
let currentTriggers = [];
let currentScreenUrls = [];
let currentTriggerGiftsOverlayUrlBase = null;
let currentTriggerPendingScreenUrls = [];
let eventFilterQuery = '';
let triggerFilterQuery = '';
let pendingEventModalVideoAsset = null;
let pendingEventModalAudioAsset = null;
let editingEventId = null;
// 新規イベント作成モーダルを開いている間、まだイベントIDが確定していない状態で
// 音声/動画を取り込む際に使う一時ID。resetEventModal() で毎回発行し直す。
// これがないと、複数の新規イベントで固定のフォールバック名が使われてファイルが
// 衝突・上書きされてしまう（例: 「野球」と「中断」が同じ音声ファイルを指す）。
let pendingNewEventUploadId = null;
let editingTriggerId = null;
let editingTriggerEnabled = true;
let knownGiftSuggestions = [];
let knownUserSuggestions = [];
let visibleEventSuggestions = [];
let activeEventSuggestionIndex = -1;
let knownMidiDevices = [];
let livestudioConnected = false;
let livestudioSettings = null;

// トリガーモーダルの選択済みイベントIDリスト（表示順）
let triggerModalSelectedEventIds = [];

function setStatus(message, tone = '') {
    if (tone === 'error') {
        console.error(message);
        return;
    }

    console.info(message);
}

function collectEvents() {
    return currentEvents.map((eventRecord) => ({ ...eventRecord }));
}

function collectTriggers() {
    return currentTriggers.map((triggerRecord) => ({
        ...triggerRecord,
        userIds: Array.isArray(triggerRecord.userIds)
            ? [...triggerRecord.userIds]
            : normalizeUserIdsInput(triggerRecord.userIds)
    }));
}

async function loadConfig() {
    const response = await fetch('/api/effects/config');
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload.error || '設定の読み込みに失敗しました。');
    }

    allEvents = payload.events || [];
    allTriggers = payload.triggers || [];
    currentEvents = allEvents.filter(belongsToCurrentCategory);
    currentTriggers = allTriggers.filter(belongsToCurrentCategory);
    currentScreenUrls = payload.screenUrls || [];
    currentTriggerGiftsOverlayUrlBase = payload.triggerGiftsOverlayUrlBase || currentTriggerGiftsOverlayUrlBase;
    currentTriggerPendingScreenUrls = payload.triggerPendingScreenUrls || currentTriggerPendingScreenUrls;
    syncEventModalOptions();
    syncTriggerModalOptions();
    renderEvents();
    renderTriggers();
    renderUrls();
    renderTriggerGiftsUrl();
    renderTriggerPendingUrl();
}

async function loadMidiDevices() {
    try {
        const response = await fetch('/api/effects/midi/devices');
        const payload = await response.json();
        knownMidiDevices = payload.devices || [];
    } catch {
        knownMidiDevices = [];
    }
}

async function loadLiveStudioSettings() {
    try {
        const response = await fetch('/api/effects/livestudio/settings');
        const payload = await response.json();
        livestudioConnected = Boolean(payload.connected);
        livestudioSettings = payload.settings || null;
    } catch {
        livestudioConnected = false;
        livestudioSettings = null;
    }
}

async function saveConfig() {
    addEventButton.disabled = true;
    addTriggerButton.disabled = true;

    try {
        const mergedEvents = [
            ...allEvents.filter((item) => !belongsToCurrentCategory(item)),
            ...collectEvents().map((item) => ({ ...item, categoryId: currentCategoryId }))
        ];
        const mergedTriggers = [
            ...allTriggers.filter((item) => !belongsToCurrentCategory(item)),
            ...collectTriggers().map((item) => ({ ...item, categoryId: currentCategoryId }))
        ];

        const response = await fetch('/api/effects/config', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                events: mergedEvents,
                triggers: mergedTriggers
            })
        });
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || '設定の保存に失敗しました。');
        }

        allEvents = payload.events || [];
        allTriggers = payload.triggers || [];
        currentEvents = allEvents.filter(belongsToCurrentCategory);
        currentTriggers = allTriggers.filter(belongsToCurrentCategory);
        currentScreenUrls = payload.screenUrls || currentScreenUrls;
        syncEventModalOptions();
        syncTriggerModalOptions();
        renderEvents();
        renderTriggers();
        renderUrls();
    } catch (error) {
        setStatus(error.message || '設定の保存に失敗しました。', 'error');
    } finally {
        addEventButton.disabled = false;
        addTriggerButton.disabled = false;
    }
}

backToCategoriesButton.addEventListener('click', () => {
    window.location.href = '/event-categories';
});

async function loadCategoryLabel() {
    try {
        const response = await fetch('/api/effects/categories');
        const payload = await response.json();
        const category = (payload.categories || []).find((item) => item.id === currentCategoryId);
        categoryNameLabel.textContent = category ? category.name : 'イベントトリガー';
    } catch {
        categoryNameLabel.textContent = 'イベントトリガー';
    }
}

loadCategoryLabel();
