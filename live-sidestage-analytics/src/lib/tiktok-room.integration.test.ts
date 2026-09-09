// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// resolveRoomForStreamer() の監視復帰(機能A、reviveSuspendedMonitoring()への統合)を
// 実DBで検証する。以前はここだけ独自にmonitoringSuspendedのみを戻す実装だった
// (実装前レビューLOW指摘を踏まえてreviveSuspendedMonitoring()へ寄せた)。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  deleteTiktokRoomPermanently,
  ensureRoomWatchedByAdmin,
  resolveRoomForStreamer,
  suspendRoomMonitoring,
} from "./tiktok-room";
import { makeGiftRow, makeTiktokUid } from "./__fixtures__/gift";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const roomIds: string[] = [];
const principalIds: string[] = [];

// room の同一性は hostTiktokUid(@unique)で決まるので、テストごとに必ず別の数値IDを配る。
let uidSeq = 0;

type Subject = { tiktokUid: string; tiktokHandle: string };

function makeSubject(tag: string): Subject {
  uidSeq += 1;
  return {
    tiktokUid: `7${String(Date.now() % 1_000_000).padStart(6, "0")}${String(uidSeq).padStart(11, "0")}`,
    tiktokHandle: `itesttr${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase(),
  };
}

async function makeStreamerWithoutRoom(subject: Subject) {
  const user = await prisma.user.create({
    data: { email: `itest-tr-${suffix()}@local.test`, name: "itest" },
    select: { id: true },
  });
  principalIds.push(user.id);
  const streamer = await prisma.streamer.create({
    data: {
      principalId: user.id,
      tiktokUid: subject.tiktokUid,
      tiktokHandle: subject.tiktokHandle,
      verificationCode: `itest-${suffix()}`,
      overlayToken: `itest-overlay-${suffix()}`,
    },
    select: { id: true },
  });
  return streamer;
}

afterAll(async () => {
  await prisma.streamer.deleteMany({ where: { principalId: { in: principalIds } } });
  await prisma.user.deleteMany({ where: { id: { in: principalIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("resolveRoomForStreamer", () => {
  it("監視停止(monitoringSuspended:true)されたRoomへ新規登録すると監視を復活させる", async () => {
    const subject = makeSubject("suspended");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        monitoringSuspended: true,
        notFoundStreak: 3,
        lastLowValueCheckAt: new Date("2000-01-01T00:00:00.000Z"),
        consecutiveBlockedCount: 5,
      },
      select: { id: true },
    });
    roomIds.push(room.id);
    const streamer = await makeStreamerWithoutRoom(subject);

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
    const subject = makeSubject("active");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        monitoringSuspended: false,
      },
      select: { id: true },
    });
    roomIds.push(room.id);
    const streamer = await makeStreamerWithoutRoom(subject);

    const roomId = await resolveRoomForStreamer(streamer.id);
    expect(roomId).toBe(room.id);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
  });

  it("本人が改名して再登録すると handleStaleAt が解除され、room のハンドルが追随する", async () => {
    // 接続時 uid 照合が別人を検出して handleStaleAt を立てた room。uid は本人のままなので
    // 本人の再登録で解除されないと、TikTok 接続がハンドル失効のまま二度と張れなくなる。
    const subject = makeSubject("stale");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        handleStaleAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    roomIds.push(room.id);

    const renamed = { tiktokUid: subject.tiktokUid, tiktokHandle: `${subject.tiktokHandle}2` };
    const streamer = await makeStreamerWithoutRoom(renamed);

    const roomId = await resolveRoomForStreamer(streamer.id);
    expect(roomId).toBe(room.id);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.handleStaleAt).toBeNull();
    expect(after.tiktokHandle).toBe(renamed.tiktokHandle);
  });
});

const operatorEmail = "itest-admin@local.test";
const eventIds: string[] = [];

async function makeEvent(overrides: Partial<{ finalizedAt: Date | null }> = {}) {
  const event = await prisma.event.create({
    data: {
      slug: `itest-tr-event-${suffix()}`,
      title: "itest event",
      ownerPrincipalId: "itest-owner",
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
    const subject = makeSubject("susp");
    const room = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: subject.tiktokUid, tiktokHandle: subject.tiktokHandle },
      select: { id: true },
    });
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
    const subject = makeSubject("susp2");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        monitoringSuspended: true,
      },
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
    const subject = makeSubject("del");
    const room = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: subject.tiktokUid, tiktokHandle: subject.tiktokHandle },
      select: { id: true },
    });
    roomIds.push(room.id);
    const streamer = await makeStreamerWithoutRoom(subject);
    await prisma.streamer.update({ where: { id: streamer.id }, data: { roomId: room.id } });
    const agency = await prisma.agency.create({
      data: { email: `itest-tr-agency-${suffix()}@local.test`, name: "itest事務所" },
      select: { id: true },
    });
    await prisma.agencyWatch.create({
      data: {
        agencyId: agency.id,
        roomId: room.id,
        tiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
      },
    });
    await prisma.gift.createMany({
      data: [
        makeGiftRow({ roomId: room.id, tiktokUid: makeTiktokUid("itest-sender1"), giftId: 1, giftName: "Rose", dayKey: "2026-09-01" }),
        makeGiftRow({ roomId: room.id, tiktokUid: makeTiktokUid("itest-sender2"), giftId: 2, giftName: "GG", dayKey: "2026-09-01" }),
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
    expect(logs[0]!.tiktokHandle).toBe(subject.tiktokHandle);
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

  it("Streamerは削除されずroomIdがnullになり、次回アクセスで同じ配信者の部屋が自動再作成される", async () => {
    const subject = makeSubject("delstr");
    const room = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: subject.tiktokUid, tiktokHandle: subject.tiktokHandle },
      select: { id: true },
    });
    roomIds.push(room.id);
    const streamer = await makeStreamerWithoutRoom(subject);
    await resolveRoomForStreamer(streamer.id);

    const result = await deleteTiktokRoomPermanently(room.id, operatorEmail);
    expect(result).toBe("deleted");

    const streamerAfter = await prisma.streamer.findUniqueOrThrow({ where: { id: streamer.id } });
    expect(streamerAfter.roomId).toBeNull();

    const recreatedRoomId = await resolveRoomForStreamer(streamer.id);
    expect(recreatedRoomId).not.toBe(room.id);
    const recreated = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: recreatedRoomId } });
    // 再作成された room は同じ配信者(hostTiktokUid)を指す。ハンドルは表示用スナップショット。
    expect(recreated.hostTiktokUid).toBe(subject.tiktokUid);
    expect(recreated.tiktokHandle).toBe(subject.tiktokHandle);
    roomIds.push(recreatedRoomId);
  });

  it("存在しないroomIdでnot_foundを返す", async () => {
    const result = await deleteTiktokRoomPermanently("itest-nonexistent-room-id", operatorEmail);
    expect(result).toBe("not_found");
  });

  it("未finalizeイベントのEventParticipantが参照する部屋はevent_activeを返し削除しない", async () => {
    const subject = makeSubject("delevt1");
    const room = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: subject.tiktokUid, tiktokHandle: subject.tiktokHandle },
      select: { id: true },
    });
    roomIds.push(room.id);
    const event = await makeEvent({ finalizedAt: null });
    await prisma.eventParticipant.create({
      data: {
        eventId: event.id,
        tiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        roomId: room.id,
        displayName: subject.tiktokHandle,
      },
    });

    const result = await deleteTiktokRoomPermanently(room.id, operatorEmail);
    expect(result).toBe("event_active");
    expect(await prisma.tiktokRoom.findUnique({ where: { id: room.id } })).not.toBeNull();
  });

  it("未releaseのEventRoomLeaseが参照する部屋もevent_activeを返し削除しない", async () => {
    const subject = makeSubject("delevt2");
    const room = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: subject.tiktokUid, tiktokHandle: subject.tiktokHandle },
      select: { id: true },
    });
    roomIds.push(room.id);
    const event = await makeEvent({ finalizedAt: new Date() });
    await prisma.eventRoomLease.create({
      data: {
        eventId: event.id,
        roomId: room.id,
        tiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        monitorUntil: new Date(Date.now() + 60 * 60 * 1000),
        releasedAt: null,
      },
    });

    const result = await deleteTiktokRoomPermanently(room.id, operatorEmail);
    expect(result).toBe("event_active");
  });

  it("finalize済みイベントのEventParticipantのみが残る場合は孤児化を許容し削除が成功する", async () => {
    const subject = makeSubject("delevt3");
    const room = await prisma.tiktokRoom.create({
      data: { hostTiktokUid: subject.tiktokUid, tiktokHandle: subject.tiktokHandle },
      select: { id: true },
    });
    roomIds.push(room.id);
    const event = await makeEvent({ finalizedAt: new Date() });
    await prisma.eventParticipant.create({
      data: {
        eventId: event.id,
        tiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        roomId: room.id,
        displayName: subject.tiktokHandle,
      },
    });

    const result = await deleteTiktokRoomPermanently(room.id, operatorEmail);
    expect(result).toBe("deleted");

    const orphaned = await prisma.eventParticipant.findFirst({ where: { roomId: room.id } });
    expect(orphaned).not.toBeNull();
  });
});

describe("ensureRoomWatchedByAdmin", () => {
  it("既存room(specialWatch:false)を再度追加すると、update分岐がspecialWatchをtrueへセットする", async () => {
    // Codex-terra TestCase Modeレビュー指摘(HIGH): update分岐(既存roomへ再度呼ぶ経路)への
    // specialWatch:true付与は今回の変更対象だが、専用テストが無かった。バトル履歴の購読判定
    // (battle-subscription.ts)が誤ってfalseのままになる回帰をここで固定する。
    const subject = makeSubject("adminupd");
    const room = await prisma.tiktokRoom.create({
      data: {
        hostTiktokUid: subject.tiktokUid,
        tiktokHandle: subject.tiktokHandle,
        specialWatch: false,
        handleStaleAt: new Date("2026-09-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    roomIds.push(room.id);

    const result = await ensureRoomWatchedByAdmin({
      tiktokUid: subject.tiktokUid,
      tiktokHandle: subject.tiktokHandle,
      nickname: null,
    });
    expect(result).toEqual({ roomId: room.id, created: false });

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.specialWatch).toBe(true);
    expect(after.handleStaleAt).toBeNull();

    const countAfter = await prisma.tiktokRoom.count({ where: { hostTiktokUid: subject.tiktokUid } });
    expect(countAfter).toBe(1);
  });

  it("未登録のtiktokUidへ呼ぶと新規roomを作りspecialWatch:trueで作成する", async () => {
    const subject = makeSubject("adminnew");

    const result = await ensureRoomWatchedByAdmin({
      tiktokUid: subject.tiktokUid,
      tiktokHandle: subject.tiktokHandle,
      nickname: null,
    });
    expect(result.created).toBe(true);
    roomIds.push(result.roomId);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: result.roomId } });
    expect(after.specialWatch).toBe(true);
    expect(after.hostTiktokUid).toBe(subject.tiktokUid);
  });
});
