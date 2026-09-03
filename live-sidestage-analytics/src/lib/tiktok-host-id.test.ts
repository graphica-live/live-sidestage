import { describe, it, expect, beforeEach } from "vitest";
import {
  BACKOFF_MS,
  backfillHostUserIds,
  backfillStreamerRoomHostIds,
  clearHostIdBackoff,
  isBackedOff,
  nextRetryAt,
  type PendingRoom,
} from "./tiktok-host-id";
import type { TiktokProfileResult } from "./tiktok-profile";

function ok(userId: string | null): TiktokProfileResult {
  return { ok: true, profile: { avatarUrl: "https://p16.tiktokcdn.com/x.webp", nickname: null, userId } };
}

/** TikTok が user_not_found を明示した(= 恒久的に諦めてよい)。 */
const NOT_FOUND_EXPLICIT: TiktokProfileResult = {
  ok: false,
  reason: "NOT_FOUND",
  explicitNotFound: true,
};
/** 非 0 statusCode だが user_not_found の明示がない(bot 判定・一時異常など)。 */
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
    // 既定実装は prisma を触るので、DB 不要の unit では必ず差し替える。
    markAttempt: async () => {},
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

  it("user_not_found が明示されたときだけ「恒久的に諦めた」として記録する", async () => {
    const attempts: [string, boolean][] = [];
    await backfillHostUserIds(
      ["aiko"],
      deps({
        listPendingRooms: pending("aiko"),
        fetchProfile: async () => NOT_FOUND_EXPLICIT,
        saveHostUserId: async () => {},
        markAttempt: async (roomId, gaveUp) => {
          attempts.push([roomId, gaveUp]);
        },
      })
    );

    expect(attempts).toEqual([["room0", true]]);
  });

  // **回帰固定。** reason は非 0 statusCode をまとめた粗い値で bot 判定も混ざる。
  // これで恒久的に諦めると、TikTok の一時異常の間に引いた room が二度と補完できなくなり、
  // 「材料が手遅れになる前に集める」という本ジョブの目的を自壊させる。
  it("明示のない NOT_FOUND では諦めない(bot 判定・一時異常が混ざるため)", async () => {
    const attempts: [string, boolean][] = [];
    await backfillHostUserIds(
      ["aiko"],
      deps({
        listPendingRooms: pending("aiko"),
        fetchProfile: async () => NOT_FOUND,
        saveHostUserId: async () => {},
        markAttempt: async (roomId, gaveUp) => {
          attempts.push([roomId, gaveUp]);
        },
      })
    );

    expect(attempts).toEqual([["room0", false]]);
  });

  it("レート制限では諦めない(一時的な失敗なので再試行の余地を残す)", async () => {
    const attempts: [string, boolean][] = [];
    await backfillHostUserIds(
      ["aiko"],
      deps({
        listPendingRooms: pending("aiko"),
        fetchProfile: async () => RATE_LIMITED,
        saveHostUserId: async () => {},
        markAttempt: async (roomId, gaveUp) => {
          attempts.push([roomId, gaveUp]);
        },
      })
    );

    expect(attempts).toEqual([["room0", false]]);
  });

  it("試行の記録に失敗しても周を落とさない", async () => {
    const result = await backfillHostUserIds(
      ["aiko"],
      deps({
        listPendingRooms: pending("aiko"),
        fetchProfile: async () => NOT_FOUND,
        saveHostUserId: async () => {},
        markAttempt: async () => {
          throw new Error("boom");
        },
      })
    );

    expect(result.failed).toBe(1);
    expect(result.aborted).toBe(false);
  });
});

describe("backfillStreamerRoomHostIds", () => {
  const deps = (over: Parameters<typeof backfillStreamerRoomHostIds>[0] = {}) => ({
    sleep: async () => {},
    concurrency: 1,
    batchDelayMs: 0,
    markAttempt: async () => {},
    saveHostUserId: async () => {},
    ...over,
  });

  /** listStreamerRooms のスタブ。DB 側の並び替えは呼び出し順で表現する。 */
  function rooms(...tiktokIds: string[]) {
    const list: PendingRoom[] = tiktokIds.map((tiktokId, i) => ({ id: `room${i}`, tiktokId }));
    return async (limit: number) => list.slice(0, limit);
  }

  it("hostUserId を保存する", async () => {
    const saved: [string, string][] = [];
    const result = await backfillStreamerRoomHostIds(
      deps({
        listStreamerRooms: rooms("aiko"),
        fetchProfile: async () => ok("6745191554084586"),
        saveHostUserId: async (roomId, hostUserId) => {
          saved.push([roomId, hostUserId]);
        },
      })
    );

    expect(saved).toEqual([["room0", "6745191554084586"]]);
    expect(result.filled).toBe(1);
  });

  it("候補は maxPerRun より多めに引く(バックオフ中で枠が潰れないように)", async () => {
    let requested = 0;
    await backfillStreamerRoomHostIds(
      deps({
        listStreamerRooms: async (limit) => {
          requested = limit;
          return [];
        },
        maxPerRun: 5,
      })
    );

    expect(requested).toBeGreaterThan(5);
  });

  // 先頭詰まりの回帰固定。**take してから絞る実装だと、この期待は満たせない。**
  // 先頭がバックオフ中の room で埋まった周は処理0件になり、後続へ永久に到達しなくなる。
  it("先頭の候補がバックオフ中でも、後続の room を処理する", async () => {
    const shared = deps({
      listStreamerRooms: rooms("dead1", "dead2", "alive"),
      // dead* は NOT_FOUND、alive だけ引ける。
      fetchProfile: async (tiktokId: string) =>
        tiktokId === "alive" ? ok("999") : NOT_FOUND,
      maxPerRun: 2,
      // 諦めた room を候補から外す DB 側の挙動は使わず、
      // プロセス内バックオフだけで後続へ到達できることを確かめる。
      circuitThreshold: 99,
    });

    const first = await backfillStreamerRoomHostIds(shared);
    // 1周目は先頭2件(dead1, dead2)を引いて両方失敗する。
    expect(first.filled).toBe(0);
    expect(first.failed).toBe(2);

    const second = await backfillStreamerRoomHostIds(shared);
    // 2周目は dead1/dead2 がバックオフ中でも alive まで到達する。
    expect(second.skipped).toBe(2);
    expect(second.filled).toBe(1);
  });

  it("maxPerRun=0 なら候補を引きにも行かない", async () => {
    let listed = 0;
    await backfillStreamerRoomHostIds(
      deps({
        listStreamerRooms: async () => {
          listed++;
          return [];
        },
        maxPerRun: 0,
      })
    );

    expect(listed).toBe(0);
  });
});
