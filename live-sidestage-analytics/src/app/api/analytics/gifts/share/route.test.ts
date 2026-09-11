// POST /api/analytics/gifts/share — 認可ゲート・入力検証・冪等発行を固定する。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getServerSessionMock, findUniqueMock, ensureContributionShareTokenMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  findUniqueMock: vi.fn(),
  ensureContributionShareTokenMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { streamer: { findUnique: findUniqueMock } } }));
vi.mock("@/lib/contribution-share", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contribution-share")>("@/lib/contribution-share");
  return { ...actual, ensureContributionShareToken: ensureContributionShareTokenMock };
});
vi.mock("@/lib/canonical-origin", () => ({ canonicalOrigin: () => "https://analytics.test" }));

import { POST } from "./route";

function buildReq(body: unknown) {
  return { json: async () => body } as never;
}

describe("POST /api/analytics/gifts/share", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    findUniqueMock.mockReset();
    ensureContributionShareTokenMock.mockReset();
  });

  it("セッションが無ければ 401 で、トークンを発行しない", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const response = await POST(buildReq({ period: "day", date: "2026-09-01" }));

    expect(response.status).toBe(401);
    expect(ensureContributionShareTokenMock).not.toHaveBeenCalled();
  });

  it("roomId未登録の配信者は 404(トークンを発行しない)", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue(null);

    const response = await POST(buildReq({ period: "day", date: "2026-09-01" }));

    expect(response.status).toBe(404);
    expect(ensureContributionShareTokenMock).not.toHaveBeenCalled();
  });

  it("period が不正なら 400(トークンを発行しない)", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: "room1" });

    const response = await POST(buildReq({ period: "century", date: "2026-09-01" }));

    expect(response.status).toBe(400);
    expect(ensureContributionShareTokenMock).not.toHaveBeenCalled();
  });

  it("customでstart>=endは400", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: "room1" });

    const response = await POST(
      buildReq({
        period: "custom",
        startDatetime: "2026-09-02T00:00:00.000Z",
        endDatetime: "2026-09-01T00:00:00.000Z",
      })
    );

    expect(response.status).toBe(400);
    expect(ensureContributionShareTokenMock).not.toHaveBeenCalled();
  });

  it("正常系: URLはサーバー側の正準オリジンで組み、同じ入力で再発行しても同じトークンを返す(冪等性はensureContributionShareToken側の責務)", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: "room1" });
    ensureContributionShareTokenMock.mockResolvedValue("a".repeat(48));

    const response = await POST(buildReq({ period: "day", date: "2026-09-01" }));

    expect(ensureContributionShareTokenMock).toHaveBeenCalledWith("room1", {
      period: "day",
      date: "2026-09-01",
      startDatetime: null,
      endDatetime: null,
    });
    expect(await response.json()).toEqual({ url: `https://analytics.test/c/${"a".repeat(48)}` });

    const response2 = await POST(buildReq({ period: "day", date: "2026-09-01" }));
    expect(await response2.json()).toEqual({ url: `https://analytics.test/c/${"a".repeat(48)}` });
  });
});
