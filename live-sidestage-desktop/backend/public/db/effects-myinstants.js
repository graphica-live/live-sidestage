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
                <button type="button" data-preview-index="${index}">試聴</button>
                <button type="button" class="primary" data-import-index="${index}">使う</button>
            </div>
        </div>
    `).join('');

    let previewAudio = null;

    myinstantsResults.querySelectorAll('[data-preview-index]').forEach((button) => {
        button.addEventListener('click', () => {
            const result = results[Number(button.dataset.previewIndex)];
            if (!result) return;
            if (previewAudio) {
                previewAudio.pause();
            }
            previewAudio = new Audio(result.mp3Url);
            previewAudio.play().catch(() => {});
        });
    });

    myinstantsResults.querySelectorAll('[data-import-index]').forEach((button) => {
        button.addEventListener('click', async () => {
            const result = results[Number(button.dataset.importIndex)];
            if (!result) return;

            button.disabled = true;
            myinstantsStatus.textContent = `${result.name} を取り込み中です。`;

            try {
                const params = editingEventId ? `?eventId=${encodeURIComponent(editingEventId)}` : '';
                const response = await fetch(`/api/effects/myinstants/import${params}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mp3Url: result.mp3Url, name: result.name })
                });
                const payload = await response.json();

                if (!response.ok || !payload.ok) {
                    throw new Error(payload.error || '音声の取り込みに失敗しました。');
                }

                pendingEventModalAudioAsset = payload.asset;
                eventModalAudioEnabled.checked = true;
                eventModalAudioName.textContent = payload.asset.name;
                setStatus(`音声 ${payload.asset.name} を取り込みました。`, 'ok');
                closeModal(myinstantsModal);
            } catch (error) {
                myinstantsStatus.textContent = error.message || '音声の取り込みに失敗しました。';
            } finally {
                button.disabled = false;
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

        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || '検索に失敗しました。');
        }

        renderMyinstantsResults(payload.results);
    } catch (error) {
        myinstantsStatus.textContent = error.message || '検索に失敗しました。';
    }
}

eventModalTemplateAudioButton.addEventListener('click', () => {
    myinstantsSearchInput.value = '';
    myinstantsStatus.textContent = '';
    myinstantsResults.innerHTML = '';
    openModal(myinstantsModal);
    myinstantsSearchInput.focus();
});

myinstantsSearchButton.addEventListener('click', runMyinstantsSearch);

myinstantsSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        runMyinstantsSearch();
    }
});

let myinstantsSuggestTimer = null;

myinstantsSearchInput.addEventListener('input', () => {
    if (myinstantsSuggestTimer) {
        clearTimeout(myinstantsSuggestTimer);
    }

    if (!myinstantsSearchInput.value.trim()) {
        myinstantsStatus.textContent = '';
        myinstantsResults.innerHTML = '';
        return;
    }

    myinstantsSuggestTimer = setTimeout(runMyinstantsSearch, 400);
});

document.querySelectorAll('[data-action="close-myinstants-modal"]').forEach((button) => {
    button.addEventListener('click', () => closeModal(myinstantsModal));
});
