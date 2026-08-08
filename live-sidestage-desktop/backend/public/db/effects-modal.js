function createId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function populateMidiDeviceSelect(selectedValue) {
    const knownOptions = knownMidiDevices.map((name) =>
        `<option value="${escapeHtml(name)}"${name === selectedValue ? ' selected' : ''}>${escapeHtml(name)}</option>`
    ).join('');
    const missingSelectedOption = selectedValue && !knownMidiDevices.includes(selectedValue)
        ? `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}（未検出）</option>`
        : '';

    eventModalMidiDevice.innerHTML = `<option value="">(デバイス未選択)</option>${knownOptions}${missingSelectedOption}`;
}

function syncEventModalMidiFields() {
    const messageType = eventModalMidiMessageType.value;
    eventModalMidiData1Label.textContent = messageType === 'cc' ? 'CC番号' : messageType === 'pc' ? 'プログラム番号' : 'ノート番号';
    eventModalMidiData2Label.textContent = messageType === 'cc' ? '値' : 'ベロシティ';
    eventModalMidiData2.disabled = messageType === 'pc';
}

function updateLiveStudioStatusLabel() {
    eventModalLsStatus.textContent = livestudioConnected ? '● 接続中' : '○ 未接続（LIVE Studioを起動してください）';
    eventModalLsStatus.classList.toggle('is-connected', livestudioConnected);
}

function getLiveStudioCameraEffectOptions(typeName) {
    const list = livestudioSettings?.camera_effect?.effectList || [];
    return list.find((item) => item.name === typeName)?.effects || [];
}

function populateLiveStudioCameraEffectSelect(typeName, selectedId) {
    const effects = getLiveStudioCameraEffectOptions(typeName);
    eventModalLsCameraEffect.innerHTML = effects.length
        ? effects.map((effect) =>
            `<option value="${escapeHtml(effect.value)}"${effect.value === selectedId ? ' selected' : ''}>${escapeHtml(effect.label)}</option>`
        ).join('')
        : '<option value="">(選択肢なし)</option>';
}

function populateLiveStudioSelects(selected = {}) {
    updateLiveStudioStatusLabel();

    const sceneList = livestudioSettings?.scene_list || [];
    eventModalLsScene.innerHTML = sceneList.length
        ? sceneList.map((scene) =>
            `<option value="${escapeHtml(scene.name)}"${scene.name === selected.lsScene ? ' selected' : ''}>${escapeHtml(scene.name)}</option>`
        ).join('')
        : '<option value="">(LIVE Studio未接続)</option>';

    const cameraEffect = livestudioSettings?.camera_effect;
    const sourceList = cameraEffect?.sourceList || [];
    eventModalLsCameraSource.innerHTML = sourceList.length
        ? sourceList.map((source) =>
            `<option value="${escapeHtml(source.value)}"${source.value === selected.lsCameraSource ? ' selected' : ''}>${escapeHtml(source.label)}</option>`
        ).join('')
        : '<option value="">(LIVE Studio未接続)</option>';

    const typeList = cameraEffect?.typeList || [];
    const selectedType = typeList.includes(selected.lsCameraEffectType) ? selected.lsCameraEffectType : (typeList[0] || '');
    eventModalLsCameraType.innerHTML = typeList.length
        ? typeList.map((type) =>
            `<option value="${escapeHtml(type)}"${type === selectedType ? ' selected' : ''}>${escapeHtml(type)}</option>`
        ).join('')
        : '<option value="">(LIVE Studio未接続)</option>';
    populateLiveStudioCameraEffectSelect(selectedType, selected.lsCameraEffectId);

    const soundList = livestudioSettings?.sound_effect?.sound_Info || [];
    eventModalLsSoundEffect.innerHTML = soundList.length
        ? soundList.map((name) =>
            `<option value="${escapeHtml(name)}"${name === selected.lsSoundEffect ? ' selected' : ''}>${escapeHtml(name)}</option>`
        ).join('')
        : '<option value="">(LIVE Studio未接続)</option>';

    const vibeList = livestudioSettings?.vibeList || [];
    eventModalLsVibe.innerHTML = vibeList.length
        ? vibeList.map((vibe) =>
            `<option value="${escapeHtml(vibe.id)}"${vibe.id === selected.lsVibeId ? ' selected' : ''}>${escapeHtml(vibe.name)}</option>`
        ).join('')
        : '<option value="">(LIVE Studio未接続)</option>';
}

function syncLiveStudioActionTypeRows() {
    const type = eventModalLsActionType.value;
    eventModalLsSceneRow.hidden = type !== 'scene';
    eventModalLsCameraRow.hidden = type !== 'cameraeffects';
    eventModalLsCameraAutoOffRow.hidden = type !== 'cameraeffects';
    eventModalLsSoundRow.hidden = type !== 'soundeffect';
    eventModalLsVibeRow.hidden = type !== 'vibe';
}

function syncEventModalForceInterruptField() {
    eventModalForceInterruptCountRow.hidden = !eventModalForceInterruptEnabled.checked;
}

function syncEventModalTimerWidgetRows() {
    const isReversal = eventModalTimerWidgetMode.value === 'reversal';
    eventModalTimerWidgetFixedRow.hidden = isReversal;
    eventModalTimerWidgetReversalRow.hidden = !isReversal;
}

function resetEventModal() {
    editingEventId = null;
    pendingNewEventUploadId = createId('event');
    eventModalTitle.textContent = 'イベントを新規追加';
    eventModalDescription.textContent = '表示名と再生先 screen を決め、動画と音声もこの画面で設定します。';
    eventModalSubmit.textContent = '追加';
    syncEventModalOptions();
    eventModalName.value = '';
    eventModalVideoEnabled.checked = false;
    pendingEventModalVideoAsset = null;
    eventModalVideoName.textContent = '未設定';
    eventModalAudioEnabled.checked = false;
    pendingEventModalAudioAsset = null;
    eventModalAudioName.textContent = '未設定';
    eventModalMediaVolume.value = '100';
    syncEventModalVolume();
    eventModalMidiEnabled.checked = false;
    populateMidiDeviceSelect('');
    eventModalMidiMessageType.value = 'noteon';
    eventModalMidiChannel.value = '1';
    eventModalMidiData1.value = '60';
    eventModalMidiData2.value = '127';
    syncEventModalMidiFields();
    eventModalLsEnabled.checked = false;
    eventModalLsActionType.value = 'cameraeffects';
    eventModalLsCameraAutoOffEnabled.checked = false;
    populateLiveStudioSelects({});
    syncLiveStudioActionTypeRows();
    eventModalVdjEnabled.checked = false;
    eventModalVdjCommand.value = '';
    eventModalTimerWidgetEnabled.checked = false;
    eventModalTimerWidgetMode.value = 'fixed';
    eventModalTimerWidgetMinutes.value = '0';
    eventModalTimerWidgetThreshold.value = '5';
    eventModalTimerWidgetBelowMinutes.value = '0';
    eventModalTimerWidgetAboveMinutes.value = '0';
    syncEventModalTimerWidgetRows();
    eventModalForceInterruptEnabled.checked = false;
    eventModalForceInterruptCount.value = '0';
    syncEventModalForceInterruptField();
}

function openEventModalForCreate() {
    resetEventModal();
    openModal(eventModal);
    eventModalName.focus();
}

function openEventModalForEdit(eventRecord) {
    editingEventId = eventRecord.id;
    eventModalTitle.textContent = 'イベントを編集';
    eventModalDescription.textContent = '表示名、再生先 screen、動画と音声をここで更新します。';
    eventModalSubmit.textContent = '更新';
    eventModalScreen.innerHTML = buildScreenOptions(eventRecord.screen);
    eventModalName.value = eventRecord.name || '';
    eventModalVideoEnabled.checked = Boolean(eventRecord.videoEnabled);
    pendingEventModalVideoAsset = eventRecord.videoAssetUrl
        ? { url: eventRecord.videoAssetUrl, name: eventRecord.videoAssetName || '設定済み' }
        : null;
    eventModalVideoName.textContent = eventRecord.videoAssetName || '未設定';
    eventModalAudioEnabled.checked = Boolean(eventRecord.audioEnabled);
    pendingEventModalAudioAsset = eventRecord.audioAssetUrl
        ? { url: eventRecord.audioAssetUrl, name: eventRecord.audioAssetName || '設定済み' }
        : null;
    eventModalAudioName.textContent = eventRecord.audioAssetName || '未設定';
    eventModalMediaVolume.value = String(eventRecord.mediaVolume ?? 100);
    syncEventModalVolume();
    eventModalMidiEnabled.checked = Boolean(eventRecord.midiEnabled);
    populateMidiDeviceSelect(eventRecord.midiDeviceName || '');
    eventModalMidiMessageType.value = eventRecord.midiMessageType || 'noteon';
    eventModalMidiChannel.value = String(eventRecord.midiChannel ?? 1);
    eventModalMidiData1.value = String(eventRecord.midiData1 ?? 60);
    eventModalMidiData2.value = String(eventRecord.midiData2 ?? 127);
    syncEventModalMidiFields();
    eventModalLsEnabled.checked = Boolean(eventRecord.lsEnabled);
    eventModalLsActionType.value = eventRecord.lsActionType || 'cameraeffects';
    eventModalLsCameraAutoOffEnabled.checked = Boolean(eventRecord.lsCameraAutoOffEnabled);
    populateLiveStudioSelects({
        lsScene: eventRecord.lsScene,
        lsCameraSource: eventRecord.lsCameraSource,
        lsCameraEffectType: eventRecord.lsCameraEffectType,
        lsCameraEffectId: eventRecord.lsCameraEffectId,
        lsSoundEffect: eventRecord.lsSoundEffect,
        lsVibeId: eventRecord.lsVibeId
    });
    syncLiveStudioActionTypeRows();
    eventModalVdjEnabled.checked = Boolean(eventRecord.vdjEffectEnabled);
    eventModalVdjCommand.value = eventRecord.vdjCommand || '';
    eventModalTimerWidgetEnabled.checked = Boolean(eventRecord.timerWidgetEnabled);
    eventModalTimerWidgetMode.value = eventRecord.timerWidgetMode === 'reversal' ? 'reversal' : 'fixed';
    eventModalTimerWidgetMinutes.value = String(eventRecord.timerWidgetMinutesDelta ?? 0);
    eventModalTimerWidgetThreshold.value = String(eventRecord.timerWidgetReversalThresholdMinutes ?? 5);
    eventModalTimerWidgetBelowMinutes.value = String(eventRecord.timerWidgetBelowMinutesDelta ?? 0);
    eventModalTimerWidgetAboveMinutes.value = String(eventRecord.timerWidgetAboveMinutesDelta ?? 0);
    syncEventModalTimerWidgetRows();
    eventModalForceInterruptEnabled.checked = Boolean(eventRecord.forceInterruptAllEvents);
    eventModalForceInterruptCount.value = String(eventRecord.forceInterruptCount ?? 0);
    syncEventModalForceInterruptField();
    openModal(eventModal);
    eventModalName.focus();
}

function collectEventFromModal() {
    return {
        id: editingEventId || pendingNewEventUploadId,
        name: eventModalName.value.trim(),
        screen: Number(eventModalScreen.value || currentScreenUrls[0]?.slot || 1),
        videoEnabled: eventModalVideoEnabled.checked,
        videoAssetUrl: pendingEventModalVideoAsset?.url || '',
        videoAssetName: pendingEventModalVideoAsset?.name || '',
        audioEnabled: eventModalAudioEnabled.checked,
        audioAssetUrl: pendingEventModalAudioAsset?.url || '',
        audioAssetName: pendingEventModalAudioAsset?.name || '',
        mediaVolume: Number(eventModalMediaVolume.value || 100),
        midiEnabled: eventModalMidiEnabled.checked,
        midiDeviceName: eventModalMidiDevice.value || '',
        midiMessageType: eventModalMidiMessageType.value,
        midiChannel: Number(eventModalMidiChannel.value || 1),
        midiData1: Number(eventModalMidiData1.value || 0),
        midiData2: Number(eventModalMidiData2.value || 0),
        lsEnabled: eventModalLsEnabled.checked,
        lsActionType: eventModalLsActionType.value,
        lsScene: eventModalLsScene.value || '',
        lsCameraSource: eventModalLsCameraSource.value || '',
        lsCameraEffectType: eventModalLsCameraType.value || '',
        lsCameraEffectId: eventModalLsCameraEffect.value || '',
        lsCameraAutoOffEnabled: eventModalLsCameraAutoOffEnabled.checked,
        lsSoundEffect: eventModalLsSoundEffect.value || '',
        lsVibeId: eventModalLsVibe.value || '',
        vdjEffectEnabled: eventModalVdjEnabled.checked,
        vdjCommand: eventModalVdjCommand.value.trim(),
        timerWidgetEnabled: eventModalTimerWidgetEnabled.checked,
        timerWidgetMode: eventModalTimerWidgetMode.value,
        timerWidgetMinutesDelta: Number(eventModalTimerWidgetMinutes.value || 0),
        timerWidgetReversalThresholdMinutes: Number(eventModalTimerWidgetThreshold.value || 0),
        timerWidgetBelowMinutesDelta: Number(eventModalTimerWidgetBelowMinutes.value || 0),
        timerWidgetAboveMinutesDelta: Number(eventModalTimerWidgetAboveMinutes.value || 0),
        forceInterruptAllEvents: eventModalForceInterruptEnabled.checked,
        forceInterruptCount: Number(eventModalForceInterruptCount.value || 0)
    };
}

function getEventLabel(eventRecord, index) {
    return eventRecord.name?.trim() || `イベント ${index + 1}`;
}

function getTriggerLabel(triggerRecord, index) {
    return triggerRecord.name?.trim() || `トリガー ${index + 1}`;
}

function normalizeUserIdsInput(value) {
    return String(value || '')
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function getSelectedEventLabel(eventId) {
    if (!eventId) {
        return '未選択';
    }

    const matchedEvent = currentEvents.find((eventRecord) => eventRecord.id === eventId);
    return matchedEvent ? getEventLabel(matchedEvent, currentEvents.indexOf(matchedEvent)) : '未選択';
}

function buildScreenOptions(selectedValue) {
    return currentScreenUrls.map((item) => {
        const selected = Number(item.slot) === Number(selectedValue) ? ' selected' : '';
        return `<option value="${item.slot}"${selected}>screen ${item.slot}</option>`;
    }).join('');
}

function openModal(modal) {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeModal(modal) {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');

    if (modal === triggerModal) {
        hideGiftSuggestionPanel();
        hideEventSuggestionPanel();
    }
}

function syncEventModalOptions() {
    eventModalScreen.innerHTML = buildScreenOptions(currentScreenUrls[0]?.slot || 1);
}

function syncEventModalVolume() {
    eventModalMediaVolumeValue.textContent = `${eventModalMediaVolume.value}%`;
}

function renderTriggerModalEventIdsList() {
    const isRandom = triggerModalPlayRandom.checked;
    triggerModalEventIdsList.innerHTML = triggerModalSelectedEventIds.map((eventId, index) => {
        const ev = currentEvents.find((e) => e.id === eventId);
        const label = ev ? getEventLabel(ev, currentEvents.indexOf(ev)) : `(ID: ${eventId})`;
        const orderLabel = isRandom ? '' : `${index + 1}.`;
        return `<div class="event-id-chip" data-event-id="${escapeHtml(eventId)}">
            <span class="event-id-chip-order">${escapeHtml(orderLabel)}</span>
            <span class="event-id-chip-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
            <button type="button" class="event-id-chip-remove" data-remove-event-id="${escapeHtml(eventId)}" title="削除" aria-label="削除">×</button>
        </div>`;
    }).join('');
    triggerModalEventIdsList.querySelectorAll('[data-remove-event-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
            triggerModalSelectedEventIds = triggerModalSelectedEventIds.filter((id) => id !== btn.dataset.removeEventId);
            renderTriggerModalEventIdsList();
        });
    });
}

function syncUserTargetMode() {
    const isFilemap = triggerModalUserTargetFilemap.checked;
    triggerModalUserListSection.hidden = isFilemap;
    triggerModalUserFilemapSection.hidden = !isFilemap;
}

function setFilemapDir(dirPath) {
    triggerModalFilemapDir.value = dirPath || '';
    triggerModalFilemapDirDisplay.textContent = dirPath || '未選択';
    triggerModalFilemapDirDisplay.title = dirPath || '';
}

function resetTriggerModal() {
    editingTriggerId = null;
    triggerModalTitle.textContent = 'トリガーを新規追加';
    triggerModalDescription.textContent = 'トリガー名、再生イベント、ギフト条件、コメント条件、ユーザー条件をこの画面で設定します。';
    triggerModalSubmit.textContent = '追加';
    triggerModalName.value = '';
    editingTriggerEnabled = true;
    triggerModalSelectedEventIds = [];
    triggerModalPlaySequential.checked = true;
    renderTriggerModalEventIdsList();
    triggerModalEvent.value = '';
    triggerModalGiftName.value = '';
    triggerModalMinCoins.value = '0';
    triggerModalRapidFireEnabled.checked = false;
    triggerModalRapidFireCancelMs.value = '1500';
    syncTriggerRapidFireField();
    triggerModalTreatComboSingle.checked = true;
    triggerModalCommentMode.value = '';
    triggerModalCommentText.value = '';
    triggerModalUserIds.value = '';
    triggerModalUserTargetList.checked = true;
    triggerModalX5Excluded.checked = false;
    setFilemapDir('');
    syncUserTargetMode();
    syncTriggerCommentField();
    hideGiftSuggestionPanel();
    hideEventSuggestionPanel();
}

function openTriggerModalForCreate() {
    resetTriggerModal();
    openModal(triggerModal);
    triggerModalName.focus();
}

function openTriggerModalForEdit(triggerRecord) {
    editingTriggerId = triggerRecord.id;
    triggerModalTitle.textContent = 'トリガーを編集';
    triggerModalDescription.textContent = 'トリガー名、再生イベント、ギフト条件、コメント条件、ユーザー条件をここで更新します。';
    triggerModalSubmit.textContent = '更新';
    triggerModalName.value = triggerRecord.name || '';
    editingTriggerEnabled = Boolean(triggerRecord.enabled);
    // eventIds 複数対応（旧フォーマット eventId も考慮）
    const ids = Array.isArray(triggerRecord.eventIds) && triggerRecord.eventIds.length > 0
        ? triggerRecord.eventIds
        : (triggerRecord.eventId ? [triggerRecord.eventId] : []);
    triggerModalSelectedEventIds = [...ids];
    const isRandom = triggerRecord.eventPlayMode === 'random';
    triggerModalPlayRandom.checked = isRandom;
    triggerModalPlaySequential.checked = !isRandom;
    renderTriggerModalEventIdsList();
    triggerModalEvent.value = '';
    triggerModalGiftName.value = triggerRecord.giftName || '';
    triggerModalMinCoins.value = String(triggerRecord.minCoins || 0);
    triggerModalRapidFireEnabled.checked = Boolean(triggerRecord.rapidFireEnabled);
    triggerModalRapidFireCancelMs.value = String(triggerRecord.rapidFireCancelMs ?? 1500);
    syncTriggerRapidFireField();
    triggerModalTreatComboSingle.checked = triggerRecord.treatGiftComboAsSingle !== false;
    triggerModalCommentMode.value = triggerRecord.commentMode === 'disabled' ? '' : (triggerRecord.commentMode || '');
    triggerModalCommentText.value = triggerRecord.commentText || '';
    triggerModalUserIds.value = Array.isArray(triggerRecord.userIds)
        ? triggerRecord.userIds.join('\n')
        : '';
    const isFilemap = triggerRecord.userTargetMode === 'file-map';
    triggerModalUserTargetFilemap.checked = isFilemap;
    triggerModalUserTargetList.checked = !isFilemap;
    triggerModalX5Excluded.checked = Boolean(triggerRecord.triggerX5ExcludedFromLottery);
    setFilemapDir(isFilemap ? (triggerRecord.userIdToFileDir || '') : '');
    syncUserTargetMode();
    syncTriggerCommentField();
    hideGiftSuggestionPanel();
    hideEventSuggestionPanel();
    openModal(triggerModal);
    triggerModalName.focus();
}

function collectTriggerFromModal() {
    const isFilemap = triggerModalUserTargetFilemap.checked;
    return {
        id: editingTriggerId || createId('trigger'),
        name: triggerModalName.value.trim(),
        eventIds: [...triggerModalSelectedEventIds],
        eventPlayMode: triggerModalPlayRandom.checked ? 'random' : 'sequential',
        giftName: triggerModalGiftName.value.trim(),
        minCoins: Number(triggerModalMinCoins.value || 0),
        rapidFireEnabled: triggerModalRapidFireEnabled.checked,
        rapidFireCancelMs: Number(triggerModalRapidFireCancelMs.value || 1500),
        treatGiftComboAsSingle: triggerModalTreatComboSingle.checked,
        commentMode: triggerModalCommentMode.value,
        commentText: triggerModalCommentText.value.trim(),
        userIds: isFilemap ? [] : normalizeUserIdsInput(triggerModalUserIds.value),
        enabled: editingTriggerEnabled,
        userTargetMode: isFilemap ? 'file-map' : 'list',
        userIdToFileDir: isFilemap ? triggerModalFilemapDir.value : '',
        triggerX5ExcludedFromLottery: triggerModalX5Excluded.checked
    };
}

function syncTriggerModalOptions() {
    hideEventSuggestionPanel();
}

function syncTriggerCommentField() {
    const mode = triggerModalCommentMode.value;
    const isExact = mode === 'exact';
    triggerModalCommentText.disabled = !isExact;

    if (mode === 'any') {
        triggerModalCommentText.value = '';
        triggerModalCommentText.placeholder = 'あらゆるコメントを対象にします';
        return;
    }

    triggerModalCommentText.placeholder = isExact
        ? '入力一致にするコメントを入力'
        : 'コメント条件を使わない場合は未入力のまま';
}

function syncTriggerRapidFireField() {
    triggerModalRapidFireCancelMs.disabled = !triggerModalRapidFireEnabled.checked;
}

addEventButton.addEventListener('click', () => {
    openEventModalForCreate();
});

addTriggerButton.addEventListener('click', () => {
    openTriggerModalForCreate();
});

eventModalSubmit.addEventListener('click', async () => {
    const nextEvent = collectEventFromModal();

    if (nextEvent.name) {
        const isDuplicate = currentEvents.some((item) =>
            item.id !== nextEvent.id && item.name.trim() === nextEvent.name
        );
        if (isDuplicate) {
            eventModalName.setCustomValidity('同じイベント名が既に存在します。');
            eventModalName.reportValidity();
            return;
        }
    }
    eventModalName.setCustomValidity('');

    if (editingEventId) {
        currentEvents = currentEvents.map((item) => item.id === editingEventId ? nextEvent : item);
    } else {
        currentEvents = [
            ...currentEvents,
            nextEvent
        ];
    }

    closeModal(eventModal);
    syncTriggerModalOptions();
    renderEvents();
    renderTriggers();
    editingEventId = null;

    try {
        await saveConfig();
    } catch {
        // saveConfig already reports the failure in the status box.
    }
});

triggerModalSubmit.addEventListener('click', async () => {
    const nextTrigger = collectTriggerFromModal();

    if (nextTrigger.name) {
        const isDuplicate = currentTriggers.some((item) =>
            item.id !== nextTrigger.id && item.name.trim() === nextTrigger.name
        );
        if (isDuplicate) {
            triggerModalName.setCustomValidity('同じトリガー名が既に存在します。');
            triggerModalName.reportValidity();
            return;
        }
    }
    triggerModalName.setCustomValidity('');

    if (nextTrigger.userTargetMode === 'file-map' && !nextTrigger.giftName) {
        triggerModalGiftName.focus();
        triggerModalGiftName.setCustomValidity('ファイルマップモードでは対象ギフト名が必須です。');
        triggerModalGiftName.reportValidity();
        return;
    }

    triggerModalGiftName.setCustomValidity('');

    if (nextTrigger.userTargetMode === 'file-map' && !nextTrigger.userIdToFileDir) {
        triggerModalFilemapDirButton.focus();
        alert('フォルダを選択してください。');
        return;
    }

    if (editingTriggerId) {
        currentTriggers = currentTriggers.map((item) => item.id === editingTriggerId ? nextTrigger : item);
    } else {
        currentTriggers = [
            ...currentTriggers,
            nextTrigger
        ];
    }

    closeModal(triggerModal);
    renderTriggers();
    editingTriggerId = null;

    try {
        await saveConfig();
    } catch {
        // saveConfig already reports the failure in the status box.
    }
});

triggerModalCommentMode.addEventListener('change', () => {
    syncTriggerCommentField();
});

triggerModalRapidFireEnabled.addEventListener('change', () => {
    syncTriggerRapidFireField();
});

triggerModalUserTargetList.addEventListener('change', () => {
    syncUserTargetMode();
});

triggerModalUserTargetFilemap.addEventListener('change', () => {
    syncUserTargetMode();
});

triggerModalFilemapDirButton.addEventListener('click', async () => {
    triggerModalFilemapDirButton.disabled = true;
    try {
        const response = await fetch('/api/electron/pick-directory', { method: 'POST' });
        if (!response.ok) {
            return;
        }

        const result = await response.json();
        if (result.dirPath) {
            setFilemapDir(result.dirPath);
        }
    } catch {
        // ダイアログが閉じられた場合など
    } finally {
        triggerModalFilemapDirButton.disabled = false;
    }
});

triggerModalPlaySequential.addEventListener('change', () => {
    renderTriggerModalEventIdsList();
});

triggerModalPlayRandom.addEventListener('change', () => {
    renderTriggerModalEventIdsList();
});

document.querySelectorAll('[data-action="close-event-modal"]').forEach((button) => {
    button.addEventListener('click', () => {
        closeModal(eventModal);
    });
});

document.querySelectorAll('[data-action="close-trigger-modal"]').forEach((button) => {
    button.addEventListener('click', () => {
        closeModal(triggerModal);
    });
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        hideGiftSuggestionPanel();
        hideEventSuggestionPanel();
        closeModal(eventModal);
        closeModal(triggerModal);
    }
});

eventModalMediaVolume.addEventListener('input', () => {
    syncEventModalVolume();
});

eventModalMidiMessageType.addEventListener('change', () => {
    syncEventModalMidiFields();
});

eventModalForceInterruptEnabled.addEventListener('change', () => {
    syncEventModalForceInterruptField();
});

eventModalTimerWidgetMode.addEventListener('change', () => {
    syncEventModalTimerWidgetRows();
});

eventModalLsActionType.addEventListener('change', () => {
    syncLiveStudioActionTypeRows();
});

eventModalLsCameraType.addEventListener('change', () => {
    populateLiveStudioCameraEffectSelect(eventModalLsCameraType.value, '');
});

eventModalLsAccordion.addEventListener('toggle', () => {
    if (!eventModalLsAccordion.open) return;

    loadLiveStudioSettings().then(() => populateLiveStudioSelects({
        lsScene: eventModalLsScene.value,
        lsCameraSource: eventModalLsCameraSource.value,
        lsCameraEffectType: eventModalLsCameraType.value,
        lsCameraEffectId: eventModalLsCameraEffect.value,
        lsSoundEffect: eventModalLsSoundEffect.value,
        lsVibeId: eventModalLsVibe.value
    }));
});

eventModalName.addEventListener('input', () => {
    eventModalName.setCustomValidity('');
});

triggerModalName.addEventListener('input', () => {
    triggerModalName.setCustomValidity('');
});
