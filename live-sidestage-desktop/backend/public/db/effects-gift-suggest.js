function getPlaybackSummary(eventRecord) {
    const features = [];

    if (eventRecord.videoEnabled) {
        features.push('動画');
    }

    if (eventRecord.audioEnabled) {
        features.push('音声');
    }

    return features.length ? features.join(' / ') : '未設定';
}

function findGiftSuggestionForTrigger(giftName) {
    return GiftSuggest.findByNameOrId(knownGiftSuggestions, giftName);
}

const triggerGiftSuggestPicker = GiftSuggest.attachSuggestField({
    input: triggerModalGiftName,
    panel: triggerGiftSuggestionPanel,
    getGifts: () => knownGiftSuggestions,
    onSelect: (gift) => {
        triggerModalGiftName.value = gift.name || '';
    },
    escapeHtml
});

// effects-modal.js からモーダルの開閉時に呼ばれる（トリガーモーダルを閉じる際にサジェストパネルも閉じる）。
function hideGiftSuggestionPanel() {
    triggerGiftSuggestPicker.hide();
}

function positionEventSuggestionPanel() {
    const rect = triggerModalEvent.getBoundingClientRect();
    const spaceAbove = rect.top - 8;
    triggerEventSuggestionPanel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    triggerEventSuggestionPanel.style.top = '';
    triggerEventSuggestionPanel.style.maxHeight = `${Math.min(260, spaceAbove)}px`;
    triggerEventSuggestionPanel.style.left = `${rect.left}px`;
    triggerEventSuggestionPanel.style.width = `${rect.width}px`;
}

function hideEventSuggestionPanel() {
    triggerEventSuggestionPanel.hidden = true;
    triggerEventSuggestionPanel.innerHTML = '';
    visibleEventSuggestions = [];
    activeEventSuggestionIndex = -1;
}

function applyEventSuggestion(eventRecord) {
    if (!eventRecord) {
        return;
    }

    if (!triggerModalSelectedEventIds.includes(eventRecord.id)) {
        triggerModalSelectedEventIds.push(eventRecord.id);
        renderTriggerModalEventIdsList();
    }

    triggerModalEvent.value = '';
    hideEventSuggestionPanel();
    triggerModalEvent.focus();
}

function renderEventSuggestions(query) {
    const q = String(query || '').trim().toLowerCase();
    visibleEventSuggestions = q
        ? currentEvents.filter((e) => getEventLabel(e, currentEvents.indexOf(e)).toLowerCase().includes(q))
        : [...currentEvents];
    if (!visibleEventSuggestions.length) {
        hideEventSuggestionPanel();
        return;
    }
    activeEventSuggestionIndex = 0;
    triggerEventSuggestionPanel.innerHTML = visibleEventSuggestions.map((eventRecord, index) => {
        const label = getEventLabel(eventRecord, currentEvents.indexOf(eventRecord));
        const playbackDesc = getPlaybackSummary(eventRecord);
        const isAlreadySelected = triggerModalSelectedEventIds.includes(eventRecord.id);
        return `
            <button type="button" class="gift-suggestion-item${index === activeEventSuggestionIndex ? ' is-active' : ''}${isAlreadySelected ? ' is-selected' : ''}" data-event-index="${index}">
                <div class="gift-suggestion-image is-empty">▶</div>
                <div class="gift-suggestion-meta">
                    <div class="gift-suggestion-name">${escapeHtml(label)}${isAlreadySelected ? ' ✓' : ''}</div>
                    <div class="gift-suggestion-desc">${escapeHtml(playbackDesc)}</div>
                </div>
                <div class="gift-suggestion-cost"></div>
            </button>
        `;
    }).join('');
    triggerEventSuggestionPanel.hidden = false;
    positionEventSuggestionPanel();
    triggerEventSuggestionPanel.querySelectorAll('[data-event-index]').forEach((button) => {
        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            applyEventSuggestion(visibleEventSuggestions[Number(button.dataset.eventIndex)]);
        });
    });
}

function updateActiveEventSuggestion(nextIndex) {
    if (!visibleEventSuggestions.length) {
        return;
    }
    activeEventSuggestionIndex = Math.max(0, Math.min(nextIndex, visibleEventSuggestions.length - 1));
    triggerEventSuggestionPanel.querySelectorAll('[data-event-index]').forEach((button, index) => {
        button.classList.toggle('is-active', index === activeEventSuggestionIndex);
        if (index === activeEventSuggestionIndex) {
            button.scrollIntoView({ block: 'nearest' });
        }
    });
}

function positionUserSuggestionPanel() {
    const rect = triggerModalUserIds.getBoundingClientRect();
    const spaceAbove = rect.top - 8;
    triggerUserSuggestionPanel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    triggerUserSuggestionPanel.style.top = '';
    triggerUserSuggestionPanel.style.maxHeight = `${Math.min(260, spaceAbove)}px`;
    triggerUserSuggestionPanel.style.left = `${rect.left}px`;
    triggerUserSuggestionPanel.style.width = `${rect.width}px`;
}

function hideUserSuggestionPanel() {
    triggerUserSuggestionPanel.hidden = true;
    triggerUserSuggestionPanel.innerHTML = '';
    visibleUserSuggestions = [];
    activeUserSuggestionIndex = -1;
}

function getActiveUserToken() {
    const val = triggerModalUserIds.value;
    const pos = triggerModalUserIds.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const match = before.match(/[^,\n]+$/);
    return match ? match[0] : '';
}

function applyUserSuggestion(user) {
    if (!user) {
        return;
    }
    const val = triggerModalUserIds.value;
    const pos = triggerModalUserIds.selectionStart ?? val.length;
    const before = val.slice(0, pos);
    const after = val.slice(pos);
    const tokenMatch = before.match(/[^,\n]+$/);
    const prefix = tokenMatch ? before.slice(0, before.length - tokenMatch[0].length) : before;
    const needsSep = prefix.length > 0 && !/[\n,]\s*$/.test(prefix);
    triggerModalUserIds.value = prefix + (needsSep ? '\n' : '') + user.uniqueId + '\n' + after.replace(/^[^,\n]*/, '');
    hideUserSuggestionPanel();
    triggerModalUserIds.focus();
}

function renderUserSuggestions(token) {
    const q = String(token || '').trim().toLowerCase();
    if (!q) {
        hideUserSuggestionPanel();
        return;
    }
    visibleUserSuggestions = knownUserSuggestions.filter((u) => {
        return String(u.uniqueId || '').toLowerCase().includes(q)
            || String(u.nickname || '').toLowerCase().includes(q);
    }).slice(0, 20);
    if (!visibleUserSuggestions.length) {
        hideUserSuggestionPanel();
        return;
    }
    activeUserSuggestionIndex = 0;
    triggerUserSuggestionPanel.innerHTML = visibleUserSuggestions.map((user, index) => {
        const imgMarkup = user.image
            ? `<img class="gift-suggestion-image" src="${escapeHtml(user.image)}" alt="">`
            : '<div class="gift-suggestion-image is-empty">NO IMG</div>';
        return `
            <button type="button" class="gift-suggestion-item${index === activeUserSuggestionIndex ? ' is-active' : ''}" data-user-index="${index}">
                ${imgMarkup}
                <div class="gift-suggestion-meta">
                    <div class="gift-suggestion-name">${escapeHtml(user.nickname || user.uniqueId)}</div>
                    <div class="gift-suggestion-desc">@${escapeHtml(user.uniqueId)}</div>
                </div>
                <div class="gift-suggestion-cost"></div>
            </button>
        `;
    }).join('');
    triggerUserSuggestionPanel.hidden = false;
    positionUserSuggestionPanel();
    triggerUserSuggestionPanel.querySelectorAll('[data-user-index]').forEach((button) => {
        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            applyUserSuggestion(visibleUserSuggestions[Number(button.dataset.userIndex)]);
        });
    });
}

function updateActiveUserSuggestion(nextIndex) {
    if (!visibleUserSuggestions.length) {
        return;
    }
    activeUserSuggestionIndex = Math.max(0, Math.min(nextIndex, visibleUserSuggestions.length - 1));
    triggerUserSuggestionPanel.querySelectorAll('[data-user-index]').forEach((button, index) => {
        button.classList.toggle('is-active', index === activeUserSuggestionIndex);
        if (index === activeUserSuggestionIndex) {
            button.scrollIntoView({ block: 'nearest' });
        }
    });
}

async function loadUserSuggestions() {
    const response = await fetch('/api/users/recent');
    if (!response.ok) {
        return;
    }
    const payload = await response.json();
    knownUserSuggestions = Array.isArray(payload.users)
        ? payload.users.filter((u) => u?.uniqueId)
        : [];
}

// バックエンドの EFFECT_TRIGGER_FOLLOW_GIFT_NAME（backend/lib/constants.js）と同期すること。
const FOLLOW_TRIGGER_GIFT_NAME = 'フォロー・リフォロー';
const FOLLOW_TRIGGER_GIFT_IMAGE_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
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
        <g filter="url(#shadow)">
            <circle cx="130" cy="150" r="40" fill="#ecfeff"/>
            <path d="M62 246c0-36 28-64 64-64h8c36 0 64 28 64 64v10H62z" fill="#ecfeff"/>
            <circle cx="234" cy="86" r="64" fill="#ffffff"/>
            <path d="M234 46v80" stroke="#0f766e" stroke-width="20" stroke-linecap="round"/>
            <path d="M194 86h80" stroke="#0f766e" stroke-width="20" stroke-linecap="round"/>
        </g>
    </svg>
`)}`;
const FOLLOW_TRIGGER_GIFT_SUGGESTION = {
    id: '__follow__',
    name: FOLLOW_TRIGGER_GIFT_NAME,
    describe: 'フォロー / リフォロー時に発火します（ギフト以外のイベント）',
    diamondCount: null,
    imageUrl: FOLLOW_TRIGGER_GIFT_IMAGE_URL
};

async function loadGiftSuggestions() {
    knownGiftSuggestions = [FOLLOW_TRIGGER_GIFT_SUGGESTION];

    if (currentTriggers.length) {
        renderTriggers();
    }

    const response = await fetch('/api/tiktok/gifts');
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload.error || 'ギフト候補の読み込みに失敗しました。');
    }

    const realGifts = Array.isArray(payload.gifts)
        ? payload.gifts.filter((gift) => typeof gift?.name === 'string' && gift.name.trim())
        : [];

    knownGiftSuggestions = [FOLLOW_TRIGGER_GIFT_SUGGESTION, ...realGifts];

    if (currentTriggers.length) {
        renderTriggers();
    }
}

triggerModalEvent.addEventListener('focus', () => {
    renderEventSuggestions(triggerModalEvent.value);
});

triggerModalEvent.addEventListener('input', () => {
    renderEventSuggestions(triggerModalEvent.value);
});

triggerModalEvent.addEventListener('keydown', (event) => {
    if (triggerEventSuggestionPanel.hidden) {
        if (event.key === 'ArrowDown' && currentEvents.length) {
            event.preventDefault();
            renderEventSuggestions(triggerModalEvent.value);
        }
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        updateActiveEventSuggestion(activeEventSuggestionIndex + 1);
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        updateActiveEventSuggestion(activeEventSuggestionIndex - 1);
        return;
    }
    if (event.key === 'Enter') {
        const selected = visibleEventSuggestions[activeEventSuggestionIndex];
        if (selected) {
            event.preventDefault();
            applyEventSuggestion(selected);
        }
        return;
    }
    if (event.key === 'Escape') {
        hideEventSuggestionPanel();
    }
});

window.addEventListener('resize', () => {
    if (!triggerEventSuggestionPanel.hidden) {
        positionEventSuggestionPanel();
    }
});

window.addEventListener('scroll', () => {
    if (!triggerUserSuggestionPanel.hidden) {
        positionUserSuggestionPanel();
    }
    if (!triggerEventSuggestionPanel.hidden) {
        positionEventSuggestionPanel();
    }
}, true);

window.addEventListener('resize', () => {
    if (!triggerUserSuggestionPanel.hidden) {
        positionUserSuggestionPanel();
    }
});

document.addEventListener('click', (event) => {
    if (!event.target.closest('.gift-suggest-shell') && !triggerUserSuggestionPanel.contains(event.target)) {
        hideUserSuggestionPanel();
    }
});

document.addEventListener('click', (event) => {
    if (!event.target.closest('.gift-suggest-shell') && !triggerEventSuggestionPanel.contains(event.target)) {
        hideEventSuggestionPanel();
    }
});

triggerModalUserIds.addEventListener('input', () => {
    renderUserSuggestions(getActiveUserToken());
});

triggerModalUserIds.addEventListener('keydown', (event) => {
    if (triggerUserSuggestionPanel.hidden) {
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        updateActiveUserSuggestion(activeUserSuggestionIndex + 1);
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        updateActiveUserSuggestion(activeUserSuggestionIndex - 1);
        return;
    }
    if (event.key === 'Enter') {
        const selected = visibleUserSuggestions[activeUserSuggestionIndex];
        if (selected) {
            event.preventDefault();
            applyUserSuggestion(selected);
        }
        return;
    }
    if (event.key === 'Escape') {
        hideUserSuggestionPanel();
    }
});

let giftTestSelectedGift = null;

function setGiftTestStatus(text, tone = '') {
    giftTestStatus.className = 'status' + (tone ? ` ${tone}` : '');
    giftTestStatus.textContent = text;
}

GiftSuggest.attachSuggestField({
    input: giftTestNameInput,
    panel: giftTestSuggestionPanel,
    getGifts: () => knownGiftSuggestions,
    onSelect: (gift) => {
        giftTestNameInput.value = gift.name || '';
        giftTestSelectedGift = gift;
    },
    escapeHtml
});

giftTestNameInput.addEventListener('input', () => {
    giftTestSelectedGift = null;
});

giftTestSendButton.addEventListener('click', async () => {
    const giftName = giftTestNameInput.value.trim();

    if (!giftName) {
        setGiftTestStatus('ギフト名を入力してください。', 'error');
        return;
    }

    const matchedGift = (giftTestSelectedGift && giftTestSelectedGift.name === giftName)
        ? giftTestSelectedGift
        : findGiftSuggestionForTrigger(giftName);

    const repeatCount = Math.max(1, Number.parseInt(giftTestRepeatCountInput.value, 10) || 1);
    const uniqueId = giftTestUniqueIdInput.value.trim();

    giftTestSendButton.disabled = true;
    setGiftTestStatus('送信中…');

    try {
        const response = await fetch('/api/effects/gift-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                giftName,
                giftId: matchedGift?.id ?? null,
                diamondCount: Number.isFinite(matchedGift?.diamondCount) ? matchedGift.diamondCount : 0,
                repeatCount,
                uniqueId
            })
        });
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'テスト送信に失敗しました。');
        }

        setGiftTestStatus(
            payload.triggered ? '送信しました。条件に合致するトリガーが発火しました。' : '送信しました。ただし条件に合致するトリガーはありませんでした。',
            payload.triggered ? 'ok' : ''
        );
    } catch (error) {
        setGiftTestStatus(error.message || 'テスト送信に失敗しました。', 'error');
    } finally {
        giftTestSendButton.disabled = false;
    }
});

syncEventModalVolume();

loadGiftSuggestions().catch((error) => {
    setStatus(error.message || 'ギフト候補の読み込みに失敗しました。', 'error');
});

loadUserSuggestions().catch(() => {});

loadMidiDevices().catch(() => {});

loadConfig().catch((error) => {
    setStatus(error.message || '設定の読み込みに失敗しました。', 'error');
});
