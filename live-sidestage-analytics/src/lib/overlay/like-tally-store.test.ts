import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  incrementLike,
  getTopEntries,
  resetRoomToday,
  __resetLikeTallyStoreForTest,
  __getEntryCountForTest,
} from "./like-tally-store";
import { makeTiktokUid } from "../__fixtures__/gift";

// jstDateKey() は Date.now() + 9h の JST日付。UTC 2026-09-05T00:00:00Z なら JST 2026-09-05。
const JST_DAY1 = new Date("2026-09-05T00:00:00.000Z");
const JST_DAY2 = new Date("2026-09-06T00:00:00.000Z");

// 集計キーは tiktokUid(不変の数値ID)。tiktokHandle は表示専用で同一性の判定に使わない。
const UID1 = makeTiktokUid("like_u1");
const UID2 = makeTiktokUid("like_u2");
const UID3 = makeTiktokUid("like_u3");

describe("like-tally-store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(JST_DAY1);
    __resetLikeTallyStoreForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TC-LT-001: 同一tiktokUidへの複数回incrementLikeで累計が積み上がる(ハンドル改名を跨いでも同一人物として積む)", () => {
    const r1 = incrementLike("room1", UID1, "u1", "太郎", null, 5);
    expect(r1).toEqual({ dayKey: "2026-09-05", previousTotal: 0, newTotal: 5 });

    // 同じ tiktokUid だがハンドルが変わったイベント。集計は割れない。
    const r2 = incrementLike("room1", UID1, "u1_renamed", "太郎", null, 3);
    expect(r2).toEqual({ dayKey: "2026-09-05", previousTotal: 5, newTotal: 8 });
    expect(getTopEntries("room1", 10)).toHaveLength(1);
  });

  it("TC-LT-001b(回帰): 同じ tiktokHandle でも tiktokUid が違えば別人として集計する", () => {
    incrementLike("room1", UID1, "same_handle", "A", null, 5);
    incrementLike("room1", UID2, "same_handle", "B", null, 7);

    const top = getTopEntries("room1", 10);
    expect(top).toHaveLength(2);
    expect(top.map((e) => e.tiktokUid)).toEqual([UID2, UID1]);
  });

  it("TC-LT-002: getTopEntriesはtotalLikes降順でmaxEntries件に絞る", () => {
    incrementLike("room1", UID1, "u1", "A", null, 10);
    incrementLike("room1", UID2, "u2", "B", null, 30);
    incrementLike("room1", UID3, "u3", "C", null, 20);

    const top2 = getTopEntries("room1", 2);
    expect(top2.map((e) => e.tiktokUid)).toEqual([UID2, UID3]);
    expect(top2.map((e) => e.tiktokHandle)).toEqual(["u2", "u3"]);

    const top10 = getTopEntries("room1", 10);
    expect(top10).toHaveLength(3);
  });

  it("TC-LT-003(negative): totalLikesが0以下のエントリはgetTopEntriesに出ない", () => {
    // likeCountが常に正の運用のため0以下は通常発生しないが、防御的フィルタを固定する。
    incrementLike("room1", UID1, "u1", "A", null, 0);
    incrementLike("room1", UID2, "u2", "B", null, -1);
    expect(getTopEntries("room1", 10)).toHaveLength(0);
  });

  it("TC-LT-004: roomIdが異なれば集計は独立する", () => {
    incrementLike("roomA", UID1, "u1", "A", null, 5);
    incrementLike("roomB", UID1, "u1", "A", null, 100);

    expect(getTopEntries("roomA", 10)[0].totalLikes).toBe(5);
    expect(getTopEntries("roomB", 10)[0].totalLikes).toBe(100);
  });

  it("TC-LT-005: resetRoomTodayは当日分のみ削除する", () => {
    incrementLike("room1", UID1, "u1", "A", null, 5);
    resetRoomToday("room1");
    expect(getTopEntries("room1", 10)).toHaveLength(0);

    // リセット後も新規incrementは通常どおり動く。
    const r = incrementLike("room1", UID1, "u1", "A", null, 2);
    expect(r).toEqual({ dayKey: "2026-09-05", previousTotal: 0, newTotal: 2 });
  });

  it("TC-LT-006(境界/回帰): 日付が変わるとpreviousTotalは0扱いになり、旧dayKeyのエントリは以後のアクセスでMapから物理的に削除される(メモリリーク対策)", () => {
    incrementLike("room1", UID1, "u1", "A", null, 5);
    incrementLike("room1", UID2, "u2", "B", null, 7); // u2はDAY2に再訪しない = 一度きりのリスナー想定
    expect(__getEntryCountForTest("room1")).toBe(2);

    vi.setSystemTime(JST_DAY2);

    // u1が翌日に再訪 → previousTotalは0から始まる(旧日の値を引き継がない)。
    const r = incrementLike("room1", UID1, "u1", "A", null, 1);
    expect(r).toEqual({ dayKey: "2026-09-06", previousTotal: 0, newTotal: 1 });

    // 二度と来ないu2はgetTopEntriesのフィルタで隠れるだけでなく、Mapの実体からも消えている
    // (フィルタだけに頼るとpruneループを削除してもテストが通ってしまうため、実体件数で確認する)。
    expect(__getEntryCountForTest("room1")).toBe(1);
    const top = getTopEntries("room1", 10);
    expect(top.map((e) => e.tiktokUid)).toEqual([UID1]);
  });

  it("TC-LT-007(異常/境界): tiktokHandle・nickname・profileImageUrlが空文字/nullのイベントは既存の良い値を上書きしない", () => {
    incrementLike("room1", UID1, "u1", "太郎", "https://example.com/a.png", 1);
    const r = incrementLike("room1", UID1, "", "", null, 1);
    expect(r.newTotal).toBe(2);

    const [entry] = getTopEntries("room1", 10);
    expect(entry.tiktokHandle).toBe("u1");
    expect(entry.nickname).toBe("太郎");
    expect(entry.profileImageUrl).toBe("https://example.com/a.png");
  });
});
