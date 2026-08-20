const triggerPendingScreenSelect = document.getElementById('trigger-pending-screen-select');
const triggerPendingUrlValue = document.getElementById('trigger-pending-url-value');
const triggerPendingUrlCopyButton = document.getElementById('trigger-pending-url-copy-button');
const triggerPendingUrlPreviewButton = document.getElementById('trigger-pending-url-preview-button');
const TRIGGER_PENDING_SCREEN_STORAGE_KEY = 'tikeffect-trigger-pending-screen';

function renderTriggerPendingUrl() {
    if (!currentTriggerPendingScreenUrls.length) {
        triggerPendingUrlValue.value = '読み込み中';
        return;
    }

    if (!triggerPendingScreenSelect.options.length) {
        triggerPendingScreenSelect.innerHTML = currentTriggerPendingScreenUrls
            .map((item) => `<option value="${item.slot}">screen ${item.slot}</option>`)
            .join('');

        const storedSlot = Number(localStorage.getItem(TRIGGER_PENDING_SCREEN_STORAGE_KEY));
        if (currentTriggerPendingScreenUrls.some((item) => item.slot === storedSlot)) {
            triggerPendingScreenSelect.value = String(storedSlot);
        }
    }

    const selectedSlot = Number(triggerPendingScreenSelect.value) || currentTriggerPendingScreenUrls[0].slot;
    const target = currentTriggerPendingScreenUrls.find((item) => item.slot === selectedSlot)
        || currentTriggerPendingScreenUrls[0];

    triggerPendingUrlValue.value = target.url;

    triggerPendingUrlCopyButton.onclick = async () => {
        try {
            await navigator.clipboard.writeText(target.url);
            setStatus(`screen ${target.slot} の保留オーバーレイ URL をコピーしました。`, 'ok');
        } catch {
            setStatus('URL のコピーに失敗しました。', 'error');
        }
    };

    triggerPendingUrlPreviewButton.onclick = () => {
        window.open(`${target.directUrl}?preview=1`, `trigger-pending-preview-${target.slot}`, 'popup=yes,width=1100,height=420');
    };
}

triggerPendingScreenSelect.addEventListener('change', () => {
    localStorage.setItem(TRIGGER_PENDING_SCREEN_STORAGE_KEY, triggerPendingScreenSelect.value);
    renderTriggerPendingUrl();
});
