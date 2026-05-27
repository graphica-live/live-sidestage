const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/visual',
    testMatch: '**/*.spec.js',
    snapshotDir: './tests/visual/__snapshots__',
    updateSnapshots: 'missing',

    use: {
        // フォントレンダリング差異を減らすため固定
        locale: 'ja-JP',
        timezoneId: 'Asia/Tokyo',
        // 外部フォント読み込みをスキップしてフォールバックで統一
        extraHTTPHeaders: {},
    },

    // スクリーンショット差分の閾値（グローバルデフォルト）
    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: 0.02,
            animations: 'disabled',
        },
    },

    webServer: {
        command: 'node tests/visual/mock-server.js',
        url: `http://localhost:${process.env.TEST_SERVER_PORT || 38199}/health`,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        timeout: 15000,
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
