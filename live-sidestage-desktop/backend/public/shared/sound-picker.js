// 共通サウンド検索・取り込みピッカー (myinstants.com + 効果音ラボ)
// このモーダル(id="myinstants-modal")と検索ロジックは全ページで共有する。
// 新しいページでサウンド選択UIを追加する場合、このファイルと同じ構造のモーダルHTMLを配置し、
// <script src="/shared/sound-picker.js"></script> を読み込んで openSoundPicker() を呼び出すだけでよい。
// 検索対象サイトを増減する場合は backend/lib/routes/effects.js のAPI側のみ変更すれば全ページに反映される。

let soundPickerContext = null;
let soundPickerSearchTimer = null;
let soundPickerPreviewAudio = null;

const SOUND_PICKER_SOURCE_LABELS = { 'myinstants': 'myinstants', 'soundeffect-lab': '効果音ラボ' };

function getSoundPickerElements() {
    return {
        modal: document.getElementById('myinstants-modal'),
        searchInput: document.getElementById('myinstants-search-input'),
        searchButton: document.getElementById('myinstants-search-button'),
        status: document.getElementById('myinstants-status'),
        results: document.getElementById('myinstants-results'),
    };
}

function openSoundPicker({ eventIdHint = 'sound', onImported } = {}) {
    const els = getSoundPickerElements();
    if (!els.modal) return;

    soundPickerContext = { eventIdHint, onImported };
    els.searchInput.value = '';
    els.status.textContent = '';
    els.results.innerHTML = '';
    els.modal.classList.add('is-open');
    els.modal.setAttribute('aria-hidden', 'false');
    els.searchInput.focus();
}

function closeSoundPicker() {
    const els = getSoundPickerElements();
    if (!els.modal) return;

    els.modal.classList.remove('is-open');
    els.modal.setAttribute('aria-hidden', 'true');
    soundPickerContext = null;
}

function renderSoundPickerResults(results) {
    const els = getSoundPickerElements();

    if (!results.length) {
        els.results.innerHTML = '';
        els.status.textContent = '該当するサウンドが見つかりませんでした。';
        return;
    }

    els.status.textContent = `${results.length}件見つかりました。`;
    els.results.innerHTML = results.map((result, index) => `
        <div class="myinstants-result-item">
            <span class="myinstants-result-source myinstants-result-source-${escapeHtml(result.source || '')}">${escapeHtml(SOUND_PICKER_SOURCE_LABELS[result.source] || '')}</span>
            <span class="myinstants-result-name">${escapeHtml(result.name)}</span>
            <div class="myinstants-result-actions">
                <button type="button" class="ghost-button icon-button" data-preview-index="${index}" title="試聴" aria-label="試聴">▶</button>
                <button type="button" class="ghost-button" data-import-index="${index}">これを使う</button>
            </div>
        </div>
    `).join('');

    els.results.querySelectorAll('[data-preview-index]').forEach((button) => {
        button.addEventListener('click', () => {
            const result = results[Number(button.dataset.previewIndex)];
            if (!result) return;
            if (soundPickerPreviewAudio) soundPickerPreviewAudio.pause();
            soundPickerPreviewAudio = new Audio(result.mp3Url);
            soundPickerPreviewAudio.play().catch(() => {});
        });
    });

    els.results.querySelectorAll('[data-import-index]').forEach((button) => {
        button.addEventListener('click', async () => {
            const result = results[Number(button.dataset.importIndex)];
            const context = soundPickerContext;
            if (!result || !context) return;

            button.disabled = true;
            els.status.textContent = `${result.name} を取り込み中です。`;

            try {
                const params = context.eventIdHint ? `?eventId=${encodeURIComponent(context.eventIdHint)}` : '';
                const response = await fetch(`/api/effects/myinstants/import${params}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mp3Url: result.mp3Url, name: result.name })
                });
                const payload = await response.json();

                if (!response.ok || !payload.ok) {
                    throw new Error(payload.error || '音声の取り込みに失敗しました。');
                }

                context.onImported?.(payload.asset);
                closeSoundPicker();
            } catch (error) {
                els.status.textContent = error.message || '音声の取り込みに失敗しました。';
            } finally {
                button.disabled = false;
            }
        });
    });
}

async function runSoundPickerSearch() {
    const els = getSoundPickerElements();
    const query = els.searchInput.value.trim();

    if (!query) {
        els.status.textContent = 'キーワードを入力してください。';
        return;
    }

    els.status.textContent = '検索中です。';
    els.results.innerHTML = '';

    try {
        const response = await fetch(`/api/effects/myinstants/search?q=${encodeURIComponent(query)}`);
        const payload = await response.json();

        if (!response.ok || !payload.ok) {
            throw new Error(payload.error || '検索に失敗しました。');
        }

        renderSoundPickerResults(payload.results);
    } catch (error) {
        els.status.textContent = error.message || '検索に失敗しました。';
    }
}

(function initSoundPicker() {
    const els = getSoundPickerElements();
    if (!els.modal) return;

    els.searchButton.addEventListener('click', runSoundPickerSearch);

    els.searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            runSoundPickerSearch();
        }
    });

    els.searchInput.addEventListener('input', () => {
        if (soundPickerSearchTimer) clearTimeout(soundPickerSearchTimer);

        if (!els.searchInput.value.trim()) {
            els.status.textContent = '';
            els.results.innerHTML = '';
            return;
        }

        soundPickerSearchTimer = setTimeout(runSoundPickerSearch, 400);
    });

    document.querySelectorAll('[data-action="close-myinstants-modal"]').forEach((button) => {
        button.addEventListener('click', closeSoundPicker);
    });
})();
