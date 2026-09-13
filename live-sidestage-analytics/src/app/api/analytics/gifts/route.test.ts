import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  CALENDAR_RANKING_QUERY_OPTIONS,
  CUSTOM_RANGE_RANKING_QUERY_OPTIONS,
} from "@/lib/gift-ranking-avatars";

const { getServerSessionMock, findUniqueMock, queryGiftsMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  findUniqueMock: vi.fn(),
  queryGiftsMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { streamer: { findUnique: findUniqueMock } } }));
vi.mock("@/lib/gift-analytics", () => ({
  getDateRange: (period: string, date: string) => ({ start: date, end: date }),
  queryGifts: queryGiftsMock,
}));

import { GET } from "./route";

describe("GET /api/analytics/gifts", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    findUniqueMock.mockReset();
    queryGiftsMock.mockReset();
    queryGiftsMock.mockResolvedValue({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
  });

  it("returns 401 without session", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/analytics/gifts"));
    expect(res.status).toBe(401);
    expect(queryGiftsMock).not.toHaveBeenCalled();
  });

  it("calendar range uses preferRollup and skips avatars", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ id: "s1", roomId: "room1", verified: true });

    const res = await GET(new NextRequest("http://localhost/api/analytics/gifts?period=day&date=2026-09-12"));
    expect(res.status).toBe(200);
    expect(queryGiftsMock).toHaveBeenCalledWith(
      "room1",
      "s1",
      { dayKey: { gte: "2026-09-12", lte: "2026-09-12" } },
      null,
      CALENDAR_RANKING_QUERY_OPTIONS
    );
  });

  it("custom datetime does not preferRollup but still skips avatars", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ id: "s1", roomId: "room1", verified: true });
    const start = "2026-09-12T00:00:00.000Z";
    const end = "2026-09-12T01:00:00.000Z";

    const res = await GET(
      new NextRequest(`http://localhost/api/analytics/gifts?startDatetime=${start}&endDatetime=${end}`)
    );
    expect(res.status).toBe(200);
    expect(queryGiftsMock.mock.calls[0][4]).toEqual(CUSTOM_RANGE_RANKING_QUERY_OPTIONS);
  });
});
