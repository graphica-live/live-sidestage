const categoryList = document.getElementById('category-list');
const categoryTemplate = document.getElementById('category-template');
const addCategoryButton = document.getElementById('add-category-button');
const categoryModal = document.getElementById('category-modal');
const categoryModalTitle = document.getElementById('category-modal-title');
const categoryModalName = document.getElementById('category-modal-name');
const categoryModalSubmit = document.getElementById('category-modal-submit');

const DEFAULT_CATEGORY_ID = 'default';

let currentCategories = [];
let eventCountByCategory = {};
let triggerCountByCategory = {};
let editingCategoryId = null;

function openModal(modal) {
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeModal(modal) {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
}

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

async function loadCategories() {
    const [categoriesResponse, configResponse] = await Promise.all([
        fetch('/api/effects/categories'),
        fetch('/api/effects/config')
    ]);
    const categoriesPayload = await categoriesResponse.json();
    const configPayload = await configResponse.json();

    currentCategories = categoriesPayload.categories || [];

    eventCountByCategory = {};
    triggerCountByCategory = {};

    (configPayload.events || []).forEach((eventRecord) => {
        const categoryId = eventRecord.categoryId || DEFAULT_CATEGORY_ID;
        eventCountByCategory[categoryId] = (eventCountByCategory[categoryId] || 0) + 1;
    });

    (configPayload.triggers || []).forEach((triggerRecord) => {
        const categoryId = triggerRecord.categoryId || DEFAULT_CATEGORY_ID;
        triggerCountByCategory[categoryId] = (triggerCountByCategory[categoryId] || 0) + 1;
    });

    renderCategories();
}

function getOrphanCategories() {
    const knownIds = new Set(currentCategories.map((category) => category.id));
    const orphanIds = new Set([
        ...Object.keys(eventCountByCategory),
        ...Object.keys(triggerCountByCategory)
    ].filter((id) => !knownIds.has(id)));

    return [...orphanIds].map((id) => ({ id, name: '未分類', isOrphan: true }));
}

function renderCategories() {
    const displayCategories = [...currentCategories, ...getOrphanCategories()];

    if (!displayCategories.length) {
        categoryList.innerHTML = '<div class="empty">カテゴリはまだありません。上のボタンから追加してください。</div>';
        return;
    }

    categoryList.innerHTML = '';

    displayCategories.forEach((category) => {
        const fragment = categoryTemplate.content.cloneNode(true);
        const nameButton = fragment.querySelector('[data-role="name"]');
        const metaEl = fragment.querySelector('[data-role="meta"]');
        const eventCount = eventCountByCategory[category.id] || 0;
        const triggerCount = triggerCountByCategory[category.id] || 0;

        nameButton.textContent = category.name;
        metaEl.textContent = `イベント ${eventCount} / トリガー ${triggerCount}`;

        nameButton.addEventListener('click', () => {
            window.location.href = `/effects?category=${encodeURIComponent(category.id)}`;
        });

        const deleteButton = fragment.querySelector('[data-action="delete-category"]');
        const editButton = fragment.querySelector('[data-action="edit-category"]');

        if (category.isOrphan) {
            deleteButton.disabled = true;
            deleteButton.title = 'カテゴリが削除された未分類の項目です。開いて📁ボタンで別カテゴリへ移動してください。';
            editButton.disabled = true;
        } else {
            deleteButton.addEventListener('click', async () => {
                const confirmed = await showConfirm(
                    `「${category.name}」を削除してもよいですか？含まれるイベント・トリガーはカテゴリ未分類になります。`
                );
                if (!confirmed) return;

                try {
                    const response = await fetch(`/api/effects/categories/${encodeURIComponent(category.id)}`, {
                        method: 'DELETE'
                    });
                    const payload = await response.json();

                    if (!response.ok) {
                        throw new Error(payload.error || 'カテゴリの削除に失敗しました。');
                    }

                    await loadCategories();
                } catch (error) {
                    alert(error.message || 'カテゴリの削除に失敗しました。');
                }
            });
        }

        editButton.addEventListener('click', () => {
            if (category.isOrphan) return;
            openCategoryModalForEdit(category);
        });

        categoryList.appendChild(fragment);
    });
}

function resetCategoryModal() {
    editingCategoryId = null;
    categoryModalTitle.textContent = 'カテゴリを新規追加';
    categoryModalSubmit.textContent = '追加';
    categoryModalName.value = '';
    categoryModalName.setCustomValidity('');
}

function openCategoryModalForCreate() {
    resetCategoryModal();
    openModal(categoryModal);
    categoryModalName.focus();
}

function openCategoryModalForEdit(category) {
    editingCategoryId = category.id;
    categoryModalTitle.textContent = 'カテゴリを編集';
    categoryModalSubmit.textContent = '更新';
    categoryModalName.value = category.name;
    categoryModalName.setCustomValidity('');
    openModal(categoryModal);
    categoryModalName.focus();
}

addCategoryButton.addEventListener('click', () => {
    openCategoryModalForCreate();
});

categoryModalSubmit.addEventListener('click', async () => {
    const name = categoryModalName.value.trim();

    if (!name) {
        categoryModalName.setCustomValidity('カテゴリ名を入力してください。');
        categoryModalName.reportValidity();
        return;
    }

    categoryModalName.setCustomValidity('');

    try {
        const response = editingCategoryId
            ? await fetch(`/api/effects/categories/${encodeURIComponent(editingCategoryId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            })
            : await fetch('/api/effects/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'カテゴリの保存に失敗しました。');
        }

        closeModal(categoryModal);
        await loadCategories();
    } catch (error) {
        alert(error.message || 'カテゴリの保存に失敗しました。');
    }
});

document.querySelectorAll('[data-action="close-category-modal"]').forEach((button) => {
    button.addEventListener('click', () => closeModal(categoryModal));
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeModal(categoryModal);
    }
});

categoryModalName.addEventListener('input', () => {
    categoryModalName.setCustomValidity('');
});

loadCategories().catch((error) => {
    categoryList.innerHTML = `<div class="empty">${error.message || 'カテゴリの読み込みに失敗しました。'}</div>`;
});
