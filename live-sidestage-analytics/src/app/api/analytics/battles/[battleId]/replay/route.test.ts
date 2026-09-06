// GET /api/analytics/battles/{battleId}/replay — 認可ゲートと再生不可時のステータスを固定する。
// DBには触れない(セッションとprisma.streamerをモックする)ためunitで完結する。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getServerSessionMock, findUniqueMock, queryBattleReplayMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  findUniqueMock: vi.fn(),
  queryBattleReplayMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { streamer: { findUnique: findUniqueMock } } }));
vi.mock("@/lib/battle-replay", () => ({ queryBattleReplay: queryBattleReplayMock }));

import { GET } from "./route";

const req = {} as never;
const params = { params: { battleId: "b1" } };

describe("GET /api/analytics/battles/[battleId]/replay", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    findUniqueMock.mockReset();
    queryBattleReplayMock.mockReset();
  });

  it("セッションが無ければ 401 で、DBを引かない", async () => {
    getServerSessionMock.mockResolvedValue(null);

    const response = await GET(req, params);

    expect(response.status).toBe(401);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("roomId を持たないユーザーは 404 で、他人のバトルを引きにいかない", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: null });

    const response = await GET(req, params);

    expect(response.status).toBe(404);
    expect(queryBattleReplayMock).not.toHaveBeenCalled();
  });

  it("再生不可は 409 で理由コードを返す(所有者向けなので理由を出してよい)", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: "room1" });
    queryBattleReplayMock.mockResolvedValue({
      ok: false,
      availability: { available: false, reason: "no_score_points" },
    });

    const response = await GET(req, params);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Replay unavailable",
      available: false,
      reason: "no_score_points",
    });
  });

  it("自分の roomId で絞って再生ペイロードを返す", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: "room1" });
    queryBattleReplayMock.mockResolvedValue({ ok: true, payload: { version: 1 } });

    const response = await GET(req, params);

    expect(queryBattleReplayMock).toHaveBeenCalledWith("room1", "b1");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
