// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET } from "./route";
import { createInvite } from "@/lib/ambassador/ambassador";
import { AMBASSADOR_INVITE_COOKIE } from "@/lib/ambassador/invite-cookie";

const inviteIds: string[] = [];

function request(token: string) {
  return new NextRequest(`https://example.test/api/ambassador/invite/start?token=${encodeURIComponent(token)}`);
}

afterAll(async () => {
  if (inviteIds.length > 0) {
    await prisma.ambassadorInvite.deleteMany({ where: { id: { in: inviteIds } } });
  }
});

describe("GET /api/ambassador/invite/start", () => {
  it("有効な招待tokenならhttpOnly Cookieをセットし、Google signinへリダイレクトする", async () => {
    const invite = await createInvite();
    inviteIds.push(invite.id);

    const response = await GET(request(invite.token));

    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/api/auth/signin/google");

    const setCookie = response.cookies.get(AMBASSADOR_INVITE_COOKIE);
    expect(setCookie?.value).toBe(invite.token);
    expect(setCookie?.httpOnly).toBe(true);
    expect(setCookie?.sameSite).toBe("lax");
    expect(setCookie?.path).toBe("/");
  });

  it("無効なtokenではCookieをセットせず、招待ページへerror=invalid付きで戻す", async () => {
    const response = await GET(request("invalid-token-does-not-exist"));

    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/invite/ambassador/invalid-token-does-not-exist");
    expect(location).toContain("error=invalid");

    const setCookie = response.cookies.get(AMBASSADOR_INVITE_COOKIE);
    expect(setCookie).toBeUndefined();
  });

  it("使用済みの招待tokenはCookieをセットせず無効として扱う", async () => {
    const invite = await createInvite();
    inviteIds.push(invite.id);
    await prisma.ambassadorInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });

    const response = await GET(request(invite.token));

    const location = response.headers.get("location") ?? "";
    expect(location).toContain("error=invalid");
    expect(response.cookies.get(AMBASSADOR_INVITE_COOKIE)).toBeUndefined();
  });
});
