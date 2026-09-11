// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// TikTok ID変更の7日ロック(CAS付き)を実DBで検証する。
// TikTok実在確認・room解決・merge jobは外部依存のためモックし、ロック判定とCASのみを対象にする。
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
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

let actualResolveRoomForStreamer: (streamerId: string) => Promise<string>;

vi.mock("@/lib/tiktok-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tiktok-room")>();
  actualResolveRoomForStreamer = actual.resolveRoomForStreamer;
  return {
    ...actual,
    resolveRoomForStreamer: vi.fn(async () => "dummy-room-id"),
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
  await prisma.principal.deleteMany({ where: { email: { startsWith: PREFIX } } });
  // TC-LOCK-106がTiktokRoomを直接作成するため、streamer削除では消えない。
  // 消し忘れると次回実行時にhostTiktokUid一意制約で失敗する(pre-existing欠陥、2026-09-11修正)。
  await prisma.tiktokRoom.deleteMany({ where: { tiktokHandle: { startsWith: TID_PREFIX } } });
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
  const user = await prisma.principal.create({
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

  describe("UID mismatchチェック(TIKTOK_UID_MISMATCH_CHECK_DISABLED)", () => {
    const ENV_KEY = "TIKTOK_UID_MISMATCH_CHECK_DISABLED";
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env[ENV_KEY];
    });
    afterEach(() => {
      if (originalEnv === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = originalEnv;
    });

    it("チェック有効時(\"0\")は、実在確認で得たtiktokUidが登録済みと異なれば409 TIKTOK_UID_MISMATCHで拒否する", async () => {
      process.env[ENV_KEY] = "0";
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

    it("既定(未設定=無効化)状態では、tiktokUidが登録済みと異なっても200で許可される", async () => {
      delete process.env[ENV_KEY];
      const { user, streamer } = await createUserWithStreamer({
        tiktokHandle: `${TID_PREFIX}old`,
        tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        tiktokUid: makeTiktokUid(`${TID_PREFIX}other`),
      });
      auth.principalId = user.id;

      const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.tiktokHandle).toBe(`${TID_PREFIX}new`);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new`);
      // UID mismatchチェックが無効化されているため同一ハンドル変更は200。tiktokUidは実在確認で得た新しい値へ追従。
      expect(reloaded.tiktokUid).toBe(MOCK_TIKTOK_UID);
    });

    it("チェック有効時(\"0\")でも、ADMIN_EMAILのセッションはtiktokUid不一致でも200で許可される", async () => {
      process.env[ENV_KEY] = "0";
      const { user, streamer } = await createUserWithStreamer({
        tiktokHandle: `${TID_PREFIX}old`,
        tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        tiktokUid: makeTiktokUid(`${TID_PREFIX}other`),
      });
      auth.principalId = user.id;
      auth.email = ADMIN_EMAIL;

      const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.tiktokHandle).toBe(`${TID_PREFIX}new`);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new`);
    });

    it("チェック有効時(\"0\")でも、tiktokUidが一致していれば200で許可される", async () => {
      process.env[ENV_KEY] = "0";
      const { user, streamer } = await createUserWithStreamer({
        tiktokHandle: `${TID_PREFIX}old`,
        tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        // tiktokUid省略 = 実在確認モックと同一uid(同一アカウントの改名)。
      });
      auth.principalId = user.id;

      const res = await verifyGeneratePost(req(`${TID_PREFIX}new`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.tiktokHandle).toBe(`${TID_PREFIX}new`);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new`);
      expect(reloaded.tiktokUid).toBe(MOCK_TIKTOK_UID);
    });
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
    // 同一アカウントなのでtiktokUidは実質無変化(モック値 = DB既存値)
    expect(reloaded.tiktokUid).toBe(MOCK_TIKTOK_UID);
  });

  it("新規登録は7日ロックの対象外で、即座にtiktokHandleChangedAtがセットされる", async () => {
    const user = await prisma.principal.create({
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

  it("TC-LOCK-106: ハンドル変更後、Streamer.roomIdは新tiktokUidに対応する既存roomへ正しく付け替わる", async () => {
    // room再解決の実証: resolveRoomForStreamerを実実装へ委譲し、
    // ハンドル変更時にroom A(旧tiktokUid)からroom B(新tiktokUid)へ付け替わることを検証する。
    const { user, streamer } = await createUserWithStreamer({
      tiktokHandle: `${TID_PREFIX}oldhandle`,
      tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      tiktokUid: makeTiktokUid(`${TID_PREFIX}olduid`),
    });

    // 旧tiktokUid対応のroom A(既に存在)
    const roomA = await prisma.tiktokRoom.create({
      data: {
        tiktokHandle: `${TID_PREFIX}oldaccount`,
        hostTiktokUid: makeTiktokUid(`${TID_PREFIX}olduid`),
      },
    });

    // Streamer.roomIdをroom Aへ紐付け
    await prisma.streamer.update({
      where: { id: streamer.id },
      data: { roomId: roomA.id },
    });

    // 新tiktokUid対応のroom B(ハンドル変更時に対応させる)
    const roomB = await prisma.tiktokRoom.create({
      data: {
        tiktokHandle: `${TID_PREFIX}newaccount`,
        hostTiktokUid: MOCK_TIKTOK_UID, // モックが返すtiktokUid
      },
    });

    auth.principalId = user.id;

    // resolveRoomForStreamerを実実装へ委譲するmockImplementationOnceを設定
    // (モックのデフォルトは"dummy-room-id"を返すが、このテストだけ実装へ委譲)
    const { resolveRoomForStreamer } = await import("@/lib/tiktok-room");
    vi.mocked(resolveRoomForStreamer).mockImplementationOnce(
      actualResolveRoomForStreamer
    );

    try {
      const res = await verifyGeneratePost(req(`${TID_PREFIX}newhandle`));
      expect(res.status).toBe(200);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      // ハンドル変更後、roomIdが新tiktokUidに対応するroom Bへ付け替わることを検証
      expect(reloaded.roomId).toBe(roomB.id);
      expect(reloaded.tiktokUid).toBe(MOCK_TIKTOK_UID);
    } finally {
      // cleanup: このテストで作成したroom A・Bは明示的に削除
      // (既存cleanup()はStreamer/Principalのみ削除しroomを扱わないため。assertion失敗時も
      // 確実に削除しテストDBへのroom leakを防ぐ)
      await prisma.tiktokRoom.deleteMany({ where: { id: { in: [roomA.id, roomB.id] } } });
    }
  });

  it("TC-LOCK-107: 大文字小文字のみ変更した場合、冪等分岐を通ってtiktokUidがmocker値へ更新される", async () => {
    // 大文字小文字のみ異なるハンドルを送信すると、normalizeTiktokId()がnormalize後に
    // 値が変わらないと判定し冪等分岐を通る。その時もtiktokUidは実在確認モックの値へ更新される。
    const { user, streamer } = await createUserWithStreamer({
      tiktokHandle: `${TID_PREFIX}Sample`,
      tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      // モック値と異なる別のtiktokUid(書き込まれたことを明確に検証するため)
      tiktokUid: makeTiktokUid(`${TID_PREFIX}other`),
    });
    auth.principalId = user.id;

    // 大文字小文字のみ異なる値を送信
    const res = await verifyGeneratePost(req(`${TID_PREFIX}sample`)); // lowercaseに変更
    expect(res.status).toBe(200);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    // 大文字小文字の違いは正規化後に消えるため、tiktokHandleは正規化後の値(小文字)が保存される
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}sample`);
    // tiktokUidは事前値(makeTiktokUid other)からmocker値へ更新される
    expect(reloaded.tiktokUid).toBe(MOCK_TIKTOK_UID);
  });
});
// ADMIN_EMAIL経路のCAS(楽観的排他)自体は通常経路と同一コードパスを通る
// (isAdminEmailはロック判定checkTiktokHandleChangeAllowedの呼び出しだけをスキップし、
// updateManyのwhere句(id + tiktokHandleChangedAt)は素通りする)。
// 実際の同時リクエストによる競合再現はTC-LOCK-301と同様にテストでは行わず、
// コードレビュー(review-auto Code Mode、Codex)でこのコードパスの同一性を確認済み。
