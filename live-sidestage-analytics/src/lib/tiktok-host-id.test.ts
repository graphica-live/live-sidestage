import { describe, it, expect, beforeEach } from "vitest";
import {
  BACKOFF_MS,
  backfillHostUserIds,
  clearHostIdBackoff,
  isBackedOff,
  nextRetryAt,
  type PendingRoom,
} from "./tiktok-host-id";
import type { TiktokProfileResult } from "./tiktok-profile";

function ok(userId: string | null): TiktokProfileResult {
  return { ok: true, profile: { avatarUrl: "https://p16.tiktokcdn.com/x.webp", nickname: null, userId } };
}

const NOT_FOUND: TiktokProfileResult = { ok: false, reason: "NOT_FOUND" };
const RATE_LIMITED: TiktokProfileResult = { ok: false, reason: "RATE_LIMITED" };

/** listPendingRooms のスタブ。hostUserId が入った room は返さない挙動を模す。 */
function pending(...tiktokIds: string[]) {
  const rooms: PendingRoom[] = tiktokIds.map((tiktokId, i) => ({ id: `room${i}`, tiktokId }));
  return async (ids: string[], limit: number) =>
    rooms.filter((r) => ids.includes(r.tiktokId)).slice(0, limit);
}

beforeEach(() => {
  clearHostIdBackoff();
});

describe("isBackedOff", () => {
  it("未記録は待たない", () => {
    expect(isBackedOff(undefined, 1000)).toBe(false);
  });

  it("期限が未来なら待つ、過ぎていれば待たない", () => {
    expect(isBackedOff(2000, 1000)).toBe(true);
    expect(isBackedOff(1000, 1000)).toBe(false);
  });
});

describe("nextRetryAt", () => {
  it("NOT_FOUND は長く、一時エラーは短く待つ", () => {
    expect(nextRetryAt("NOT_FOUND", 0)).toBe(BACKOFF_MS.NOT_FOUND);
    expect(nextRetryAt("RATE_LIMITED", 0)).toBe(BACKOFF_MS.RATE_LIMITED);
    expect(BACKOFF_MS.NOT_FOUND).toBeGreaterThan(BACKOFF_MS.ERROR);
  });
});

describe("backfillHostUserIds", () => {
  const deps = (over: Parameters<typeof backfillHostUserIds>[1] = {}) => ({
    sleep: async () => {},
    concurrency: 1,
    batchDelayMs: 0,
    ...over,
  });

  it("取得できた hostUserId を保存する", async () => {
    const saved: [string, string][] = [];
    const result = await backfillHostUserIds(
      ["aiko"],
      deps({
        listPendingRooms: pending("aiko"),
        fetchProfile: async () => ok("6745191554084586"),
        saveHostUserId: async (roomId, hostUserId) => {
          saved.push([roomId, hostUserId]);
        },
      })
    );

    expect(saved).toEqual([["room0", "6745191554084586"]]);
    expect(result.filled).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("hostUserId が既にある room は listPendingRooms が返さないので引かない", async () => {
    let fetched = 0;
    const result = await backfillHostUserIds(
      ["aiko"],
      deps({
        // 埋まっている想定で空を返す。
        listPendingRooms: async () => [],
        fetchProfile: async () => {
          fetched++;
          return ok("111");
        },
        saveHostUserId: async () => {},
      })
    );

    expect(fetched).toBe(0);
    expect(result.filled).toBe(0);
  });

  it("実在するが id が取れなければ保存しない", async () => {
    let saves = 0;
    const result = await backfillHostUserIds(
      ["aiko"],
      deps({
        listPendingRooms: pending("aiko"),
        fetchProfile: async () => ok(null),
        saveHostUserId: async () => {
          saves++;
        },
      })
    );

    expect(saves).toBe(0);
    expect(result.failed).toBe(1);
  });

  it("失敗した room は次の周でバックオフ中として飛ばす", async () => {
    let now = 0;
    const shared = deps({
      listPendingRooms: pending("aiko"),
      fetchProfile: async () => NOT_FOUND,
      saveHostUserId: async () => {},
      now: () => now,
    });

    const first = await backfillHostUserIds(["aiko"], shared);
    expect(first.failed).toBe(1);

    const second = await backfillHostUserIds(["aiko"], shared);
    expect(second.skipped).toBe(1);
    expect(second.failed).toBe(0);

    // バックオフが明けたら引き直す。
    now = BACKOFF_MS.NOT_FOUND + 1;
    const third = await backfillHostUserIds(["aiko"], shared);
    expect(third.skipped).toBe(0);
    expect(third.failed).toBe(1);
  });

  it("1周の件数上限を超えて引かない", async () => {
    let fetched = 0;
    await backfillHostUserIds(
      ["a", "b", "c", "d"],
      deps({
        listPendingRooms: pending("a", "b", "c", "d"),
        fetchProfile: async () => {
          fetched++;
          return ok("111");
        },
        saveHostUserId: async () => {},
        maxPerRun: 2,
      })
    );

    expect(fetched).toBe(2);
  });

  it("連続失敗が閾値に達したらその周を打ち切る", async () => {
    let fetched = 0;
    const result = await backfillHostUserIds(
      ["a", "b", "c", "d", "e"],
      deps({
        listPendingRooms: pending("a", "b", "c", "d", "e"),
        fetchProfile: async () => {
          fetched++;
          return RATE_LIMITED;
        },
        saveHostUserId: async () => {},
        circuitThreshold: 2,
      })
    );

    expect(result.aborted).toBe(true);
    expect(fetched).toBe(2);
  });

  it("保存中の例外で周全体を落とさない", async () => {
    const result = await backfillHostUserIds(
      ["aiko"],
      deps({
        listPendingRooms: pending("aiko"),
        fetchProfile: async () => ok("111"),
        saveHostUserId: async () => {
          throw new Error("boom");
        },
      })
    );

    expect(result.failed).toBe(1);
    expect(result.filled).toBe(0);
  });

  it("間隔を無効化(maxPerRun=0)したら何もしない", async () => {
    let listed = 0;
    const result = await backfillHostUserIds(
      ["aiko"],
      deps({
        listPendingRooms: async () => {
          listed++;
          return [];
        },
        maxPerRun: 0,
      })
    );

    expect(listed).toBe(0);
    expect(result.filled).toBe(0);
  });
});
