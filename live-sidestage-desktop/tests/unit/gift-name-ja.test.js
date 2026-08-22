'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
    getGiftDisplayNameJa,
    setGiftDisplayNameJa,
    normalizeGiftNameKey,
    GIFT_NAME_JA_MAP
} = require('../../backend/lib/gift-name-ja');
const { GIFT_NAME_JA_REFERENCE_LIST } = require('../../backend/lib/gift-name-ja-reference-list');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SHARED_DIR = path.join(REPO_ROOT, 'shared', 'gift-names');
const SYNC_SCRIPT = path.join(SHARED_DIR, 'sync.mjs');

// 共通資産の正本と、各プロジェクトへ配られた生成コピー。
const MANAGED_FILES = [
    path.join(SHARED_DIR, 'gift-names-ja.json'),
    path.join(SHARED_DIR, 'gift-names-ja-reference.json'),
    path.join(REPO_ROOT, 'live-sidestage-desktop', 'backend', 'lib', 'gift-names', 'gift-names-ja.json'),
    path.join(REPO_ROOT, 'live-sidestage-desktop', 'backend', 'lib', 'gift-names', 'gift-names-ja-reference.json'),
    path.join(REPO_ROOT, 'live-sidestage-mobile', 'assets', 'gift_names', 'gift_names_ja.json')
];

function runSyncCheck() {
    execFileSync(process.execPath, [SYNC_SCRIPT, '--check'], { stdio: 'pipe' });
}

describe('gift-name-ja: 表示名の解決', () => {
    test('辞書に載っている英語名は日本語で返る', () => {
        expect(getGiftDisplayNameJa('Rose')).toBe('バラ');
    });

    test('未収録のギフトは渡された名前をそのまま返す', () => {
        expect(getGiftDisplayNameJa('Totally Unknown Gift')).toBe('Totally Unknown Gift');
    });

    test('空文字は空文字のまま', () => {
        expect(getGiftDisplayNameJa('')).toBe('');
        expect(getGiftDisplayNameJa(null)).toBe('');
    });

    test('日本語環境でも英語のままのギフトは正式表記で返る', () => {
        // 辞書から外して呼び出し元のフォールバックに任せると、元表記を持っていない
        // 呼び出し（小文字のキーしか無い古い設定など）で表示が劣化する。
        expect(getGiftDisplayNameJa('TikTok Universe+')).toBe('TikTok Universe+');
        expect(getGiftDisplayNameJa('tiktok universe+')).toBe('TikTok Universe+');
        expect(getGiftDisplayNameJa('gg')).toBe('GG');
    });

    test('小文字英語がそのまま値になっているエントリは無い', () => {
        // "coldy": "coldy" のような行。表示が劣化するので辞書から外し、
        // 呼び出し元が持つ元表記へフォールバックさせる。sync.mjs もこれを弾く。
        const echoed = Object.entries(GIFT_NAME_JA_MAP)
            .filter(([key, value]) => key === value)
            .map(([key]) => key);
        expect(echoed).toEqual([]);
    });
});

describe('gift-name-ja: キーの正規化', () => {
    // 正規化は JS と Dart で別々に実装されている。ずれると同じギフトの表示が
    // 端末とデスクトップで食い違うので、ケースは共有資産から読む。
    // live-sidestage-mobile/test/gift_name_ja_test.dart も同じファイルを読んでいる。
    const NORMALIZE_CASES = JSON.parse(
        fs.readFileSync(path.join(SHARED_DIR, 'normalize-cases.json'), 'utf8')
    ).cases;

    test('共有テストベクタが読めている', () => {
        expect(NORMALIZE_CASES.length).toBeGreaterThan(5);
    });

    test.each(NORMALIZE_CASES.map((c) => [c.input, c.expected]))('%j -> %j', (input, expected) => {
        expect(normalizeGiftNameKey(input)).toBe(expected);
    });

    test('アポストロフィの表記ゆれがあっても同じ対訳を引ける', () => {
        expect(getGiftDisplayNameJa('Adam’s Dream')).toBe('アダムの夢');
        expect(getGiftDisplayNameJa("Adam's Dream")).toBe('アダムの夢');
    });

    test('辞書のキーはすべて正規化済み', () => {
        const unnormalized = Object.keys(GIFT_NAME_JA_MAP).filter((key) => key !== normalizeGiftNameKey(key));
        expect(unnormalized).toEqual([]);
    });
});

describe('gift-name-ja: 参照リスト', () => {
    test('共通資産から読み込めている', () => {
        expect(GIFT_NAME_JA_REFERENCE_LIST.length).toBeGreaterThan(100);
        expect(GIFT_NAME_JA_REFERENCE_LIST.every((name) => typeof name === 'string' && name.trim())).toBe(true);
    });
});

describe('gift-name-ja: 共通資産との同期', () => {
    const backups = new Map();

    beforeAll(() => {
        for (const filePath of MANAGED_FILES) {
            backups.set(filePath, fs.readFileSync(filePath, 'utf8'));
        }
    });

    afterAll(() => {
        // 実ファイルを書き換えるテストなので、必ず元へ戻す。
        for (const [filePath, content] of backups) {
            fs.writeFileSync(filePath, content, 'utf8');
        }
    });

    test('正本と配布コピーは一致している', () => {
        expect(() => runSyncCheck()).not.toThrow();
    });

    test('対訳を保存すると正本・配布コピーの両方が sync と同じ整形で更新される', () => {
        const result = setGiftDisplayNameJa('Zzz Fixture Gift', 'テスト用ギフト');
        expect(result.ok).toBe(true);

        expect(getGiftDisplayNameJa('Zzz Fixture Gift')).toBe('テスト用ギフト');
        for (const filePath of MANAGED_FILES.filter((p) => p.includes('gift-names-ja.json') || p.includes('gift_names_ja.json'))) {
            const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            expect(doc.entries['zzz fixture gift']).toBe('テスト用ギフト');
        }

        // 整形が sync.mjs とずれていればここで落ちる。
        expect(() => runSyncCheck()).not.toThrow();
    }, 30000);

    test('英語の正式表記を保存すると、その表記のまま辞書に残る', () => {
        // 「日本語環境でも英語のまま」と確認できたギフト。小文字のキーしか持たない
        // 呼び出しからでも正しい表記を出せるよう、辞書に入れておく。
        const result = setGiftDisplayNameJa('Zzz Fixture Gift', 'Zzz Fixture Gift');
        expect(result.ok).toBe(true);

        const doc = JSON.parse(fs.readFileSync(MANAGED_FILES[0], 'utf8'));
        expect(doc.entries['zzz fixture gift']).toBe('Zzz Fixture Gift');
        expect(getGiftDisplayNameJa('zzz fixture gift')).toBe('Zzz Fixture Gift');

        expect(() => runSyncCheck()).not.toThrow();
    }, 30000);

    test('小文字英語そのものを保存するとエントリが消える', () => {
        setGiftDisplayNameJa('Zzz Fixture Gift', 'テスト用ギフト');
        const result = setGiftDisplayNameJa('Zzz Fixture Gift', 'zzz fixture gift');
        expect(result.ok).toBe(true);

        const doc = JSON.parse(fs.readFileSync(MANAGED_FILES[0], 'utf8'));
        expect(doc.entries['zzz fixture gift']).toBeUndefined();
        expect(getGiftDisplayNameJa('Zzz Fixture Gift')).toBe('Zzz Fixture Gift');

        expect(() => runSyncCheck()).not.toThrow();
    }, 30000);

    test('空文字を保存するとエントリが消える', () => {
        setGiftDisplayNameJa('Zzz Fixture Gift', 'テスト用ギフト');
        const result = setGiftDisplayNameJa('Zzz Fixture Gift', '');
        expect(result.ok).toBe(true);

        const doc = JSON.parse(fs.readFileSync(MANAGED_FILES[0], 'utf8'));
        expect(doc.entries['zzz fixture gift']).toBeUndefined();
        expect(getGiftDisplayNameJa('Zzz Fixture Gift')).toBe('Zzz Fixture Gift');

        expect(() => runSyncCheck()).not.toThrow();
    }, 30000);
});
