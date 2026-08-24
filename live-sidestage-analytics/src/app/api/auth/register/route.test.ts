// パスワード登録は既定で閉じている。
//
// ここで作った User は誰もログインできない(bcrypt.compare が無く、authOptions に
// パスワード用 provider も無い)。開いていると「他人のメールで先に User 行を作る」
// ことだけができてしまい、モバイル Google ルートのメール一致リンクと組み合わさる。
//
// **DB にも bcrypt にも触れずに閉じること**が要点なので、prisma を import した時点で
// 接続を張らないことも含めてここで固定する(このファイルは integration ではない)。
import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: string) {
  return new NextRequest("https://example.test/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/auth/register", () => {
  it("既定では 404（存在しないものとして扱う）", async () => {
    const response = await POST(
      request(JSON.stringify({ name: "a", email: "a@example.test", password: "password1" })),
    );

    expect(response.status).toBe(404);
  });

  it("壊れた本文でも 404（本文を読む前に閉じている）", async () => {
    // ここで 500 になるなら req.json() まで到達している＝DB や bcrypt にも届きうる。
    const response = await POST(request("not json"));

    expect(response.status).toBe(404);
  });

  it("環境変数が 1 以外なら開かない", async () => {
    vi.stubEnv("ENABLE_PASSWORD_REGISTER", "true");
    const response = await POST(
      request(JSON.stringify({ name: "a", email: "a@example.test", password: "password1" })),
    );

    expect(response.status).toBe(404);
  });
});
