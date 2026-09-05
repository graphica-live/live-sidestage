// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// TikTok ID変更時のroom合流(absorbRooms)を実DBに対して検証する。ユニット側は
// 純粋関数(findHostUserIdFromBattleProfiles)しかカバーしないため、raw SQLを含む
// 実際の移動・破棄・削除ロジックはここでしか確認できない。
//
// **最重要の回帰**: Gift.orderIdは本番で100%null。`IS NOT DISTINCT FROM`実装だと
// NULL同士が「一致」と評価され、旧roomのGiftが1件も移動されず全滅する。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  absorbRooms,
  fillHostUserIdAtEntryIfEligible,
  upsertTiktokIdMergeJob,
  getRecentUnacknowledgedMerge,
  acknowledgeMergeLog,
} from "./tiktok-id-migration";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
function handle(tag: string) {
  return `itestmig${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

const roomIds: string[] = [];
const userIds: string[] = [];
const eventIds: string[] = [];
const agencyIds: string[] = [];
const streamerJobStreamerIds: string[] = [];
const mergeLogStreamerIds: string[] = [];

async function makeRoom(tag: string, hostUserId: string | null = null) {
  const room = await prisma.tiktokRoom.create({
    data: { tiktokId: handle(tag), hostUserId },
    select: { id: true, tiktokId: true },
  });
  roomIds.push(room.id);
  return room;
}

async function makeStreamer(roomId: string, tiktokId: string) {
  const user = await prisma.user.create({
    data: { email: `itest-mig-${suffix()}@local.test`, name: "itest" },
    select: { id: true },
  });
  userIds.push(user.id);
  const streamer = await prisma.streamer.create({
    data: {
      userId: user.id,
      tiktokId,
      roomId,
      verificationCode: `itest-${suffix()}`,
      apiKey: `itest-key-${suffix()}`,
      overlayToken: `itest-overlay-${suffix()}`,
    },
    select: { id: true },
  });
  return streamer;
}

async function makeGift(roomId: string, overrides: { orderId?: string | null; totalDiamonds?: number } = {}) {
  return prisma.gift.create({
    data: {
      roomId,
      uniqueId: `sender_${suffix()}`,
      nickname: "itest",
      giftId: 1,
      giftName: "Rose",
      dayKey: "2026-09-03",
      orderId: overrides.orderId ?? null,
      totalDiamonds: overrides.totalDiamonds ?? 1,
    },
    select: { id: true },
  });
}

afterAll(async () => {
  await prisma.tiktokIdMergeLog.deleteMany({ where: { streamerId: { in: mergeLogStreamerIds } } });
  await prisma.tiktokIdMergeJob.deleteMany({ where: { streamerId: { in: streamerJobStreamerIds } } });
  await prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.eventRoomLease.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.agencyWatch.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
  await prisma.streamer.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("absorbRooms — ABSORB正常系", () => {
  it("両roomのGiftが全てorderId:nullでも全件移動し、1件もDELETEされない", async () => {
    const survivor = await makeRoom("survivor", "hu1");
    const candidate = await makeRoom("candidate", "hu1");

    await makeGift(survivor.id, { orderId: null });
    await makeGift(survivor.id, { orderId: null });
    const g1 = await makeGift(candidate.id, { orderId: null });
    const g2 = await makeGift(candidate.id, { orderId: null });

    const result = await absorbRooms(survivor.id, candidate.id, "hu1", survivor.tiktokId);
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;

    expect(result.stats.giftsMoved).toBe(2);
    expect(result.stats.giftsDiscarded).toBe(0);

    const survivorGifts = await prisma.gift.findMany({ where: { roomId: survivor.id } });
    expect(survivorGifts).toHaveLength(4);
    expect(survivorGifts.map((g) => g.id)).toEqual(expect.arrayContaining([g1.id, g2.id]));

    const room = await prisma.tiktokRoom.findUnique({ where: { id: candidate.id } });
    expect(room).toBeNull();
  });

  it("非NULLのorderIdが衝突するときは移動分と破棄分に分かれる", async () => {
    const survivor = await makeRoom("survivor2", "hu2");
    const candidate = await makeRoom("candidate2", "hu2");

    await makeGift(survivor.id, { orderId: "order-conflict" });
    const conflicting = await makeGift(candidate.id, { orderId: "order-conflict" });
    const unique = await makeGift(candidate.id, { orderId: "order-unique" });

    const result = await absorbRooms(survivor.id, candidate.id, "hu2", survivor.tiktokId);
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;

    expect(result.stats.giftsMoved).toBe(1);
    expect(result.stats.giftsDiscarded).toBe(1);

    const survivingGift = await prisma.gift.findUnique({ where: { id: unique.id } });
    expect(survivingGift?.roomId).toBe(survivor.id);
    const discardedGift = await prisma.gift.findUnique({ where: { id: conflicting.id } });
    expect(discardedGift).toBeNull();
  });

  it("Streamerのroomidとtiktokidを同時に更新する", async () => {
    const survivor = await makeRoom("survivor3", "hu3");
    const candidate = await makeRoom("candidate3", "hu3");
    const streamer = await makeStreamer(candidate.id, candidate.tiktokId);

    const result = await absorbRooms(survivor.id, candidate.id, "hu3", "newhandle3");
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;
    expect(result.stats.streamersMoved).toBe(1);

    const updated = await prisma.streamer.findUnique({ where: { id: streamer.id } });
    expect(updated?.roomId).toBe(survivor.id);
    expect(updated?.tiktokId).toBe("newhandle3");
  });

  it("TiktokBattleの battleId 衝突は endedAt IS NOT NULL を優先して残す", async () => {
    const survivor = await makeRoom("survivor5", "hu5");
    const candidate = await makeRoom("candidate5", "hu5");

    await prisma.tiktokBattle.create({
      data: {
        roomId: survivor.id,
        battleId: "b1",
        action: 4,
        startedAt: new Date(),
        endedAt: null,
      },
    });
    await prisma.tiktokBattle.create({
      data: {
        roomId: candidate.id,
        battleId: "b1",
        action: 5,
        startedAt: new Date(),
        endedAt: new Date(),
      },
    });

    const result = await absorbRooms(survivor.id, candidate.id, "hu5", survivor.tiktokId);
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;
    expect(result.stats.battlesDiscarded).toBe(1);

    const battle = await prisma.tiktokBattle.findUnique({
      where: { roomId_battleId: { roomId: survivor.id, battleId: "b1" } },
    });
    expect(battle?.endedAt).not.toBeNull();
  });

  it("AgencyWatchは同じ事務所の重複を破棄し、それ以外は roomId を付け替える", async () => {
    const survivor = await makeRoom("survivor6", "hu6");
    const candidate = await makeRoom("candidate6", "hu6");

    const agency1 = await prisma.agency.create({
      data: { email: `itest-agency1-${suffix()}@local.test`, name: "agency1" },
      select: { id: true },
    });
    const agency2 = await prisma.agency.create({
      data: { email: `itest-agency2-${suffix()}@local.test`, name: "agency2" },
      select: { id: true },
    });
    agencyIds.push(agency1.id, agency2.id);

    await prisma.agencyWatch.create({
      data: { agencyId: agency1.id, roomId: survivor.id, tiktokId: survivor.tiktokId },
    });
    await prisma.agencyWatch.create({
      data: { agencyId: agency1.id, roomId: candidate.id, tiktokId: candidate.tiktokId },
    });
    await prisma.agencyWatch.create({
      data: { agencyId: agency2.id, roomId: candidate.id, tiktokId: candidate.tiktokId },
    });

    const result = await absorbRooms(survivor.id, candidate.id, "hu6", survivor.tiktokId);
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;
    expect(result.stats.agencyWatchesMoved).toBe(1);

    const watches = await prisma.agencyWatch.findMany({ where: { roomId: survivor.id } });
    expect(watches).toHaveLength(2);
    expect(watches.map((w) => w.agencyId).sort()).toEqual([agency1.id, agency2.id].sort());
  });

  it("解放済みEventRoomLeaseは roomId・tiktokId を付け替える", async () => {
    const survivor = await makeRoom("survivor7", "hu7");
    const candidate = await makeRoom("candidate7", "hu7");

    const event = await prisma.event.create({
      data: {
        slug: `itest-mig-${suffix()}`,
        title: "itest",
        ownerUserId: "itest_owner",
        format: "DIAMOND_RACE",
        entryMode: "SOLO",
        startAt: new Date(),
        endAt: new Date(Date.now() + 3600_000),
      },
      select: { id: true },
    });
    eventIds.push(event.id);

    await prisma.eventRoomLease.create({
      data: {
        eventId: event.id,
        roomId: candidate.id,
        tiktokId: candidate.tiktokId,
        monitorUntil: new Date(Date.now() + 3600_000),
        releasedAt: new Date(),
      },
    });

    const result = await absorbRooms(survivor.id, candidate.id, "hu7", "newhandle7");
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;
    expect(result.stats.eventRoomLeasesMoved).toBe(1);

    const lease = await prisma.eventRoomLease.findUnique({ where: { eventId_roomId: { eventId: event.id, roomId: survivor.id } } });
    expect(lease?.tiktokId).toBe("newhandle7");
  });
});

describe("absorbRooms — 拒否系", () => {
  it("未finalizeのイベントに参加中のroomは EVENT_ACTIVE でスキップし、1行も書き換わらない", async () => {
    const survivor = await makeRoom("survivor8", "hu8");
    const candidate = await makeRoom("candidate8", "hu8");
    await makeGift(candidate.id);

    const event = await prisma.event.create({
      data: {
        slug: `itest-mig-${suffix()}`,
        title: "itest",
        ownerUserId: "itest_owner",
        format: "DIAMOND_RACE",
        entryMode: "SOLO",
        startAt: new Date(),
        endAt: new Date(Date.now() + 3600_000),
        finalizedAt: null,
      },
      select: { id: true },
    });
    eventIds.push(event.id);
    await prisma.eventParticipant.create({
      data: { eventId: event.id, tiktokId: candidate.tiktokId, roomId: candidate.id, displayName: candidate.tiktokId },
    });

    const result = await absorbRooms(survivor.id, candidate.id, "hu8", survivor.tiktokId);
    expect(result.kind).toBe("event_active");

    const candidateRoom = await prisma.tiktokRoom.findUnique({ where: { id: candidate.id } });
    expect(candidateRoom).not.toBeNull();
    const gifts = await prisma.gift.findMany({ where: { roomId: candidate.id } });
    expect(gifts).toHaveLength(1);
  });

  it("finalize済みイベントの参加roomは合流できる(永久ブロックの回帰固定)", async () => {
    const survivor = await makeRoom("survivor9", "hu9");
    const candidate = await makeRoom("candidate9", "hu9");

    const event = await prisma.event.create({
      data: {
        slug: `itest-mig-${suffix()}`,
        title: "itest",
        ownerUserId: "itest_owner",
        format: "DIAMOND_RACE",
        entryMode: "SOLO",
        startAt: new Date(Date.now() - 7200_000),
        endAt: new Date(Date.now() - 3600_000),
        finalizedAt: new Date(),
      },
      select: { id: true },
    });
    eventIds.push(event.id);
    await prisma.eventParticipant.create({
      data: { eventId: event.id, tiktokId: candidate.tiktokId, roomId: candidate.id, displayName: candidate.tiktokId },
    });

    const result = await absorbRooms(survivor.id, candidate.id, "hu9", survivor.tiktokId);
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;
    expect(result.stats.eventParticipantsMoved).toBe(1);

    const participant = await prisma.eventParticipant.findUnique({
      where: { eventId_roomId: { eventId: event.id, roomId: survivor.id } },
    });
    expect(participant).not.toBeNull();
  });

  it("hostUserIdが期待値と食い違っていたら stale で1行も書き換わらない(TOCTOU)", async () => {
    const survivor = await makeRoom("survivor10", "hu10");
    const candidate = await makeRoom("candidate10", "different-hu");
    await makeGift(candidate.id);

    const result = await absorbRooms(survivor.id, candidate.id, "hu10", survivor.tiktokId);
    expect(result.kind).toBe("stale");

    const gifts = await prisma.gift.findMany({ where: { roomId: candidate.id } });
    expect(gifts).toHaveLength(1);
  });

  it("survivor側のhostUserIdが食い違っていても、candidate側さえ一致すれば合流できる(ハンドル再利用の正常系。永久ループの回帰固定)", async () => {
    // ハンドル再利用: survivor(現ハンドルroom)の保存済みhostUserIdは前所有者のもの(規律により
    // 上書きされない)。安全性はcandidate側の一致だけで担保される設計であり、survivor側の
    // 不一致だけでstaleにしてはいけない(それをやると合流が構造的に永久成立不能になる)。
    const survivor = await makeRoom("survivor11", "previous-owner-uid");
    const candidate = await makeRoom("candidate11", "hu11");

    const result = await absorbRooms(survivor.id, candidate.id, "hu11", survivor.tiktokId);
    expect(result.kind).toBe("merged");
  });
});

describe("fillHostUserIdAtEntryIfEligible — 入口fillの限定", () => {
  it("Giftが0件のroomにはfillする", async () => {
    const room = await makeRoom("entryfill1");

    await fillHostUserIdAtEntryIfEligible(room.id, "entry-uid-1");

    const after = await prisma.tiktokRoom.findUnique({ where: { id: room.id } });
    expect(after?.hostUserId).toBe("entry-uid-1");
  });

  it("Giftが入っているroomにはfillしない(squatter汚染の回帰固定)", async () => {
    const room = await makeRoom("entryfill2");
    await makeGift(room.id);

    await fillHostUserIdAtEntryIfEligible(room.id, "entry-uid-2");

    const after = await prisma.tiktokRoom.findUnique({ where: { id: room.id } });
    expect(after?.hostUserId).toBeNull();
  });
});

describe("upsertTiktokIdMergeJob — ジョブのライフサイクル", () => {
  it("done になった行が次のID変更で再pending化される", async () => {
    const room = await makeRoom("jobroom1");
    const streamer = await makeStreamer(room.id, room.tiktokId);
    streamerJobStreamerIds.push(streamer.id);

    await prisma.$transaction((tx) => upsertTiktokIdMergeJob(tx, streamer.id, "handle1"));
    await prisma.tiktokIdMergeJob.update({
      where: { streamerId: streamer.id },
      data: { status: "done" },
    });

    await prisma.$transaction((tx) => upsertTiktokIdMergeJob(tx, streamer.id, "handle2"));

    const job = await prisma.tiktokIdMergeJob.findUnique({ where: { streamerId: streamer.id } });
    expect(job?.status).toBe("pending");
    expect(job?.tiktokId).toBe("handle2");
    expect(job?.attempts).toBe(0);
  });
});

describe("getRecentUnacknowledgedMerge / acknowledgeMergeLog — 事後通知バナー", () => {
  it("未読ログがなければ null を返す", async () => {
    const room = await makeRoom("noticeroom0");
    const streamer = await makeStreamer(room.id, room.tiktokId);
    mergeLogStreamerIds.push(streamer.id);

    const notice = await getRecentUnacknowledgedMerge(streamer.id);
    expect(notice).toBeNull();
  });

  it("MERGEDログの giftsMoved を giftCount として返す", async () => {
    const room = await makeRoom("noticeroom1");
    const streamer = await makeStreamer(room.id, room.tiktokId);
    mergeLogStreamerIds.push(streamer.id);

    await prisma.tiktokIdMergeLog.create({
      data: {
        streamerId: streamer.id,
        userId: "notice-uid-1",
        outcome: "MERGED",
        oldTiktokId: "alice",
        newTiktokId: room.tiktokId,
        stats: { giftsMoved: 42 },
      },
    });

    const notice = await getRecentUnacknowledgedMerge(streamer.id);
    expect(notice?.outcome).toBe("MERGED");
    expect(notice?.oldTiktokId).toBe("alice");
    expect(notice?.giftCount).toBe(42);
  });

  it("複数未読ログがあっても最新1件のみ返す", async () => {
    const room = await makeRoom("noticeroom2");
    const streamer = await makeStreamer(room.id, room.tiktokId);
    mergeLogStreamerIds.push(streamer.id);

    await prisma.tiktokIdMergeLog.create({
      data: { streamerId: streamer.id, userId: "u", outcome: "MERGED", newTiktokId: room.tiktokId, oldTiktokId: "old1" },
    });
    await new Promise((r) => setTimeout(r, 5));
    await prisma.tiktokIdMergeLog.create({
      data: { streamerId: streamer.id, userId: "u", outcome: "MERGED", newTiktokId: room.tiktokId, oldTiktokId: "old2" },
    });

    const notice = await getRecentUnacknowledgedMerge(streamer.id);
    expect(notice?.oldTiktokId).toBe("old2");
  });

  it("NO_CANDIDATE / EVENT_ACTIVE / BLOCKED_HOST_MISMATCH は通知対象外", async () => {
    const room = await makeRoom("noticeroom3");
    const streamer = await makeStreamer(room.id, room.tiktokId);
    mergeLogStreamerIds.push(streamer.id);

    for (const outcome of ["NO_CANDIDATE", "EVENT_ACTIVE", "BLOCKED_HOST_MISMATCH", "DEFERRED"]) {
      await prisma.tiktokIdMergeLog.create({
        data: { streamerId: streamer.id, userId: "u", outcome, newTiktokId: room.tiktokId },
      });
    }

    const notice = await getRecentUnacknowledgedMerge(streamer.id);
    expect(notice).toBeNull();
  });

  it("acknowledgeMergeLog で既読化すると以後返らない", async () => {
    const room = await makeRoom("noticeroom4");
    const streamer = await makeStreamer(room.id, room.tiktokId);
    mergeLogStreamerIds.push(streamer.id);

    const log = await prisma.tiktokIdMergeLog.create({
      data: { streamerId: streamer.id, userId: "u", outcome: "MERGED", newTiktokId: room.tiktokId, oldTiktokId: "old" },
    });

    await acknowledgeMergeLog(streamer.id, log.id);

    const notice = await getRecentUnacknowledgedMerge(streamer.id);
    expect(notice).toBeNull();
  });

  it("acknowledgeMergeLog は streamerId が一致しない行を既読化しない(他人のログ保護)", async () => {
    const room1 = await makeRoom("noticeroom5a");
    const streamer1 = await makeStreamer(room1.id, room1.tiktokId);
    mergeLogStreamerIds.push(streamer1.id);
    const room2 = await makeRoom("noticeroom5b");
    const streamer2 = await makeStreamer(room2.id, room2.tiktokId);
    mergeLogStreamerIds.push(streamer2.id);

    const log = await prisma.tiktokIdMergeLog.create({
      data: { streamerId: streamer1.id, userId: "u", outcome: "MERGED", newTiktokId: room1.tiktokId, oldTiktokId: "old" },
    });

    await acknowledgeMergeLog(streamer2.id, log.id);

    const notice = await getRecentUnacknowledgedMerge(streamer1.id);
    expect(notice?.id).toBe(log.id);
  });
});
