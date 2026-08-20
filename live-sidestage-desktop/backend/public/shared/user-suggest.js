// リスナー（ユーザーID/ニックネーム）サジェスト検索の共通処理。
// トリガー登録の対象ユーザー欄（effects-gift-suggest.js）、ギフトテスト送信の送信ユーザーID欄など、
// 複数箇所で同じ検索・候補表示処理を使うため、ここに集約する。
// 構造は shared/gift-suggest.js の GiftSuggest と対称。
(function (global) {
    'use strict';

    // users: { uniqueId, nickname, image, ... } の配列。
    // クエリが空なら全件、そうでなければ uniqueId / nickname の部分一致で絞り込む。
    function filterUsers(users, query) {
        const list = Array.isArray(users) ? users : [];
        const normalizedQuery = String(query || '').trim().toLowerCase();

        if (!normalizedQuery) {
            return list;
        }

        return list.filter((user) => {
            const uniqueId = String(user?.uniqueId || '').toLowerCase();
            const nickname = String(user?.nickname || '').toLowerCase();
            return uniqueId.includes(normalizedQuery) || nickname.includes(normalizedQuery);
        });
    }

    // uniqueId が完全一致するユーザーを探す（保存済み値からの逆引き用）。
    function findByUniqueId(users, uniqueId) {
        const list = Array.isArray(users) ? users : [];
        const normalized = String(uniqueId || '').trim().toLowerCase();

        if (!normalized) {
            return null;
        }

        return list.find((user) => String(user?.uniqueId || '').toLowerCase() === normalized) || null;
    }

    // トリガー登録・ギフトテスト送信で共通の「アイコン＋ニックネーム＋@uniqueId」の候補行マークアップ。
    function renderItemHtml(user, index, isActive, escapeHtml) {
        const imageMarkup = user.image
            ? `<img class="gift-suggestion-image" src="${escapeHtml(user.image)}" alt="">`
            : '<div class="gift-suggestion-image is-empty">NO IMG</div>';

        return `
            <button type="button" class="gift-suggestion-item${isActive ? ' is-active' : ''}" data-suggest-index="${index}">
                ${imageMarkup}
                <div class="gift-suggestion-meta">
                    <div class="gift-suggestion-name">${escapeHtml(user.nickname || user.uniqueId)}</div>
                    <div class="gift-suggestion-desc">@${escapeHtml(user.uniqueId)}</div>
                </div>
                <div class="gift-suggestion-cost"></div>
            </button>
        `;
    }

    // 単一の input <-> 単一の panel を紐付ける汎用サジェストコントローラ。
    // getQuery を渡すと、input の全文ではなくカーソル位置のトークンなどを検索クエリとして使える
    // （トリガー登録のカンマ・改行区切り複数ユーザー欄など）。省略時は input.value をそのまま使う。
    function createPicker({ panel, containerSelector = '.gift-suggest-shell', position, renderList, hideOnEmptyQuery = false, maxResults = 20 }) {
        let activeInput = null;
        let getUsersFn = null;
        let onSelectFn = null;
        let getQueryFn = null;
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

        function select(user) {
            if (!user) return;
            const input = activeInput;
            const onSelect = onSelectFn;
            hide();
            if (onSelect) onSelect(user, input);
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

        function queryFor(input) {
            return getQueryFn ? getQueryFn(input) : input.value;
        }

        function render(input) {
            if (!input || !getUsersFn) return;
            activeInput = input;

            const query = queryFor(input);

            if (hideOnEmptyQuery && !String(query || '').trim()) {
                hide();
                return;
            }

            visible = filterUsers(getUsersFn(), query).slice(0, maxResults);

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

        function attachInput(input, { getUsers, onSelect, getQuery, openOnEmptyArrowDown = true }) {
            input.addEventListener('focus', () => {
                getUsersFn = getUsers;
                onSelectFn = onSelect;
                getQueryFn = getQuery;
                render(input);
            });
            input.addEventListener('input', () => {
                getUsersFn = getUsers;
                onSelectFn = onSelect;
                getQueryFn = getQuery;
                render(input);
            });
            input.addEventListener('keydown', (event) => {
                if (activeInput !== input) return;

                if (panel.hidden) {
                    if (event.key === 'ArrowDown' && openOnEmptyArrowDown) {
                        event.preventDefault();
                        render(input);
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
                    const user = visible[activeIndex];
                    if (user) {
                        event.preventDefault();
                        select(user);
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

    // input が1つだけの単純なケース向けの簡易ラッパー。
    function attachSuggestField({ input, panel, containerSelector, getUsers, onSelect, escapeHtml, position, getQuery, hideOnEmptyQuery, maxResults }) {
        const picker = createPicker({
            panel,
            containerSelector,
            position,
            hideOnEmptyQuery,
            maxResults,
            renderList(panelEl, visibleUsers, activeIndex) {
                panelEl.innerHTML = visibleUsers
                    .map((user, index) => renderItemHtml(user, index, index === activeIndex, escapeHtml))
                    .join('');
            }
        });

        picker.attachInput(input, { getUsers, onSelect, getQuery });

        return picker;
    }

    global.UserSuggest = {
        filterUsers,
        findByUniqueId,
        renderItemHtml,
        createPicker,
        attachSuggestField
    };
})(window);
