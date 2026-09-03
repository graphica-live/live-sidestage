// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// recordEulerSignUsage()が「誰の目的で署名を消費したか」を正しくスナップショットするかを検証する。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./prisma";
import { recordEulerSignUsage } from "./euler-usage";

// monitoringSuspended: true は監視対象から外すための隔離。Streamer 0人・有効な
// monitorUntil 無しの部屋も watchedRoomFilter() の監視対象になったため、そのままだと
// 並行して走る listener 系テストの getMyRooms() がグローバルに claim してくる。
// 署名消費のスナップショット検証に監視は要らないので共有プールへ足さない。
async function createRoom(tiktokId: string, monitoringSuspended = false) {
  return prisma.tiktokRoom.create({ data: { tiktokId, monitoringSuspended } });
}

async function createStreamerOn(roomId: string, tiktokId: string, emailPrefix: string) {
  const user = await prisma.user.create({
    data: { email: `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@local.test` },
  });
  const streamer = await prisma.streamer.create({
    data: { userId: user.id, tiktokId, verificationCode: "x", verified: true, roomId },
  });
  return { user, streamer };
}

async function createAgencyWatchOn(roomId: string, tiktokId: string, emailPrefix: string) {
  const agency = await prisma.agency.create({
    data: { email: `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@local.test`, name: "テスト事務所" },
  });
  const watch = await prisma.agencyWatch.create({ data: { agencyId: agency.id, roomId, tiktokId } });
  return { agency, watch };
}

async function createEvent(ownerUserId: string, status: string = "RUNNING") {
  return prisma.event.create({
    data: {
      slug: `itest-euler-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: "テストイベント",
      ownerUserId,
      format: "DIAMOND_RACE",
      entryMode: "SOLO",
      status,
      startAt: new Date(Date.now() - 3600_000),
      endAt: new Date(Date.now() + 3600_000),
    },
  });
}

async function createOwnerUser() {
  const user = await prisma.user.create({
    data: { email: `itest-euler-owner-${Date.now()}-${Math.random().toString(36).slice(2)}@local.test` },
  });
  return user;
}

const cleanupRoomIds: string[] = [];
const cleanupUserIds: string[] = [];
const cleanupAgencyIds: string[] = [];
const cleanupEventIds: string[] = [];

afterAll(async () => {
  await prisma.eulerSignUsage.deleteMany({ where: { roomId: { in: cleanupRoomIds } } });
  await prisma.eventRoomLease.deleteMany({ where: { roomId: { in: cleanupRoomIds } } });
  await prisma.event.deleteMany({ where: { id: { in: cleanupEventIds } } });
  await prisma.agencyWatch.deleteMany({ where: { roomId: { in: cleanupRoomIds } } });
  await prisma.agency.deleteMany({ where: { id: { in: cleanupAgencyIds } } });
  await prisma.streamer.deleteMany({ where: { roomId: { in: cleanupRoomIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: cleanupRoomIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  await prisma.$disconnect();
});

describe("recordEulerSignUsage", () => {
  it("配信者本人・事務所監視・有効なイベント監視の3種類を1行にスナップショットする", async () => {
    const tiktokId = `itest_euler_snapshot_${Date.now()}`;
    const room = await createRoom(tiktokId);
    cleanupRoomIds.push(room.id);

    const { user, streamer } = await createStreamerOn(room.id, tiktokId, "itest-euler-streamer");
    cleanupUserIds.push(user.id, streamer.userId);

    const { agency } = await createAgencyWatchOn(room.id, tiktokId, "itest-euler-agency");
    cleanupAgencyIds.push(agency.id);

    const owner = await createOwnerUser();
    cleanupUserIds.push(owner.id);
    const event = await createEvent(owner.id, "RUNNING");
    cleanupEventIds.push(event.id);
    await prisma.eventRoomLease.create({
      data: { eventId: event.id, roomId: room.id, tiktokId, monitorUntil: new Date(Date.now() + 3600_000) },
    });

    await recordEulerSignUsage({
      roomId: room.id,
      tiktokId,
      requestedAt: new Date(),
      outcome: "success",
      trigger: "start",
      reason: null,
      role: "worker",
      workerIndex: 0,
      listenerEpoch: 1n,
      credentialMode: "configured",
    });

    const rows = await prisma.eulerSignUsage.findMany({ where: { roomId: room.id } });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.streamerUserIds).toEqual([user.id]);
    expect(row.agencyIds).toEqual([agency.id]);
    expect(row.eventIds).toEqual([event.id]);
    expect(row.outcome).toBe("success");
    expect(row.trigger).toBe("start");
    expect(row.role).toBe("worker");
    expect(row.workerIndex).toBe(0);
    expect(row.listenerEpoch).toBe(1n);
    expect(row.credentialMode).toBe("configured");
  });

  it("期限切れ・解放済み・ARCHIVEDのイベント監視要求はeventIdsに含めない", async () => {
    const tiktokId = `itest_euler_lease_exclude_${Date.now()}`;
    // Streamer も有効な monitorUntil も付かない部屋なので、共有プールから外しておく。
    const room = await createRoom(tiktokId, true);
    cleanupRoomIds.push(room.id);

    const owner = await createOwnerUser();
    cleanupUserIds.push(owner.id);

    const expiredEvent = await createEvent(owner.id, "RUNNING");
    const releasedEvent = await createEvent(owner.id, "RUNNING");
    const archivedEvent = await createEvent(owner.id, "ARCHIVED");
    cleanupEventIds.push(expiredEvent.id, releasedEvent.id, archivedEvent.id);

    await prisma.eventRoomLease.create({
      data: {
        eventId: expiredEvent.id,
        roomId: room.id,
        tiktokId,
        monitorUntil: new Date(Date.now() - 3600_000), // 期限切れ
      },
    });
    await prisma.eventRoomLease.create({
      data: {
        eventId: releasedEvent.id,
        roomId: room.id,
        tiktokId,
        monitorUntil: new Date(Date.now() + 3600_000),
        releasedAt: new Date(), // 解放済み
      },
    });
    await prisma.eventRoomLease.create({
      data: {
        eventId: archivedEvent.id,
        roomId: room.id,
        tiktokId,
        monitorUntil: new Date(Date.now() + 3600_000),
      },
    });

    await recordEulerSignUsage({
      roomId: room.id,
      tiktokId,
      requestedAt: new Date(),
      outcome: "success",
      trigger: "watchdog",
      reason: null,
      role: "web",
      workerIndex: null,
      listenerEpoch: null,
      credentialMode: "anonymous",
    });

    const rows = await prisma.eulerSignUsage.findMany({ where: { roomId: room.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventIds).toEqual([]);
    expect(rows[0]!.streamerUserIds).toEqual([]);
    expect(rows[0]!.agencyIds).toEqual([]);
  });

  it("存在しないroomIdでも例外を投げず、空のスナップショットで記録する", async () => {
    const roomId = `itest_euler_missing_room_${Date.now()}`;
    await expect(
      recordEulerSignUsage({
        roomId,
        tiktokId: "nonexistent",
        requestedAt: new Date(),
        outcome: "error",
        errorMessage: "boom",
        trigger: "scheduled_reconnect",
        reason: "connect_failed",
        role: "worker",
        workerIndex: 1,
        listenerEpoch: null,
        credentialMode: "anonymous",
      })
    ).resolves.toBeUndefined();

    const rows = await prisma.eulerSignUsage.findMany({ where: { roomId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.streamerUserIds).toEqual([]);
    expect(rows[0]!.agencyIds).toEqual([]);
    expect(rows[0]!.eventIds).toEqual([]);
    expect(rows[0]!.outcome).toBe("error");
    expect(rows[0]!.errorMessage).toBe("boom");

    await prisma.eulerSignUsage.deleteMany({ where: { roomId } });
  });
});
