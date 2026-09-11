// GET /api/public/contribution/{token} — 公開シェアリンクの契約を固定する。
// DBには触れない(queryContributionRankingByShareTokenをモックする)ためunitで完結する。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryByShareTokenMock } = vi.hoisted(() => ({ queryByShareTokenMock: vi.fn() }));

vi.mock("@/lib/contribution-share", () => ({ queryContributionRankingByShareToken: queryByShareTokenMock }));

import { GET } from "./route";

const req = {} as never;

describe("GET /api/public/contribution/[token]", () => {
  beforeEach(() => {
    queryByShareTokenMock.mockReset();
  });

  it("存在しないトークンは 404 で、本文に理由コードを載せない", async () => {
    queryByShareTokenMock.mockResolvedValue({ ok: false });

    const response = await GET(req, { params: { token: "t" } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("成功時も共有キャッシュ・検索インデックスへ載せないヘッダを付ける", async () => {
    queryByShareTokenMock.mockResolvedValue({
      ok: true,
      payload: {
        period: "day",
        date: "2026-09-01",
        startDatetime: null,
        endDatetime: null,
        dateRange: { start: "2026-09-01", end: "2026-09-01" },
        users: [],
        total: { giftCount: 0, totalDiamonds: 0 },
        streamer: { nickname: "配信者A", profileImageUrl: null },
      },
    });

    const response = await GET(req, { params: { token: "t" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.streamer).toEqual({ nickname: "配信者A", profileImageUrl: null });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("公開payloadにtiktokUid/tiktokHandle/verifiedを含めない(payloadのキー集合そのものを固定)", async () => {
    queryByShareTokenMock.mockResolvedValue({
      ok: true,
      payload: {
        period: "day",
        date: "2026-09-01",
        startDatetime: null,
        endDatetime: null,
        dateRange: { start: "2026-09-01", end: "2026-09-01" },
        users: [
          { nickname: "リスナーA", profileImageUrl: null, giftCount: 3, totalDiamonds: 100, lastGiftAt: "2026-09-01T00:00:00.000Z" },
        ],
        total: { giftCount: 3, totalDiamonds: 100 },
        streamer: { nickname: "配信者A", profileImageUrl: null },
      },
    });

    const response = await GET(req, { params: { token: "t" } });
    const body = await response.json();

    for (const user of body.users) {
      expect(Object.keys(user).sort()).toEqual(
        ["giftCount", "lastGiftAt", "nickname", "profileImageUrl", "totalDiamonds"].sort()
      );
    }
  });
});
