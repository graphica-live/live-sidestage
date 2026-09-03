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
import { absorbRooms, fillHostUserIdAtEntryIfEligible, upsertTiktokIdMergeJob } from "./tiktok-id-migration";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
function handle(tag: string) {
  return `itestmig${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

const roomIds: string[] = [];
const userIds: string[] = [];
const eventIds: string[] = [];
const agencyIds: string[] = [];
const streamerJobStreamerIds: string[] = [];

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

  it("非NULLのorderIdが衝突するときは移動分と破棄分に分かれ、GiftEditは移動後も生存する", async () => {
    const survivor = await makeRoom("survivor2", "hu2");
    const candidate = await makeRoom("candidate2", "hu2");
    const streamer = await makeStreamer(survivor.id, survivor.tiktokId);

    await makeGift(survivor.id, { orderId: "order-conflict" });
    const conflicting = await makeGift(candidate.id, { orderId: "order-conflict" });
    const unique = await makeGift(candidate.id, { orderId: "order-unique" });

    await prisma.giftEdit.create({
      data: {
        giftId: conflicting.id,
        streamerId: streamer.id,
        giftName: "Rose",
        totalDiamonds: 999,
      },
    });
    await prisma.giftEdit.create({
      data: {
        giftId: unique.id,
        streamerId: streamer.id,
        giftName: "Rose",
        totalDiamonds: 1,
      },
    });

    const result = await absorbRooms(survivor.id, candidate.id, "hu2", survivor.tiktokId);
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;

    expect(result.stats.giftsMoved).toBe(1);
    expect(result.stats.giftsDiscarded).toBe(1);
    expect(result.stats.giftEditsDiscarded).toBe(1);

    const survivingGift = await prisma.gift.findUnique({ where: { id: unique.id } });
    expect(survivingGift?.roomId).toBe(survivor.id);
    const survivingEdit = await prisma.giftEdit.findUnique({
      where: { giftId_streamerId: { giftId: unique.id, streamerId: streamer.id } },
    });
    expect(survivingEdit).not.toBeNull();

    const discardedEdit = await prisma.giftEdit.findUnique({
      where: { giftId_streamerId: { giftId: conflicting.id, streamerId: streamer.id } },
    });
    expect(discardedEdit).toBeNull();
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

  it("LikeTallyは衝突行を合算し、非衝突行は移動する", async () => {
    const survivor = await makeRoom("survivor4", "hu4");
    const candidate = await makeRoom("candidate4", "hu4");

    await prisma.likeTally.create({
      data: { roomId: survivor.id, dayKey: "2026-09-03", uniqueId: "u1", nickname: "u1", totalLikes: 10 },
    });
    await prisma.likeTally.create({
      data: { roomId: candidate.id, dayKey: "2026-09-03", uniqueId: "u1", nickname: "u1", totalLikes: 5 },
    });
    await prisma.likeTally.create({
      data: { roomId: candidate.id, dayKey: "2026-09-03", uniqueId: "u2", nickname: "u2", totalLikes: 3 },
    });

    const result = await absorbRooms(survivor.id, candidate.id, "hu4", survivor.tiktokId);
    expect(result.kind).toBe("merged");

    const tallies = await prisma.likeTally.findMany({ where: { roomId: survivor.id }, orderBy: { uniqueId: "asc" } });
    expect(tallies).toHaveLength(2);
    expect(tallies.find((t) => t.uniqueId === "u1")?.totalLikes).toBe(15);
    expect(tallies.find((t) => t.uniqueId === "u2")?.totalLikes).toBe(3);
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
        raw: {},
      },
    });
    await prisma.tiktokBattle.create({
      data: {
        roomId: candidate.id,
        battleId: "b1",
        action: 5,
        startedAt: new Date(),
        endedAt: new Date(),
        raw: {},
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
