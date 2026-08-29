// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **メール+パスワード登録では必ず `Account`(provider: "email") を同時に作る**、を固定する。
//
// これは安全性の核心。Accountを作らない設計だと、後からGoogle/Appleが「Account 0件のUserだけ
// メール一致でリンクする」既存の移行経路(../../google/route.ts, src/lib/auth.ts)に乗ってしまい、
// 攻撃者が他人のメールで先に登録してJWTを取得→本物の所有者が後日Googleでログイン→
// 被害者のGoogle Accountが攻撃者のUser行にリンクされる、というアカウント乗っ取りが成立する。
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const { POST: registerPost } = await import("./route");

process.env.MOBILE_JWT_SECRET ||= "itest-email-register-secret";

const PREFIX = "itest-emailreg-";

function registerRequest(body: Record<string, unknown>, ip = "203.0.113.1") {
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

describe("POST /api/mobile/auth/email/register", () => {
  it("新規メールで登録できる", async () => {
    const email = `${PREFIX}new@local.test`;
    const response = await registerPost(registerRequest({ email, password: "correct-horse" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.email).toBe(email);
    expect(body.onboardingRequired).toBe(true);
    expect(typeof body.token).toBe("string");
  });

  it("作成されたUserに provider:\"email\" のAccountが1件紐付いている(設計の核心)", async () => {
    const email = `${PREFIX}account-check@local.test`;
    const response = await registerPost(registerRequest({ email, password: "correct-horse" }));
    const body = await response.json();

    const accounts = await prisma.account.findMany({ where: { userId: body.user.id } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.provider).toBe("email");
    expect(accounts[0]!.providerAccountId).toBe(email);
  });

  it("パスワードは平文で保存せずbcryptハッシュにする", async () => {
    const email = `${PREFIX}hash@local.test`;
    await registerPost(registerRequest({ email, password: "correct-horse" }));

    const user = await prisma.user.findUnique({ where: { email }, select: { password: true } });
    expect(user?.password).not.toBe("correct-horse");
    expect(await bcrypt.compare("correct-horse", user!.password!)).toBe(true);
  });

  it("同じメールで2回目は409、Userは増えない", async () => {
    const email = `${PREFIX}dup@local.test`;
    await registerPost(registerRequest({ email, password: "correct-horse" }));

    const second = await registerPost(registerRequest({ email, password: "another-pass" }));
    expect(second.status).toBe(409);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it("Account 0件の旧User(所有権未確認)が既に存在するメールも409で拒否する(相乗り防止)", async () => {
    const email = `${PREFIX}legacy@local.test`;
    await prisma.user.create({ data: { email, name: `${PREFIX}legacy`, password: "hashed" } });

    const response = await registerPost(registerRequest({ email, password: "correct-horse" }));
    expect(response.status).toBe(409);
    // Accountが足されていないこと(乗っ取り目的の相乗りが成立していないこと)。
    expect(await prisma.account.count({ where: { providerAccountId: email } })).toBe(0);
  });

  it("パスワードが8文字未満は400、Userは作られない", async () => {
    const email = `${PREFIX}short@local.test`;
    const response = await registerPost(registerRequest({ email, password: "short1" }));

    expect(response.status).toBe(400);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("メール形式が不正なら400", async () => {
    const response = await registerPost(
      registerRequest({ email: "not-an-email", password: "correct-horse" }),
    );
    expect(response.status).toBe(400);
  });

  it("同一IPから短時間に大量登録するとレート制限で429になる", async () => {
    const ip = "203.0.113.77";
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) {
      last = await registerPost(
        registerRequest({ email: `${PREFIX}rl-${i}@local.test`, password: "correct-horse" }, ip),
      );
    }
    expect(last!.status).toBe(429);
  });
});
