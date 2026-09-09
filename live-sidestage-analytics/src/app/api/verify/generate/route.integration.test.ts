// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// TikTok ID変更の7日ロック(CAS付き)を実DBで検証する。
// TikTok実在確認・room解決・merge jobは外部依存のためモックし、ロック判定とCASのみを対象にする。
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ADMIN_EMAIL } from "@/lib/admin";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";

const PREFIX = "itest-verifygen-";
// TikTok IDはハイフン不可・24文字以内(isValidNormalizedTiktokHandle)なのでメール等とは別のprefixにする。
const TID_PREFIX = "itestvg_";

const auth = vi.hoisted(() => ({ principalId: null as string | null, email: null as string | null }));
vi.mock("next-auth", () => ({
  getServerSession: async () =>
    auth.principalId ? { user: { id: auth.principalId, email: auth.email } } : null,
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

// tiktokUid を返さないと登録ゲートが「所有の根拠が取れない」として 503 で止める。
// vi.mock のファクトリは巻き上げられるので、外の import を参照せずリテラルで持つ。
vi.mock("@/lib/tiktok-existence", () => ({
  requireExistingTiktokAccount: async () => ({
    ok: true,
    nickname: null,
    tiktokUid: "7000000000000000902",
    preview: { avatarUrl: null, signature: null, followingCount: null, followerCount: null },
  }),
  formatExistenceGateError: () => ({ error: "not used", status: 400 }),
}));

vi.mock("@/lib/tiktok-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tiktok-room")>();
  return {
    ...actual,
    resolveRoomForStreamer: async () => "dummy-room-id",
  };
});

const { POST: verifyGeneratePost } = await import("./route");

function req(tiktokHandle: string) {
  return new NextRequest("https://example.test/api/verify/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tiktokHandle }),
  });
}

async function cleanup() {
  await prisma.streamer.deleteMany({ where: { tiktokHandle: { startsWith: TID_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  auth.principalId = null;
  auth.email = null;
  await cleanup();
});
afterAll(cleanup);

// 上のモックが返す tiktokUid。ハンドル変更が通るのは「同じ tiktokUid の改名」だけなので、
// 変更を許可させたいケースの Streamer はこの値で作る。
const MOCK_TIKTOK_UID = "7000000000000000902";

async function createUserWithStreamer(opts: {
  tiktokHandle: string;
  tiktokHandleChangedAt: Date | null;
  verified?: boolean;
  /** 省略時は実在確認モックと同一 uid(= 同一アカウントの改名として通る) */
  tiktokUid?: string;
}) {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}${Date.now()}@local.test`, name: `${PREFIX}user` },
  });
  const streamer = await prisma.streamer.create({
    data: {
      principalId: user.id,
      tiktokUid: opts.tiktokUid ?? MOCK_TIKTOK_UID,
      tiktokHandle: opts.tiktokHandle,
      verificationCode: "x",
      tiktokHandleChangedAt: opts.tiktokHandleChangedAt,
      verified: opts.verified ?? false,
    },
  });
  return { user, streamer };
}

describe("POST /api/verify/generate — TikTok ID変更7日ロック", () => {
  it("7日未満の変更は409 TIKTOK_ID_CHANGE_LOCKEDを返し、tiktokHandleは変わらない", async () => {
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1日前
    const { user, streamer } = await createUserWithStreamer({
      tiktokHandle: `${TID_PREFIX}old`,
      tiktokHandleChangedAt: changedAt,
    });
    auth.principalId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("TIKTOK_ID_CHANGE_LOCKED");
    expect(body.retryAfter).toBeTruthy();

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}old`);
  });

  it("7日経過後は変更を許可し、tiktokHandleChangedAtを更新する", async () => {
    const changedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8日前
    const { user, streamer } = await createUserWithStreamer({
      tiktokHandle: `${TID_PREFIX}old`,
      tiktokHandleChangedAt: changedAt,
    });
    auth.principalId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tiktokHandle).toBe(`${TID_PREFIX}new`);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new`);
    expect(reloaded.tiktokHandleChangedAt).not.toBeNull();
    expect(reloaded.tiktokHandleChangedAt!.getTime()).toBeGreaterThan(changedAt.getTime());
  });

  it("tiktokHandleChangedAtがnull(migration前の既存streamer)なら即座に変更を許可する", async () => {
    const { user, streamer } = await createUserWithStreamer({
      tiktokHandle: `${TID_PREFIX}old`,
      tiktokHandleChangedAt: null,
    });
    auth.principalId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
    expect(res.status).toBe(200);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new`);
    expect(reloaded.tiktokHandleChangedAt).not.toBeNull();
  });

  it("ロックが明けていても、実在確認で得たtiktokUidが登録済みと異なれば409 TIKTOK_UID_MISMATCHで拒否する", async () => {
    const { user, streamer } = await createUserWithStreamer({
      tiktokHandle: `${TID_PREFIX}old`,
      tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      // モックが返す uid とは別人。ハンドルを空けた第三者への付け替えに相当する。
      tiktokUid: makeTiktokUid(`${TID_PREFIX}other`),
    });
    auth.principalId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("TIKTOK_UID_MISMATCH");

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}old`);
  });

  it("正規化後に値が変わらない場合(冪等リトライ)はロック判定を経ずに常に許可する", async () => {
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // ロック中のはずの1日前
    const { user, streamer } = await createUserWithStreamer({
      tiktokHandle: `${TID_PREFIX}same`,
      tiktokHandleChangedAt: changedAt,
    });
    auth.principalId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}same`));
    expect(res.status).toBe(200);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    // 冪等リトライではtiktokHandleChangedAtは更新されない
    expect(reloaded.tiktokHandleChangedAt?.getTime()).toBe(changedAt.getTime());
  });

  it("新規登録は7日ロックの対象外で、即座にtiktokHandleChangedAtがセットされる", async () => {
    const user = await prisma.user.create({
      data: { email: `${PREFIX}${Date.now()}new@local.test`, name: `${PREFIX}newuser` },
    });
    auth.principalId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}firsttime`));
    expect(res.status).toBe(200);

    const streamer = await prisma.streamer.findUniqueOrThrow({ where: { principalId: user.id } });
    expect(streamer.tiktokHandle).toBe(`${TID_PREFIX}firsttime`);
    expect(streamer.tiktokHandleChangedAt).not.toBeNull();
  });

  it("ADMIN_EMAILのセッションは7日ロック中でも変更を許可し、tiktokHandleChangedAt更新・verifiedリセットは維持される", async () => {
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1日前(通常ならロック中)
    const { user, streamer } = await createUserWithStreamer({
      tiktokHandle: `${TID_PREFIX}old`,
      tiktokHandleChangedAt: changedAt,
      verified: true,
    });
    auth.principalId = user.id;
    auth.email = ADMIN_EMAIL;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tiktokHandle).toBe(`${TID_PREFIX}new`);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new`);
    // ロック免除であっても他の副作用(tiktokHandleChangedAt更新・verifiedリセット)は通常経路と同じ。
    expect(reloaded.tiktokHandleChangedAt!.getTime()).toBeGreaterThan(changedAt.getTime());
    expect(reloaded.verified).toBe(false);
  });
});
// ADMIN_EMAIL経路のCAS(楽観的排他)自体は通常経路と同一コードパスを通る
// (isAdminEmailはロック判定checkTiktokHandleChangeAllowedの呼び出しだけをスキップし、
// updateManyのwhere句(id + tiktokHandleChangedAt)は素通りする)。
// 実際の同時リクエストによる競合再現はTC-LOCK-301と同様にテストでは行わず、
// コードレビュー(review-auto Code Mode、Codex)でこのコードパスの同一性を確認済み。
