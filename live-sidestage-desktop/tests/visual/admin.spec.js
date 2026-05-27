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

    test('表示設定モーダル', async ({ page }) => {
        await page.click('#comment-settings-button');
        await expect(page.locator('#comment-settings-modal')).toHaveClass(/is-open/);
    });

    test('読み上げ対象設定モーダル', async ({ page }) => {
        await page.click('#comment-read-aloud-settings-button');
        await expect(page.locator('#comment-read-aloud-settings-modal')).toHaveClass(/is-open/);
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

// ── comments.html VOICE モーダル: モーダル外クリックで閉じない ────────────────

test.describe('comments.html: VOICE モーダルはモーダル外クリックで閉じない', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(`${BASE_URL}/db/comments.html`);
        await waitForCommentsReady(page);
        await page.click('#comment-read-aloud-voice-button');
        await expect(page.locator('#comment-read-aloud-voice-modal')).toHaveClass(/is-open/);
    });

    test('モーダルシェル（背景）クリックで閉じない', async ({ page }) => {
        await page.locator('#comment-read-aloud-voice-modal').click({ position: { x: 5, y: 5 } });
        await expect(page.locator('#comment-read-aloud-voice-modal')).toHaveClass(/is-open/);
    });
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
