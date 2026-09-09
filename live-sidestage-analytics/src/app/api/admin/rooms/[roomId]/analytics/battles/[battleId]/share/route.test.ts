// POST /api/admin/rooms/{roomId}/analytics/battles/{battleId}/share — 管理者認可ゲートと発行URLの組み立てを固定する。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAdminSessionMock, findUniqueTiktokRoomMock, ensureShareTokenMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  findUniqueTiktokRoomMock: vi.fn(),
  ensureShareTokenMock: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("@/lib/prisma", () => ({ prisma: { tiktokRoom: { findUnique: findUniqueTiktokRoomMock } } }));
vi.mock("@/lib/battle-replay", () => ({ ensureShareToken: ensureShareTokenMock }));
vi.mock("@/lib/canonical-origin", () => ({ canonicalOrigin: () => "https://analytics.test" }));

import { POST } from "./route";

const req = {} as never;
const params = { params: { roomId: "room1", battleId: "b1" } };

describe("POST /api/admin/rooms/[roomId]/analytics/battles/[battleId]/share", () => {
  beforeEach(() => {
    getAdminSessionMock.mockReset();
    findUniqueTiktokRoomMock.mockReset();
    ensureShareTokenMock.mockReset();
  });

  it("admin セッションが無ければ 401 で、トークンを発行しない", async () => {
    getAdminSessionMock.mockResolvedValue(null);

    const response = await POST(req, params);

    expect(response.status).toBe(401);
    expect(ensureShareTokenMock).not.toHaveBeenCalled();
  });

  it("存在しない roomId で 404(トークンを発行しない)", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@example.test" } });
    findUniqueTiktokRoomMock.mockResolvedValue(null);

    const response = await POST(req, params);

    expect(response.status).toBe(404);
    expect(ensureShareTokenMock).not.toHaveBeenCalled();
  });

  it("確定していないバトルは 404(トークンを発行しない)", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@example.test" } });
    findUniqueTiktokRoomMock.mockResolvedValue({ id: "room1" });
    ensureShareTokenMock.mockResolvedValue(null);

    const response = await POST(req, params);

    expect(response.status).toBe(404);
  });

  it("URLはサーバー側の正準オリジンで組む(発行元ホストに依存しない)", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@example.test" } });
    findUniqueTiktokRoomMock.mockResolvedValue({ id: "room1" });
    ensureShareTokenMock.mockResolvedValue("a".repeat(48));

    const response = await POST(req, params);

    expect(findUniqueTiktokRoomMock).toHaveBeenCalledWith({
      where: { id: "room1" },
      select: { id: true },
    });
    expect(ensureShareTokenMock).toHaveBeenCalledWith("room1", "b1");
    expect(await response.json()).toEqual({ url: `https://analytics.test/b/${"a".repeat(48)}` });
  });

  it("2回目呼び出しで同じトークンを返す(再発行しない)", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@example.test" } });
    findUniqueTiktokRoomMock.mockResolvedValue({ id: "room1" });
    // ensureShareToken は冪等性を持つため、2回呼んでも同じトークンを返す
    const token = "a".repeat(48);
    ensureShareTokenMock.mockResolvedValue(token);

    const response1 = await POST(req, params);
    const response2 = await POST(req, params);

    expect(await response1.json()).toEqual({ url: `https://analytics.test/b/${token}` });
    expect(await response2.json()).toEqual({ url: `https://analytics.test/b/${token}` });
  });
});
