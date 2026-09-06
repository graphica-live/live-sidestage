// GET /api/public/battles/{token}/replay — 公開シェアリンクの契約を固定する。
// DBには触れない(queryBattleReplayByShareTokenをモックする)ためunitで完結する。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryByShareTokenMock } = vi.hoisted(() => ({ queryByShareTokenMock: vi.fn() }));

vi.mock("@/lib/battle-replay", () => ({ queryBattleReplayByShareToken: queryByShareTokenMock }));

import { GET } from "./route";

const req = {} as never;

describe("GET /api/public/battles/[token]/replay", () => {
  beforeEach(() => {
    queryByShareTokenMock.mockReset();
  });

  it("再生できないトークンは 404 で、本文に理由コードを載せない", async () => {
    // 理由を載せると「トークンは実在するが再生不可」と「トークンが無い」を区別でき、
    // トークンの実在有無が漏れる。
    queryByShareTokenMock.mockResolvedValue({
      ok: false,
      availability: { available: false, reason: "no_score_points" },
    });

    const response = await GET(req, { params: { token: "t" } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("成功時も共有キャッシュ・検索インデックスへ載せないヘッダを付ける", async () => {
    queryByShareTokenMock.mockResolvedValue({ ok: true, payload: { version: 1, battleId: "b1" } });

    const response = await GET(req, { params: { token: "t" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, battleId: "b1" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});
