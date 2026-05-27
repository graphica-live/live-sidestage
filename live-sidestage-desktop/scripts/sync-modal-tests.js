#!/usr/bin/env node
/**
 * admin.spec.js に未テストのモーダルを自動追加する。
 * 引数なし: git の staged HTML ファイルを対象
 * 引数あり: 指定ファイルを対象
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SPEC = path.join(ROOT, 'tests/visual/admin.spec.js');

function getStagedHtmlFiles() {
    try {
        const out = execSync('git diff --cached --name-only', { cwd: ROOT, encoding: 'utf8' });
        return out.trim().split('\n')
            .filter(f => f.match(/^backend\/public\/db\/.+\.html$/));
    } catch {
        return [];
    }
}

function getModalIds(htmlFile) {
    const content = fs.readFileSync(htmlFile, 'utf8');
    const ids = [];
    const re = /class="modal-shell"[^>]*id="([^"]+)"/g;
    const re2 = /id="([^"]+)"[^>]*class="[^"]*modal-shell[^"]*"/g;
    let m;
    while ((m = re.exec(content)) !== null) ids.push(m[1]);
    while ((m = re2.exec(content)) !== null) ids.push(m[1]);
    return [...new Set(ids)];
}

function getTestedModalIds(specContent) {
    const ids = [];
    // '#some-modal' パターンを検索
    const re = /'(#[^']+)'/g;
    let m;
    while ((m = re.exec(specContent)) !== null) {
        if (m[1].endsWith('-modal') || m[1].includes('-modal')) ids.push(m[1].slice(1));
    }
    return [...new Set(ids)];
}

function inferButtonId(modalId) {
    return modalId.replace(/-modal$/, '-button');
}

function inferPageGroup(htmlFile) {
    return path.basename(htmlFile, '.html');
}

function buildTestBlock(modalId, buttonId, pageFile) {
    return `
    test('${modalId}', async ({ page }) => {
        await page.click('#${buttonId}');
        await expect(page.locator('#${modalId}')).toHaveClass(/is-open/);
    });`;
}

function addMissingTests(htmlFilePath, specContent) {
    const absHtml = path.join(ROOT, htmlFilePath);
    if (!fs.existsSync(absHtml)) return specContent;

    const modalIds = getModalIds(absHtml);
    const testedIds = getTestedModalIds(specContent);
    const missing = modalIds.filter(id => !testedIds.includes(id));

    if (missing.length === 0) return specContent;

    const pageBase = inferPageGroup(htmlFilePath);
    const urlPath = `db/${path.basename(htmlFilePath)}`;

    const newBlocks = missing.map(id => buildTestBlock(id, inferButtonId(id), urlPath));

    // 既存の describe ブロック末尾に挿入を試みる
    const describePattern = new RegExp(
        `(test\\.describe\\(['"${pageBase.replace(/-/g, '[\\-]')}[^)]*\\).*?\\{)([\\s\\S]*?)(\\n\\}\\);)`,
        'g'
    );

    let inserted = false;
    let result = specContent.replace(describePattern, (match, open, body, close) => {
        inserted = true;
        return `${open}${body}${newBlocks.join('\n')}${close}`;
    });

    if (!inserted) {
        // 対応する describe がなければ末尾に新規ブロックを追加
        const waitFn = pageBase.includes('comments')
            ? `    await page.waitForLoadState('networkidle');`
            : `    await page.waitForLoadState('networkidle');`;

        const newDescribe = `
// ── ${pageBase}.html モーダル開閉テスト (自動生成) ──────────────────────────
test.describe('${pageBase}.html: モーダルが開ける', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(\`\${BASE_URL}/${urlPath}\`);
${waitFn}
    });
${newBlocks.join('\n')}
});
`;
        result = specContent + newDescribe;
    }

    console.log(`[sync-modal-tests] ${path.basename(htmlFilePath)}: 新規テスト追加 → ${missing.join(', ')}`);
    return result;
}

function main() {
    const targets = process.argv.slice(2).length > 0
        ? process.argv.slice(2)
        : getStagedHtmlFiles();

    if (targets.length === 0) {
        process.exit(0);
    }

    let specContent = fs.readFileSync(SPEC, 'utf8');
    let changed = false;

    for (const f of targets) {
        const next = addMissingTests(f, specContent);
        if (next !== specContent) {
            specContent = next;
            changed = true;
        }
    }

    if (changed) {
        fs.writeFileSync(SPEC, specContent, 'utf8');
        try {
            execSync('git add tests/visual/admin.spec.js', { cwd: ROOT });
        } catch { /* ignore */ }
        console.log('[sync-modal-tests] admin.spec.js を更新・ステージ済み');
    }
}

main();
