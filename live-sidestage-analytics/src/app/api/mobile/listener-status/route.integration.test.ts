// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// モバイルアプリのステータス表示が「配信中」と「配信開始待ち」を区別するための口。
// TiktokRoom.listenerStatus は best effort な値なので、鮮度(listenerUpdatedAt)込みで
// 正規化して返すのがこのルートの責務。判定そのものは listener-liveness.test.ts が持つ。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signMobileToken } from "@/lib/mobile-auth";
import { GET } from "./route";

const TIKTOK_ID = "itest_mobile_listener";

let userId: string;
let roomId: string;
let noRoomUserId: string;
let unverifiedUserId: string;
let token: string;
let noStreamerToken: string;
let noRoomToken: string;
let apiKey: string;
let unverifiedApiKey: string;

process.env.MOBILE_JWT_SECRET ||= "itest-mobile-listener-secret";

function request(opts: { bearer?: string; apiKey?: string } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
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
  const room = await prisma.tiktokRoom.create({ data: { tiktokId: TIKTOK_ID } });
  roomId = room.id;

  const user = await prisma.user.create({
    data: { email: `itest-mobile-listener-${Date.now()}@local.test` },
  });
  userId = user.id;
  apiKey = `itest-listener-key-${Date.now()}`;
  const streamer = await prisma.streamer.create({
    data: { userId, tiktokId: TIKTOK_ID, verificationCode: "x", verified: true, roomId, apiKey },
  });
  token = signMobileToken({ userId, streamerId: streamer.id });

  // streamerId を持たないトークン（オンボーディング途中）。
  noStreamerToken = signMobileToken({ userId });

  // Streamer はあるが部屋がまだ割り当たっていないユーザー。
  const noRoom = await prisma.user.create({
    data: { email: `itest-mobile-listener-noroom-${Date.now()}@local.test` },
  });
  noRoomUserId = noRoom.id;
  const noRoomStreamer = await prisma.streamer.create({
    data: { userId: noRoomUserId, tiktokId: `${TIKTOK_ID}_noroom`, verificationCode: "x" },
  });
  noRoomToken = signMobileToken({ userId: noRoomUserId, streamerId: noRoomStreamer.id });

  // BIO認証が済んでいない配信者。socket 認証と同じく弾かれること。
  const unverified = await prisma.user.create({
    data: { email: `itest-mobile-listener-unverified-${Date.now()}@local.test` },
  });
  unverifiedUserId = unverified.id;
  unverifiedApiKey = `itest-listener-unverified-${Date.now()}`;
  await prisma.streamer.create({
    data: {
      userId: unverifiedUserId,
      tiktokId: `${TIKTOK_ID}_unverified`,
      verificationCode: "x",
      verified: false,
      apiKey: unverifiedApiKey,
    },
  });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: noRoomUserId } }).catch(() => {});
  await prisma.user.delete({ where: { id: unverifiedUserId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {});
  await prisma.$disconnect();
});

describe("GET /api/mobile/listener-status", () => {
  it("トークンが無ければ401", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
  });

  it("streamerIdを持たないトークンは401", async () => {
    const res = await GET(request({ bearer: noStreamerToken }));
    expect(res.status).toBe(401);
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

  // 背景 Isolate は JWT を持たず apiKey しか持たない。socket 認証と同じ資格情報。
  describe("apiKey認証", () => {
    it("apiKeyだけでも取得できる", async () => {
      await setListener("connected", "接続済み", new Date());

      const res = await GET(request({ apiKey }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.listener.live).toBe(true);
    });

    it("不正なapiKeyは401", async () => {
      const res = await GET(request({ apiKey: "not-a-real-key" }));
      expect(res.status).toBe(401);
    });

    // socket 認証(server.js)と条件を揃える。未認証の配信者には配信しない。
    it("verified=falseのapiKeyは401", async () => {
      const res = await GET(request({ apiKey: unverifiedApiKey }));
      expect(res.status).toBe(401);
    });

    it("JWTとapiKeyが別人を指していたら401", async () => {
      const res = await GET(request({ bearer: noRoomToken, apiKey }));
      expect(res.status).toBe(401);
    });

    it("JWTとapiKeyが同じ配信者なら通る", async () => {
      await setListener("connected", "接続済み", new Date());

      const res = await GET(request({ bearer: token, apiKey }));

      expect(res.status).toBe(200);
    });
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
