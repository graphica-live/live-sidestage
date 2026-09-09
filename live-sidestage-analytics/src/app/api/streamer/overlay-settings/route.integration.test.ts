// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET, PATCH } from "./route";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";

// セッションをモック化する
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

let principalId: string;
let streamerId: string;
let roomId: string;

beforeAll(async () => {
  // テスト用の principal (user) を作成
  const principal = await prisma.principal.create({
    data: { email: `itest-overlay-route-${Date.now()}@local.test` },
  });
  principalId = principal.id;

  // テスト用の room を作成
  const hostUid = makeTiktokUid("itest-overlay-route-host");
  const room = await prisma.tiktokRoom.create({
    data: { tiktokHandle: "itest_overlay_route_streamer", hostTiktokUid: hostUid },
  });
  roomId = room.id;

  // テスト用の streamer を作成（settings なし）
  const streamer = await prisma.streamer.create({
    data: {
      principalId,
      tiktokUid: hostUid,
      tiktokHandle: "itest_overlay_route_streamer",
      verificationCode: "x",
      verified: true,
      roomId,
    },
  });
  streamerId = streamer.id;
});

afterAll(async () => {
  // クリーンアップ
  await prisma.streamer.delete({ where: { id: streamerId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: roomId } }).catch(() => {});
  await prisma.principal.delete({ where: { id: principalId } }).catch(() => {});
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("GET /api/streamer/overlay-settings", () => {
  it("設定行がなくデフォルト値を返す", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalId },
    } as any);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.threshold).toBe(1000); // デフォルト値
    expect(data.goalCount).toBe(5); // デフォルト値
    expect(data.visibleRows).toBe(5); // デフォルト値
    expect(data.nameMaxWidth).toBe(140); // デフォルト値
    expect(data.align).toBe("left"); // デフォルト値
    expect(data.headingBackground).toBe("clear"); // デフォルト値
    expect(data.displaySpeed).toBe(3); // デフォルト値
    expect(data.displayDate).toBeDefined();
    expect(data.isToday).toBeDefined();
  });

  it("カスタム値を返す", async () => {
    // 先に settings を作成
    await prisma.overlayContributionSettings.create({
      data: {
        streamerId,
        threshold: 500,
        goalCount: 10,
        visibleRows: 8,
        nameMaxWidth: 200,
        align: "right",
        headingBackground: "sakura-pink",
        displaySpeed: 5,
        displayReference: "fixed",
        displayDate: "2026-09-01",
      },
    });

    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalId },
    } as any);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.threshold).toBe(500);
    expect(data.goalCount).toBe(10);
    expect(data.visibleRows).toBe(8);
    expect(data.nameMaxWidth).toBe(200);
    expect(data.align).toBe("right");
    expect(data.headingBackground).toBe("sakura-pink");
    expect(data.displaySpeed).toBe(5);
    expect(data.displayDate).toBe("2026-09-01");
    expect(data.isToday).toBe(false);
  });
});

describe("PATCH /api/streamer/overlay-settings", () => {
  it("新規設定を create する", async () => {
    // settings をリセット
    await prisma.overlayContributionSettings.deleteMany({ where: { streamerId } });

    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalId },
    } as any);

    const req = new NextRequest("http://localhost/api/streamer/overlay-settings", {
      method: "PATCH",
      body: JSON.stringify({ threshold: 600, goalCount: 12 }),
    });

    const response = await PATCH(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.threshold).toBe(600);
    expect(data.goalCount).toBe(12);
    // overlayToken/isTodayを含む完全なOverlaySettingsPayloadであること(result.payloadの直返しではない)
    expect(typeof data.overlayToken).toBe("string");
    expect(data.isToday).toBeDefined();
    expect(data.align).toBe("left");
    expect(data.headingBackground).toBe("clear");
    expect(data.displaySpeed).toBe(3);

    // DB に実際に保存されているか確認
    const saved = await prisma.overlayContributionSettings.findUnique({ where: { streamerId } });
    expect(saved).not.toBeNull();
    expect(saved!.threshold).toBe(600);
    expect(saved!.goalCount).toBe(12);
  });

  it("既存設定を update する", async () => {
    // 先に設定を作成
    await prisma.overlayContributionSettings.upsert({
      where: { streamerId },
      create: { streamerId, threshold: 400 },
      update: { threshold: 400 },
    });

    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalId },
    } as any);

    const req = new NextRequest("http://localhost/api/streamer/overlay-settings", {
      method: "PATCH",
      body: JSON.stringify({ threshold: 700 }),
    });

    const response = await PATCH(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.threshold).toBe(700);

    // DB で確認
    const saved = await prisma.overlayContributionSettings.findUnique({ where: { streamerId } });
    expect(saved!.threshold).toBe(700);
  });

  it("日付ナビゲーション（today）で displayReference を today に設定", async () => {
    await prisma.overlayContributionSettings.upsert({
      where: { streamerId },
      create: {
        streamerId,
        displayReference: "fixed",
        displayDate: "2026-09-01",
      },
      update: {
        displayReference: "fixed",
        displayDate: "2026-09-01",
      },
    });

    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalId },
    } as any);

    const req = new NextRequest("http://localhost/api/streamer/overlay-settings", {
      method: "PATCH",
      body: JSON.stringify({ nav: "today" }),
    });

    const response = await PATCH(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.displayDate).toBeDefined();

    // DB で確認
    const saved = await prisma.overlayContributionSettings.findUnique({ where: { streamerId } });
    expect(saved!.displayReference).toBe("today");
    expect(saved!.displayDate).toBeNull();
  });

  it("日付ナビゲーション（prev）で前日に移動", async () => {
    await prisma.overlayContributionSettings.upsert({
      where: { streamerId },
      create: {
        streamerId,
        displayReference: "today",
        displayDate: null,
      },
      update: {
        displayReference: "today",
        displayDate: null,
      },
    });

    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalId },
    } as any);

    const req = new NextRequest("http://localhost/api/streamer/overlay-settings", {
      method: "PATCH",
      body: JSON.stringify({ nav: "prev" }),
    });

    const response = await PATCH(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.displayDate).toBe("2026-09-09"); // 前日

    // DB で確認
    const saved = await prisma.overlayContributionSettings.findUnique({ where: { streamerId } });
    expect(saved!.displayReference).toBe("fixed");
    expect(saved!.displayDate).toBe("2026-09-09");
  });

  it("旧上限(100万等)を超える大きな値も受理する(後方互換性)", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalId },
    } as any);

    const req = new NextRequest("http://localhost/api/streamer/overlay-settings", {
      method: "PATCH",
      body: JSON.stringify({ threshold: 5_000_000, goalCount: 2_000_000, visibleRows: 500, nameMaxWidth: 5_000 }),
    });

    const response = await PATCH(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.threshold).toBe(5_000_000);
    expect(data.goalCount).toBe(2_000_000);
    expect(data.visibleRows).toBe(500);
    expect(data.nameMaxWidth).toBe(5_000);
  });

  it("不正な閾値は拒否", async () => {
    const mockedGetServerSession = vi.mocked(getServerSession);
    mockedGetServerSession.mockResolvedValue({
      user: { id: principalId },
    } as any);

    const req = new NextRequest("http://localhost/api/streamer/overlay-settings", {
      method: "PATCH",
      body: JSON.stringify({ threshold: 150 }), // 100の倍数ではない
    });

    const response = await PATCH(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBeDefined();
  });
});
