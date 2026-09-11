// POST /api/admin/rooms/[roomId]/analytics/gifts/share — 管理者向け発行の認可ゲート・入力検証を固定する。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAdminSessionMock, findUniqueMock, ensureContributionShareTokenMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  findUniqueMock: vi.fn(),
  ensureContributionShareTokenMock: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("@/lib/prisma", () => ({ prisma: { tiktokRoom: { findUnique: findUniqueMock } } }));
vi.mock("@/lib/contribution-share", async () => {
  const actual = await vi.importActual<typeof import("@/lib/contribution-share")>("@/lib/contribution-share");
  return { ...actual, ensureContributionShareToken: ensureContributionShareTokenMock };
});
vi.mock("@/lib/canonical-origin", () => ({ canonicalOrigin: () => "https://analytics.test" }));

import { POST } from "./route";

function buildReq(body: unknown) {
  return { json: async () => body } as never;
}

const params = { params: { roomId: "room1" } };

describe("POST /api/admin/rooms/[roomId]/analytics/gifts/share", () => {
  beforeEach(() => {
    getAdminSessionMock.mockReset();
    findUniqueMock.mockReset();
    ensureContributionShareTokenMock.mockReset();
  });

  it("adminセッションが無ければ 401 で、トークンを発行しない", async () => {
    getAdminSessionMock.mockResolvedValue(null);

    const response = await POST(buildReq({ period: "day", date: "2026-09-01" }), params);

    expect(response.status).toBe(401);
    expect(ensureContributionShareTokenMock).not.toHaveBeenCalled();
  });

  it("roomが存在しなければ 404(トークンを発行しない)", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@test" } });
    findUniqueMock.mockResolvedValue(null);

    const response = await POST(buildReq({ period: "day", date: "2026-09-01" }), params);

    expect(response.status).toBe(404);
    expect(ensureContributionShareTokenMock).not.toHaveBeenCalled();
  });

  it("period が不正なら 400", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@test" } });
    findUniqueMock.mockResolvedValue({ id: "room1" });

    const response = await POST(buildReq({ period: "century" }), params);

    expect(response.status).toBe(400);
    expect(ensureContributionShareTokenMock).not.toHaveBeenCalled();
  });

  it("正常系: パスのroomIdでトークンを発行する", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@test" } });
    findUniqueMock.mockResolvedValue({ id: "room1" });
    ensureContributionShareTokenMock.mockResolvedValue("b".repeat(48));

    const response = await POST(buildReq({ period: "day", date: "2026-09-01" }), params);

    expect(ensureContributionShareTokenMock).toHaveBeenCalledWith("room1", {
      period: "day",
      date: "2026-09-01",
      startDatetime: null,
      endDatetime: null,
    });
    expect(await response.json()).toEqual({ url: `https://analytics.test/c/${"b".repeat(48)}` });
  });
});
