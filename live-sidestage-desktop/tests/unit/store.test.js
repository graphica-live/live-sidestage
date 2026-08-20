const os = require('os');
const fs = require('fs');
const path = require('path');
const { createDbStore } = require('../../backend/lib/db/store');

const NOW = '2024-01-15T12:00:00.000Z';
const BROADCASTER = 'test_broadcaster';
const DAY_KEY = '2024-01-15';

let store;
let tmpDir;

beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-test-'));
    store = createDbStore({ appRoot: tmpDir, userDataDirectory: tmpDir });
});

afterAll(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    // 各テスト前にデータをリセット
    const db = require('better-sqlite3')(path.join(tmpDir, 'data', 'contributors.sqlite3'));
    db.exec('DELETE FROM daily_contributors; DELETE FROM display_state; DELETE FROM broadcaster_state; DELETE FROM raw_gift_events; DELETE FROM listener_name_overrides;');
    db.close();
});

// ─── Global State ────────────────────────────────────────────────────────────

describe('global state', () => {
    test('set and get', () => {
        store.setGlobalStateValue('theme', 'dark', NOW);
        expect(store.getGlobalStateValue('theme')).toBe('dark');
    });

    test('returns null for unknown key', () => {
        expect(store.getGlobalStateValue('nonexistent')).toBeNull();
    });

    test('overwrite updates value', () => {
        store.setGlobalStateValue('theme', 'dark', NOW);
        store.setGlobalStateValue('theme', 'light', NOW);
        expect(store.getGlobalStateValue('theme')).toBe('light');
    });
});

// ─── Broadcaster State ────────────────────────────────────────────────────────

describe('broadcaster state', () => {
    test('set and get', () => {
        store.setBroadcasterStateValue(BROADCASTER, 'volume', '80', NOW);
        expect(store.getBroadcasterStateValue(BROADCASTER, 'volume')).toBe('80');
    });

    test('returns null for unknown key', () => {
        expect(store.getBroadcasterStateValue(BROADCASTER, 'missing')).toBeNull();
    });

    test('isolated per broadcaster', () => {
        store.setBroadcasterStateValue('broadcaster_a', 'key', 'val_a', NOW);
        store.setBroadcasterStateValue('broadcaster_b', 'key', 'val_b', NOW);
        expect(store.getBroadcasterStateValue('broadcaster_a', 'key')).toBe('val_a');
        expect(store.getBroadcasterStateValue('broadcaster_b', 'key')).toBe('val_b');
    });
});

// ─── Raw Gift Events ──────────────────────────────────────────────────────────

function makeGiftEvent(overrides = {}) {
    return {
        dayKey: DAY_KEY,
        eventKey: `evt_${Date.now()}_${Math.random()}`,
        msgId: 'msg1',
        eventId: 'eid1',
        uniqueId: 'user123',
        nickname: 'テストユーザー',
        image: 'https://example.com/avatar.jpg',
        giftId: 'gift_rose',
        giftName: 'Rose',
        giftImage: 'https://example.com/rose.png',
        repeatCount: 1,
        totalGifts: 100,
        rawPayload: '{}',
        timestamp: NOW,
        ...overrides,
    };
}

describe('storeRawGiftEvent', () => {
    test('stores event and returns true', () => {
        const result = store.storeRawGiftEvent(BROADCASTER, makeGiftEvent());
        expect(result).toBe(true);
    });

    test('duplicate eventKey returns false (ON CONFLICT DO NOTHING)', () => {
        const event = makeGiftEvent({ eventKey: 'duplicate_key' });
        store.storeRawGiftEvent(BROADCASTER, event);
        const second = store.storeRawGiftEvent(BROADCASTER, event);
        expect(second).toBe(false);
    });
});

describe('getUnprocessedRawGiftEvents', () => {
    test('returns stored unprocessed events', () => {
        store.storeRawGiftEvent(BROADCASTER, makeGiftEvent({ eventKey: 'e1', uniqueId: 'u1' }));
        store.storeRawGiftEvent(BROADCASTER, makeGiftEvent({ eventKey: 'e2', uniqueId: 'u2' }));
        const events = store.getUnprocessedRawGiftEvents(BROADCASTER, 10);
        expect(events).toHaveLength(2);
    });

    test('respects batch limit', () => {
        for (let i = 0; i < 5; i++) {
            store.storeRawGiftEvent(BROADCASTER, makeGiftEvent({ eventKey: `batch_${i}` }));
        }
        const events = store.getUnprocessedRawGiftEvents(BROADCASTER, 3);
        expect(events).toHaveLength(3);
    });

    test('returns events in id ascending order', () => {
        store.storeRawGiftEvent(BROADCASTER, makeGiftEvent({ eventKey: 'ord1', uniqueId: 'ua' }));
        store.storeRawGiftEvent(BROADCASTER, makeGiftEvent({ eventKey: 'ord2', uniqueId: 'ub' }));
        const events = store.getUnprocessedRawGiftEvents(BROADCASTER, 10);
        expect(events[0].uniqueId).toBe('ua');
        expect(events[1].uniqueId).toBe('ub');
    });
});

// ─── processStoredGiftEvent ───────────────────────────────────────────────────

describe('processStoredGiftEvent', () => {
    test('upserts contributor and marks event processed', () => {
        const event = makeGiftEvent({ uniqueId: 'user_proc', totalGifts: 200 });
        store.storeRawGiftEvent(BROADCASTER, event);
        const [stored] = store.getUnprocessedRawGiftEvents(BROADCASTER, 1);

        const contributor = store.processStoredGiftEvent(stored, NOW, BROADCASTER);

        expect(contributor).not.toBeNull();
        expect(contributor.uniqueId).toBe('user_proc');
        expect(contributor.total).toBe(200);

        const remaining = store.getUnprocessedRawGiftEvents(BROADCASTER, 10);
        expect(remaining).toHaveLength(0);
    });

    test('accumulates coins on repeated gifts from same user', () => {
        const uid = 'user_accum';
        store.storeRawGiftEvent(BROADCASTER, makeGiftEvent({ eventKey: 'acc1', uniqueId: uid, totalGifts: 100 }));
        store.storeRawGiftEvent(BROADCASTER, makeGiftEvent({ eventKey: 'acc2', uniqueId: uid, totalGifts: 50 }));

        const [first, second] = store.getUnprocessedRawGiftEvents(BROADCASTER, 10);
        store.processStoredGiftEvent(first, NOW, BROADCASTER);
        const result = store.processStoredGiftEvent(second, NOW, BROADCASTER);

        expect(result.total).toBe(150);
    });
});

// ─── getContributorById ───────────────────────────────────────────────────────

describe('getContributorById', () => {
    test('returns null when not found', () => {
        expect(store.getContributorById(DAY_KEY, BROADCASTER, 'nobody')).toBeNull();
    });

    test('returns contributor after processing gift', () => {
        const event = makeGiftEvent({ uniqueId: 'user_find' });
        store.storeRawGiftEvent(BROADCASTER, event);
        const [stored] = store.getUnprocessedRawGiftEvents(BROADCASTER, 1);
        store.processStoredGiftEvent(stored, NOW, BROADCASTER);

        const contributor = store.getContributorById(DAY_KEY, BROADCASTER, 'user_find');
        expect(contributor).not.toBeNull();
        expect(contributor.nickname).toBe('テストユーザー');
    });
});

// ─── Listener Name Override ───────────────────────────────────────────────────

describe('listener name override', () => {
    test('overrides nickname in getContributorById', () => {
        const event = makeGiftEvent({ uniqueId: 'user_override', nickname: '元の名前' });
        store.storeRawGiftEvent(BROADCASTER, event);
        const [stored] = store.getUnprocessedRawGiftEvents(BROADCASTER, 1);
        store.processStoredGiftEvent(stored, NOW, BROADCASTER);

        store.upsertListenerNameOverride(BROADCASTER, 'user_override', '新しい名前', NOW);

        const contributor = store.getContributorById(DAY_KEY, BROADCASTER, 'user_override');
        expect(contributor.nickname).toBe('新しい名前');
    });
});

// ─── updateContributorTotal ───────────────────────────────────────────────────

describe('updateContributorTotal', () => {
    test('returns null for non-existent contributor', () => {
        const result = store.updateContributorTotal({
            dayKey: DAY_KEY,
            broadcasterId: BROADCASTER,
            uniqueId: 'nobody',
            totalCoins: 999,
            updatedAt: NOW,
        });
        expect(result).toBeNull();
    });

    test('updates total and returns updated contributor', () => {
        const event = makeGiftEvent({ uniqueId: 'user_upd', totalGifts: 100 });
        store.storeRawGiftEvent(BROADCASTER, event);
        const [stored] = store.getUnprocessedRawGiftEvents(BROADCASTER, 1);
        store.processStoredGiftEvent(stored, NOW, BROADCASTER);

        const result = store.updateContributorTotal({
            dayKey: DAY_KEY,
            broadcasterId: BROADCASTER,
            uniqueId: 'user_upd',
            totalCoins: 999,
            updatedAt: NOW,
        });
        expect(result.total).toBe(999);
    });
});

// ─── getAvailableDays ─────────────────────────────────────────────────────────

describe('getAvailableDays', () => {
    test('returns empty array when no data', () => {
        expect(store.getAvailableDays(BROADCASTER)).toEqual([]);
    });

    test('returns days after processing gifts', () => {
        const event = makeGiftEvent();
        store.storeRawGiftEvent(BROADCASTER, event);
        const [stored] = store.getUnprocessedRawGiftEvents(BROADCASTER, 1);
        store.processStoredGiftEvent(stored, NOW, BROADCASTER);

        const days = store.getAvailableDays(BROADCASTER);
        expect(days).toHaveLength(1);
        expect(days[0].dayKey).toBe(DAY_KEY);
    });
});

// ─── deleteContributor / deleteDay ────────────────────────────────────────────

describe('deleteContributor', () => {
    test('removes specific contributor', () => {
        const event = makeGiftEvent({ uniqueId: 'user_del' });
        store.storeRawGiftEvent(BROADCASTER, event);
        const [stored] = store.getUnprocessedRawGiftEvents(BROADCASTER, 1);
        store.processStoredGiftEvent(stored, NOW, BROADCASTER);

        const deleted = store.deleteContributor(DAY_KEY, BROADCASTER, 'user_del');
        expect(deleted).toBe(1);
        expect(store.getContributorById(DAY_KEY, BROADCASTER, 'user_del')).toBeNull();
    });
});

describe('deleteDay', () => {
    test('removes all contributors for a day', () => {
        store.storeRawGiftEvent(BROADCASTER, makeGiftEvent({ eventKey: 'd1', uniqueId: 'u1' }));
        store.storeRawGiftEvent(BROADCASTER, makeGiftEvent({ eventKey: 'd2', uniqueId: 'u2' }));
        const events = store.getUnprocessedRawGiftEvents(BROADCASTER, 10);
        events.forEach((e) => store.processStoredGiftEvent(e, NOW, BROADCASTER));

        const deleted = store.deleteDay(DAY_KEY, BROADCASTER);
        expect(deleted).toBe(2);
        expect(store.getAvailableDays(BROADCASTER)).toHaveLength(0);
    });
});
