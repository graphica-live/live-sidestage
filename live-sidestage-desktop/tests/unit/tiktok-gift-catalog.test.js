'use strict';

// ギフトカタログの正規化と日本語表示名の索引。
//
// **ここで守っているのは「`name`(トリガの一致キー)は英語のまま」という不変条件。**
// LIVE のギフトイベントは WebSocket の protobuf 由来で英語固定なので、カタログを
// 日本語で取ったときに `name` まで日本語になると、effects-runtime の照合が通らず
// 例外もログも出ないままトリガが発火しなくなる（サイレント故障）。

const fs = require('fs');
const path = require('path');

const {
    normalizeGiftNameKey,
    normalizeTikTokGiftCatalog,
    buildNameJaIndex,
    initGiftCatalog,
    loadGiftCatalogIndex,
    getCatalogNameJa
} = require('../../backend/lib/tiktok-gift-catalog');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('normalizeGiftNameKey', () => {
    // 正規化は JS と Dart で別々に実装されている。ずれると同じギフトの表示が
    // 端末とデスクトップで食い違うので、ケースは共有資産から読む。
    const cases = JSON.parse(
        fs.readFileSync(
            path.join(REPO_ROOT, 'shared', 'gift-name-normalization', 'normalize-cases.json'),
            'utf8'
        )
    ).cases;

    test('共有テストベクタが読めている', () => {
        expect(cases.length).toBeGreaterThan(5);
    });

    test.each(cases)('$input -> $expected', ({ input, expected }) => {
        expect(normalizeGiftNameKey(input)).toBe(expected);
    });
});

describe('normalizeTikTokGiftCatalog', () => {
    const enGifts = [
        { id: 5655, name: 'Rose', diamond_count: 1 },
        { id: 5658, name: 'Perfume', diamond_count: 20 }
    ];

    test('name は英語版から作り、nameJa に日本語を入れる', () => {
        const jaNamesById = new Map([['5655', 'バラ'], ['5658', '香水']]);
        const gifts = normalizeTikTokGiftCatalog(enGifts, { jaNamesById });

        expect(gifts.map((gift) => [gift.id, gift.name, gift.nameJa])).toEqual([
            ['5655', 'Rose', 'バラ'],
            ['5658', 'Perfume', '香水']
        ]);
    });

    test('日本語版が取れなくても英語名でカタログを作る', () => {
        const gifts = normalizeTikTokGiftCatalog(enGifts, {});

        expect(gifts[0].name).toBe('Rose');
        // 日本語が無ければ表示も英語へ落とす（名前が消えるより良い）。
        expect(gifts[0].nameJa).toBe('Rose');
    });

    test('受信履歴にある名前を一致キーとして優先する', () => {
        // 実際に飛んでくる表記こそが chat:gift の giftName なので、カタログより確実。
        // 配信者ごとのサブスクギフトは TikTok 自身が日本語名で送ってくる。
        const observedGiftNamesById = new Map([
            ['29233', { giftId: '29233', giftName: 'わやハグ', giftImage: '' }]
        ]);
        const gifts = normalizeTikTokGiftCatalog(
            [{ id: 29233, name: 'Waya Hug', diamond_count: 1 }],
            { observedGiftNamesById }
        );

        expect(gifts[0].name).toBe('わやハグ');
        expect(gifts[0].nameJa).toBe('わやハグ');
    });

    test('日本語版カタログを英語版のつもりで渡しても name は混ざらない', () => {
        // 呼び出し側が取り違えたときに気づけるように、jaNamesById だけが日本語の供給元
        // であることを固定しておく。
        const gifts = normalizeTikTokGiftCatalog(enGifts, {
            jaNamesById: new Map([['5655', 'バラ']])
        });

        expect(gifts.every((gift) => /^[\x20-\x7E]+$/.test(gift.name))).toBe(true);
    });

    test('同じ giftId は先勝ちで畳み、コイン数の昇順に並べる', () => {
        const gifts = normalizeTikTokGiftCatalog([
            { id: 2, name: 'Bravo', diamond_count: 100 },
            { id: 1, name: 'Alpha', diamond_count: 1 },
            { id: 1, name: 'Alpha dup', diamond_count: 1 }
        ], {});

        expect(gifts.map((gift) => gift.id)).toEqual(['1', '2']);
    });

    test('配列でなければ空を返す', () => {
        expect(normalizeTikTokGiftCatalog(null, {})).toEqual([]);
        expect(normalizeTikTokGiftCatalog(undefined, {})).toEqual([]);
    });
});

describe('buildNameJaIndex', () => {
    test('正規化したキーで索引を作る', () => {
        const index = buildNameJaIndex([
            { name: 'Adam’s Dream', nameJa: 'アダムの夢' },
            { name: '  Rose  ', nameJa: 'バラ' }
        ]);

        // アポストロフィと空白の表記ゆれを吸収する。
        expect(index.get("adam's dream")).toBe('アダムの夢');
        expect(index.get('rose')).toBe('バラ');
    });

    test('日本語名が無い行は索引に入れない', () => {
        const index = buildNameJaIndex([
            { name: 'Rose', nameJa: '' },
            { name: 'Perfume' }
        ]);

        expect(index.size).toBe(0);
    });
});

describe('getCatalogNameJa', () => {
    beforeEach(() => {
        initGiftCatalog({
            dbStore: {
                getGiftCatalog: () => [
                    { giftId: '5655', name: 'Rose', nameJa: 'バラ' },
                    { giftId: '6064', name: 'GG', nameJa: 'GG' }
                ]
            },
            getBroadcasterId: () => 'someone',
            getConnectionOptions: () => ({})
        });
        loadGiftCatalogIndex('someone');
    });

    test('貯めたカタログから日本語名を引く', () => {
        expect(getCatalogNameJa('Rose')).toBe('バラ');
        expect(getCatalogNameJa('rose')).toBe('バラ');
        expect(getCatalogNameJa('  ROSE ')).toBe('バラ');
    });

    test('日本語環境でも英語のままのギフトはその表記を返す', () => {
        expect(getCatalogNameJa('GG')).toBe('GG');
    });

    test('カタログに無い名前はそのまま返す', () => {
        expect(getCatalogNameJa('Totally Unknown Gift')).toBe('Totally Unknown Gift');
    });

    test('空の入力では空文字を返す', () => {
        expect(getCatalogNameJa('')).toBe('');
        expect(getCatalogNameJa(null)).toBe('');
        expect(getCatalogNameJa(undefined)).toBe('');
    });

    test('DB が読めなくても例外にしない', () => {
        // 表示を良くするためだけの索引なので、読めなければ 0 件を返して黙って続ける。
        // **直前の索引はあえて捨てない**（読めなくなった瞬間に表示が英語へ戻るより、
        // 前に読めた日本語名を出し続ける方が良い）。
        initGiftCatalog({
            dbStore: {
                getGiftCatalog: () => {
                    throw new Error('db is gone');
                }
            },
            getBroadcasterId: () => 'someone',
            getConnectionOptions: () => ({})
        });

        expect(() => loadGiftCatalogIndex('someone')).not.toThrow();
        expect(loadGiftCatalogIndex('someone')).toBe(0);
    });

    test('broadcasterId が無ければ何もしない', () => {
        expect(loadGiftCatalogIndex('')).toBe(0);
        expect(loadGiftCatalogIndex(null)).toBe(0);
    });
});
