// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// ENABLE_PASSWORD_REGISTER=1 を立てたときだけ従来どおり動くこと。
// 無効時の挙動は route.test.ts(DB 不要)で見ている。
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";

const PREFIX = "itest-register-";

function request(body: unknown) {
  return new NextRequest("https://example.test/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.stubEnv("ENABLE_PASSWORD_REGISTER", "1");
  await cleanup();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(cleanup);

describe("POST /api/auth/register (ENABLE_PASSWORD_REGISTER=1)", () => {
  it("User を作る。パスワードは平文で保存しない", async () => {
    const email = `${PREFIX}new@local.test`;
    const response = await POST(request({ name: "テスト", email, password: "password1" }));

    expect(response.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.name).toBe("テスト");
    expect(user?.password).not.toBe("password1");
  });

  it("同じメールは二重に登録できない", async () => {
    const email = `${PREFIX}dup@local.test`;
    await POST(request({ name: "テスト", email, password: "password1" }));
    const response = await POST(request({ name: "テスト", email, password: "password1" }));

    expect(response.status).toBe(400);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it("項目不足とパスワード長は 400", async () => {
    expect((await POST(request({ email: `${PREFIX}a@local.test`, password: "password1" }))).status).toBe(400);
    expect(
      (await POST(request({ name: "テスト", email: `${PREFIX}b@local.test`, password: "short" }))).status,
    ).toBe(400);
  });
});
