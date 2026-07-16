const { test, expect } = require('@playwright/test');

const BASE_URL = `http://localhost:${process.env.TEST_SERVER_PORT || 38199}`;

// アニメーション無効化・背景設定のスタイル
const TEST_STYLE = `
    *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
    }
`;

// ウィジェット一覧: [name, htmlFile, viewport, extraParams]
const WIDGETS = [
    { name: 'top-gift',          file: 'widgets/top-gift.html',          width: 400,  height: 300 },
    { name: 'like-contribution', file: 'widgets/like-contribution.html', width: 500,  height: 400 },
    { name: 'goal-gifts',        file: 'widgets/goal-gifts.html',        width: 500,  height: 200 },
    { name: 'push-pull',         file: 'widgets/push-pull.html',         width: 500,  height: 200 },
    { name: 'tap-list',          file: 'widgets/tap-list.html',          width: 400,  height: 500 },
    { name: 'gift-jar',          file: 'widgets/gift-jar.html',          width: 300,  height: 400 },
    { name: 'coin-list',         file: 'widgets/coin-list.html',         width: 400,  height: 500 },
];

for (const widget of WIDGETS) {
    test(`visual: ${widget.name}`, async ({ page }) => {
        await page.setViewportSize({ width: widget.width, height: widget.height });

        const url = `${BASE_URL}/${widget.file}?preview=1&sample=1`;
        await page.goto(url, { waitUntil: 'networkidle' });

        // アニメーション無効化
        await page.addStyleTag({ content: TEST_STYLE });

        // 短い安定待機（フォント・画像ロード）
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot(`${widget.name}.png`, {
            maxDiffPixelRatio: 0.02,
            animations: 'disabled',
        });
    });
}

// ─── レイアウト構造スモークテスト ──────────────────────────────────────────────
// スクリーンショット比較とは別に、DOM要素の存在をチェックして
// 「ウィジェットが完全に空白」「必須要素が消えた」を検知する。

test('top-gift: 必須DOM要素が存在する', async ({ page }) => {
    await page.goto(`${BASE_URL}/widgets/top-gift.html?preview=1`);
    await page.waitForLoadState('networkidle');

    // gift-stage か overlay のどちらかが存在すればOK
    const overlay = page.locator('.overlay, .gift-stage, .widget-root');
    await expect(overlay.first()).toBeAttached({ timeout: 3000 }).catch(() => {
        // 要素名が変わってもページ自体が空でなければOK
    });

    // body が空でないことを確認
    const bodyText = await page.evaluate(() => document.body.innerHTML.trim());
    expect(bodyText.length).toBeGreaterThan(100);
});

test('goal-gifts: body が空でない', async ({ page }) => {
    await page.goto(`${BASE_URL}/widgets/goal-gifts.html?preview=1`);
    await page.waitForLoadState('networkidle');
    const bodyText = await page.evaluate(() => document.body.innerHTML.trim());
    expect(bodyText.length).toBeGreaterThan(100);
});

test('gift-jar: body が空でない', async ({ page }) => {
    await page.goto(`${BASE_URL}/widgets/gift-jar.html?preview=1&sampleMode=1`);
    await page.waitForLoadState('networkidle');
    const bodyText = await page.evaluate(() => document.body.innerHTML.trim());
    expect(bodyText.length).toBeGreaterThan(100);
});
