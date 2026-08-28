'use strict';

// Push/Pullウィジェットのギフト一致判定。
//
// TikTokのgift/listカタログには絵柄・価格が同じでもgiftIdだけ異なる重複ギフトが
// 多数存在する(例: giftId=5338/7237 は共に英語名"Unicorn Fantasy"・diamond_count=5000)。
// 配信者がPush/Pull設定で「実際には配信されない方のgiftId」を選んでいても、
// 名前+価格が一致すれば同一ギフトとして救済する必要がある。
//
// 名前一致を先に評価すると、push側とpull側で異なるgiftIdの同名ギフトを設定した場合に
// 誤ったsideへ加点してしまう(giftId完全一致を必ず名前一致より優先する)。

const { findPushPullMatch } = require('../../backend/lib/gift-jar-config-state');

function gift({ giftId, giftName, diamondCount, points }) {
    return { giftId, giftName, giftImage: '', diamondCount, points };
}

describe('findPushPullMatch', () => {
    test('giftId完全一致(push)', () => {
        const pushGifts = [gift({ giftId: '5338', giftName: 'Unicorn Fantasy', diamondCount: 5000, points: 10 })];
        const result = findPushPullMatch(pushGifts, [], { giftId: '5338', giftName: 'Unicorn Fantasy', diamondCount: 5000 });
        expect(result).toEqual({ side: 'push', gift: pushGifts[0] });
    });

    test('giftId完全一致(pull)', () => {
        const pullGifts = [gift({ giftId: '7237', giftName: 'Unicorn Fantasy', diamondCount: 5000, points: 20 })];
        const result = findPushPullMatch([], pullGifts, { giftId: '7237', giftName: 'Unicorn Fantasy', diamondCount: 5000 });
        expect(result).toEqual({ side: 'pull', gift: pullGifts[0] });
    });

    test('重複giftIdの相方が届いても名前+価格で救済される(push側に5338を登録、7237が届く)', () => {
        const pushGifts = [gift({ giftId: '5338', giftName: 'Unicorn Fantasy', diamondCount: 5000, points: 10 })];
        const result = findPushPullMatch(pushGifts, [], { giftId: '7237', giftName: 'Unicorn Fantasy', diamondCount: 5000 });
        expect(result).toEqual({ side: 'push', gift: pushGifts[0] });
    });

    test('重複giftIdの相方が届いても名前+価格で救済される(逆方向: pull側に7237を登録、5338が届く)', () => {
        const pullGifts = [gift({ giftId: '7237', giftName: 'Unicorn Fantasy', diamondCount: 5000, points: 20 })];
        const result = findPushPullMatch([], pullGifts, { giftId: '5338', giftName: 'Unicorn Fantasy', diamondCount: 5000 });
        expect(result).toEqual({ side: 'pull', gift: pullGifts[0] });
    });

    test('push側が名前一致してもpull側に完全ID一致があればpullを優先する(優先順位バグの再発防止)', () => {
        const pushGifts = [gift({ giftId: '5338', giftName: 'Unicorn Fantasy', diamondCount: 5000, points: 10 })];
        const pullGifts = [gift({ giftId: '7237', giftName: 'Unicorn Fantasy', diamondCount: 5000, points: 100 })];
        const result = findPushPullMatch(pushGifts, pullGifts, { giftId: '7237', giftName: 'Unicorn Fantasy', diamondCount: 5000 });
        expect(result).toEqual({ side: 'pull', gift: pullGifts[0] });
    });

    test('同一side内で複数候補がある場合、完全ID一致が名前一致より優先される', () => {
        const pushGifts = [
            gift({ giftId: '5338', giftName: 'Unicorn Fantasy', diamondCount: 5000, points: 10 }),
            gift({ giftId: '7237', giftName: 'Unicorn Fantasy', diamondCount: 5000, points: 999 }),
        ];
        const result = findPushPullMatch(pushGifts, [], { giftId: '7237', giftName: 'Unicorn Fantasy', diamondCount: 5000 });
        expect(result).toEqual({ side: 'push', gift: pushGifts[1] });
    });

    test('giftIdもgiftNameも一致しなければマッチしない', () => {
        const pushGifts = [gift({ giftId: '5338', giftName: 'Unicorn Fantasy', diamondCount: 5000, points: 10 })];
        const result = findPushPullMatch(pushGifts, [], { giftId: '9999', giftName: 'Rose', diamondCount: 1 });
        expect(result).toBeNull();
    });

    test('giftNameが空文字ならフォールバックしない', () => {
        const pushGifts = [gift({ giftId: '5338', giftName: '', diamondCount: 5000, points: 10 })];
        const result = findPushPullMatch(pushGifts, [], { giftId: '9999', giftName: '', diamondCount: 5000 });
        expect(result).toBeNull();
    });

    test('同名でも価格が異なるギフトは同一視しない(Freestyle 1コイン/1800コイン)', () => {
        const pushGifts = [gift({ giftId: '1111', giftName: 'Freestyle', diamondCount: 1, points: 5 })];
        const result = findPushPullMatch(pushGifts, [], { giftId: '2222', giftName: 'Freestyle', diamondCount: 1800 });
        expect(result).toBeNull();
    });

    test('diamondCountが未保存(0)の既存設定は名前フォールバックが働かない(後方互換)', () => {
        const pushGifts = [gift({ giftId: '5338', giftName: 'Unicorn Fantasy', diamondCount: 0, points: 10 })];
        const result = findPushPullMatch(pushGifts, [], { giftId: '7237', giftName: 'Unicorn Fantasy', diamondCount: 5000 });
        expect(result).toBeNull();
    });
});

describe('gift-jar-config-state factory', () => {
    test('factoryの戻り値にfindPushPullMatchが含まれる(配線ミスの再発防止)', () => {
        const factory = require('../../backend/lib/gift-jar-config-state');
        const mockDbStore = { getGlobalStateValue: () => null, setGlobalStateValue: () => {} };
        const state = factory({
            dbStore: mockDbStore,
            PUBLIC_DIRECTORY: __dirname,
            getPushPullWidgetTextAppearance: () => ({}),
        });
        expect(typeof state.findPushPullMatch).toBe('function');
    });
});
