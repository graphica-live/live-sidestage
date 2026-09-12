import { describe, it, expect, vi, beforeEach } from "vitest";

const { findFirstMock, createMock, findUniqueTokenMock, findUniqueRoomMock, queryGiftsMock, resolveTikTokUserDisplayMock, resolveAvatarUrlsMock } =
  vi.hoisted(() => ({
    findFirstMock: vi.fn(),
    createMock: vi.fn(),
    findUniqueTokenMock: vi.fn(),
    findUniqueRoomMock: vi.fn(),
    queryGiftsMock: vi.fn(),
    resolveTikTokUserDisplayMock: vi.fn(),
    resolveAvatarUrlsMock: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contributionShareToken: { findFirst: findFirstMock, create: createMock, findUnique: findUniqueTokenMock },
    tiktokRoom: { findUnique: findUniqueRoomMock },
  },
}));
vi.mock("@/lib/gift-analytics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gift-analytics")>("@/lib/gift-analytics");
  return { ...actual, queryGifts: queryGiftsMock };
});
vi.mock("@/lib/tiktok-user", () => ({ resolveTikTokUserDisplay: resolveTikTokUserDisplayMock }));
vi.mock("@/lib/avatar-storage", () => ({ resolveAvatarUrls: resolveAvatarUrlsMock }));

import {
  buildRangeKey,
  validateShareRequestBody,
  ensureContributionShareToken,
  queryContributionRankingByShareToken,
  formatContributionShareRangeLabel,
} from "./contribution-share";

describe("buildRangeKey", () => {
  it("period+dateはUTC日付のみへ正規化する", () => {
    expect(buildRangeKey("day", "2026-09-01", null, null)).toBe("day|2026-09-01");
  });

  it("customはstart/endをUTC ISO 8601(Z終端)へ正規化する", () => {
    const key = buildRangeKey("custom", null, "2026-09-01T00:00:00+09:00", "2026-09-02T00:00:00+09:00");
    expect(key).toBe("custom|2026-08-31T15:00:00.000Z|2026-09-01T15:00:00.000Z");
  });

  it("同じ時刻を異なるオフセット表記で渡しても同じキーになる(冪等性の要)", () => {
    const a = buildRangeKey("custom", null, "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z");
    const b = buildRangeKey("custom", null, "2026-09-01T09:00:00+09:00", "2026-09-02T09:00:00+09:00");
    expect(a).toBe(b);
  });

  it("customなのにstart/endが無ければ例外", () => {
    expect(() => buildRangeKey("custom", null, null, null)).toThrow();
  });

  it("非customなのにdateが無ければ例外", () => {
    expect(() => buildRangeKey("day", null, null, null)).toThrow();
  });
});

describe("validateShareRequestBody", () => {
  it("period列挙値以外は拒否", () => {
    const result = validateShareRequestBody({ period: "century", date: "2026-09-01" });
    expect(result.ok).toBe(false);
  });

  it("非custom periodはdateが不正なら拒否", () => {
    const result = validateShareRequestBody({ period: "day", date: "2026-02-30" });
    expect(result.ok).toBe(false);
  });

  it("非custom periodの正常系", () => {
    const result = validateShareRequestBody({ period: "week", date: "2026-09-01" });
    expect(result).toEqual({
      ok: true,
      value: { period: "week", date: "2026-09-01", startDatetime: null, endDatetime: null },
    });
  });

  it("customでstartDatetime/endDatetime欠落は拒否", () => {
    const result = validateShareRequestBody({ period: "custom" });
    expect(result.ok).toBe(false);
  });

  it("customでstart>=endは拒否", () => {
    const result = validateShareRequestBody({
      period: "custom",
      startDatetime: "2026-09-02T00:00:00Z",
      endDatetime: "2026-09-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
  });

  it("customで366日を超える期間は拒否", () => {
    const result = validateShareRequestBody({
      period: "custom",
      startDatetime: "2020-01-01T00:00:00Z",
      endDatetime: "2026-09-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
  });

  it("customで過去1年より前のstartDatetimeは拒否", () => {
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString();
    const oneYearNineMonthsAgo = new Date(Date.now() - 640 * 86_400_000).toISOString();
    const result = validateShareRequestBody({
      period: "custom",
      startDatetime: twoYearsAgo,
      endDatetime: oneYearNineMonthsAgo,
    });
    expect(result.ok).toBe(false);
  });

  it("customの正常系", () => {
    const result = validateShareRequestBody({
      period: "custom",
      startDatetime: "2026-09-01T00:00:00Z",
      endDatetime: "2026-09-02T00:00:00Z",
    });
    expect(result.ok).toBe(true);
  });
});

describe("ensureContributionShareToken", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    createMock.mockReset();
  });

  it("既存トークンがあればそれを返す(再発行しない)", async () => {
    findFirstMock.mockResolvedValue({ token: "existing" });

    const token = await ensureContributionShareToken("room1", {
      period: "day",
      date: "2026-09-01",
      startDatetime: null,
      endDatetime: null,
    });

    expect(token).toBe("existing");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("無ければ新規発行する", async () => {
    findFirstMock.mockResolvedValue(null);
    createMock.mockResolvedValue({ token: "new-token" });

    const token = await ensureContributionShareToken("room1", {
      period: "day",
      date: "2026-09-01",
      startDatetime: null,
      endDatetime: null,
    });

    expect(token).toBe("new-token");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roomId: "room1", period: "day", date: "2026-09-01", rangeKey: "day|2026-09-01" }),
      })
    );
  });

  it("P2002競合時は再findFirstで既存トークンを吸収する", async () => {
    findFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ token: "race-winner" });
    const { Prisma } = await import("@prisma/client");
    createMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
      })
    );

    const token = await ensureContributionShareToken("room1", {
      period: "day",
      date: "2026-09-01",
      startDatetime: null,
      endDatetime: null,
    });

    expect(token).toBe("race-winner");
    expect(findFirstMock).toHaveBeenCalledTimes(2);
  });
});

describe("queryContributionRankingByShareToken", () => {
  beforeEach(() => {
    findUniqueTokenMock.mockReset();
    findUniqueRoomMock.mockReset();
    queryGiftsMock.mockReset();
    resolveTikTokUserDisplayMock.mockReset();
    resolveAvatarUrlsMock.mockReset();
  });

  it("トークン不在はok:falseのみ(理由を持たない)", async () => {
    findUniqueTokenMock.mockResolvedValue(null);

    const result = await queryContributionRankingByShareToken("missing");

    expect(result).toEqual({ ok: false });
  });

  it("公開payloadはverifiedを含まない(tiktokUid/tiktokHandleは公開する)", async () => {
    findUniqueTokenMock.mockResolvedValue({
      roomId: "room1",
      period: "day",
      date: "2026-09-01",
      startDatetime: null,
      endDatetime: null,
    });
    queryGiftsMock.mockResolvedValue({
      users: [
        {
          tiktokUid: "secret-uid",
          tiktokHandle: "secret-handle",
          nickname: "リスナーA",
          profileImageUrl: "https://example.com/a.png",
          giftCount: 3,
          totalDiamonds: 999,
          lastGiftAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      total: { giftCount: 3, totalDiamonds: 999 },
    });
    findUniqueRoomMock.mockResolvedValue({ hostTiktokUid: "host-uid" });
    resolveTikTokUserDisplayMock.mockResolvedValue(new Map([["host-uid", { nickname: "配信者A", tiktokHandle: "hostHandle" }]]));
    resolveAvatarUrlsMock.mockResolvedValue(new Map([["host-uid", "https://example.com/host.png"]]));

    const result = await queryContributionRankingByShareToken("t");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.payload.users).toEqual([
      {
        tiktokUid: "secret-uid",
        tiktokHandle: "secret-handle",
        nickname: "リスナーA",
        profileImageUrl: "https://example.com/a.png",
        giftCount: 3,
        totalDiamonds: 999,
        lastGiftAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
    for (const user of result.payload.users) {
      expect(user).not.toHaveProperty("verified");
    }
    expect(result.payload.streamer).toEqual({ nickname: "配信者A", profileImageUrl: "https://example.com/host.png" });
    // streamer側にはtiktokHandle/tiktokUidを含めない(配信者情報は表示名・アイコンのみ)。
    expect(result.payload.streamer).not.toHaveProperty("tiktokHandle");
    expect(result.payload.streamer).not.toHaveProperty("tiktokUid");
  });

  it("custom rangeはreceivedAtでqueryGiftsへ渡す(dayKeyへ素通ししない)", async () => {
    findUniqueTokenMock.mockResolvedValue({
      roomId: "room1",
      period: "custom",
      date: null,
      startDatetime: new Date("2026-09-01T00:00:00.000Z"),
      endDatetime: new Date("2026-09-02T00:00:00.000Z"),
    });
    queryGiftsMock.mockResolvedValue({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
    findUniqueRoomMock.mockResolvedValue(null);

    await queryContributionRankingByShareToken("t");

    expect(queryGiftsMock).toHaveBeenCalledWith(
      "room1",
      "room1",
      { receivedAt: { gte: new Date("2026-09-01T00:00:00.000Z"), lte: new Date("2026-09-02T00:00:00.000Z") } }
    );
  });

  it("custom rangeが90日保持期間より古い場合はreceivedAt境界をUTC日境界へ丸めてqueryGiftsへ渡す(dateRange表示は元の値を保つ)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
    try {
      findUniqueTokenMock.mockResolvedValue({
        roomId: "room1",
        period: "custom",
        date: null,
        // 2026-09-11から見て90日超前(2026-06-01T15:00Z 〜 2026-06-02T09:00Z)
        startDatetime: new Date("2026-06-01T15:00:00.000Z"),
        endDatetime: new Date("2026-06-02T09:00:00.000Z"),
      });
      queryGiftsMock.mockResolvedValue({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
      findUniqueRoomMock.mockResolvedValue(null);

      const result = await queryContributionRankingByShareToken("t");

      expect(queryGiftsMock).toHaveBeenCalledWith(
        "room1",
        "room1",
        {
          receivedAt: {
            gte: new Date("2026-06-01T00:00:00.000Z"),
            lte: new Date("2026-06-02T23:59:59.999Z"),
          },
        }
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.payload.dateRange).toEqual({
          start: "2026-06-01T15:00:00.000Z",
          end: "2026-06-02T09:00:00.000Z",
        });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("custom rangeでstartのみ90日より古い場合はqueryStartだけ日境界に丸める(endは保持期間内なのでそのまま)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
    try {
      findUniqueTokenMock.mockResolvedValue({
        roomId: "room1",
        period: "custom",
        date: null,
        startDatetime: new Date("2026-06-01T15:00:00.000Z"),
        endDatetime: new Date("2026-09-10T12:00:00.000Z"),
      });
      queryGiftsMock.mockResolvedValue({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
      findUniqueRoomMock.mockResolvedValue(null);

      await queryContributionRankingByShareToken("t");

      expect(queryGiftsMock).toHaveBeenCalledWith(
        "room1",
        "room1",
        {
          receivedAt: {
            gte: new Date("2026-06-01T00:00:00.000Z"),
            lte: new Date("2026-09-10T12:00:00.000Z"),
          },
        }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("custom rangeでendのみ90日より古い場合はqueryEndだけ日境界に丸める(startは保持期間内なのでそのまま)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
    try {
      findUniqueTokenMock.mockResolvedValue({
        roomId: "room1",
        period: "custom",
        date: null,
        startDatetime: new Date("2026-09-10T12:00:00.000Z"),
        endDatetime: new Date("2026-06-02T09:00:00.000Z"),
      });
      queryGiftsMock.mockResolvedValue({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
      findUniqueRoomMock.mockResolvedValue(null);

      await queryContributionRankingByShareToken("t");

      expect(queryGiftsMock).toHaveBeenCalledWith(
        "room1",
        "room1",
        {
          receivedAt: {
            gte: new Date("2026-09-10T12:00:00.000Z"),
            lte: new Date("2026-06-02T23:59:59.999Z"),
          },
        }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("custom rangeでstart/endが保持期間境界と同じかそれより新しい場合は丸めない(境界値は`<`なので丸め対象外)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-11T12:00:00.000Z"));
    try {
      // 90日前ちょうど = 2026-06-13T12:00:00.000Z (retentionCutoffMs と同値)
      findUniqueTokenMock.mockResolvedValue({
        roomId: "room1",
        period: "custom",
        date: null,
        startDatetime: new Date("2026-06-13T12:00:00.000Z"),
        endDatetime: new Date("2026-06-14T12:00:00.000Z"),
      });
      queryGiftsMock.mockResolvedValue({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
      findUniqueRoomMock.mockResolvedValue(null);

      await queryContributionRankingByShareToken("t");

      expect(queryGiftsMock).toHaveBeenCalledWith(
        "room1",
        "room1",
        {
          receivedAt: {
            gte: new Date("2026-06-13T12:00:00.000Z"),
            lte: new Date("2026-06-14T12:00:00.000Z"),
          },
        }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("period+dateはgetDateRange経由のdayKeyでqueryGiftsへ渡す", async () => {
    findUniqueTokenMock.mockResolvedValue({
      roomId: "room1",
      period: "day",
      date: "2026-09-01",
      startDatetime: null,
      endDatetime: null,
    });
    queryGiftsMock.mockResolvedValue({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
    findUniqueRoomMock.mockResolvedValue(null);

    await queryContributionRankingByShareToken("t");

    expect(queryGiftsMock).toHaveBeenCalledWith("room1", "room1", { dayKey: { gte: "2026-09-01", lte: "2026-09-01" } });
  });
});

describe("formatContributionShareRangeLabel", () => {
  it("customはUTC ISOをJSTの時刻表示へ変換する", () => {
    const label = formatContributionShareRangeLabel({
      period: "custom",
      dateRange: {
        start: "2026-09-12T15:00:00.000Z",
        end: "2026-09-12T16:00:00.000Z",
      },
    });
    expect(label).toContain("9/13");
    expect(label).toMatch(/0:00:00/);
    expect(label).toMatch(/1:00:00/);
    expect(label).not.toContain("16:00");
  });

  it("非customはdateRangeをそのまま結合する", () => {
    expect(
      formatContributionShareRangeLabel({
        period: "week",
        dateRange: { start: "2026-09-08", end: "2026-09-14" },
      })
    ).toBe("2026-09-08 〜 2026-09-14");
  });
});
