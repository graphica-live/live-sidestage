// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// TikTok ID変更の7日ロック(CAS付き)を実DBで検証する。
// TikTok実在確認・room解決・merge jobは外部依存のためモックし、ロック判定とCASのみを対象にする。
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ADMIN_EMAIL } from "@/lib/admin";

const PREFIX = "itest-verifygen-";
// TikTok IDはハイフン不可・24文字以内(isValidNormalizedTiktokId)なのでメール等とは別のprefixにする。
const TID_PREFIX = "itestvg_";

const auth = vi.hoisted(() => ({ userId: null as string | null, email: null as string | null }));
vi.mock("next-auth", () => ({
  getServerSession: async () =>
    auth.userId ? { user: { id: auth.userId, email: auth.email } } : null,
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

vi.mock("@/lib/tiktok-existence", () => ({
  requireExistingTiktokAccount: async () => ({ ok: true, userId: null }),
  formatExistenceGateError: () => ({ error: "not used", status: 400 }),
}));

vi.mock("@/lib/tiktok-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tiktok-room")>();
  return {
    ...actual,
    resolveRoomForStreamer: async () => "dummy-room-id",
  };
});

vi.mock("@/lib/tiktok-id-migration", () => ({
  upsertTiktokIdMergeJob: async () => {},
}));

const { POST: verifyGeneratePost } = await import("./route");

function req(tiktokId: string) {
  return new NextRequest("https://example.test/api/verify/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tiktokId }),
  });
}

async function cleanup() {
  await prisma.streamer.deleteMany({ where: { tiktokId: { startsWith: TID_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  auth.userId = null;
  auth.email = null;
  await cleanup();
});
afterAll(cleanup);

async function createUserWithStreamer(opts: {
  tiktokId: string;
  tiktokIdChangedAt: Date | null;
  verified?: boolean;
}) {
  const user = await prisma.user.create({
    data: { email: `${PREFIX}${Date.now()}@local.test`, name: `${PREFIX}user` },
  });
  const streamer = await prisma.streamer.create({
    data: {
      userId: user.id,
      tiktokId: opts.tiktokId,
      verificationCode: "x",
      apiKey: `${PREFIX}${Date.now()}`,
      tiktokIdChangedAt: opts.tiktokIdChangedAt,
      verified: opts.verified ?? false,
    },
  });
  return { user, streamer };
}

describe("POST /api/verify/generate — TikTok ID変更7日ロック", () => {
  it("7日未満の変更は409 TIKTOK_ID_CHANGE_LOCKEDを返し、tiktokIdは変わらない", async () => {
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1日前
    const { user, streamer } = await createUserWithStreamer({
      tiktokId: `${TID_PREFIX}old`,
      tiktokIdChangedAt: changedAt,
    });
    auth.userId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("TIKTOK_ID_CHANGE_LOCKED");
    expect(body.retryAfter).toBeTruthy();

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokId).toBe(`${TID_PREFIX}old`);
  });

  it("7日経過後は変更を許可し、tiktokIdChangedAtを更新する", async () => {
    const changedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8日前
    const { user, streamer } = await createUserWithStreamer({
      tiktokId: `${TID_PREFIX}old`,
      tiktokIdChangedAt: changedAt,
    });
    auth.userId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tiktokId).toBe(`${TID_PREFIX}new`);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokId).toBe(`${TID_PREFIX}new`);
    expect(reloaded.tiktokIdChangedAt).not.toBeNull();
    expect(reloaded.tiktokIdChangedAt!.getTime()).toBeGreaterThan(changedAt.getTime());
  });

  it("tiktokIdChangedAtがnull(migration前の既存streamer)なら即座に変更を許可する", async () => {
    const { user, streamer } = await createUserWithStreamer({
      tiktokId: `${TID_PREFIX}old`,
      tiktokIdChangedAt: null,
    });
    auth.userId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
    expect(res.status).toBe(200);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokId).toBe(`${TID_PREFIX}new`);
    expect(reloaded.tiktokIdChangedAt).not.toBeNull();
  });

  it("正規化後に値が変わらない場合(冪等リトライ)はロック判定を経ずに常に許可する", async () => {
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // ロック中のはずの1日前
    const { user, streamer } = await createUserWithStreamer({
      tiktokId: `${TID_PREFIX}same`,
      tiktokIdChangedAt: changedAt,
    });
    auth.userId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}same`));
    expect(res.status).toBe(200);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    // 冪等リトライではtiktokIdChangedAtは更新されない
    expect(reloaded.tiktokIdChangedAt?.getTime()).toBe(changedAt.getTime());
  });

  it("新規登録は7日ロックの対象外で、即座にtiktokIdChangedAtがセットされる", async () => {
    const user = await prisma.user.create({
      data: { email: `${PREFIX}${Date.now()}new@local.test`, name: `${PREFIX}newuser` },
    });
    auth.userId = user.id;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}firsttime`));
    expect(res.status).toBe(200);

    const streamer = await prisma.streamer.findUniqueOrThrow({ where: { userId: user.id } });
    expect(streamer.tiktokId).toBe(`${TID_PREFIX}firsttime`);
    expect(streamer.tiktokIdChangedAt).not.toBeNull();
  });

  it("ADMIN_EMAILのセッションは7日ロック中でも変更を許可し、tiktokIdChangedAt更新・verifiedリセットは維持される", async () => {
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1日前(通常ならロック中)
    const { user, streamer } = await createUserWithStreamer({
      tiktokId: `${TID_PREFIX}old`,
      tiktokIdChangedAt: changedAt,
      verified: true,
    });
    auth.userId = user.id;
    auth.email = ADMIN_EMAIL;

    const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tiktokId).toBe(`${TID_PREFIX}new`);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokId).toBe(`${TID_PREFIX}new`);
    // ロック免除であっても他の副作用(tiktokIdChangedAt更新・verifiedリセット)は通常経路と同じ。
    expect(reloaded.tiktokIdChangedAt!.getTime()).toBeGreaterThan(changedAt.getTime());
    expect(reloaded.verified).toBe(false);
  });
});
// ADMIN_EMAIL経路のCAS(楽観的排他)自体は通常経路と同一コードパスを通る
// (isAdminEmailはロック判定checkTiktokIdChangeAllowedの呼び出しだけをスキップし、
// updateManyのwhere句(id + tiktokIdChangedAt)は素通りする)。
// 実際の同時リクエストによる競合再現はTC-LOCK-301と同様にテストでは行わず、
// コードレビュー(review-auto Code Mode、Codex)でこのコードパスの同一性を確認済み。
