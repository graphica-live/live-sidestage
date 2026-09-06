// GET /api/admin/rooms/{roomId}/analytics/battles/{battleId}/replay — 管理者ゲートを固定する。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAdminSessionMock, queryBattleReplayMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  queryBattleReplayMock: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("@/lib/battle-replay", () => ({ queryBattleReplay: queryBattleReplayMock }));

import { GET } from "./route";

const req = {} as never;
const params = { params: { roomId: "room1", battleId: "b1" } };

describe("GET /api/admin/rooms/[roomId]/analytics/battles/[battleId]/replay", () => {
  beforeEach(() => {
    getAdminSessionMock.mockReset();
    queryBattleReplayMock.mockReset();
  });

  it("管理者セッションが無ければ 401 で、バトルを引かない", async () => {
    getAdminSessionMock.mockResolvedValue(null);

    const response = await GET(req, params);

    expect(response.status).toBe(401);
    expect(queryBattleReplayMock).not.toHaveBeenCalled();
  });

  it("管理者は URL の roomId で任意の部屋の再生ペイロードを取れる", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@example.test" } });
    queryBattleReplayMock.mockResolvedValue({ ok: true, payload: { version: 1 } });

    const response = await GET(req, params);

    expect(queryBattleReplayMock).toHaveBeenCalledWith("room1", "b1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("再生不可は 409 で理由コードを返す", async () => {
    getAdminSessionMock.mockResolvedValue({ user: { email: "admin@example.test" } });
    queryBattleReplayMock.mockResolvedValue({
      ok: false,
      availability: { available: false, reason: "not_finalized" },
    });

    const response = await GET(req, params);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Replay unavailable",
      available: false,
      reason: "not_finalized",
    });
  });
});
