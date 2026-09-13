import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  CALENDAR_RANKING_QUERY_OPTIONS,
  CUSTOM_RANGE_RANKING_QUERY_OPTIONS,
} from "@/lib/gift-ranking-avatars";

const { getAdminSessionMock, queryGiftsMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  queryGiftsMock: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("@/lib/gift-analytics", () => ({
  getDateRange: (_period: string, date: string) => ({ start: date, end: date }),
  queryGifts: queryGiftsMock,
}));

import { GET } from "./route";

describe("GET /api/admin/rooms/[roomId]/analytics/gifts query options", () => {
  beforeEach(() => {
    getAdminSessionMock.mockReset();
    queryGiftsMock.mockReset();
    queryGiftsMock.mockResolvedValue({ users: [], total: { giftCount: 0, totalDiamonds: 0 } });
  });

  it("calendar uses preferRollup and skips avatars", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@test" } });
    const res = await GET(
      new NextRequest("http://localhost/api/admin/rooms/room1/analytics/gifts?period=day&date=2026-09-12"),
      { params: { roomId: "room1" } }
    );
    expect(res.status).toBe(200);
    expect(queryGiftsMock).toHaveBeenCalledWith(
      "room1",
      "room1",
      { dayKey: { gte: "2026-09-12", lte: "2026-09-12" } },
      null,
      CALENDAR_RANKING_QUERY_OPTIONS
    );
  });

  it("custom datetime does not preferRollup", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@test" } });
    const start = "2026-09-12T00:00:00.000Z";
    const end = "2026-09-12T01:00:00.000Z";
    const res = await GET(
      new NextRequest(
        `http://localhost/api/admin/rooms/room1/analytics/gifts?startDatetime=${start}&endDatetime=${end}`
      ),
      { params: { roomId: "room1" } }
    );
    expect(res.status).toBe(200);
    expect(queryGiftsMock.mock.calls[0][4]).toEqual(CUSTOM_RANGE_RANKING_QUERY_OPTIONS);
  });
});
