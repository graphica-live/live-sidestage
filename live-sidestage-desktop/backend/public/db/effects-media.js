async function uploadMedia(file, kind, eventId) {
    const formData = new FormData();
    formData.append('media', file);
    formData.append('kind', kind);

    const params = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
    const response = await fetch(`/api/effects/media${params}`, {
        method: 'POST',
        body: formData
    });
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload.error || 'メディアの取り込みに失敗しました。');
    }

    return payload.asset;
}

eventModalUploadVideoButton.addEventListener('click', () => {
    eventModalVideoFile.click();
});

eventModalClearVideoButton.addEventListener('click', () => {
    pendingEventModalVideoAsset = null;
    eventModalVideoEnabled.checked = false;
    eventModalVideoName.textContent = '未設定';
    eventModalVideoFile.value = '';
});

eventModalVideoFile.addEventListener('change', async () => {
    const file = eventModalVideoFile.files && eventModalVideoFile.files[0];

    if (!file) {
        return;
    }

    setStatus(`動画 ${file.name} を取り込み中です。`);

    try {
        const asset = await uploadMedia(file, 'video', editingEventId);
        pendingEventModalVideoAsset = asset;
        eventModalVideoEnabled.checked = true;
        eventModalVideoName.textContent = asset.name;
        setStatus(`動画 ${asset.name} を取り込みました。`, 'ok');
    } catch (error) {
        setStatus(error.message || '動画の取り込みに失敗しました。', 'error');
    } finally {
        eventModalVideoFile.value = '';
    }
});

eventModalUploadAudioButton.addEventListener('click', () => {
    eventModalAudioFile.click();
});

eventModalClearAudioButton.addEventListener('click', () => {
    pendingEventModalAudioAsset = null;
    eventModalAudioEnabled.checked = false;
    eventModalAudioName.textContent = '未設定';
    eventModalAudioFile.value = '';
});

eventModalAudioFile.addEventListener('change', async () => {
    const file = eventModalAudioFile.files && eventModalAudioFile.files[0];

    if (!file) {
        return;
    }

    setStatus(`音声 ${file.name} を取り込み中です。`);

    try {
        const asset = await uploadMedia(file, 'audio', editingEventId);
        pendingEventModalAudioAsset = asset;
        eventModalAudioEnabled.checked = true;
        eventModalAudioName.textContent = asset.name;
        setStatus(`音声 ${asset.name} を取り込みました。`, 'ok');
    } catch (error) {
        setStatus(error.message || '音声の取り込みに失敗しました。', 'error');
    } finally {
        eventModalAudioFile.value = '';
    }
});
