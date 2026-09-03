// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// selectCleanupCandidates() の候補抽出条件と、suspendNotFoundRoom() の停止実行
// (データ削除なし・monitoringSuspendedのみ・dry-run・課金ガード・TOCTOU再確認)を実DBで検証する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  selectCleanupCandidates,
  suspendNotFoundRoom,
  UNHEALTHY_THRESHOLD_MS,
  CHECK_COOLDOWN_MS,
  NOT_FOUND_STREAK_REQUIRED,
} from "./tiktok-room-cleanup";

const suffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const roomIds: string[] = [];
const userIds: string[] = [];
const giftIds: string[] = [];

function tiktokId(tag: string) {
  return `itestcln${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom(data: {
  tag: string;
  listenerStatus?: string | null;
  unhealthySince?: Date | null;
  lastExistenceCheckAt?: Date | null;
  notFoundStreak?: number;
  notFoundFirstAt?: Date | null;
  monitoringSuspended?: boolean;
}) {
  const room = await prisma.tiktokRoom.create({
    data: {
      tiktokId: tiktokId(data.tag),
      listenerStatus: data.listenerStatus ?? null,
      unhealthySince: data.unhealthySince ?? null,
      lastExistenceCheckAt: data.lastExistenceCheckAt ?? null,
      notFoundStreak: data.notFoundStreak ?? 0,
      notFoundFirstAt: data.notFoundFirstAt ?? null,
      monitoringSuspended: data.monitoringSuspended ?? false,
    },
    select: { id: true, tiktokId: true },
  });
  roomIds.push(room.id);
  return room;
}

async function attachStreamer(roomId: string, userId?: string) {
  let uid = userId;
  if (!uid) {
    const user = await prisma.user.create({
      data: { email: `itest-cln-${suffix()}@local.test`, name: "itest" },
      select: { id: true },
    });
    userIds.push(user.id);
    uid = user.id;
  }
  const streamer = await prisma.streamer.create({
    data: {
      userId: uid,
      tiktokId: tiktokId("s"),
      roomId,
      verificationCode: `itest-${suffix()}`,
      apiKey: `itest-key-${suffix()}`,
      overlayToken: `itest-overlay-${suffix()}`,
    },
    select: { id: true },
  });
  return streamer;
}

async function attachGift(roomId: string) {
  const gift = await prisma.gift.create({
    data: {
      roomId,
      uniqueId: "itest-sender",
      nickname: "itest sender",
      giftId: 1,
      giftName: "Rose",
      dayKey: "2026-08-23",
    },
    select: { id: true },
  });
  giftIds.push(gift.id);
  return gift;
}

async function attachSubscription(userId: string) {
  await prisma.subscription.create({ data: { userId, plan: "PRO", entitlementActive: true } });
}

const NOW = new Date();

afterAll(async () => {
  await prisma.gift.deleteMany({ where: { id: { in: giftIds } } });
  await prisma.giftEdit.deleteMany({ where: { streamer: { roomId: { in: roomIds } } } });
  await prisma.streamer.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("selectCleanupCandidates", () => {
  let eligibleUnchecked: { id: string; tiktokId: string };
  let eligibleCheckedLongAgo: { id: string; tiktokId: string };
  let tooFreshUnhealthy: { id: string; tiktokId: string };
  let cooldownNotElapsed: { id: string; tiktokId: string };
  let connectedRoom: { id: string; tiktokId: string };
  let noStreamerRoom: { id: string; tiktokId: string };
  let alreadySuspendedRoom: { id: string; tiktokId: string };

  beforeAll(async () => {
    const wellPastUnhealthy = new Date(NOW.getTime() - UNHEALTHY_THRESHOLD_MS - 60_000);
    const barelyUnhealthy = new Date(NOW.getTime() - UNHEALTHY_THRESHOLD_MS + 60_000);
    const wellPastCooldown = new Date(NOW.getTime() - CHECK_COOLDOWN_MS - 60_000);
    const withinCooldown = new Date(NOW.getTime() - CHECK_COOLDOWN_MS + 60_000);

    eligibleUnchecked = await makeRoom({
      tag: "unchecked",
      listenerStatus: "retrying",
      unhealthySince: wellPastUnhealthy,
      lastExistenceCheckAt: null,
    });
    await attachStreamer(eligibleUnchecked.id);

    eligibleCheckedLongAgo = await makeRoom({
      tag: "checkedlong",
      listenerStatus: "retrying",
      unhealthySince: wellPastUnhealthy,
      lastExistenceCheckAt: wellPastCooldown,
    });
    await attachStreamer(eligibleCheckedLongAgo.id);

    tooFreshUnhealthy = await makeRoom({
      tag: "fresh",
      listenerStatus: "retrying",
      unhealthySince: barelyUnhealthy,
      lastExistenceCheckAt: null,
    });
    await attachStreamer(tooFreshUnhealthy.id);

    cooldownNotElapsed = await makeRoom({
      tag: "cooldown",
      listenerStatus: "retrying",
      unhealthySince: wellPastUnhealthy,
      lastExistenceCheckAt: withinCooldown,
    });
    await attachStreamer(cooldownNotElapsed.id);

    connectedRoom = await makeRoom({
      tag: "connected",
      listenerStatus: "connected",
      unhealthySince: null,
      lastExistenceCheckAt: null,
    });
    await attachStreamer(connectedRoom.id);

    noStreamerRoom = await makeRoom({
      tag: "nostreamer",
      listenerStatus: "retrying",
      unhealthySince: wellPastUnhealthy,
      lastExistenceCheckAt: null,
    });
    // Streamerを付けない。

    alreadySuspendedRoom = await makeRoom({
      tag: "suspended",
      listenerStatus: "retrying",
      unhealthySince: wellPastUnhealthy,
      lastExistenceCheckAt: null,
      monitoringSuspended: true,
    });
    await attachStreamer(alreadySuspendedRoom.id);
  });

  it("未チェック(lastExistenceCheckAt=null)の対象を拾う", async () => {
    const candidates = await selectCleanupCandidates(NOW, 100);
    expect(candidates.some((c) => c.id === eligibleUnchecked.id)).toBe(true);
  });

  it("クールダウンを過ぎた既チェック対象も拾う", async () => {
    const candidates = await selectCleanupCandidates(NOW, 100);
    expect(candidates.some((c) => c.id === eligibleCheckedLongAgo.id)).toBe(true);
  });

  it("unhealthySinceが閾値未満(まだ浅い)の部屋は拾わない", async () => {
    const candidates = await selectCleanupCandidates(NOW, 100);
    expect(candidates.some((c) => c.id === tooFreshUnhealthy.id)).toBe(false);
  });

  it("クールダウン期間内の既チェック部屋は拾わない", async () => {
    const candidates = await selectCleanupCandidates(NOW, 100);
    expect(candidates.some((c) => c.id === cooldownNotElapsed.id)).toBe(false);
  });

  it("listenerStatus=connectedの部屋は拾わない", async () => {
    const candidates = await selectCleanupCandidates(NOW, 100);
    expect(candidates.some((c) => c.id === connectedRoom.id)).toBe(false);
  });

  it("Streamerが1人もいない部屋も拾う(情報プール方針。改名でハンドルが死んだ旧Roomを永久にretryさせない)", async () => {
    const candidates = await selectCleanupCandidates(NOW, 100);
    expect(candidates.some((c) => c.id === noStreamerRoom.id)).toBe(true);
  });

  it("既に監視停止済み(monitoringSuspended:true)の部屋は拾わない", async () => {
    const candidates = await selectCleanupCandidates(NOW, 100);
    expect(candidates.some((c) => c.id === alreadySuspendedRoom.id)).toBe(false);
  });

  it("未チェック(NULL)行がNULLS LASTで後ろに落ちず優先される(nulls: first確認)", async () => {
    const candidates = await selectCleanupCandidates(NOW, 100);
    const uncheckedIdx = candidates.findIndex((c) => c.id === eligibleUnchecked.id);
    const checkedIdx = candidates.findIndex((c) => c.id === eligibleCheckedLongAgo.id);
    expect(uncheckedIdx).toBeGreaterThanOrEqual(0);
    expect(checkedIdx).toBeGreaterThanOrEqual(0);
    expect(uncheckedIdx).toBeLessThan(checkedIdx);
  });
});

describe("suspendNotFoundRoom", () => {
  it("Gift0件・streak充足なら監視を停止する(Streamer/GiftEditは削除しない)", async () => {
    const room = await makeRoom({
      tag: "suspend-ok",
      listenerStatus: "retrying",
      notFoundStreak: NOT_FOUND_STREAK_REQUIRED,
      notFoundFirstAt: new Date(NOW.getTime() - 10 * 86_400_000),
    });
    const streamer = await attachStreamer(room.id);

    const otherRoom = await makeRoom({ tag: "gift-source" });
    const editGift = await prisma.gift.create({
      data: {
        roomId: otherRoom.id,
        uniqueId: "s3",
        nickname: "s3",
        giftId: 4,
        giftName: "Rose",
        dayKey: "2026-08-01",
      },
      select: { id: true },
    });
    giftIds.push(editGift.id);
    const edit = await prisma.giftEdit.create({
      data: { streamerId: streamer.id, giftId: editGift.id, giftName: "Rose", totalDiamonds: 5 },
      select: { id: true },
    });

    const entry = await suspendNotFoundRoom({ id: room.id, tiktokId: room.tiktokId }, false);

    expect(entry).not.toBeNull();
    expect(entry!.outcome).toBe("suspended");
    expect(entry!.giftCount).toBe(0);
    expect(entry!.watcherCount).toBe(1);

    const streamerAfter = await prisma.streamer.findUnique({ where: { id: streamer.id } });
    expect(streamerAfter).not.toBeNull();

    const giftEditAfter = await prisma.giftEdit.findUnique({ where: { id: edit.id } });
    expect(giftEditAfter).not.toBeNull();

    const roomAfter = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomAfter.monitoringSuspended).toBe(true);
  });

  it("Gift実績が1件でもあれば監視を停止する(データは残る)", async () => {
    const room = await makeRoom({
      tag: "gift-exists",
      listenerStatus: "retrying",
      notFoundStreak: NOT_FOUND_STREAK_REQUIRED,
      notFoundFirstAt: new Date(NOW.getTime() - 10 * 86_400_000),
    });
    const streamer = await attachStreamer(room.id);
    await attachGift(room.id);

    const entry = await suspendNotFoundRoom({ id: room.id, tiktokId: room.tiktokId }, false);

    expect(entry).not.toBeNull();
    expect(entry!.outcome).toBe("suspended");
    expect(entry!.giftCount).toBe(1);

    const streamerAfter = await prisma.streamer.findUnique({ where: { id: streamer.id } });
    expect(streamerAfter).not.toBeNull();

    const roomAfter = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomAfter.monitoringSuspended).toBe(true);
  });

  it("課金ユーザーが監視していれば停止しない", async () => {
    const room = await makeRoom({
      tag: "paid",
      listenerStatus: "retrying",
      notFoundStreak: NOT_FOUND_STREAK_REQUIRED,
      notFoundFirstAt: new Date(NOW.getTime() - 10 * 86_400_000),
    });
    const user = await prisma.user.create({
      data: { email: `itest-cln-${suffix()}@local.test`, name: "itest" },
      select: { id: true },
    });
    userIds.push(user.id);
    await attachSubscription(user.id);
    const streamer = await attachStreamer(room.id, user.id);

    const entry = await suspendNotFoundRoom({ id: room.id, tiktokId: room.tiktokId }, false);

    expect(entry).toBeNull();

    const streamerAfter = await prisma.streamer.findUnique({ where: { id: streamer.id } });
    expect(streamerAfter).not.toBeNull();

    const roomAfter = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomAfter.monitoringSuspended).toBe(false);
  });

  it("dryRun=trueなら実際には停止せずoutcome=dry_runで記録する", async () => {
    const room = await makeRoom({
      tag: "dry-run",
      listenerStatus: "retrying",
      notFoundStreak: NOT_FOUND_STREAK_REQUIRED,
      notFoundFirstAt: new Date(NOW.getTime() - 10 * 86_400_000),
    });
    await attachStreamer(room.id);

    const entry = await suspendNotFoundRoom({ id: room.id, tiktokId: room.tiktokId }, true);

    expect(entry).not.toBeNull();
    expect(entry!.outcome).toBe("dry_run");

    const roomAfter = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomAfter.monitoringSuspended).toBe(false);
  });

  it("Streamerが0人のRoomも停止する(情報プール方針。課金者判定はuserIds=[]でfalse相当になる)", async () => {
    const room = await makeRoom({
      tag: "no-streamer-suspend",
      listenerStatus: "retrying",
      notFoundStreak: NOT_FOUND_STREAK_REQUIRED,
      notFoundFirstAt: new Date(NOW.getTime() - 10 * 86_400_000),
    });
    // Streamerを付けない。

    const entry = await suspendNotFoundRoom({ id: room.id, tiktokId: room.tiktokId }, false);

    expect(entry).not.toBeNull();
    expect(entry!.outcome).toBe("suspended");
    expect(entry!.watcherCount).toBe(0);

    const roomAfter = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomAfter.monitoringSuspended).toBe(true);
  });

  it("TOCTOU再確認: DB上のnotFoundStreakが要件未満に戻っていれば何もせずnullを返す(connected復帰等)", async () => {
    const room = await makeRoom({
      tag: "toctou",
      listenerStatus: "connected",
      notFoundStreak: 0,
      notFoundFirstAt: null,
    });
    await attachStreamer(room.id);

    const entry = await suspendNotFoundRoom({ id: room.id, tiktokId: room.tiktokId }, false);

    expect(entry).toBeNull();

    const roomAfter = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomAfter.monitoringSuspended).toBe(false);
  });
});
