// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// jwt session戦略はDBを見ずにtoken.idを素通しするため、モバイルのアカウント削除で
// Userが消えても署名が有効な限りWebセッションが生き続けてしまう。jwtコールバックで
// Userの実在を確認しnullを返すことでセッションを即時失効させる(getServerSession/
// useSessionがnullを返すようになる)。middleware.tsはこのコールバックを経由しない
// (getToken()は署名検証のみ)ため対象外で、実際の防御はgetServerSession()ベースの
// 保護route/layout側で効く。
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "./prisma";
import { authOptions } from "./auth";

const PREFIX = "itest-authjwt-";

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(cleanup);
afterAll(cleanup);

describe("authOptions.callbacks.jwt", () => {
  it("ログイン時(userあり)はDB照会せずtoken.idをセットする", async () => {
    const jwt = authOptions.callbacks!.jwt!;
    // わざとDBに無いidを渡す。サインイン直後はadapterが作った直後のUserなので
    // 実在確認は不要 — ここでDBを見に行くと不要なクエリが増えるだけでなく、
    // 作成直後のレプリケーション遅延等で誤って弾くリスクがある。
    const token = await jwt({ token: {}, user: { id: "not-in-db-id", email: null } } as never);

    expect(token).not.toBeNull();
    expect((token as { id?: string })?.id).toBe("not-in-db-id");
  });

  it("Userが実在する間はtokenをそのまま返す", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}alive@local.test` } });
    const jwt = authOptions.callbacks!.jwt!;

    const token = await jwt({ token: { id: user.id } } as never);

    expect(token).not.toBeNull();
    expect((token as { id?: string })?.id).toBe(user.id);
  });

  it("Userが削除済みならnullを返す(アカウント削除後のWebセッション即時失効)", async () => {
    const user = await prisma.user.create({ data: { email: `${PREFIX}deleted@local.test` } });
    await prisma.user.delete({ where: { id: user.id } });

    const jwt = authOptions.callbacks!.jwt!;
    const token = await jwt({ token: { id: user.id } } as never);

    expect(token).toBeNull();
  });
});
