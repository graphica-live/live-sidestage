// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// resolveRoomForStreamer() の監視復帰(機能A、reviveSuspendedMonitoring()への統合)を
// 実DBで検証する。以前はここだけ独自にmonitoringSuspendedのみを戻す実装だった
// (実装前レビューLOW指摘を踏まえてreviveSuspendedMonitoring()へ寄せた)。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveRoomForStreamer } from "./tiktok-room";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const roomIds: string[] = [];
const userIds: string[] = [];

function tiktokId(tag: string) {
  return `itesttr${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeStreamerWithoutRoom(targetTiktokId: string) {
  const user = await prisma.user.create({
    data: { email: `itest-tr-${suffix()}@local.test`, name: "itest" },
    select: { id: true },
  });
  userIds.push(user.id);
  const streamer = await prisma.streamer.create({
    data: {
      userId: user.id,
      tiktokId: targetTiktokId,
      verificationCode: `itest-${suffix()}`,
      apiKey: `itest-key-${suffix()}`,
      overlayToken: `itest-overlay-${suffix()}`,
    },
    select: { id: true },
  });
  return streamer;
}

afterAll(async () => {
  await prisma.streamer.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("resolveRoomForStreamer", () => {
  it("監視停止(monitoringSuspended:true)されたRoomへ新規登録すると監視を復活させる", async () => {
    const id = tiktokId("suspended");
    const room = await prisma.tiktokRoom.create({
      data: {
        tiktokId: id,
        monitoringSuspended: true,
        notFoundStreak: 3,
        lastLowValueCheckAt: new Date("2000-01-01T00:00:00.000Z"),
        consecutiveBlockedCount: 5,
      },
      select: { id: true },
    });
    roomIds.push(room.id);
    const streamer = await makeStreamerWithoutRoom(id);

    const roomId = await resolveRoomForStreamer(streamer.id);
    expect(roomId).toBe(room.id);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
    expect(after.notFoundStreak).toBe(0);
    expect(after.consecutiveBlockedCount).toBe(0);
    // reviveSuspendedMonitoring()へ統合したことで、機能Aのクールダウンにも乗る。
    expect(after.lastLowValueCheckAt).not.toBeNull();
    expect(after.lastLowValueCheckAt!.getTime()).toBeGreaterThan(Date.now() - 5_000);

    const streamerAfter = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(streamerAfter.roomId).toBe(room.id);
  });

  it("既に監視中のRoomへ新規登録しても無害(no-op)", async () => {
    const id = tiktokId("active");
    const room = await prisma.tiktokRoom.create({
      data: { tiktokId: id, monitoringSuspended: false },
      select: { id: true },
    });
    roomIds.push(room.id);
    const streamer = await makeStreamerWithoutRoom(id);

    const roomId = await resolveRoomForStreamer(streamer.id);
    expect(roomId).toBe(room.id);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
  });
});
