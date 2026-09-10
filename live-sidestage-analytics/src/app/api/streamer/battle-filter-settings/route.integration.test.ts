// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET, PATCH } from "./route";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";

// セッションをモック化する
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

let principalAId: string;
let streamerAId: string;
let roomAId: string;

let principalBId: string;
let streamerBId: string;
let roomBId: string;

beforeAll(async () => {
  // テスト用の principal A を作成
  const principalA = await prisma.principal.create({
    data: {
      email: `itest-battle-filter-principal-a-${Date.now()}@local.test`,
    },
  });
  principalAId = principalA.id;

  // テスト用の room A を作成
  const hostUidA = makeTiktokUid("itest-battle-filter-a");
  const roomA = await prisma.tiktokRoom.create({
    data: {
      tiktokHandle: "itest_battle_filter_streamer_a",
      hostTiktokUid: hostUidA,
    },
  });
  roomAId = roomA.id;

  // テスト用の streamer A を作成
  const streamerA = await prisma.streamer.create({
    data: {
      principalId: principalAId,
      tiktokUid: hostUidA,
      tiktokHandle: "itest_battle_filter_streamer_a",
      verificationCode: "x",
      verified: true,
      roomId: roomAId,
    },
  });
  streamerAId = streamerA.id;

  // テスト用の principal B を作成
  const principalB = await prisma.principal.create({
    data: {
      email: `itest-battle-filter-principal-b-${Date.now()}@local.test`,
    },
  });
  principalBId = principalB.id;

  // テスト用の room B を作成
  const hostUidB = makeTiktokUid("itest-battle-filter-b");
  const roomB = await prisma.tiktokRoom.create({
    data: {
      tiktokHandle: "itest_battle_filter_streamer_b",
      hostTiktokUid: hostUidB,
    },
  });
  roomBId = roomB.id;

  // テスト用の streamer B を作成
  const streamerB = await prisma.streamer.create({
    data: {
      principalId: principalBId,
      tiktokUid: hostUidB,
      tiktokHandle: "itest_battle_filter_streamer_b",
      verificationCode: "x",
      verified: true,
      roomId: roomBId,
    },
  });
  streamerBId = streamerB.id;
});

afterAll(async () => {
  // クリーンアップ（streamer削除時に onDelete: Cascade で battleHistoryFilterSettings も削除される）
  await prisma.streamer.deleteMany({
    where: { id: { in: [streamerAId, streamerBId] } },
  });
  await prisma.tiktokRoom.deleteMany({
    where: { id: { in: [roomAId, roomBId] } },
  });
  await prisma.principal.deleteMany({
    where: { id: { in: [principalAId, principalBId] } },
  });
  await prisma.$disconnect();
});

describe("GET /api/streamer/battle-filter-settings", () => {
  it("未ログインで401を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/streamer/battle-filter-settings"));
    expect(response.status).toBe(401);
  });

  it("Streamer未登録の principalで404を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    const orphanPrincipal = await prisma.principal.create({
      data: { email: `itest-battle-filter-orphan-${Date.now()}@local.test` },
    });
    mockedGetServerSession.mockResolvedValue({
      user: { id: orphanPrincipal.id },
    } as any);

    const response = await GET(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings"),
    );
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("配信者情報が見つかりません。");

    // クリーンアップ
    await prisma.principal.delete({ where: { id: orphanPrincipal.id } });
  });

  it("設定行がなくデフォルト値を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalAId },
    } as any);

    const response = await GET(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.hideLowDiamondEnabled).toBe(false);
    expect(data.threshold).toBe(100);
  });
});

describe("PATCH /api/streamer/battle-filter-settings", () => {
  it("値を変更できる", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalAId },
    } as any);

    // PATCH で値を変更
    const patchResponse = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({
          hideLowDiamondEnabled: true,
          threshold: 250,
        }),
      }),
    );
    expect(patchResponse.status).toBe(200);
    const patchData = await patchResponse.json();
    expect(patchData.hideLowDiamondEnabled).toBe(true);
    expect(patchData.threshold).toBe(250);

    // GET で反映を確認
    const getResponse = await GET(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings"),
    );
    expect(getResponse.status).toBe(200);
    const getData = await getResponse.json();
    expect(getData.hideLowDiamondEnabled).toBe(true);
    expect(getData.threshold).toBe(250);
  });

  it("threshold が負数で400を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalBId },
    } as any);

    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ threshold: -1 }),
      }),
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("しきい値は0以上の整数で指定してください。");

    // DB不変確認
    const currentValue = await prisma.battleHistoryFilterSettings.findUnique({
      where: { streamerId: streamerBId },
    });
    expect(currentValue).toBeNull();
  });

  it("threshold が小数で400を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalBId },
    } as any);

    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ threshold: 1.5 }),
      }),
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("しきい値は0以上の整数で指定してください。");
  });

  it("threshold が文字列で400を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalBId },
    } as any);

    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ threshold: "abc" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("threshold が boolean で400を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalBId },
    } as any);

    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ threshold: true }),
      }),
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("しきい値は0以上の整数で指定してください。");
  });

  it("threshold が null で400を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalBId },
    } as any);

    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ threshold: null }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("threshold が上限値(2147483647)で200を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalAId },
    } as any);

    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ threshold: 2147483647 }),
      }),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.threshold).toBe(2147483647);
  });

  it("threshold が上限超過(2147483648)で400を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalBId },
    } as any);

    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ threshold: 2147483648 }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("不正なJSONボディでも現在値を返す(空bodyとして扱われる)", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalBId },
    } as any);

    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: "{bad json",
      }),
    );
    expect(response.status).toBe(200);
  });

  it("PATCH で threshold のみ変更しても hideLowDiamondEnabled は維持される", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalAId },
    } as any);

    await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ hideLowDiamondEnabled: true, threshold: 500 }),
      }),
    );

    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ threshold: 777 }),
      }),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.threshold).toBe(777);
    expect(data.hideLowDiamondEnabled).toBe(true);
  });

  it("hideLowDiamondEnabled が文字列で400を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalBId },
    } as any);

    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ hideLowDiamondEnabled: "yes" }),
      }),
    );
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("小さいバトル非表示フラグが不正です。");
  });

  it("他Streamer の行を変更できない", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);

    // streamer A の設定を先に作る
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalAId },
    } as any);
    await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({ threshold: 200 }),
      }),
    );

    // streamer A のセッションで streamer B の streamerId を送信してもダメ
    // (bodyの streamerId は無視されるはず)
    const response = await PATCH(
      new NextRequest("http://localhost/api/streamer/battle-filter-settings", {
        method: "PATCH",
        body: JSON.stringify({
          streamerId: streamerBId,
          threshold: 999,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.threshold).toBe(999);

    // streamer A の値だけが変更されている
    const settingA = await prisma.battleHistoryFilterSettings.findUnique({
      where: { streamerId: streamerAId },
    });
    expect(settingA?.threshold).toBe(999);

    // streamer B の行は存在しない
    const settingB = await prisma.battleHistoryFilterSettings.findUnique({
      where: { streamerId: streamerBId },
    });
    expect(settingB).toBeNull();
  });
});
