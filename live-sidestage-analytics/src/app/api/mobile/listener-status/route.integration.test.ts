// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// モバイルアプリのステータス表示が「配信中」と「配信開始待ち」を区別するための口。
// TiktokRoom.listenerStatus は best effort な値なので、鮮度(listenerUpdatedAt)込みで
// 正規化して返すのがこのルートの責務。判定そのものは listener-liveness.test.ts が持つ。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_listener";

let principalId: string;
let roomId: string;
let noRoomPrincipalId: string;
let noStreamerPrincipalId: string;
let unverifiedPrincipalId: string;
let token: string;
let claimlessToken: string;
let noStreamerToken: string;
let noRoomToken: string;
let unverifiedToken: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-listener-secret";

function request(opts: { bearer?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  return new NextRequest("http://localhost/api/mobile/listener-status", { headers });
}

/// 新しい列は明示的に空へ戻す。「列を足す前に書かれた行」の再現でもある。
async function setListener(status: string | null, message: string | null, updatedAt: Date | null) {
  await prisma.tiktokRoom.update({
    where: { id: roomId },
    data: {
      listenerStatus: status,
      listenerMessage: message,
      listenerUpdatedAt: updatedAt,
      listenerActivity: null,
      listenerHealth: null,
      listenerReason: null,
      listenerRevision: null,
    },
  });
}

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({
    data: { tiktokHandle: TIKTOK_ID, hostTiktokUid: makeTiktokUid(TIKTOK_ID) },
  });
  roomId = room.id;

  const user = await prisma.principal.create({
    data: { email: `itest-mobile-listener-${Date.now()}@local.test` },
  });
  principalId = user.id;
  const streamer = await prisma.streamer.create({
    data: {
      principalId,
      tiktokUid: makeTiktokUid(TIKTOK_ID),
      tiktokHandle: TIKTOK_ID,
      verificationCode: "x",
      verified: true,
      roomId,
    },
  });
  token = signMobileToken({ principalId, streamerId: streamer.id });

  // streamerId クレームを持たないトークン（オンボーディング途中に発行されたもの）。
  // ルートはクレームを見ずに principalId から引き直すので、これでも解決できる。
  claimlessToken = signMobileToken({ principalId });

  // Streamer が1件も無いユーザー（オンボーディング未完了）。
  const noStreamer = await prisma.principal.create({
    data: { email: `itest-mobile-listener-nostreamer-${Date.now()}@local.test` },
  });
  noStreamerPrincipalId = noStreamer.id;
  noStreamerToken = signMobileToken({ principalId: noStreamerPrincipalId });

  // Streamer はあるが部屋がまだ割り当たっていないユーザー。
  const noRoom = await prisma.principal.create({
    data: { email: `itest-mobile-listener-noroom-${Date.now()}@local.test` },
  });
  noRoomPrincipalId = noRoom.id;
  const noRoomStreamer = await prisma.streamer.create({
    data: {
      principalId: noRoomPrincipalId,
      tiktokUid: makeTiktokUid(`${TIKTOK_ID}_noroom`),
      tiktokHandle: `${TIKTOK_ID}_noroom`,
      verificationCode: "x",
    },
  });
  noRoomToken = signMobileToken({ principalId: noRoomPrincipalId, streamerId: noRoomStreamer.id });

  // BIO認証が済んでいない配信者。モバイルはBIO認証ゲート対象外なので弾かれないこと。
  const unverified = await prisma.principal.create({
    data: { email: `itest-mobile-listener-unverified-${Date.now()}@local.test` },
  });
  unverifiedPrincipalId = unverified.id;
  const unverifiedStreamer = await prisma.streamer.create({
    data: {
      principalId: unverifiedPrincipalId,
      tiktokUid: makeTiktokUid(`${TIKTOK_ID}_unverified`),
      tiktokHandle: `${TIKTOK_ID}_unverified`,
      verificationCode: "x",
      verified: false,
    },
  });
  unverifiedToken = signMobileToken({
    principalId: unverifiedPrincipalId,
    streamerId: unverifiedStreamer.id,
  });
});

afterAll(async () => {
  await prisma.principal.delete({ where: { id: principalId } }).catch(() => {});
  await prisma.principal.delete({ where: { id: noRoomPrincipalId } }).catch(() => {});
  await prisma.principal.delete({ where: { id: noStreamerPrincipalId } }).catch(() => {});
  await prisma.principal.delete({ where: { id: unverifiedPrincipalId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {});
  await prisma.$disconnect();
});

describe("GET /api/mobile/listener-status", () => {
  it("トークンが無ければ401", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
  });

  it("Streamer未登録のユーザーのトークンは401", async () => {
    const res = await GET(request({ bearer: noStreamerToken }));
    expect(res.status).toBe(401);
  });

  // JWTの streamerId クレームは信用せず principalId から引き直す規律。
  // クレームが無い(オンボーディング途中に発行された)トークンでも解決できる。
  it("streamerIdクレームが無いトークンでもprincipalIdから解決する", async () => {
    await setListener("connected", "接続済み", new Date());

    const res = await GET(request({ bearer: claimlessToken }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.listener.roomId).toBe(roomId);
  });

  // モバイルはBIO認証ゲート対象外。socket認証(server.js)と条件を揃える。
  it("verified=falseでも401にしない", async () => {
    const res = await GET(request({ bearer: unverifiedToken }));
    expect(res.status).toBe(200);
  });

  it("部屋が未割り当てならlistenerはnull(エラーではない)", async () => {
    const res = await GET(request({ bearer: noRoomToken }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listener).toBeNull();
    expect(typeof body.observedAt).toBe("string");
  });

  it("新鮮なconnectedは配信中として返す", async () => {
    await setListener("connected", "接続済み", new Date());

    const res = await GET(request({ bearer: token }));
    const body = await res.json();

    expect(body.listener.status).toBe("connected");
    expect(body.listener.live).toBe(true);
    expect(body.listener.stale).toBe(false);
    expect(body.listener.message).toBe("接続済み");
  });

  // オフラインの配信者へは再接続ループが回り続ける。異常ではなく「配信開始待ち」。
  it("retryingは配信中にしない", async () => {
    await setListener("retrying", "再接続中", new Date());

    const res = await GET(request({ bearer: token }));
    const body = await res.json();

    expect(body.listener.live).toBe(false);
    expect(body.listener.stale).toBe(false);
    expect(body.listener.status).toBe("retrying");
  });

  // heartbeat が止まった = Worker が落ちている。配信中のまま残してはいけない。
  it("古いconnectedはstaleにして配信中と言わない", async () => {
    await setListener("connected", "接続済み", new Date(Date.now() - 120_000));

    const res = await GET(request({ bearer: token }));
    const body = await res.json();

    expect(body.listener.live).toBe(false);
    expect(body.listener.stale).toBe(true);
  });

  it("listenerUpdatedAtが無ければstale", async () => {
    await setListener("connected", null, null);

    const res = await GET(request({ bearer: token }));
    const body = await res.json();

    expect(body.listener.live).toBe(false);
    expect(body.listener.stale).toBe(true);
    expect(body.listener.updatedAt).toBeNull();
  });

  it("キャッシュされないようCache-Controlを付ける", async () => {
    await setListener("connected", "接続済み", new Date());

    const res = await GET(request({ bearer: token }));

    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  // 列を足す前に書かれた行、および旧Workerが書いた行。
  describe("listenerActivity が空の行(後方互換)", () => {
    it("connectedならliveとみなす", async () => {
      await setListener("connected", "接続済み", new Date());
      const body = await (await GET(request({ bearer: token }))).json();
      expect(body.listener.activity).toBe("live");
      expect(body.listener.live).toBe(true);
    });

    // retrying はオフライン・接続失敗・レート制限のすべてに使われるので断定できない。
    it("retryingはunknownへ倒す", async () => {
      await setListener("retrying", "再接続中", new Date());
      const body = await (await GET(request({ bearer: token }))).json();
      expect(body.listener.activity).toBe("unknown");
    });
  });

  describe("新しい列がある行", () => {
    it("activity/health/reason をそのまま返す", async () => {
      await prisma.tiktokRoom.update({
        where: { id: roomId },
        data: {
          listenerStatus: "retrying",
          listenerMessage: "配信認証の混雑により接続を待機中です",
          listenerUpdatedAt: new Date(),
          listenerActivity: "unknown",
          listenerHealth: "error",
          listenerReason: "rate_limited",
          listenerRevision: 12345n,
        },
      });

      const body = await (await GET(request({ bearer: token }))).json();

      expect(body.listener.activity).toBe("unknown");
      expect(body.listener.health).toBe("error");
      expect(body.listener.reason).toBe("rate_limited");
      expect(body.listener.live).toBe(false);
      // 端末は (roomId, revision) で push と poll の新旧を判定する。
      expect(body.listener.roomId).toBe(roomId);
      expect(body.listener.revision).toBe("12345");
    });
  });
});
