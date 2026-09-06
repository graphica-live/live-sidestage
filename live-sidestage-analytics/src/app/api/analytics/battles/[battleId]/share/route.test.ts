// POST /api/analytics/battles/{battleId}/share — 認可ゲートと発行URLの組み立てを固定する。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getServerSessionMock, findUniqueMock, ensureShareTokenMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  findUniqueMock: vi.fn(),
  ensureShareTokenMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { streamer: { findUnique: findUniqueMock } } }));
vi.mock("@/lib/battle-replay", () => ({ ensureShareToken: ensureShareTokenMock }));
vi.mock("@/lib/canonical-origin", () => ({ canonicalOrigin: () => "https://analytics.test" }));

import { POST } from "./route";

const req = {} as never;
const params = { params: { battleId: "b1" } };

describe("POST /api/analytics/battles/[battleId]/share", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    findUniqueMock.mockReset();
    ensureShareTokenMock.mockReset();
  });

  it("セッションが無ければ 401 で、トークンを発行しない", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const response = await POST(req, params);

    expect(response.status).toBe(401);
    expect(ensureShareTokenMock).not.toHaveBeenCalled();
  });

  it("確定していないバトルは 404(トークンを発行しない)", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: "room1" });
    ensureShareTokenMock.mockResolvedValue(null);

    const response = await POST(req, params);

    expect(response.status).toBe(404);
  });

  it("URLはサーバー側の正準オリジンで組む(発行元ホストに依存しない)", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: "room1" });
    ensureShareTokenMock.mockResolvedValue("a".repeat(48));

    const response = await POST(req, params);

    expect(ensureShareTokenMock).toHaveBeenCalledWith("room1", "b1");
    expect(await response.json()).toEqual({ url: `https://analytics.test/b/${"a".repeat(48)}` });
  });
});
