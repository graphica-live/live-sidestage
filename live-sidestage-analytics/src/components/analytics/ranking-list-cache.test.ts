import { describe, it, expect } from "vitest";
import {
  RANKING_AVATAR_BATCH,
  adjacentPrefetchDates,
  applyAvatarUrls,
  chunkUids,
  mergePreservedAvatars,
  missingAvatarUids,
  rankingCacheKey,
} from "./ranking-list-cache";

describe("rankingCacheKey", () => {
  it("includes apiBase so admin room switches do not collide", () => {
    expect(
      rankingCacheKey({
        apiBase: "/api/analytics",
        period: "day",
        currentDate: "2026-09-12",
        customStart: "a",
        customEnd: "b",
      })
    ).toBe("/api/analytics|day|2026-09-12");
    expect(
      rankingCacheKey({
        apiBase: "/api/admin/rooms/r1/analytics",
        period: "day",
        currentDate: "2026-09-12",
        customStart: "a",
        customEnd: "b",
      })
    ).toBe("/api/admin/rooms/r1/analytics|day|2026-09-12");
  });

  it("uses custom bounds", () => {
    expect(
      rankingCacheKey({
        apiBase: "/api/analytics",
        period: "custom",
        currentDate: "ignored",
        customStart: "s",
        customEnd: "e",
      })
    ).toBe("/api/analytics|custom|s|e");
  });
});

describe("chunkUids / avatars", () => {
  it("chunks at batch size", () => {
    const uids = Array.from({ length: RANKING_AVATAR_BATCH + 2 }, (_, i) => String(i));
    const chunks = chunkUids(uids);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(RANKING_AVATAR_BATCH);
    expect(chunks[1]).toEqual([String(RANKING_AVATAR_BATCH), String(RANKING_AVATAR_BATCH + 1)]);
  });

  it("merges previous avatar urls onto incoming rows", () => {
    const merged = mergePreservedAvatars(
      [{ tiktokUid: "1", profileImageUrl: "https://a" }],
      [
        { tiktokUid: "1", profileImageUrl: null },
        { tiktokUid: "2", profileImageUrl: null },
      ]
    );
    expect(merged[0].profileImageUrl).toBe("https://a");
    expect(merged[1].profileImageUrl).toBeNull();
  });

  it("applies avatar payload and lists missing uids", () => {
    const users = [
      { tiktokUid: "1", profileImageUrl: null },
      { tiktokUid: "2", profileImageUrl: null },
    ];
    const next = applyAvatarUrls(users, [{ tiktokUid: "1", profileImageUrl: "https://x" }]);
    expect(next[0].profileImageUrl).toBe("https://x");
    expect(missingAvatarUids(next)).toEqual(["2"]);
  });
});

describe("adjacentPrefetchDates", () => {
  const nav = (period: string, date: string, dir: -1 | 1) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dir);
    return d.toISOString().slice(0, 10);
  };

  it("skips custom and future-of-today", () => {
    expect(adjacentPrefetchDates("custom", "2026-09-12", "2026-09-13", nav)).toEqual([]);
    expect(adjacentPrefetchDates("day", "2026-09-13", "2026-09-13", nav)).toEqual(["2026-09-12"]);
    expect(adjacentPrefetchDates("day", "2026-09-12", "2026-09-13", nav).sort()).toEqual([
      "2026-09-11",
      "2026-09-13",
    ]);
  });
});
