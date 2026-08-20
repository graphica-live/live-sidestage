// shared/utils.js はブラウザ向けグローバル関数群なので require() できない。
// Node 環境で評価するため vm で読み込む。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(
    path.join(__dirname, '../../backend/public/shared/utils.js'),
    'utf8'
);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const { escapeHtml, normalizeTextPaint, getTextPaintPreviewColor } = ctx;

// ─── escapeHtml ───────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
    test('escapes < > & " \'', () => {
        expect(escapeHtml('<script>"it\'s"</script>&')).toBe(
            '&lt;script&gt;&quot;it&#39;s&quot;&lt;/script&gt;&amp;'
        );
    });

    test('null → empty string', () => {
        expect(escapeHtml(null)).toBe('');
    });

    test('undefined → empty string', () => {
        expect(escapeHtml(undefined)).toBe('');
    });

    test('plain text unchanged', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });

    test('numbers converted to string', () => {
        expect(escapeHtml(42)).toBe('42');
    });
});

// ─── normalizeTextPaint ───────────────────────────────────────────────────────

describe('normalizeTextPaint', () => {
    test('string: trims and returns', () => {
        expect(normalizeTextPaint('  #fff  ')).toBe('#fff');
    });

    test('empty string → empty string', () => {
        expect(normalizeTextPaint('')).toBe('');
    });

    test('array: filters empty strings', () => {
        expect(normalizeTextPaint(['#f00', '', '  ', '#00f'])).toEqual(['#f00', '#00f']);
    });

    test('array: all empty → empty array', () => {
        expect(normalizeTextPaint(['', '  '])).toEqual([]);
    });

    test('null → empty string', () => {
        expect(normalizeTextPaint(null)).toBe('');
    });

    test('number → empty string', () => {
        expect(normalizeTextPaint(123)).toBe('');
    });
});

// ─── getTextPaintPreviewColor ─────────────────────────────────────────────────

describe('getTextPaintPreviewColor', () => {
    test('single color string → returns it', () => {
        expect(getTextPaintPreviewColor('#ff0000', '#000')).toBe('#ff0000');
    });

    test('gradient array → returns first color', () => {
        expect(getTextPaintPreviewColor(['#f00', '#00f'], '#000')).toBe('#f00');
    });

    test('empty string → returns fallback', () => {
        expect(getTextPaintPreviewColor('', '#000')).toBe('#000');
    });

    test('empty array → returns fallback', () => {
        expect(getTextPaintPreviewColor([], '#000')).toBe('#000');
    });
});
