import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";
import { signMobileToken } from "@/lib/mobile-auth";

const { previewTiktokAccount, findUnique, isRateLimitedMock } = vi.hoisted(() => ({
  previewTiktokAccount: vi.fn(),
  findUnique: vi.fn(),
  isRateLimitedMock: vi.fn((_key?: string, _opts?: { max: number; windowMs: number }) => false),
}));

vi.mock("@/lib/tiktok-existence", () => ({
  previewTiktokAccount: (...args: [string]) => previewTiktokAccount(...args),
  formatExistenceGateError: (code: string) => {
    if (code === "USER_NOT_FOUND") {
      return { error: `このTikTok IDのユーザーが見つかりません。IDに誤りがないかご確認ください(${code})`, status: 400 };
    }
    if (code === "CHECK_UNVERIFIED") {
      return { error: `TikTok側で確認できませんでした。しばらく待ってから再度お試しください(${code})`, status: 503 };
    }
    return {
      error: `TikTok IDの形式が正しくありません。英数字・ピリオド(.)・アンダースコア(_)のみ使用できます(${code})`,
      status: 400,
    };
  },
}));

vi.mock("@/lib/mark-last-active", () => ({
  markLastActive: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { principal: { findUnique: (args: unknown) => findUnique(args) } },
}));

vi.mock("@/lib/rate-limit", () => ({
  isRateLimited: (key: string, opts: { max: number; windowMs: number }) => isRateLimitedMock(key, opts),
}));

const { POST } = await import("./route");

function request(body: unknown, token?: string, authHeader?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader) headers.authorization = authHeader;
  else if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest("https://example.test/api/mobile/streamer/preview", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  isRateLimitedMock.mockReturnValue(false);
  findUnique.mockResolvedValue({ id: "p1", streamer: null });
  process.env.MOBILE_JWT_SECRET ||= "test-mobile-secret";
});

describe("POST /api/mobile/streamer/preview", () => {
  it("未認証は401", async () => {
    const res = await POST(request({ tiktokHandle: "someone" }));
    expect(res.status).toBe(401);
    expect(previewTiktokAccount).not.toHaveBeenCalled();
  });

  it("壊れたJWTは401", async () => {
    const res = await POST(request({ tiktokHandle: "someone" }, "not-a-jwt"));
    expect(res.status).toBe(401);
    expect(previewTiktokAccount).not.toHaveBeenCalled();
  });

  it("Bearer以外のAuthorizationは401", async () => {
    const res = await POST(request({ tiktokHandle: "someone" }, undefined, "Basic abc"));
    expect(res.status).toBe(401);
    expect(previewTiktokAccount).not.toHaveBeenCalled();
  });

  it("期限切れJWTは401", async () => {
    const token = jwt.sign({ principalId: "p1" }, process.env.MOBILE_JWT_SECRET!, { expiresIn: "-1s" });
    const res = await POST(request({ tiktokHandle: "someone" }, token));
    expect(res.status).toBe(401);
    expect(previewTiktokAccount).not.toHaveBeenCalled();
  });

  it("レート制限は429で TikTok 照会しない", async () => {
    isRateLimitedMock.mockReturnValue(true);
    const token = signMobileToken({ principalId: "p1" });
    const res = await POST(request({ tiktokHandle: "someone" }, token));
    expect(res.status).toBe(429);
    expect(previewTiktokAccount).not.toHaveBeenCalled();
  });

  it("既登録は409で TikTok 照会しない", async () => {
    findUnique.mockResolvedValue({ id: "p1", streamer: { id: "s1" } });
    const token = signMobileToken({ principalId: "p1" });
    const res = await POST(request({ tiktokHandle: "someone" }, token));
    expect(res.status).toBe(409);
    expect(previewTiktokAccount).not.toHaveBeenCalled();
  });

  it("空ハンドルは400で TikTok 照会しない", async () => {
    const token = signMobileToken({ principalId: "p1" });
    const res = await POST(request({ tiktokHandle: "  " }, token));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("TikTok IDを入力してください");
    expect(previewTiktokAccount).not.toHaveBeenCalled();
  });

  it("壊れたJSONは400で TikTok 照会しない", async () => {
    const token = signMobileToken({ principalId: "p1" });
    const res = await POST(request("{", token));
    expect(res.status).toBe(400);
    expect(previewTiktokAccount).not.toHaveBeenCalled();
  });

  it("tiktokHandleが文字列でないと400で照会しない", async () => {
    const token = signMobileToken({ principalId: "p1" });
    const res = await POST(request({ tiktokHandle: 1 }, token));
    expect(res.status).toBe(400);
    expect(previewTiktokAccount).not.toHaveBeenCalled();
  });

  it("存在しないハンドルは400 USER_NOT_FOUND", async () => {
    previewTiktokAccount.mockResolvedValue({ ok: false, code: "USER_NOT_FOUND" });
    const token = signMobileToken({ principalId: "p1" });
    const res = await POST(request({ tiktokHandle: "nobody" }, token));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("USER_NOT_FOUND");
    expect(body.error).toContain("USER_NOT_FOUND");
  });

  it("照会不能は503 CHECK_UNVERIFIED", async () => {
    previewTiktokAccount.mockResolvedValue({ ok: false, code: "CHECK_UNVERIFIED" });
    const token = signMobileToken({ principalId: "p1" });
    const res = await POST(request({ tiktokHandle: "someone" }, token));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("CHECK_UNVERIFIED");
  });

  it("成功は Web preview と同じキーを返す", async () => {
    previewTiktokAccount.mockResolvedValue({
      ok: true,
      tiktokHandle: "your_handle",
      nickname: "ニックネーム",
      preview: {
        avatarUrl: "https://example.test/a.png",
        signature: "hello",
        followingCount: 128,
        followerCount: 12340,
      },
    });
    const token = signMobileToken({ principalId: "p1" });
    const res = await POST(request({ tiktokHandle: "@Your_Handle" }, token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      tiktokHandle: "your_handle",
      nickname: "ニックネーム",
      avatarUrl: "https://example.test/a.png",
      signature: "hello",
      followingCount: 128,
      followerCount: 12340,
    });
  });
});
