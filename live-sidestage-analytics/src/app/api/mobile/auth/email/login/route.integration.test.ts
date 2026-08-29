// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **ログインは `provider: "email"` の Account を持つ User にのみ許可する**、を固定する。
//
// これは High-2 の修正の核心。5a3e97a以前の「メール/パスワード登録」で作られた旧User行は
// Accountを1件も持たない(所有権未確認のハッシュ)。ここで作った email/login が
// `User.email`一致だけでログインを許すと、旧行が新機能の登場で突然到達可能になり、
// パスワード強度もリセット手段も無いまま外部から突かれ得る。Accountテーブル経由で
// 解決することで、旧行は従来どおり ../google/route.ts の移行経路にしか出口が無い。
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const { POST: loginPost } = await import("./route");
const { POST: registerPost } = await import("../register/route");

process.env.MOBILE_JWT_SECRET ||= "itest-email-login-secret";

const PREFIX = "itest-emaillogin-";

function loginRequest(body: Record<string, unknown>) {
  return new NextRequest("https://example.test/api/mobile/auth/email/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function registerRequest(body: Record<string, unknown>, ip: string) {
  return new NextRequest("https://example.test/api/mobile/auth/email/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });
}

async function cleanup() {
  await prisma.account.deleteMany({ where: { providerAccountId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("POST /api/mobile/auth/email/login", () => {
  it("正しいメール・パスワードでログインできる", async () => {
    const email = `${PREFIX}ok@local.test`;
    await registerPost(registerRequest({ email, password: "correct-horse" }, "203.0.113.10"));

    const response = await loginPost(loginRequest({ email, password: "correct-horse" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.email).toBe(email);
    expect(typeof body.token).toBe("string");
  });

  it("パスワードが誤っていれば401、メッセージは汎用", async () => {
    const email = `${PREFIX}wrongpw@local.test`;
    await registerPost(registerRequest({ email, password: "correct-horse" }, "203.0.113.11"));

    const response = await loginPost(loginRequest({ email, password: "wrong-password" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("メールアドレスまたはパスワードが正しくありません");
  });

  it("存在しないメールでも同じ401メッセージ(存在有無を漏らさない)", async () => {
    const response = await loginPost(
      loginRequest({ email: `${PREFIX}nobody@local.test`, password: "whatever1" }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("メールアドレスまたはパスワードが正しくありません");
  });

  it("emailプロバイダのAccountを持たない旧User(Account0件、password直挿し)は401で拒否する(High-2の核心)", async () => {
    const email = `${PREFIX}legacy@local.test`;
    await prisma.user.create({
      data: { email, name: `${PREFIX}legacy`, password: await bcrypt.hash("correct-horse", 12) },
    });

    const response = await loginPost(loginRequest({ email, password: "correct-horse" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("メールアドレスまたはパスワードが正しくありません");
  });

  it("Googleアカウントとして登録済みのメールには専用メッセージを返す", async () => {
    const email = `${PREFIX}google@local.test`;
    const user = await prisma.user.create({ data: { email, name: `${PREFIX}google-user` } });
    await prisma.account.create({
      data: { userId: user.id, type: "oauth", provider: "google", providerAccountId: `${PREFIX}google-sub` },
    });

    const response = await loginPost(loginRequest({ email, password: "whatever1" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe(
      "このメールアドレスはGoogleアカウントとして登録されています。Googleでログインしてください",
    );
  });

  it("同一メールへの11回目の試行は429になる", async () => {
    const email = `${PREFIX}ratelimit@local.test`;
    await registerPost(registerRequest({ email, password: "correct-horse" }, "203.0.113.12"));

    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await loginPost(loginRequest({ email, password: "wrong-password" }));
    }
    expect(last!.status).toBe(429);
  });

  it("ログイン成功後はレート制限カウントがリセットされる", async () => {
    const email = `${PREFIX}resetcount@local.test`;
    await registerPost(registerRequest({ email, password: "correct-horse" }, "203.0.113.13"));

    for (let i = 0; i < 9; i++) {
      await loginPost(loginRequest({ email, password: "wrong-password" }));
    }
    const success = await loginPost(loginRequest({ email, password: "correct-horse" }));
    expect(success.status).toBe(200);

    // リセットされていなければ次の1回で429になるはずだが、そうならないことを確認する。
    const afterSuccess = await loginPost(loginRequest({ email, password: "wrong-password" }));
    expect(afterSuccess.status).toBe(401);
  });
});
