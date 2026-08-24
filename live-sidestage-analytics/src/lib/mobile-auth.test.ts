// `5a3e97a` 以前に発行された旧トークンを弾くこと（LEGACY_TOKEN_CUTOFF_SEC）を固定する。
//
// 旧 `/api/mobile/auth/register` はメールの所有確認なしに 90 日トークンを発行していた。
// トークンは stateless で失効機構が無いため、下限を外すと 2026-11 月まで有効なまま残る。
import { describe, it, expect, beforeAll } from "vitest";
import jwt from "jsonwebtoken";

const SECRET = "mobile-auth-unit-secret";
process.env.MOBILE_JWT_SECRET = SECRET;

const { signMobileToken, verifyMobileToken } = await import("./mobile-auth");

const CUTOFF_SEC = Math.floor(Date.parse("2026-08-15T02:00:00Z") / 1000);
const NINETY_DAYS_SEC = 90 * 24 * 60 * 60;

/// 指定時刻に発行された 90 日トークンを作る。
/// `exp` は将来のままにしてあるので、弾かれるとしたら期限切れではなく iat 下限が理由。
function signIssuedAt(iatSec: number, payload: Record<string, unknown> = { userId: "u1" }): string {
  return jwt.sign({ ...payload, iat: iatSec, exp: iatSec + NINETY_DAYS_SEC }, SECRET);
}

beforeAll(() => {
  // exp が過去だと「期限切れで落ちただけ」になり、テストの意味が無くなる。
  expect(CUTOFF_SEC + NINETY_DAYS_SEC).toBeGreaterThan(Math.floor(Date.now() / 1000));
});

describe("verifyMobileToken の旧トークン締め出し", () => {
  it("カットオフより前に発行されたトークンは、期限内でも拒否する", () => {
    expect(verifyMobileToken(signIssuedAt(CUTOFF_SEC - 1))).toBeNull();
  });

  it("カットオフちょうどは通す（境界を閉区間で扱う）", () => {
    expect(verifyMobileToken(signIssuedAt(CUTOFF_SEC))).toEqual({
      userId: "u1",
      streamerId: undefined,
    });
  });

  it("カットオフより後に発行されたトークンは通す", () => {
    expect(verifyMobileToken(signIssuedAt(CUTOFF_SEC + 3600, { userId: "u2", streamerId: "s2" }))).toEqual({
      userId: "u2",
      streamerId: "s2",
    });
  });

  it("iat を持たないトークンは拒否する（jwt.sign が必ず付ける前提から外れている）", () => {
    const token = jwt.sign(
      { userId: "u3", exp: Math.floor(Date.now() / 1000) + NINETY_DAYS_SEC },
      SECRET,
      { noTimestamp: true },
    );
    expect(verifyMobileToken(token)).toBeNull();
  });

  it("いま signMobileToken で発行したトークンは通る（現行フローを壊していない）", () => {
    expect(verifyMobileToken(signMobileToken({ userId: "u4", streamerId: "s4" }))).toEqual({
      userId: "u4",
      streamerId: "s4",
    });
  });

  it("署名が違うトークンは従来どおり拒否する", () => {
    const forged = jwt.sign({ userId: "u5", iat: CUTOFF_SEC + 10 }, "wrong-secret");
    expect(verifyMobileToken(forged)).toBeNull();
  });
});
