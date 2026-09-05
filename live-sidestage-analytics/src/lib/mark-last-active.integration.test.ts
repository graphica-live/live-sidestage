// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// markLastActive()・reviveSuspendedMonitoringForRoom() の監視復活ロジックを実DBで検証する。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { markLastActive, reviveSuspendedMonitoringForRoom } from "./mark-last-active";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const roomIds: string[] = [];
const userIds: string[] = [];

function tiktokId(tag: string) {
  return `itestmla${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom(data: { tag: string; monitoringSuspended: boolean }) {
  const room = await prisma.tiktokRoom.create({
    data: {
      tiktokId: tiktokId(data.tag),
      monitoringSuspended: data.monitoringSuspended,
      unhealthySince: new Date(),
      notFoundStreak: 2,
      notFoundFirstAt: new Date(),
      lastExistenceCheckAt: new Date(),
      lastLowValueCheckAt: new Date("2000-01-01T00:00:00.000Z"),
      consecutiveBlockedCount: 3,
    },
    select: { id: true },
  });
  roomIds.push(room.id);
  return room;
}

async function attachStreamer(roomId: string) {
  const user = await prisma.user.create({
    data: { email: `itest-mla-${suffix()}@local.test`, name: "itest" },
    select: { id: true },
  });
  userIds.push(user.id);
  const streamer = await prisma.streamer.create({
    data: {
      userId: user.id,
      tiktokId: tiktokId("s"),
      roomId,
      verificationCode: `itest-${suffix()}`,
      apiKey: `itest-key-${suffix()}`,
      overlayToken: `itest-overlay-${suffix()}`,
    },
    select: { id: true, userId: true },
  });
  return streamer;
}

afterAll(async () => {
  await prisma.streamer.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("reviveSuspendedMonitoringForRoom", () => {
  it("monitoringSuspended:trueなRoomをfalseへ戻し、NOT_FOUND判定フィールドもリセットする", async () => {
    const room = await makeRoom({ tag: "suspended", monitoringSuspended: true });

    await reviveSuspendedMonitoringForRoom(room.id);

    const roomAfter = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomAfter.monitoringSuspended).toBe(false);
    expect(roomAfter.unhealthySince).toBeNull();
    expect(roomAfter.notFoundStreak).toBe(0);
    expect(roomAfter.notFoundFirstAt).toBeNull();
    expect(roomAfter.lastExistenceCheckAt).toBeNull();
    // 低価値クリーンアップのクールダウンに復帰直後から乗せるため現在時刻へ更新される。
    expect(roomAfter.lastLowValueCheckAt).not.toBeNull();
    expect(roomAfter.lastLowValueCheckAt!.getTime()).toBeGreaterThan(Date.now() - 5_000);
    // 403ブロックによるgive-up停止からの復帰でも古いカウントを引き継がない。
    expect(roomAfter.consecutiveBlockedCount).toBe(0);
  });

  it("monitoringSuspended:falseなら何もしない(no-op)", async () => {
    const room = await makeRoom({ tag: "active", monitoringSuspended: false });

    await reviveSuspendedMonitoringForRoom(room.id);

    const roomAfter = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomAfter.monitoringSuspended).toBe(false);
    // 停止していなかったRoomのNOT_FOUND判定フィールドは変化しない。
    expect(roomAfter.notFoundStreak).toBe(2);
    // no-opなのでlastLowValueCheckAt/consecutiveBlockedCountも変化しない。
    expect(roomAfter.lastLowValueCheckAt?.toISOString()).toBe("2000-01-01T00:00:00.000Z");
    expect(roomAfter.consecutiveBlockedCount).toBe(3);
  });

  it("存在しないroomIdを渡しても例外にならない", async () => {
    await expect(reviveSuspendedMonitoringForRoom("nonexistent-room-id")).resolves.toBeUndefined();
  });
});

describe("markLastActive", () => {
  it("Streamer(userId経由)に紐づく監視停止Roomも復活させる", async () => {
    const room = await makeRoom({ tag: "via-user", monitoringSuspended: true });
    const streamer = await attachStreamer(room.id);

    await markLastActive(streamer.userId);

    const roomAfter = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomAfter.monitoringSuspended).toBe(false);
  });

  it("存在しないuserIdを渡しても例外にならない", async () => {
    await expect(markLastActive("nonexistent-user-id")).resolves.toBeUndefined();
  });
});
