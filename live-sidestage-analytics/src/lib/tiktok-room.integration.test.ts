// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// resolveRoomForStreamer() の監視復帰(機能A、reviveSuspendedMonitoring()への統合)を
// 実DBで検証する。以前はここだけ独自にmonitoringSuspendedのみを戻す実装だった
// (実装前レビューLOW指摘を踏まえてreviveSuspendedMonitoring()へ寄せた)。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { deleteTiktokRoomPermanently, resolveRoomForStreamer, suspendRoomMonitoring } from "./tiktok-room";

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

const operatorEmail = "itest-admin@local.test";
const eventIds: string[] = [];

async function makeEvent(overrides: Partial<{ finalizedAt: Date | null }> = {}) {
  const event = await prisma.event.create({
    data: {
      slug: `itest-tr-event-${suffix()}`,
      title: "itest event",
      ownerUserId: "itest-owner",
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: new Date(),
      endAt: new Date(Date.now() + 60 * 60 * 1000),
      finalizedAt: overrides.finalizedAt ?? null,
    },
    select: { id: true },
  });
  eventIds.push(event.id);
  return event;
}

afterAll(async () => {
  await prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventRoomLease.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.tiktokRoomAdminAuditLog.deleteMany({ where: { operatorEmail } });
});

describe("suspendRoomMonitoring", () => {
  it("監視中の部屋を一時停止し、監査ログを1件残す", async () => {
    const id = tiktokId("susp");
    const room = await prisma.tiktokRoom.create({ data: { tiktokId: id }, select: { id: true } });
    roomIds.push(room.id);

    const result = await suspendRoomMonitoring(room.id, operatorEmail);
    expect(result).toBe("suspended");

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(true);

    const logs = await prisma.tiktokRoomAdminAuditLog.findMany({ where: { roomId: room.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe("suspend");
    expect(logs[0]!.operatorEmail).toBe(operatorEmail);
  });

  it("既に一時停止中なら already_suspended を返し、監査ログを増やさない(冪等)", async () => {
    const id = tiktokId("susp2");
    const room = await prisma.tiktokRoom.create({
      data: { tiktokId: id, monitoringSuspended: true },
      select: { id: true },
    });
    roomIds.push(room.id);

    const result = await suspendRoomMonitoring(room.id, operatorEmail);
    expect(result).toBe("already_suspended");

    const logs = await prisma.tiktokRoomAdminAuditLog.findMany({ where: { roomId: room.id } });
    expect(logs).toHaveLength(0);
  });

  it("存在しないroomIdでnot_foundを返す", async () => {
    const result = await suspendRoomMonitoring("itest-nonexistent-room-id", operatorEmail);
    expect(result).toBe("not_found");
  });
});

describe("deleteTiktokRoomPermanently", () => {
  it("Gift/BattleHistory等をカスケード削除し、AgencyWatchも削除して成功する。監査ログdetailは投入値と一致する", async () => {
    const id = tiktokId("del");
    const room = await prisma.tiktokRoom.create({ data: { tiktokId: id }, select: { id: true } });
    roomIds.push(room.id);
    const streamer = await makeStreamerWithoutRoom(id);
    await prisma.streamer.update({ where: { id: streamer.id }, data: { roomId: room.id } });
    const agency = await prisma.agency.create({
      data: { email: `itest-tr-agency-${suffix()}@local.test`, name: "itest事務所" },
      select: { id: true },
    });
    await prisma.agencyWatch.create({ data: { agencyId: agency.id, roomId: room.id, tiktokId: id } });
    await prisma.gift.createMany({
      data: [
        { roomId: room.id, uniqueId: "itest-sender1", nickname: "s1", giftId: 1, giftName: "Rose", dayKey: "2026-09-01" },
        { roomId: room.id, uniqueId: "itest-sender2", nickname: "s2", giftId: 2, giftName: "GG", dayKey: "2026-09-01" },
      ],
    });
    const battleId = `itest-battle-${suffix()}`;
    await prisma.battleHistory.create({
      data: {
        roomId: room.id,
        battleId,
        windowStart: new Date(),
        windowEnd: new Date(Date.now() + 5 * 60 * 1000),
        status: "finished",
        selfTotalDiamonds: 0,
        sourceUpdatedAt: new Date(),
        finalizedAt: new Date(),
      },
    });

    const result = await deleteTiktokRoomPermanently(room.id, operatorEmail);
    expect(result).toBe("deleted");

    expect(await prisma.tiktokRoom.findUnique({ where: { id: room.id } })).toBeNull();
    expect(await prisma.agencyWatch.findFirst({ where: { roomId: room.id } })).toBeNull();
    expect(await prisma.gift.count({ where: { roomId: room.id } })).toBe(0);
    expect(await prisma.battleHistory.count({ where: { roomId: room.id } })).toBe(0);
    const streamerAfter = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(streamerAfter.roomId).toBeNull();

    const logs = await prisma.tiktokRoomAdminAuditLog.findMany({ where: { roomId: room.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe("delete");
    expect(logs[0]!.tiktokId).toBe(id);
    expect(logs[0]!.operatorEmail).toBe(operatorEmail);
    const detail = logs[0]!.detail as {
      streamerCount: number;
      watchCount: number;
      agencyIds: string[];
      giftCount: number;
      battleHistoryCount: number;
    };
    expect(detail.streamerCount).toBe(1);
    expect(detail.watchCount).toBe(1);
    expect(detail.agencyIds).toEqual([agency.id]);
    expect(detail.giftCount).toBe(2);
    expect(detail.battleHistoryCount).toBe(1);

    await prisma.agency.delete({ where: { id: agency.id } });
  });

  it("Streamerは削除されずroomIdがnullになり、次回アクセスで同じtiktokIdの部屋が自動再作成される", async () => {
    const id = tiktokId("delstr");
    const room = await prisma.tiktokRoom.create({ data: { tiktokId: id }, select: { id: true } });
    roomIds.push(room.id);
    const streamer = await makeStreamerWithoutRoom(id);
    await resolveRoomForStreamer(streamer.id);

    const result = await deleteTiktokRoomPermanently(room.id, operatorEmail);
    expect(result).toBe("deleted");

    const streamerAfter = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(streamerAfter.roomId).toBeNull();

    const recreatedRoomId = await resolveRoomForStreamer(streamer.id);
    expect(recreatedRoomId).not.toBe(room.id);
    const recreated = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: recreatedRoomId } });
    expect(recreated.tiktokId).toBe(id);
    roomIds.push(recreatedRoomId);
  });

  it("存在しないroomIdでnot_foundを返す", async () => {
    const result = await deleteTiktokRoomPermanently("itest-nonexistent-room-id", operatorEmail);
    expect(result).toBe("not_found");
  });

  it("未finalizeイベントのEventParticipantが参照する部屋はevent_activeを返し削除しない", async () => {
    const id = tiktokId("delevt1");
    const room = await prisma.tiktokRoom.create({ data: { tiktokId: id }, select: { id: true } });
    roomIds.push(room.id);
    const event = await makeEvent({ finalizedAt: null });
    await prisma.eventParticipant.create({
      data: { eventId: event.id, tiktokId: id, roomId: room.id, displayName: id },
    });

    const result = await deleteTiktokRoomPermanently(room.id, operatorEmail);
    expect(result).toBe("event_active");
    expect(await prisma.tiktokRoom.findUnique({ where: { id: room.id } })).not.toBeNull();
  });

  it("未releaseのEventRoomLeaseが参照する部屋もevent_activeを返し削除しない", async () => {
    const id = tiktokId("delevt2");
    const room = await prisma.tiktokRoom.create({ data: { tiktokId: id }, select: { id: true } });
    roomIds.push(room.id);
    const event = await makeEvent({ finalizedAt: new Date() });
    await prisma.eventRoomLease.create({
      data: {
        eventId: event.id,
        roomId: room.id,
        tiktokId: id,
        monitorUntil: new Date(Date.now() + 60 * 60 * 1000),
        releasedAt: null,
      },
    });

    const result = await deleteTiktokRoomPermanently(room.id, operatorEmail);
    expect(result).toBe("event_active");
  });

  it("finalize済みイベントのEventParticipantのみが残る場合は孤児化を許容し削除が成功する", async () => {
    const id = tiktokId("delevt3");
    const room = await prisma.tiktokRoom.create({ data: { tiktokId: id }, select: { id: true } });
    roomIds.push(room.id);
    const event = await makeEvent({ finalizedAt: new Date() });
    await prisma.eventParticipant.create({
      data: { eventId: event.id, tiktokId: id, roomId: room.id, displayName: id },
    });

    const result = await deleteTiktokRoomPermanently(room.id, operatorEmail);
    expect(result).toBe("deleted");

    const orphaned = await prisma.eventParticipant.findFirst({ where: { roomId: room.id } });
    expect(orphaned).not.toBeNull();
  });
});
