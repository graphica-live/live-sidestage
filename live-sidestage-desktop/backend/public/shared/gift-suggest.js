// ギフト名サジェスト検索の共通処理。
// トリガー登録（effects-gift-suggest.js）、ゴールギフト・プッシュプル設定（widgets.js）など、
// 複数箇所で同じ検索・フィルタ処理を使うため、ここに集約する。
// 修正が必要な場合はこのファイルだけ直せば全箇所に反映される。
(function (global) {
    'use strict';

    // ">=100" "<=100" ">100" "<100" "100-500" "100" のようなコイン数条件をパースする。
    // 該当しない場合は null を返し、呼び出し側は通常のテキスト検索にフォールバックする。
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

    // gifts: { name, describe, diamondCount, ... } の配列。
    // クエリがコイン数条件として解釈できればコイン数で、そうでなければ name / describe の部分一致で絞り込む。
    function filterGifts(gifts, query) {
        const list = Array.isArray(gifts) ? gifts : [];
        const normalizedQuery = String(query || '').trim().toLowerCase();

        if (!normalizedQuery) {
            return list;
        }

        const coinFilter = parseCoinFilter(normalizedQuery);
        if (coinFilter) {
            return list.filter((gift) => Number.isFinite(gift.diamondCount) && coinFilter(gift.diamondCount));
        }

        return list.filter((gift) => {
            const name = String(gift.name || '').toLowerCase();
            const description = String(gift.describe || '').toLowerCase();
            return name.includes(normalizedQuery) || description.includes(normalizedQuery);
        });
    }

    // name または id が完全一致するギフトを探す（トリガー保存済み値からの逆引き用）。
    function findByNameOrId(gifts, value) {
        const list = Array.isArray(gifts) ? gifts : [];
        const normalizedValue = String(value || '').trim();

        if (!normalizedValue) {
            return null;
        }

        const loweredValue = normalizedValue.toLowerCase();
        const compactValue = normalizedValue.replace(/\s+/g, '');

        return list.find((gift) => {
            const name = String(gift?.name || '').trim();
            const id = String(gift?.id || '').trim();

            if (!name && !id) {
                return false;
            }

            return name === normalizedValue
                || id === normalizedValue
                || name.toLowerCase() === loweredValue
                || name.replace(/\s+/g, '') === compactValue;
        }) || null;
    }

    // トリガー登録・ゴールギフトで共通の「画像＋名前/説明＋コイン数」の候補行マークアップ。
    function renderItemHtml(gift, index, isActive, escapeHtml) {
        const imageMarkup = gift.imageUrl
            ? `<img class="gift-suggestion-image" src="${escapeHtml(gift.imageUrl)}" alt="${escapeHtml(gift.name)}">`
            : '<div class="gift-suggestion-image is-empty">NO IMG</div>';
        const idPart = gift.id ? `ID: ${escapeHtml(String(gift.id))}` : '';
        const descPart = gift.describe ? escapeHtml(gift.describe) : '';
        const description = [idPart, descPart].filter(Boolean).join('  ·  ') || '&nbsp;';
        const costText = Number.isFinite(gift.diamondCount) ? `${gift.diamondCount} coins` : '-';

        return `
            <button type="button" class="gift-suggestion-item${isActive ? ' is-active' : ''}" data-suggest-index="${index}">
                ${imageMarkup}
                <div class="gift-suggestion-meta">
                    <div class="gift-suggestion-name">${escapeHtml(gift.name)}</div>
                    <div class="gift-suggestion-desc">${description}</div>
                </div>
                <div class="gift-suggestion-cost">${escapeHtml(costText)}</div>
            </button>
        `;
    }

    // 単一の input <-> 単一の panel を紐付ける汎用サジェストコントローラ。
    // input の上に panel を開く（トリガー登録・ギフトテスト送信など、フォーム下部の項目向け）。
    // 複数行に1つの panel を共有する（ゴールギフトの各行など）ケースは attachInput() で input ごとに切り替える。
    function createPicker({ panel, containerSelector = '.gift-suggest-shell', position, renderList }) {
        let activeInput = null;
        let getGiftsFn = null;
        let onSelectFn = null;
        let visible = [];
        let activeIndex = -1;

        function defaultPosition(input) {
            const rect = input.getBoundingClientRect();
            const spaceAbove = rect.top - 8;
            panel.style.bottom = `${window.innerHeight - rect.top + 6}px`;
            panel.style.top = '';
            panel.style.maxHeight = `${Math.min(260, spaceAbove)}px`;
            panel.style.left = `${rect.left}px`;
            panel.style.width = `${rect.width}px`;
        }

        function positionPanel() {
            if (!activeInput) return;
            (position || defaultPosition)(activeInput, panel);
        }

        function hide() {
            panel.hidden = true;
            panel.innerHTML = '';
            visible = [];
            activeIndex = -1;
            activeInput = null;
        }

        function select(gift) {
            if (!gift) return;
            const input = activeInput;
            const onSelect = onSelectFn;
            hide();
            if (onSelect) onSelect(gift, input);
        }

        function updateActive(nextIndex) {
            if (!visible.length) return;
            activeIndex = Math.max(0, Math.min(nextIndex, visible.length - 1));
            panel.querySelectorAll('[data-suggest-index]').forEach((el, index) => {
                el.classList.toggle('is-active', index === activeIndex);
                if (index === activeIndex) {
                    el.scrollIntoView({ block: 'nearest' });
                }
            });
        }

        function render(query) {
            if (!activeInput || !getGiftsFn) return;

            visible = filterGifts(getGiftsFn(), query);

            if (!visible.length) {
                hide();
                return;
            }

            activeIndex = 0;
            renderList(panel, visible, activeIndex);
            panel.hidden = false;
            positionPanel();

            panel.querySelectorAll('[data-suggest-index]').forEach((el) => {
                el.addEventListener('mousedown', (event) => {
                    event.preventDefault();
                    select(visible[Number(el.dataset.suggestIndex)]);
                });
            });
        }

        function attachInput(input, { getGifts, onSelect, openOnEmptyArrowDown = true }) {
            input.addEventListener('focus', () => {
                activeInput = input;
                getGiftsFn = getGifts;
                onSelectFn = onSelect;
                render(input.value);
            });
            input.addEventListener('input', () => {
                activeInput = input;
                getGiftsFn = getGifts;
                onSelectFn = onSelect;
                render(input.value);
            });
            input.addEventListener('keydown', (event) => {
                if (activeInput !== input) return;

                if (panel.hidden) {
                    if (event.key === 'ArrowDown' && openOnEmptyArrowDown) {
                        event.preventDefault();
                        render(input.value);
                    }
                    return;
                }

                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    updateActive(activeIndex + 1);
                    return;
                }

                if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    updateActive(activeIndex - 1);
                    return;
                }

                if (event.key === 'Enter') {
                    const gift = visible[activeIndex];
                    if (gift) {
                        event.preventDefault();
                        select(gift);
                    }
                    return;
                }

                if (event.key === 'Escape') {
                    hide();
                }
            });
        }

        document.addEventListener('click', (event) => {
            if (containerSelector && event.target.closest(containerSelector)) return;
            if (panel.contains(event.target)) return;
            hide();
        });
        window.addEventListener('resize', () => {
            if (!panel.hidden) positionPanel();
        });
        window.addEventListener('scroll', () => {
            if (!panel.hidden) positionPanel();
        }, true);

        return { attachInput, render, hide, updateActive, getVisible: () => visible };
    }

    // input が1つだけの単純なケース（トリガー登録のギフト名欄、ギフトテスト送信欄など）向けの簡易ラッパー。
    function attachSuggestField({ input, panel, containerSelector, getGifts, onSelect, escapeHtml, position }) {
        const picker = createPicker({
            panel,
            containerSelector,
            position,
            renderList(panelEl, visibleGifts, activeIndex) {
                panelEl.innerHTML = visibleGifts
                    .map((gift, index) => renderItemHtml(gift, index, index === activeIndex, escapeHtml))
                    .join('');
            }
        });

        picker.attachInput(input, { getGifts, onSelect });

        return picker;
    }

    global.GiftSuggest = {
        parseCoinFilter,
        filterGifts,
        findByNameOrId,
        renderItemHtml,
        createPicker,
        attachSuggestField
    };
})(window);
