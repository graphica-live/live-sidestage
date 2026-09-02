// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// selectLowValueCandidates() の候補抽出条件(AgencyWatch/monitorUntil/monitoringSuspended
// による除外)と、suspendLowValueRoom() の判定順序(課金者→アクティブ無課金者→ダイヤ合計)
// ・TOCTOU再確認・dry-runを実DBで検証する。データは一切削除しないため afterAll で
// monitoringSuspendedを含め作成したレコードを全て消す。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  selectLowValueCandidates,
  suspendLowValueRoom,
  DIAMOND_THRESHOLD,
  ACTIVE_PROTECT_MS,
} from "./tiktok-low-value-cleanup";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const roomIds: string[] = [];
const userIds: string[] = [];
const giftIds: string[] = [];
const agencyIds: string[] = [];

function tiktokId(tag: string) {
  return `itestlv${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom(data: {
  tag: string;
  monitorUntil?: Date | null;
  monitoringSuspended?: boolean;
  lastLowValueCheckAt?: Date | null;
}) {
  const room = await prisma.tiktokRoom.create({
    data: {
      tiktokId: tiktokId(data.tag),
      monitorUntil: data.monitorUntil ?? null,
      monitoringSuspended: data.monitoringSuspended ?? false,
      lastLowValueCheckAt: data.lastLowValueCheckAt ?? null,
    },
    select: { id: true, tiktokId: true },
  });
  roomIds.push(room.id);
  return room;
}

async function makeUser(lastActiveAt: Date | null) {
  const user = await prisma.user.create({
    data: { email: `itest-lv-${suffix()}@local.test`, name: "itest", lastActiveAt },
    select: { id: true },
  });
  userIds.push(user.id);
  return user;
}

async function attachStreamer(roomId: string, userId: string) {
  await prisma.streamer.create({
    data: {
      userId,
      tiktokId: tiktokId("s"),
      roomId,
      verificationCode: `itest-${suffix()}`,
      apiKey: `itest-key-${suffix()}`,
      overlayToken: `itest-overlay-${suffix()}`,
    },
  });
}

async function attachSubscription(userId: string) {
  await prisma.subscription.create({
    data: { userId, plan: "PRO", entitlementActive: true },
  });
}

async function attachGift(roomId: string, totalDiamonds: number, receivedAt: Date) {
  const gift = await prisma.gift.create({
    data: {
      roomId,
      uniqueId: "itest-sender",
      nickname: "itest sender",
      giftId: 1,
      giftName: "Rose",
      dayKey: "2026-08-23",
      totalDiamonds,
      receivedAt,
    },
    select: { id: true },
  });
  giftIds.push(gift.id);
  return gift;
}

async function makeAgencyWatch(roomId: string) {
  const agency = await prisma.agency.create({
    data: { email: `itest-agency-${suffix()}@local.test`, name: "itest agency" },
    select: { id: true },
  });
  agencyIds.push(agency.id);
  await prisma.agencyWatch.create({
    data: { agencyId: agency.id, roomId, tiktokId: "itest-watch-target" },
  });
}

const NOW = new Date();

afterAll(async () => {
  await prisma.agencyWatch.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
  await prisma.gift.deleteMany({ where: { id: { in: giftIds } } });
  await prisma.giftEdit.deleteMany({ where: { streamer: { roomId: { in: roomIds } } } });
  await prisma.streamer.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("selectLowValueCandidates", () => {
  let eligible: { id: string; tiktokId: string };
  let noStreamerRoom: { id: string; tiktokId: string };
  let agencyWatchedRoom: { id: string; tiktokId: string };
  let monitorUntilFutureRoom: { id: string; tiktokId: string };
  let alreadySuspendedRoom: { id: string; tiktokId: string };
  let cooldownNotElapsedRoom: { id: string; tiktokId: string };

  beforeAll(async () => {
    const withinCooldown = new Date(NOW.getTime() - 60_000);
    const futureMonitorUntil = new Date(NOW.getTime() + 86_400_000);

    eligible = await makeRoom({ tag: "eligible" });
    const u1 = await makeUser(null);
    await attachStreamer(eligible.id, u1.id);

    noStreamerRoom = await makeRoom({ tag: "nostreamer" });

    agencyWatchedRoom = await makeRoom({ tag: "agencywatched" });
    const u2 = await makeUser(null);
    await attachStreamer(agencyWatchedRoom.id, u2.id);
    await makeAgencyWatch(agencyWatchedRoom.id);

    monitorUntilFutureRoom = await makeRoom({ tag: "monitoruntil", monitorUntil: futureMonitorUntil });
    const u3 = await makeUser(null);
    await attachStreamer(monitorUntilFutureRoom.id, u3.id);

    alreadySuspendedRoom = await makeRoom({ tag: "suspended", monitoringSuspended: true });
    const u4 = await makeUser(null);
    await attachStreamer(alreadySuspendedRoom.id, u4.id);

    cooldownNotElapsedRoom = await makeRoom({ tag: "cooldown", lastLowValueCheckAt: withinCooldown });
    const u5 = await makeUser(null);
    await attachStreamer(cooldownNotElapsedRoom.id, u5.id);
  });

  it("Streamerがいて事務所監視/イベント監視/停止済み/クールダウン中でないRoomのみ候補に入る", async () => {
    const candidates = await selectLowValueCandidates(NOW, 200);
    const ids = candidates.map((c) => c.id);

    expect(ids).toContain(eligible.id);
    expect(ids).not.toContain(noStreamerRoom.id);
    expect(ids).not.toContain(agencyWatchedRoom.id);
    expect(ids).not.toContain(monitorUntilFutureRoom.id);
    expect(ids).not.toContain(alreadySuspendedRoom.id);
    expect(ids).not.toContain(cooldownNotElapsedRoom.id);
  });
});

describe("suspendLowValueRoom", () => {
  it("課金ユーザーがいれば停止しない", async () => {
    const room = await makeRoom({ tag: "paid" });
    const user = await makeUser(null);
    await attachStreamer(room.id, user.id);
    await attachSubscription(user.id);

    const entry = await suspendLowValueRoom(room, false, NOW);
    expect(entry).toBeNull();

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
  });

  it("直近アクティブな無課金ユーザーがいれば停止しない", async () => {
    const room = await makeRoom({ tag: "active" });
    const recentlyActive = new Date(NOW.getTime() - 1000);
    const user = await makeUser(recentlyActive);
    await attachStreamer(room.id, user.id);

    const entry = await suspendLowValueRoom(room, false, NOW);
    expect(entry).toBeNull();

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
  });

  it("lastActiveAtがnull(未記録)のユーザーは保護され停止しない", async () => {
    const room = await makeRoom({ tag: "unrecorded" });
    const user = await makeUser(null);
    await attachStreamer(room.id, user.id);

    const entry = await suspendLowValueRoom(room, false, NOW);
    expect(entry).toBeNull();
  });

  it("課金者なし・保護対象アクティブユーザーなし・ダイヤ閾値未満なら停止する", async () => {
    const room = await makeRoom({ tag: "lowvalue" });
    const longAgoActive = new Date(NOW.getTime() - ACTIVE_PROTECT_MS - 86_400_000);
    const user = await makeUser(longAgoActive);
    await attachStreamer(room.id, user.id);
    await attachGift(room.id, DIAMOND_THRESHOLD - 1000, NOW);

    const entry = await suspendLowValueRoom(room, false, NOW);
    expect(entry).not.toBeNull();
    expect(entry?.outcome).toBe("suspended");
    expect(entry?.monthlyDiamonds).toBe(DIAMOND_THRESHOLD - 1000);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(true);
  });

  it("直近30日ダイヤ合計が閾値以上なら停止しない", async () => {
    const room = await makeRoom({ tag: "highdiamond" });
    const longAgoActive = new Date(NOW.getTime() - ACTIVE_PROTECT_MS - 86_400_000);
    const user = await makeUser(longAgoActive);
    await attachStreamer(room.id, user.id);
    await attachGift(room.id, DIAMOND_THRESHOLD, NOW);

    const entry = await suspendLowValueRoom(room, false, NOW);
    expect(entry).toBeNull();

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
  });

  it("ダイヤ集計はlookback期間外の受信を含めない", async () => {
    const room = await makeRoom({ tag: "oldgift" });
    const longAgoActive = new Date(NOW.getTime() - ACTIVE_PROTECT_MS - 86_400_000);
    const user = await makeUser(longAgoActive);
    await attachStreamer(room.id, user.id);
    // 31日以上前の高額ギフトはlookback外なので集計に含まれない想定
    await attachGift(room.id, DIAMOND_THRESHOLD + 1_000_000, new Date(NOW.getTime() - 31 * 86_400_000));

    const entry = await suspendLowValueRoom(room, false, NOW);
    expect(entry).not.toBeNull();
    expect(entry?.monthlyDiamonds).toBe(0);
  });

  it("dry-runでは実際には停止せず監査ログのみ記録する", async () => {
    const room = await makeRoom({ tag: "dryrun" });
    const longAgoActive = new Date(NOW.getTime() - ACTIVE_PROTECT_MS - 86_400_000);
    const user = await makeUser(longAgoActive);
    await attachStreamer(room.id, user.id);

    const entry = await suspendLowValueRoom(room, true, NOW);
    expect(entry).not.toBeNull();
    expect(entry?.outcome).toBe("dry_run");

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
  });

  it("Streamerが0人のRoomは停止しない", async () => {
    const room = await makeRoom({ tag: "empty" });

    const entry = await suspendLowValueRoom(room, false, NOW);
    expect(entry).toBeNull();
  });
});
