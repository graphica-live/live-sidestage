function showConfirm(message, okLabel = '削除する') {
    return new Promise((resolve) => {
        const shell = document.getElementById('confirm-dialog');
        const msgEl = document.getElementById('confirm-dialog-message');
        const okBtn = document.getElementById('confirm-dialog-ok');
        const cancelBtn = document.getElementById('confirm-dialog-cancel');
        msgEl.textContent = message;
        okBtn.textContent = okLabel;
        shell.classList.add('is-open');
        shell.setAttribute('aria-hidden', 'false');
        function cleanup(result) {
            shell.classList.remove('is-open');
            shell.setAttribute('aria-hidden', 'true');
            resolve(result);
        }
        okBtn.addEventListener('click', () => cleanup(true), { once: true });
        cancelBtn.addEventListener('click', () => cleanup(false), { once: true });
    });
}

function getTriggerGiftOptionSummary(triggerRecord) {
    return triggerRecord.treatGiftComboAsSingle !== false
        ? 'ギフトまとめ投げを1回とする'
        : 'まとめ投げを回数分再生する';
}

function formatUserIdsSummary(userIds) {
    if (Array.isArray(userIds)) {
        return userIds.length ? userIds.join(', ') : '全ユーザー';
    }

    const normalized = normalizeUserIdsInput(userIds);
    return normalized.length ? normalized.join(', ') : '全ユーザー';
}

function formatUserTargetSummary(triggerRecord) {
    if (triggerRecord.userTargetMode === 'file-map') {
        const dir = triggerRecord.userIdToFileDir || '未設定';
        return `ファイルマップ: ${dir}`;
    }

    return formatUserIdsSummary(triggerRecord.userIds);
}

function formatEventIdsSummary(triggerRecord) {
    const ids = Array.isArray(triggerRecord.eventIds) && triggerRecord.eventIds.length > 0
        ? triggerRecord.eventIds
        : (triggerRecord.eventId ? [triggerRecord.eventId] : []);

    if (!ids.length) {
        return '未選択';
    }

    const mode = triggerRecord.eventPlayMode === 'random' ? '[ランダム] ' : '[順次] ';
    const labels = ids.map((id) => {
        const ev = currentEvents.find((e) => e.id === id);
        return ev ? getEventLabel(ev, currentEvents.indexOf(ev)) : id;
    });
    return mode + labels.join(' → ');
}

function formatTriggerCommentSummary(triggerRecord) {
    if (triggerRecord.commentMode === 'any') {
        return 'あらゆるコメント';
    }

    if (triggerRecord.commentMode === 'exact') {
        return triggerRecord.commentText || '入力一致';
    }

    return '未使用';
}

function renderEmptyState(container, message) {
    container.innerHTML = `<div class="empty">${message}</div>`;
}

async function previewEvent(eventRecord) {
    const response = await fetch('/api/effects/preview', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            event: eventRecord
        })
    });
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload.error || 'イベントの再生に失敗しました。');
    }

    return payload;
}

function renderEvents() {
    const filtered = eventFilterQuery
        ? currentEvents.filter((e) => getEventLabel(e, currentEvents.indexOf(e)).toLowerCase().includes(eventFilterQuery))
        : currentEvents;

    if (!currentEvents.length) {
        renderEmptyState(eventList, 'イベントはまだありません。上のボタンから追加してください。');
        return;
    }

    if (!filtered.length) {
        renderEmptyState(eventList, '「' + eventFilterQuery + '」に一致するイベントはありません。');
        return;
    }

    eventList.innerHTML = '';

    filtered.forEach((eventRecord, index) => {
        const fragment = eventTemplate.content.cloneNode(true);
        const card = fragment.querySelector('.record-card');
        const nameValue = fragment.querySelector('[data-role="name"]');
        const screenValue = fragment.querySelector('[data-role="screen"]');
        const videoLinkedValue = fragment.querySelector('[data-role="video-linked"]');
        const audioLinkedValue = fragment.querySelector('[data-role="audio-linked"]');
        const midiLinkedValue = fragment.querySelector('[data-role="midi-linked"]');
        const vdjLinkedValue = fragment.querySelector('[data-role="vdj-linked"]');
        const mediaVolumeValue = fragment.querySelector('[data-role="media-volume-value"]');
        const hasVideoAsset = Boolean(eventRecord.videoAssetUrl || eventRecord.videoAssetName);
        const hasAudioAsset = Boolean(eventRecord.audioAssetUrl || eventRecord.audioAssetName);
        const hasMidi = Boolean(eventRecord.midiEnabled && eventRecord.midiDeviceName);
        const hasVdjEffect = Boolean(eventRecord.vdjEffectEnabled && eventRecord.vdjCommand);

        card.dataset.eventId = eventRecord.id;
        nameValue.textContent = eventRecord.name || '未設定';
        screenValue.textContent = `screen ${eventRecord.screen}`;
        videoLinkedValue.textContent = hasVideoAsset ? '✓' : '-';
        videoLinkedValue.classList.toggle('is-empty', !hasVideoAsset);
        audioLinkedValue.textContent = hasAudioAsset ? '✓' : '-';
        audioLinkedValue.classList.toggle('is-empty', !hasAudioAsset);
        midiLinkedValue.textContent = hasMidi ? '✓' : '-';
        midiLinkedValue.classList.toggle('is-empty', !hasMidi);
        vdjLinkedValue.textContent = hasVdjEffect ? '✓' : '-';
        vdjLinkedValue.classList.toggle('is-empty', !hasVdjEffect);
        mediaVolumeValue.textContent = `${eventRecord.mediaVolume ?? 100}%`;

        fragment.querySelector('[data-action="delete-event"]').addEventListener('click', async () => {
            const label = getEventLabel(eventRecord, index);
            if (!await showConfirm(`「${label}」を削除してもよいですか？`)) return;
            currentEvents = currentEvents.filter((item) => item.id !== eventRecord.id);
            currentTriggers = currentTriggers.map((item) => ({
                ...item,
                eventIds: Array.isArray(item.eventIds)
                    ? item.eventIds.filter((id) => id !== eventRecord.id)
                    : []
            }));
            // モーダルが開いている場合はリストから除去
            triggerModalSelectedEventIds = triggerModalSelectedEventIds.filter((id) => id !== eventRecord.id);
            renderTriggerModalEventIdsList();
            syncTriggerModalOptions();
            renderEvents();
            renderTriggers();

            try {
                await saveConfig();
            } catch {
                // saveConfig already reports the failure in the status box.
            }
        });

        fragment.querySelector('[data-action="edit-event"]').addEventListener('click', () => {
            openEventModalForEdit(eventRecord);
        });

        fragment.querySelector('[data-action="play-event"]').addEventListener('click', async () => {
            setStatus(`${getEventLabel(eventRecord, index)} を再生しています。`);

            try {
                await previewEvent(eventRecord);
                setStatus(`${getEventLabel(eventRecord, index)} を再生しました。`, 'ok');
            } catch (error) {
                setStatus(error.message || 'イベントの再生に失敗しました。', 'error');
            }
        });

        eventList.appendChild(fragment);
    });
}

function renderTriggers() {
    const filtered = triggerFilterQuery
        ? currentTriggers.filter((t) => {
            const q = triggerFilterQuery;
            if (getTriggerLabel(t, currentTriggers.indexOf(t)).toLowerCase().includes(q)) return true;
            if (String(t.giftName || '').toLowerCase().includes(q)) return true;
            const userIds = Array.isArray(t.userIds) ? t.userIds : [];
            if (userIds.some((id) => String(id).toLowerCase().includes(q))) return true;
            return false;
        })
        : currentTriggers;

    if (!currentTriggers.length) {
        renderEmptyState(triggerList, 'トリガーはまだありません。イベント未設定のままでも追加できます。');
        return;
    }

    if (!filtered.length) {
        renderEmptyState(triggerList, '「' + triggerFilterQuery + '」に一致するトリガーはありません。');
        return;
    }

    triggerList.innerHTML = '';

    filtered.forEach((triggerRecord, index) => {
        const fragment = triggerTemplate.content.cloneNode(true);
        const card = fragment.querySelector('.record-card');
        const nameValue = fragment.querySelector('[data-role="name"]');
        const eventNameValue = fragment.querySelector('[data-role="event-name"]');
        const giftNameValue = fragment.querySelector('[data-role="gift-name"]');
        const giftImageWrap = fragment.querySelector('[data-role="gift-image"]');
        const giftLabel = fragment.querySelector('[data-role="gift-label"]');
        const minCoinsValue = fragment.querySelector('[data-role="min-coins"]');
        const giftOptionsValue = fragment.querySelector('[data-role="gift-options"]');
        const commentSummaryValue = fragment.querySelector('[data-role="comment-summary"]');
        const userIdsValue = fragment.querySelector('[data-role="user-ids"]');
        const enabledCheckbox = fragment.querySelector('[data-role="enabled"]');

        card.dataset.triggerId = triggerRecord.id;
        nameValue.textContent = getTriggerLabel(triggerRecord, index);
        eventNameValue.textContent = formatEventIdsSummary(triggerRecord);
        const giftText = triggerRecord.giftName || '全ギフト';
        giftLabel.textContent = giftText;
        if (triggerRecord.giftName) {
            const matchedGift = findGiftSuggestionForTrigger(triggerRecord.giftName);
            if (matchedGift?.imageUrl) {
                const img = document.createElement('img');
                img.src = matchedGift.imageUrl;
                img.alt = matchedGift.name || '';
                img.className = 'trigger-gift-thumb';
                giftImageWrap.appendChild(img);
                giftImageWrap.hidden = false;
            }
        }
        minCoinsValue.textContent = `${Number(triggerRecord.minCoins || 0)}`;
        giftOptionsValue.textContent = getTriggerGiftOptionSummary(triggerRecord);
        commentSummaryValue.textContent = formatTriggerCommentSummary(triggerRecord);
        userIdsValue.textContent = formatUserTargetSummary(triggerRecord);
        enabledCheckbox.checked = Boolean(triggerRecord.enabled);

        enabledCheckbox.addEventListener('change', async () => {
            triggerRecord.enabled = enabledCheckbox.checked;
            currentTriggers = currentTriggers.map((item) => item.id === triggerRecord.id
                ? { ...item, enabled: enabledCheckbox.checked }
                : item);

            try {
                await saveConfig();
            } catch {
                // saveConfig already reports the failure in the status box.
            }
        });

        fragment.querySelector('[data-action="delete-trigger"]').addEventListener('click', async () => {
            const label = getTriggerLabel(triggerRecord, index);
            if (!await showConfirm(`「${label}」を削除してもよいですか？`)) return;
            currentTriggers = currentTriggers.filter((item) => item.id !== triggerRecord.id);
            renderTriggers();

            try {
                await saveConfig();
            } catch {
                // saveConfig already reports the failure in the status box.
            }
        });

        fragment.querySelector('[data-action="edit-trigger"]').addEventListener('click', () => {
            openTriggerModalForEdit(triggerRecord);
        });

        triggerList.appendChild(fragment);
    });
}

function renderTriggerGiftsUrl() {
    const valueInput = document.getElementById('trigger-gifts-url-value');
    const copyButton = document.getElementById('trigger-gifts-url-copy-button');
    const previewButton = document.getElementById('trigger-gifts-url-preview-button');

    if (!currentTriggerGiftsOverlayUrlBase) {
        valueInput.value = '読み込み中';
        return;
    }

    const overlayUrl = `${currentTriggerGiftsOverlayUrlBase.url}?category=${encodeURIComponent(currentCategoryId)}`;
    const directOverlayUrl = `${currentTriggerGiftsOverlayUrlBase.directUrl}?category=${encodeURIComponent(currentCategoryId)}`;

    valueInput.value = overlayUrl;

    copyButton.onclick = async () => {
        try {
            await navigator.clipboard.writeText(overlayUrl);
            setStatus('トリガーギフト一覧オーバーレイの URL をコピーしました。', 'ok');
        } catch {
            setStatus('URL のコピーに失敗しました。', 'error');
        }
    };

    previewButton.onclick = () => {
        window.open(`${directOverlayUrl}&preview=1`, 'trigger-gifts-overlay-preview', 'popup=yes,width=960,height=640');
    };
}

function renderUrls() {
    urlList.innerHTML = '';

    currentScreenUrls.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'url-item';
        row.innerHTML = `
            <div class="url-label">screen ${item.slot}</div>
            <input class="url-value" type="text" readonly value="${item.url}">
            <button type="button">URL をコピー</button>
            <button type="button">debug 表示</button>
        `;

        row.querySelector('button:nth-of-type(1)').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(item.url);
                setStatus(`screen ${item.slot} の URL をコピーしました。`, 'ok');
            } catch {
                setStatus('URL のコピーに失敗しました。', 'error');
            }
        });

        row.querySelector('button:nth-of-type(2)').addEventListener('click', () => {
            window.open(`${item.directUrl || item.url}?debug=1`, `effect-screen-debug-${item.slot}`, 'popup=yes,width=960,height=640');
        });

        urlList.appendChild(row);
    });
}

const eventFilterInput = document.getElementById('event-filter');
const triggerFilterInput = document.getElementById('trigger-filter');

eventFilterInput.addEventListener('input', () => {
    eventFilterQuery = eventFilterInput.value.trim().toLowerCase();
    renderEvents();
});

triggerFilterInput.addEventListener('input', () => {
    triggerFilterQuery = triggerFilterInput.value.trim().toLowerCase();
    renderTriggers();
});
