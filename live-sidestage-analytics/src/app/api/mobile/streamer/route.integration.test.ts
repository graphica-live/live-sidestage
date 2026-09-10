// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// TikTok ID変更の7日ロックがmobile PATCH経路でも機能することを検証する。
// コアのCAS/ロック判定ロジックは verify/generate/route.integration.test.ts で網羅済みのため、
// ここでは経路固有の代表ケース(ロック中409、既存verifiedのリセット)のみを対象にする。
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { ADMIN_EMAIL } from "@/lib/admin";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { resolveRoomForStreamer } from "@/lib/tiktok-room";

const PREFIX = "itest-mobstreamer-";
const TID_PREFIX = "itestms_";

// tiktokUid を返さないと route が「所有の根拠が取れない」として 503 で止める。
// vi.mock のファクトリは巻き上げられるので、外の import を参照せずリテラルで持つ。
vi.mock("@/lib/tiktok-existence", () => ({
  requireExistingTiktokAccount: async () => ({
    ok: true,
    nickname: null,
    tiktokUid: "7000000000000000901",
    preview: { avatarUrl: null, signature: null, followingCount: null, followerCount: null },
  }),
}));

// 上のモックが返す tiktokUid。ハンドル変更が通るのは「同じ tiktokUid の改名」だけなので、
// 変更を許可させたいケースの Streamer はこの値で作る。
const MOCK_TIKTOK_UID = "7000000000000000901";

vi.mock("@/lib/tiktok-room", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tiktok-room")>();
  return {
    ...actual,
    resolveRoomForStreamer: vi.fn(async () => "dummy-room-id"),
  };
});

// room再解決の検証専用: モックを迂回して実装本体を取得しておく(TC-ROOM-RESOLVEで使用)。
const actualTiktokRoom =
  await vi.importActual<typeof import("@/lib/tiktok-room")>("@/lib/tiktok-room");

const { PATCH: streamerPatch } = await import("./route");

function authedRequest(token: string, tiktokHandle: string) {
  return new NextRequest("https://example.test/api/mobile/streamer", {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tiktokHandle }),
  });
}

async function cleanup() {
  await prisma.streamer.deleteMany({ where: { tiktokHandle: { startsWith: TID_PREFIX } } });
  await prisma.principal.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanup();
});
afterAll(cleanup);

describe("PATCH /api/mobile/streamer — TikTok ID変更7日ロック", () => {
  it("ロック中は409 TIKTOK_ID_CHANGE_LOCKEDを返し、tiktokHandleは変わらない", async () => {
    const user = await prisma.principal.create({
      data: { email: `${PREFIX}${Date.now()}@local.test`, name: `${PREFIX}user` },
    });
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const streamer = await prisma.streamer.create({
      data: {
        principalId: user.id,
        tiktokUid: makeTiktokUid(`${TID_PREFIX}old`),
        tiktokHandle: `${TID_PREFIX}old`,
        verificationCode: "x",
        tiktokHandleChangedAt: changedAt,
        verified: true,
      },
    });
    const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

    const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new`));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("TIKTOK_ID_CHANGE_LOCKED");

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}old`);
    expect(reloaded.verified).toBe(true);
  });

  it("7日経過後の変更は許可され、古いverifiedはリセットされる", async () => {
    const user = await prisma.principal.create({
      data: { email: `${PREFIX}${Date.now()}@local.test`, name: `${PREFIX}user2` },
    });
    const changedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const streamer = await prisma.streamer.create({
      data: {
        principalId: user.id,
        tiktokUid: MOCK_TIKTOK_UID,
        tiktokHandle: `${TID_PREFIX}old2`,
        verificationCode: "x",
        tiktokHandleChangedAt: changedAt,
        verified: true,
      },
    });
    const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

    const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new2`));
    expect(res.status).toBe(200);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new2`);
    expect(reloaded.verified).toBe(false);
    expect(reloaded.tiktokHandleChangedAt!.getTime()).toBeGreaterThan(changedAt.getTime());
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
      const user = await prisma.principal.create({
        data: { email: `${PREFIX}${Date.now()}mm@local.test`, name: `${PREFIX}user3` },
      });
      const streamer = await prisma.streamer.create({
        data: {
          principalId: user.id,
          // モックが返す uid とは別人。ハンドルを空けた第三者への付け替えに相当する。
          tiktokUid: makeTiktokUid(`${TID_PREFIX}other`),
          tiktokHandle: `${TID_PREFIX}old3`,
          verificationCode: "x",
          tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          verified: true,
        },
      });
      const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

      const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new3`));
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe("TIKTOK_UID_MISMATCH");

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}old3`);
      expect(reloaded.verified).toBe(true);
    });

    it("既定(未設定=無効化)状態では、tiktokUidが登録済みと異なっても200で許可される(tiktokUidも新しい値へ更新される)", async () => {
      delete process.env[ENV_KEY];
      const user = await prisma.principal.create({
        data: { email: `${PREFIX}${Date.now()}mm2@local.test`, name: `${PREFIX}user4` },
      });
      const streamer = await prisma.streamer.create({
        data: {
          principalId: user.id,
          tiktokUid: makeTiktokUid(`${TID_PREFIX}other2`),
          tiktokHandle: `${TID_PREFIX}old4`,
          verificationCode: "x",
          tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          verified: true,
        },
      });
      const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

      const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new4`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.streamer.tiktokHandle).toBe(`${TID_PREFIX}new4`);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new4`);
      expect(reloaded.tiktokUid).toBe(MOCK_TIKTOK_UID);
    });

    it("チェック有効時(\"0\")でも、ADMIN_EMAILのユーザーはtiktokUid不一致でも200で許可される", async () => {
      process.env[ENV_KEY] = "0";
      const user = await prisma.principal.create({
        data: { email: ADMIN_EMAIL, name: `${PREFIX}admin2` },
      });
      try {
        const streamer = await prisma.streamer.create({
          data: {
            principalId: user.id,
            tiktokUid: makeTiktokUid(`${TID_PREFIX}other3`),
            tiktokHandle: `${TID_PREFIX}adminold2`,
            verificationCode: "x",
            tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
            verified: true,
          },
        });
        const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

        const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}adminnew2`));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.streamer.tiktokHandle).toBe(`${TID_PREFIX}adminnew2`);
      } finally {
        await prisma.streamer.deleteMany({ where: { principalId: user.id } });
        await prisma.principal.delete({ where: { id: user.id } });
      }
    });

    it("チェック有効時(\"0\")でも、tiktokUidが一致していれば200で許可される", async () => {
      process.env[ENV_KEY] = "0";
      const user = await prisma.principal.create({
        data: { email: `${PREFIX}${Date.now()}mm3@local.test`, name: `${PREFIX}user5` },
      });
      const streamer = await prisma.streamer.create({
        data: {
          principalId: user.id,
          // tiktokUid省略なし = 実在確認モックと同一uid(同一アカウントの改名)。
          tiktokUid: MOCK_TIKTOK_UID,
          tiktokHandle: `${TID_PREFIX}old5`,
          verificationCode: "x",
          tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          verified: true,
        },
      });
      const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

      const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}new5`));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.streamer.tiktokHandle).toBe(`${TID_PREFIX}new5`);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}new5`);
      expect(reloaded.tiktokUid).toBe(MOCK_TIKTOK_UID);
    });
  });

  it("ADMIN_EMAILのユーザーは7日ロック中でも変更を許可し、tiktokHandleChangedAt更新・verifiedリセットは維持される", async () => {
    const changedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1日前(通常ならロック中)
    const user = await prisma.principal.create({
      data: { email: ADMIN_EMAIL, name: `${PREFIX}admin` },
    });
    try {
      const streamer = await prisma.streamer.create({
        data: {
          principalId: user.id,
          tiktokUid: MOCK_TIKTOK_UID,
          tiktokHandle: `${TID_PREFIX}adminold`,
          verificationCode: "x",
          tiktokHandleChangedAt: changedAt,
          verified: true,
        },
      });
      const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

      const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}adminnew`));
      expect(res.status).toBe(200);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}adminnew`);
      // ロック免除であっても他の副作用(tiktokHandleChangedAt更新・verifiedリセット)は通常経路と同じ。
      expect(reloaded.tiktokHandleChangedAt!.getTime()).toBeGreaterThan(changedAt.getTime());
      expect(reloaded.verified).toBe(false);
    } finally {
      await prisma.streamer.deleteMany({ where: { principalId: user.id } });
      await prisma.principal.delete({ where: { id: user.id } });
    }
  });

  it("冪等リトライ(完全同一ハンドル再送信)ではtiktokUidが変化しない", async () => {
    const user = await prisma.principal.create({
      data: { email: `${PREFIX}${Date.now()}idem@local.test`, name: `${PREFIX}user6` },
    });
    const originalUid = makeTiktokUid(`${TID_PREFIX}idemuid`);
    const streamer = await prisma.streamer.create({
      data: {
        principalId: user.id,
        tiktokUid: originalUid,
        tiktokHandle: `${TID_PREFIX}idem6`,
        verificationCode: "x",
        tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        verified: true,
      },
    });
    const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

    // 完全に同一のハンドルを再送信(正規化後も一致) = 真の冪等リトライ。実在確認は走らない。
    const res = await streamerPatch(authedRequest(token, `${TID_PREFIX}idem6`));
    expect(res.status).toBe(200);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(`${TID_PREFIX}idem6`);
    // verifiedTiktokUidがnull(実在確認未実施)のままなので、tiktokUidは一切触れられない。
    expect(reloaded.tiktokUid).toBe(originalUid);
    expect(reloaded.verified).toBe(true);
  });

  it("ハンドル変更後、Streamer.roomIdは新tiktokUidに対応する既存roomへ正しく付け替わる(room再解決)", async () => {
    const user = await prisma.principal.create({
      data: { email: `${PREFIX}${Date.now()}room@local.test`, name: `${PREFIX}user7` },
    });
    const oldUid = makeTiktokUid(`${TID_PREFIX}roomold`);
    const oldHandle = `${TID_PREFIX}roomold`;
    const newHandle = `${TID_PREFIX}roomnew`;

    // 旧tiktokUidに対応するroom(現在streamerが紐付いている)。
    const roomA = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: oldUid, tiktokHandle: oldHandle },
    });
    // 新tiktokUid(モックが返すMOCK_TIKTOK_UID)に対応する、既に存在する孤立room。
    // streamerとは未紐付けだが、ギフトデータ等の実体を持つ想定。
    const roomB = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: MOCK_TIKTOK_UID, tiktokHandle: newHandle },
    });

    try {
      const streamer = await prisma.streamer.create({
        data: {
          principalId: user.id,
          tiktokUid: oldUid,
          tiktokHandle: oldHandle,
          verificationCode: "x",
          tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          verified: true,
          roomId: roomA.id,
        },
      });
      const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

      // このテストに限り、resolveRoomForStreamer()の実装本体を使う
      // (ファイル全体のモックは"dummy-room-id"固定で、room再解決の検証ができないため)。
      vi.mocked(resolveRoomForStreamer).mockImplementationOnce(actualTiktokRoom.resolveRoomForStreamer);

      const res = await streamerPatch(authedRequest(token, newHandle));
      expect(res.status).toBe(200);

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      expect(reloaded.tiktokUid).toBe(MOCK_TIKTOK_UID);
      // 新規roomを作らず、既存の孤立roomBへ吸着していること。
      expect(reloaded.roomId).toBe(roomB.id);

      const reloadedRoomB = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: roomB.id } });
      expect(reloadedRoomB.hostTiktokUid).toBe(MOCK_TIKTOK_UID);
    } finally {
      await prisma.streamer.deleteMany({ where: { principalId: user.id } });
      await prisma.tiktokRoom.deleteMany({ where: { id: { in: [roomA.id, roomB.id] } } });
    }
  });

  it("大文字小文字のみのハンドル変更(正規化後は一致)でも実在確認が走り、tiktokUidが検証済みの値へ追従しverifiedがリセットされる", async () => {
    const user = await prisma.principal.create({
      data: { email: `${PREFIX}${Date.now()}case@local.test`, name: `${PREFIX}user8` },
    });
    const originalHandle = `${TID_PREFIX}casetest`;
    const streamer = await prisma.streamer.create({
      data: {
        principalId: user.id,
        tiktokUid: MOCK_TIKTOK_UID,
        tiktokHandle: originalHandle,
        verificationCode: "x",
        tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        verified: true,
      },
    });
    const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

    // 大文字小文字だけ変更(normalizeTiktokId後は同一値)。生文字列比較の外側ゲート(162行目)は
    // 通過するため実在確認は走り、verifiedTiktokUidがセットされる。
    const changedCaseHandle = `${TID_PREFIX}CaseTest`;
    const res = await streamerPatch(authedRequest(token, changedCaseHandle));
    expect(res.status).toBe(200);

    const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(reloaded.tiktokHandle).toBe(changedCaseHandle);
    expect(reloaded.tiktokUid).toBe(MOCK_TIKTOK_UID);
    // 真の冪等リトライ(verified変化なし)と区別する決定的な観測点:
    // この分岐はverifiedTiktokUidを検証済み値として書き込むため、通常分岐と同じくverifiedがリセットされる。
    expect(reloaded.verified).toBe(false);
    expect(reloaded.verifiedAt).toBeNull();
  });

  it("事前読取後にハンドル不変と判定(冪等リトライのつもり)したが、tx内再読取までに別リクエストが実際にハンドルを変えていた場合はfail-closedで409 CONFLICTを返し、DBはBの値のまま変化しない", async () => {
    const user = await prisma.principal.create({
      data: { email: `${PREFIX}${Date.now()}race@local.test`, name: `${PREFIX}user9` },
    });
    const originalHandle = `${TID_PREFIX}racehandle`;
    const winnerHandle = `${TID_PREFIX}racewinner`;
    const winnerUid = makeTiktokUid(`${TID_PREFIX}racewinneruid`);
    const streamer = await prisma.streamer.create({
      data: {
        principalId: user.id,
        tiktokUid: MOCK_TIKTOK_UID,
        tiktokHandle: originalHandle,
        verificationCode: "x",
        tiktokHandleChangedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        verified: true,
      },
    });
    const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

    // リクエストAは自分視点で「同一ハンドル」の冪等リトライのつもり(外側ゲートでentryCheckがスキップされ、
    // verifiedTiktokUidはnullのまま)。しかしtxコールバック実行直前に別リクエストBが実際にハンドルを
    // 変更済みにしておく(prisma.$transactionへの割り込みでレースを再現)。
    const originalTransaction = prisma.$transaction.bind(prisma);
    const transactionSpy = vi
      .spyOn(prisma, "$transaction")
      .mockImplementationOnce(async (fn: any, opts?: any) => {
        await prisma.streamer.update({
          where: { id: streamer.id },
          data: {
            tiktokHandle: winnerHandle,
            tiktokUid: winnerUid,
            tiktokHandleChangedAt: new Date(),
          },
        });
        return originalTransaction(fn, opts);
      });

    try {
      const res = await streamerPatch(authedRequest(token, originalHandle));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("CONFLICT");

      const reloaded = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
      // Bの書き込みが保持されたまま。AによってnullやoriginalHandleへ巻き戻されていない。
      expect(reloaded.tiktokHandle).toBe(winnerHandle);
      expect(reloaded.tiktokUid).toBe(winnerUid);
    } finally {
      transactionSpy.mockRestore();
    }
  });
});
// ADMIN_EMAIL経路のCAS(楽観的排他)自体は通常経路と同一コードパスを通る。
// 実際の同時リクエストによる競合再現はTC-LOCK-301と同様にテストでは行わず、
// コードレビュー(review-auto Code Mode、Codex)でこのコードパスの同一性を確認済み。
