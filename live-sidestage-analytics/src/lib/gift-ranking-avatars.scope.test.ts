import { describe, it, expect, vi, beforeEach } from "vitest";

const { giftFindMany, rollupFindMany, resolveAvatarUrlsMock } = vi.hoisted(() => ({
  giftFindMany: vi.fn(),
  rollupFindMany: vi.fn(),
  resolveAvatarUrlsMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    gift: { findMany: giftFindMany },
    giftDailyListenerStat: { findMany: rollupFindMany },
  },
}));
vi.mock("@/lib/avatar-storage", () => ({ resolveAvatarUrls: resolveAvatarUrlsMock }));
vi.mock("@/lib/tiktok-profile", () => ({
  sanitizeAvatarUrl: (url: string | null) => url,
}));

import { loadRankingAvatars } from "./gift-ranking-avatars";

describe("loadRankingAvatars room scope", () => {
  beforeEach(() => {
    giftFindMany.mockReset();
    rollupFindMany.mockReset();
    resolveAvatarUrlsMock.mockReset();
  });

  it("resolves URLs only for uids that exist in the requested room", async () => {
    giftFindMany.mockResolvedValue([{ tiktokUid: "uid-a" }]);
    rollupFindMany.mockResolvedValue([]);
    resolveAvatarUrlsMock.mockResolvedValue(
      new Map([
        ["uid-a", "https://a"],
        ["uid-b", "https://b"],
      ])
    );

    const rows = await loadRankingAvatars("room-a", ["uid-a", "uid-b"]);
    expect(resolveAvatarUrlsMock).toHaveBeenCalledWith(["uid-a"]);
    expect(rows).toEqual([{ tiktokUid: "uid-a", profileImageUrl: "https://a" }]);
  });
});
