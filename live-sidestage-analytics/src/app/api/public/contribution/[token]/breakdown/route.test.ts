// GET /api/public/contribution/{token}/breakdown — 公開ページのギフト内訳アコーディオン用。
// DBには触れない(queryContributionBreakdownByShareTokenをモックする)ためunitで完結する。
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryBreakdownMock } = vi.hoisted(() => ({ queryBreakdownMock: vi.fn() }));

vi.mock("@/lib/contribution-share", () => ({ queryContributionBreakdownByShareToken: queryBreakdownMock }));

import { GET } from "./route";

function reqWith(url: string) {
  return { url } as never;
}

describe("GET /api/public/contribution/[token]/breakdown", () => {
  beforeEach(() => {
    queryBreakdownMock.mockReset();
  });

  it("tiktokUid未指定は400", async () => {
    const response = await GET(reqWith("https://example.com/api/public/contribution/t/breakdown"), {
      params: { token: "t" },
    });

    expect(response.status).toBe(400);
    expect(queryBreakdownMock).not.toHaveBeenCalled();
  });

  it("存在しないトークンは404で理由コードを載せない", async () => {
    queryBreakdownMock.mockResolvedValue({ ok: false });

    const response = await GET(
      reqWith("https://example.com/api/public/contribution/t/breakdown?tiktokUid=uid1"),
      { params: { token: "t" } }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Not found" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });

  it("成功時は内訳をそのまま返し、共有キャッシュへ載せないヘッダを付ける", async () => {
    queryBreakdownMock.mockResolvedValue({
      ok: true,
      value: {
        tiktokUid: "uid1",
        gifts: [{ giftId: 1, giftName: "Rose", giftPictureUrl: null, repeatCount: 2, diamondCount: 1, totalDiamonds: 2, lastReceivedAt: "2026-09-01T00:00:00.000Z" }],
        total: { repeatCount: 2, totalDiamonds: 2 },
        coverage: { detailAvailable: true, rawFrom: null, partial: false },
        truncated: false,
      },
    });

    const response = await GET(
      reqWith("https://example.com/api/public/contribution/t/breakdown?tiktokUid=uid1"),
      { params: { token: "t" } }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tiktokUid).toBe("uid1");
    expect(queryBreakdownMock).toHaveBeenCalledWith("t", "uid1");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});
