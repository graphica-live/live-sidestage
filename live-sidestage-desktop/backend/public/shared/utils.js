// 共通ユーティリティ関数
// 複数のウィジェット・管理画面ページから共有される汎用関数群。
// 新しいページに追加する場合は <script src="/shared/utils.js"></script> を読み込むこと。

/**
 * XSS 対策の HTML エスケープ。
 * null / undefined は空文字列として扱う。
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * テキストカラー設定を正規化する。
 * - 配列の場合: 空でない文字列要素のみ残して返す（グラデーション指定）
 * - 文字列の場合: trim して返す（単色指定）
 * - それ以外: '' を返す
 */
function normalizeTextPaint(value) {
    if (Array.isArray(value)) {
        return value.filter((item) => typeof item === 'string' && item.trim());
    }

    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * normalizeTextPaint した値からプレビュー用の代表色（文字列）を返す。
 * グラデーションの場合は先頭色、単色の場合はその色、空の場合は fallback を返す。
 */
function getTextPaintPreviewColor(value, fallback) {
    const normalizedValue = normalizeTextPaint(value);
    if (Array.isArray(normalizedValue)) {
        return normalizedValue[0] || fallback;
    }

    return normalizedValue || fallback;
}

/**
 * SVG 描画用の fill 値と linearGradient defs マークアップを生成する。
 * fill に複数色の配列が渡された場合は水平グラデーションを生成する。
 * prefix は linearGradient の id プレフィックスとして使用する。
 */
function buildSvgPaint(fill, prefix) {
    const normalizedFill = normalizeTextPaint(fill);
    if (Array.isArray(normalizedFill) && normalizedFill.length >= 2) {
        const gradientId = `${prefix}-gradient`;
        const stops = normalizedFill
            .map((color, index) => {
                const offset = normalizedFill.length === 1 ? 0 : (index / (normalizedFill.length - 1)) * 100;
                return `<stop offset="${offset}%" stop-color="${escapeHtml(color)}"></stop>`;
            })
            .join('');

        return {
            defs: `<defs><linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="0%">${stops}</linearGradient></defs>`,
            fill: `url(#${gradientId})`
        };
    }

    return {
        defs: '',
        fill: escapeHtml(normalizedFill || '#ffffff')
    };
}

/**
 * ドラッグ後の並び順（表示中の一部要素のみのID配列）を、元の全件配列に反映する。
 * 絞り込み表示中でも非表示要素の位置は変えず、表示中の要素だけを並べ替える。
 */
function reorderByVisibleIds(fullArray, visibleIdsNewOrder) {
    const byId = new Map(fullArray.map((item) => [item.id, item]));
    const visibleIdSet = new Set(visibleIdsNewOrder);
    const queue = [...visibleIdsNewOrder];
    return fullArray.map((item) => (visibleIdSet.has(item.id) ? byId.get(queue.shift()) : item));
}

/**
 * 三本線の drag-handle ボタン（[data-action="drag-handle"]）を掴んだときだけ
 * .record-card をドラッグ可能にし、並び替え後に applyNewOrder(orderedIds) を呼ぶ。
 */
function attachDragReorder(listEl, getRecordId, applyNewOrder) {
    let draggedCard = null;

    listEl.addEventListener('mousedown', (e) => {
        const handle = e.target.closest('[data-action="drag-handle"]');
        if (!handle) return;
        const card = handle.closest('.record-card');
        if (card) card.setAttribute('draggable', 'true');
    });

    listEl.addEventListener('mouseup', () => {
        listEl.querySelectorAll('.record-card[draggable="true"]').forEach((card) => {
            if (card !== draggedCard) card.removeAttribute('draggable');
        });
    });

    listEl.addEventListener('dragstart', (e) => {
        const card = e.target.closest('.record-card');
        if (!card || card.getAttribute('draggable') !== 'true') {
            e.preventDefault();
            return;
        }
        draggedCard = card;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', getRecordId(card) || '');
        requestAnimationFrame(() => card.classList.add('dragging'));
    });

    listEl.addEventListener('dragover', (e) => {
        if (!draggedCard) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const cards = Array.from(listEl.querySelectorAll('.record-card:not(.dragging)'));
        const target = cards.reduce((closest, card) => {
            const box = card.getBoundingClientRect();
            const offset = e.clientY - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: card };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;

        if (target) {
            listEl.insertBefore(draggedCard, target);
        } else {
            listEl.appendChild(draggedCard);
        }
    });

    listEl.addEventListener('dragend', () => {
        if (!draggedCard) return;
        draggedCard.classList.remove('dragging');
        draggedCard.removeAttribute('draggable');
        const orderedIds = Array.from(listEl.querySelectorAll('.record-card')).map(getRecordId);
        draggedCard = null;
        applyNewOrder(orderedIds);
    });
}

/**
 * data-outlined-svg-host 要素内の SVG テキストのサイズ・位置を確定させる。
 * CSS フォント適用後（DOMContentLoaded 以降）に呼ぶこと。
 */
function layoutOutlinedSvgText(container = document) {
    container.querySelectorAll('[data-outlined-svg-host]').forEach((host) => {
        const svg = host.querySelector('svg');
        const text = host.querySelector('[data-outlined-svg-text]');

        if (!svg || !text) {
            return;
        }

        text.setAttribute('font-family', getComputedStyle(host).fontFamily);

        let bounds;
        try {
            bounds = text.getBBox();
        } catch {
            return;
        }

        const strokeWidth = Number.parseFloat(host.dataset.strokeWidth || '0') || 0;
        const shadowPad = Number.parseFloat(host.dataset.shadowPad || '0') || 0;
        const horizontalPadding = Math.max(2, strokeWidth + shadowPad);
        const verticalPadding = Math.max(1, strokeWidth + Math.min(shadowPad, 2));
        const width = Math.max(1, bounds.width + horizontalPadding * 2);
        const height = Math.max(1, bounds.height + verticalPadding * 2);
        const fixedLayoutHeight = Number.parseFloat(host.dataset.layoutHeight || '0') || 0;
        const layoutHeight = Math.max(1, fixedLayoutHeight || bounds.height);

        svg.setAttribute('viewBox', `${bounds.x - horizontalPadding} ${bounds.y - verticalPadding} ${width} ${height}`);
        svg.setAttribute('width', `${width}`);
        svg.setAttribute('height', `${height}`);
        host.style.width = `${width}px`;
        host.style.height = `${layoutHeight}px`;
    });
}
