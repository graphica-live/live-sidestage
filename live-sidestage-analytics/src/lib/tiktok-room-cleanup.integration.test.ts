// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// selectCleanupCandidates() の候補抽出条件と、deleteConfirmedRoom() の削除実行
// (カスケード削除・Gift安全策・dry-run・TOCTOU再確認)を実DBで検証する。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  selectCleanupCandidates,
  deleteConfirmedRoom,
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
}) {
  const room = await prisma.tiktokRoom.create({
    data: {
      tiktokId: tiktokId(data.tag),
      listenerStatus: data.listenerStatus ?? null,
      unhealthySince: data.unhealthySince ?? null,
      lastExistenceCheckAt: data.lastExistenceCheckAt ?? null,
      notFoundStreak: data.notFoundStreak ?? 0,
      notFoundFirstAt: data.notFoundFirstAt ?? null,
    },
    select: { id: true, tiktokId: true },
  });
  roomIds.push(room.id);
  return room;
}

async function attachStreamer(roomId: string) {
  const user = await prisma.user.create({
    data: { email: `itest-cln-${suffix()}@local.test`, name: "itest" },
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

const NOW = new Date();

afterAll(async () => {
  await prisma.gift.deleteMany({ where: { id: { in: giftIds } } });
  await prisma.giftEdit.deleteMany({ where: { streamer: { roomId: { in: roomIds } } } });
  await prisma.streamer.deleteMany({ where: { roomId: { in: roomIds } } });
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

  it("Streamerが1人もいない部屋は拾わない", async () => {
    const candidates = await selectCleanupCandidates(NOW, 100);
    expect(candidates.some((c) => c.id === noStreamerRoom.id)).toBe(false);
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

describe("deleteConfirmedRoom", () => {
  it("Gift0件・streak充足ならStreamerを削除し、GiftEditもカスケード削除、TiktokRoomのフラグもクリアされる", async () => {
    const room = await makeRoom({
      tag: "delete-ok",
      listenerStatus: "retrying",
      notFoundStreak: NOT_FOUND_STREAK_REQUIRED,
      notFoundFirstAt: new Date(NOW.getTime() - 10 * 86_400_000),
    });
    const streamer = await attachStreamer(room.id);

    // GiftEditのcascade削除確認用に、別roomのGiftへの編集を1件付ける
    // (Gift.roomIdとStreamer.roomIdは独立なカラムなので、対象roomのGift件数とは無関係)。
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

    const entry = await deleteConfirmedRoom({ id: room.id, tiktokId: room.tiktokId }, false);

    expect(entry).not.toBeNull();
    expect(entry!.outcome).toBe("deleted");
    expect(entry!.giftCount).toBe(0);
    expect(entry!.deletedStreamers).toHaveLength(1);
    expect(entry!.deletedStreamers[0].streamerId).toBe(streamer.id);
    expect(entry!.deletedStreamers[0].hadApiKey).toBe(true);
    expect(entry!.deletedStreamers[0].hadOverlayToken).toBe(true);

    const streamerAfter = await prisma.streamer.findUnique({ where: { id: streamer.id } });
    expect(streamerAfter).toBeNull();

    const giftEditAfter = await prisma.giftEdit.findUnique({ where: { id: edit.id } });
    expect(giftEditAfter).toBeNull();

    const roomAfter = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(roomAfter.unhealthySince).toBeNull();
    expect(roomAfter.notFoundStreak).toBe(0);
    expect(roomAfter.notFoundFirstAt).toBeNull();
    expect(roomAfter.lastExistenceCheckAt).toBeNull();
  });

  it("Gift実績が1件でもあれば自動削除せずneeds_reviewに回す", async () => {
    const room = await makeRoom({
      tag: "needs-review",
      listenerStatus: "retrying",
      notFoundStreak: NOT_FOUND_STREAK_REQUIRED,
      notFoundFirstAt: new Date(NOW.getTime() - 10 * 86_400_000),
    });
    const streamer = await attachStreamer(room.id);
    await attachGift(room.id);

    const entry = await deleteConfirmedRoom({ id: room.id, tiktokId: room.tiktokId }, false);

    expect(entry).not.toBeNull();
    expect(entry!.outcome).toBe("needs_review");
    expect(entry!.giftCount).toBe(1);

    const streamerAfter = await prisma.streamer.findUnique({ where: { id: streamer.id } });
    expect(streamerAfter).not.toBeNull();
  });

  it("dryRun=trueなら実削除せずoutcome=dry_runで記録する", async () => {
    const room = await makeRoom({
      tag: "dry-run",
      listenerStatus: "retrying",
      notFoundStreak: NOT_FOUND_STREAK_REQUIRED,
      notFoundFirstAt: new Date(NOW.getTime() - 10 * 86_400_000),
    });
    const streamer = await attachStreamer(room.id);

    const entry = await deleteConfirmedRoom({ id: room.id, tiktokId: room.tiktokId }, true);

    expect(entry).not.toBeNull();
    expect(entry!.outcome).toBe("dry_run");

    const streamerAfter = await prisma.streamer.findUnique({ where: { id: streamer.id } });
    expect(streamerAfter).not.toBeNull();
  });

  it("TOCTOU再確認: DB上のnotFoundStreakが要件未満に戻っていれば何もせずnullを返す(connected復帰等)", async () => {
    const room = await makeRoom({
      tag: "toctou",
      listenerStatus: "connected",
      notFoundStreak: 0,
      notFoundFirstAt: null,
    });
    const streamer = await attachStreamer(room.id);

    const entry = await deleteConfirmedRoom({ id: room.id, tiktokId: room.tiktokId }, false);

    expect(entry).toBeNull();

    const streamerAfter = await prisma.streamer.findUnique({ where: { id: streamer.id } });
    expect(streamerAfter).not.toBeNull();
  });
});
