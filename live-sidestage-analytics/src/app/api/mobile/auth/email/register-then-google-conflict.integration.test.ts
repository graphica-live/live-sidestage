// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **メール登録の後に同じメールでGoogleログインを試みても、既存Userへリンクされず
// 409で拒否される**、を固定する。これがCritical修正(設計変更)の核心そのもの。
//
// 旧設計(Account行を作らずUser.passwordだけ立てる案)では、この操作列は逆に
// 「同一Userへ収束する(200で成功しGoogleのAccountが足される)」ことをテストしていた。
// それこそが乗っ取り経路だったので、レビュー後にこのテストを反転させた:
// 1. 攻撃者が victim@example.com で先に register → JWTを取得
// 2. 被害者が同じメールで Google ログイン
// 3. 「Account 0件のUserにだけリンクする」既存の不変条件(../google/route.ts)により、
//    register がAccountを同時に作っていれば ここで 409 になり、被害者のGoogle Accountは
//    攻撃者のUser行に接続されない。
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const verifyIdToken = vi.fn();
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = (...args: unknown[]) => verifyIdToken(...args);
  },
}));

const { POST: registerPost } = await import("./register/route");
const { POST: googlePost } = await import("../google/route");

process.env.MOBILE_JWT_SECRET ||= "itest-email-google-conflict-secret";
process.env.GOOGLE_CLIENT_ID ||= "itest-google-client-id";

const PREFIX = "itest-emailgoogleconflict-";

function registerRequest(body: Record<string, unknown>, ip = "203.0.113.20") {
  return new NextRequest("https://example.test/api/mobile/auth/email/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}

function googleRequest(idToken = "dummy-id-token") {
  return new NextRequest("https://example.test/api/mobile/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
}

function stubGooglePayload(payload: Record<string, unknown>) {
  verifyIdToken.mockResolvedValue({ getPayload: () => payload });
}

async function cleanup() {
  await prisma.account.deleteMany({ where: { providerAccountId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});
afterAll(cleanup);

describe("メール登録 → 同一メールでのGoogleログイン競合", () => {
  it("攻撃者が先にメール登録した後、真の所有者のGoogleログインは409で拒否され、Accountも増えない", async () => {
    const email = `${PREFIX}victim@local.test`;

    const registerBody = await (
      await registerPost(registerRequest({ email, password: "attacker-pass" }))
    ).json();
    const attackerUserId = registerBody.user.id as string;

    stubGooglePayload({
      sub: `${PREFIX}victim-google-sub`,
      email,
      email_verified: true,
      name: `${PREFIX}victim-real-name`,
    });
    const googleResponse = await googlePost(googleRequest());
    const googleBody = await googleResponse.json();

    expect(googleResponse.status).toBe(409);
    expect(googleBody.error).toBe("このメールアドレスは別のアカウントで使用されています");

    // 攻撃者のUserにGoogleのAccountが足されていない(乗っ取りが成立していない)こと。
    const accounts = await prisma.account.findMany({ where: { userId: attackerUserId } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.provider).toBe("email");

    // Googleのsubでは何のAccountも作られていない(新規User作成にも倒れていない)こと。
    expect(
      await prisma.account.count({
        where: { provider: "google", providerAccountId: `${PREFIX}victim-google-sub` },
      }),
    ).toBe(0);

    // Userの総数も1のまま(新規User作成に倒れていない)こと。
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });
});
