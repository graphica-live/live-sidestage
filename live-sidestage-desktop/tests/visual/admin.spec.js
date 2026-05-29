const { test, expect } = require('@playwright/test');

const BASE_URL = `http://localhost:${process.env.TEST_SERVER_PORT || 38199}`;

// comments.html が init() を完了したことを判定するセレクタ
// currentSettings がロードされると読み上げボタンのテキストが更新される
async function waitForCommentsReady(page) {
    await page.waitForLoadState('networkidle');
}

// ── comments.html モーダル開閉テスト ─────────────────────────────────────────
// モーダル内の要素を変更・削除した際に開けなくなるリグレッションを検知する。

test.describe('comments.html: モーダルが開ける', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(`${BASE_URL}/db/comments.html`);
        await waitForCommentsReady(page);
    });

    test('VOICE 設定モーダル', async ({ page }) => {
        await page.click('#comment-read-aloud-voice-button');
        await expect(page.locator('#comment-read-aloud-voice-modal')).toHaveClass(/is-open/);
    });

    test('ボイスマッピングモーダル', async ({ page }) => {
        await page.click('#comment-read-aloud-voice-mapping-button');
        await expect(page.locator('#comment-read-aloud-voice-mapping-modal')).toHaveClass(/is-open/);
    });

    test('読み上げフィルタモーダル', async ({ page }) => {
        await page.click('#comment-read-aloud-filter-button');
        await expect(page.locator('#comment-read-aloud-filter-modal')).toHaveClass(/is-open/);
    });

    test('読み上げ変換モーダル', async ({ page }) => {
        await page.click('#comment-read-aloud-text-replacement-button');
        await expect(page.locator('#comment-read-aloud-text-replacement-modal')).toHaveClass(/is-open/);
    });

    test('絵文字変換モーダル', async ({ page }) => {
        await page.click('#comment-read-aloud-emoji-button');
        await expect(page.locator('#comment-read-aloud-emoji-modal')).toHaveClass(/is-open/);
    });

    test('エモート変換モーダル', async ({ page }) => {
        await page.click('#comment-read-aloud-emote-button');
        await expect(page.locator('#comment-read-aloud-emote-modal')).toHaveClass(/is-open/);
    });
});

// ── comments.html ✕ ボタンでモーダルが閉じる ─────────────────────────────────

const MODAL_CONFIGS = [
    { name: 'VOICE 設定',         openBtn: '#comment-read-aloud-voice-button',            modal: '#comment-read-aloud-voice-modal',            closeBtn: '#comment-read-aloud-voice-close' },
    { name: 'ボイスマッピング',   openBtn: '#comment-read-aloud-voice-mapping-button',    modal: '#comment-read-aloud-voice-mapping-modal',    closeBtn: '#comment-read-aloud-voice-mapping-close' },
    { name: '読み上げフィルタ',   openBtn: '#comment-read-aloud-filter-button',           modal: '#comment-read-aloud-filter-modal',           closeBtn: '#comment-read-aloud-filter-close' },
    { name: '読み上げ変換',       openBtn: '#comment-read-aloud-text-replacement-button', modal: '#comment-read-aloud-text-replacement-modal', closeBtn: '#comment-read-aloud-text-replacement-close' },
    { name: '絵文字変換',         openBtn: '#comment-read-aloud-emoji-button',            modal: '#comment-read-aloud-emoji-modal',            closeBtn: '#comment-read-aloud-emoji-close' },
    { name: 'エモート変換',       openBtn: '#comment-read-aloud-emote-button',            modal: '#comment-read-aloud-emote-modal',            closeBtn: '#comment-read-aloud-emote-close' },
];

test.describe('comments.html: ✕ ボタンでモーダルが閉じる', () => {
    for (const cfg of MODAL_CONFIGS) {
        test(cfg.name, async ({ page }) => {
            await page.goto(`${BASE_URL}/db/comments.html`);
            await waitForCommentsReady(page);
            await page.click(cfg.openBtn);
            await expect(page.locator(cfg.modal)).toHaveClass(/is-open/);
            await page.click(cfg.closeBtn);
            await expect(page.locator(cfg.modal)).not.toHaveClass(/is-open/);
        });
    }
});

// ── comments.html モーダル外クリックで閉じない ────────────────────────────────

test.describe('comments.html: モーダル外クリックで閉じない', () => {
    for (const cfg of MODAL_CONFIGS) {
        test(cfg.name, async ({ page }) => {
            await page.goto(`${BASE_URL}/db/comments.html`);
            await waitForCommentsReady(page);
            await page.click(cfg.openBtn);
            await expect(page.locator(cfg.modal)).toHaveClass(/is-open/);
            await page.locator(cfg.modal).click({ position: { x: 5, y: 5 } });
            await expect(page.locator(cfg.modal)).toHaveClass(/is-open/);
        });
    }
});

// ── quick-access.html スモークテスト ─────────────────────────────────────────

test.describe('quick-access.html: 初期状態', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(`${BASE_URL}/db/quick-access.html`);
        await page.waitForLoadState('networkidle');
    });

    test('読み上げチェックボックスが ON になる', async ({ page }) => {
        await expect(page.locator('#read-aloud-checkbox')).toBeChecked();
    });

    test('ランダムボイス更新ボタンが有効（randomVoiceEnabled=true 時）', async ({ page }) => {
        await expect(page.locator('#reset-random-voice-button')).toBeEnabled();
    });
});

// ── effects.html モーダル開閉テスト (自動生成) ──────────────────────────
test.describe('effects.html: モーダルが開ける', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(`${BASE_URL}/db/effects.html`);
    await page.waitForLoadState('networkidle');
    });

    test('event-modal', async ({ page }) => {
        await page.click('#add-event-button');
        await expect(page.locator('#event-modal')).toHaveClass(/is-open/);
    });

    test('trigger-modal', async ({ page }) => {
        await page.click('#add-trigger-button');
        await expect(page.locator('#trigger-modal')).toHaveClass(/is-open/);
    });

    test('confirm-dialog', async ({ page }) => {
        await expect(page.locator('#confirm-dialog')).toHaveAttribute('aria-hidden', 'true');
    });
});
