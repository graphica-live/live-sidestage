// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// Workerが接続を維持すべき部屋の判定条件(getMyRooms()が使うwatchedRoomFilter)を検証する。
// 事務所のtiktokId直指定では配信者本人の登録(Streamer)が0人の部屋が生まれるため、
// この条件が正しくないと接続が一切張られずデータが1件も溜まらない。
import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { watchedRoomFilter } from "@/lib/tiktok-listener";
import type { WatchedRoomFilterOptions } from "@/lib/watched-room-filter";

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const createdRoomIds: string[] = [];
const createdUserIds: string[] = [];
const createdAgencyIds: string[] = [];

async function createRoom(prefix: string, opts: { monitoringSuspended?: boolean } = {}) {
  const room = await prisma.tiktokRoom.create({
    data: {
      tiktokId: `itest_watched_${prefix}_${suffix()}`,
      monitoringSuspended: opts.monitoringSuspended ?? false,
    },
  });
  createdRoomIds.push(room.id);
  return room;
}

async function createAgency() {
  const agency = await prisma.agency.create({
    data: { email: `itest-watched-${suffix()}@local.test`, name: "テスト事務所" },
  });
  createdAgencyIds.push(agency.id);
  return agency;
}

async function isWatched(
  roomId: string,
  now: Date = new Date(),
  opts?: WatchedRoomFilterOptions
): Promise<boolean> {
  const hit = await prisma.tiktokRoom.findFirst({
    where: { id: roomId, ...watchedRoomFilter(now, opts) },
    select: { id: true },
  });
  return hit !== null;
}

afterEach(async () => {
  await prisma.agency.deleteMany({ where: { id: { in: createdAgencyIds.splice(0) } } });
  await Promise.all(
    createdUserIds.splice(0).map((id) => prisma.user.delete({ where: { id } }).catch(() => {}))
  );
  await Promise.all(
    createdRoomIds.splice(0).map((id) => prisma.tiktokRoom.delete({ where: { id } }).catch(() => {}))
  );
});

describe("watchedRoomFilter", () => {
  it("StreamerもAgencyWatchも無い新規の部屋もmonitoringSuspendedがfalseなら接続対象(情報プール方針)", async () => {
    const room = await createRoom("bare");
    expect(await isWatched(room.id)).toBe(true);
  });

  it("monitoringSuspendedがtrueの部屋(Streamer/AgencyWatch無し)は接続対象外", async () => {
    const room = await createRoom("suspended_bare");
    await prisma.tiktokRoom.update({ where: { id: room.id }, data: { monitoringSuspended: true } });
    expect(await isWatched(room.id)).toBe(false);
  });

  it("Streamerが0人でもAgencyWatchがあれば接続対象になる", async () => {
    const room = await createRoom("agency_only", { monitoringSuspended: true });
    const agency = await createAgency();
    await prisma.agencyWatch.create({
      data: { agencyId: agency.id, roomId: room.id, tiktokId: "someliver" },
    });

    expect(await isWatched(room.id)).toBe(true);

    // 参照が本当にStreamer0人のまま成立していることを確認する。
    expect(await prisma.streamer.count({ where: { roomId: room.id } })).toBe(0);
  });

  it("AgencyWatchを削除すると接続対象から外れる", async () => {
    const room = await createRoom("revoke", { monitoringSuspended: true });
    const agency = await createAgency();
    const watch = await prisma.agencyWatch.create({
      data: { agencyId: agency.id, roomId: room.id, tiktokId: "someliver" },
    });

    expect(await isWatched(room.id)).toBe(true);

    await prisma.agencyWatch.delete({ where: { id: watch.id } });
    expect(await isWatched(room.id)).toBe(false);
  });

  it("事務所ごと削除すると監視もカスケードで消え、接続対象から外れる", async () => {
    const room = await createRoom("agency_deleted", { monitoringSuspended: true });
    const agency = await createAgency();
    await prisma.agencyWatch.create({
      data: { agencyId: agency.id, roomId: room.id, tiktokId: "someliver" },
    });

    expect(await isWatched(room.id)).toBe(true);

    await prisma.agency.delete({ where: { id: agency.id } });
    createdAgencyIds.splice(createdAgencyIds.indexOf(agency.id), 1);

    expect(await isWatched(room.id)).toBe(false);
  });

  it("片方の事務所が消えても、もう片方が監視していれば接続を続ける", async () => {
    const room = await createRoom("mixed", { monitoringSuspended: true });
    const gone = await createAgency();
    const active = await createAgency();
    await prisma.agencyWatch.create({
      data: { agencyId: gone.id, roomId: room.id, tiktokId: "someliver" },
    });
    await prisma.agencyWatch.create({
      data: { agencyId: active.id, roomId: room.id, tiktokId: "someliver" },
    });

    await prisma.agency.delete({ where: { id: gone.id } });
    createdAgencyIds.splice(createdAgencyIds.indexOf(gone.id), 1);

    expect(await isWatched(room.id)).toBe(true);
  });

  it("Streamerが居る従来の部屋は引き続き接続対象", async () => {
    const room = await createRoom("streamer_only");
    const user = await prisma.user.create({ data: { email: `itest-watched-s-${suffix()}@local.test` } });
    createdUserIds.push(user.id);
    await prisma.streamer.create({
      data: { userId: user.id, tiktokId: room.tiktokId, verificationCode: "x", roomId: room.id },
    });

    expect(await isWatched(room.id)).toBe(true);
  });
});

// 匿名観測room(Streamer/AgencyWatch/monitorUntilのいずれも無い部屋)自動停止トグル。
// anonymousStaleBeforeがnull(=トグルOFF)なら現行動作(無条件監視、情報プール方針)と
// 同一であることは上のdescribeで固定済み。ここではトグルON相当(anonymousStaleBeforeに
// 具体的な時刻を渡す)の挙動と、Sidestageユーザーのroomはstale判定の影響を受けない
// (無条件継続)不変条件を固定する。
describe("watchedRoomFilter (匿名room自動停止トグルON相当)", () => {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 30 * 60_000);

  it("匿名roomはlastWatchInstructedAtがstaleBeforeより前なら接続対象外", async () => {
    const room = await createRoom("anon_stale");
    await prisma.tiktokRoom.update({
      where: { id: room.id },
      data: { lastWatchInstructedAt: new Date(staleBefore.getTime() - 60_000) },
    });
    expect(await isWatched(room.id, now, { anonymousStaleBefore: staleBefore })).toBe(false);
  });

  it("匿名roomはlastWatchInstructedAtがstaleBeforeより後なら接続対象", async () => {
    const room = await createRoom("anon_fresh");
    await prisma.tiktokRoom.update({
      where: { id: room.id },
      data: { lastWatchInstructedAt: new Date(staleBefore.getTime() + 60_000) },
    });
    expect(await isWatched(room.id, now, { anonymousStaleBefore: staleBefore })).toBe(true);
  });

  it("Streamerが居ればstale(lastWatchInstructedAtが古い)でも接続対象(不変条件)", async () => {
    const room = await createRoom("anon_streamer_stale");
    await prisma.tiktokRoom.update({
      where: { id: room.id },
      data: { lastWatchInstructedAt: new Date(staleBefore.getTime() - 60_000) },
    });
    const user = await prisma.user.create({
      data: { email: `itest-watched-anon-s-${suffix()}@local.test` },
    });
    createdUserIds.push(user.id);
    await prisma.streamer.create({
      data: { userId: user.id, tiktokId: room.tiktokId, verificationCode: "x", roomId: room.id },
    });
    expect(await isWatched(room.id, now, { anonymousStaleBefore: staleBefore })).toBe(true);
  });

  it("AgencyWatchがあればstaleでも接続対象(不変条件、monitoringSuspended:trueでも同様)", async () => {
    const room = await createRoom("anon_agency_stale", { monitoringSuspended: true });
    await prisma.tiktokRoom.update({
      where: { id: room.id },
      data: { lastWatchInstructedAt: new Date(staleBefore.getTime() - 60_000) },
    });
    const agency = await createAgency();
    await prisma.agencyWatch.create({
      data: { agencyId: agency.id, roomId: room.id, tiktokId: "someliver" },
    });
    expect(await isWatched(room.id, now, { anonymousStaleBefore: staleBefore })).toBe(true);
  });

  it("monitorUntilが未来ならstaleでも接続対象(イベント参加中、不変条件)", async () => {
    const room = await createRoom("anon_event_stale");
    await prisma.tiktokRoom.update({
      where: { id: room.id },
      data: {
        lastWatchInstructedAt: new Date(staleBefore.getTime() - 60_000),
        monitorUntil: new Date(now.getTime() + 60 * 60_000),
      },
    });
    expect(await isWatched(room.id, now, { anonymousStaleBefore: staleBefore })).toBe(true);
  });

  it("specialWatch:trueの匿名roomはstaleでも接続対象(特別監視はstale判定を免除)", async () => {
    const room = await createRoom("anon_special_stale");
    await prisma.tiktokRoom.update({
      where: { id: room.id },
      data: { specialWatch: true, lastWatchInstructedAt: new Date(staleBefore.getTime() - 60_000) },
    });
    expect(await isWatched(room.id, now, { anonymousStaleBefore: staleBefore })).toBe(true);
  });

  it("specialWatch:trueでもmonitoringSuspended:trueなら接続対象外(一時停止が優先)", async () => {
    const room = await createRoom("anon_special_suspended", { monitoringSuspended: true });
    await prisma.tiktokRoom.update({
      where: { id: room.id },
      data: { specialWatch: true, lastWatchInstructedAt: new Date(staleBefore.getTime() + 60_000) },
    });
    expect(await isWatched(room.id, now, { anonymousStaleBefore: staleBefore })).toBe(false);
  });

  it("monitoringSuspended:trueの匿名roomはfreshでも接続対象外(既存不変条件)", async () => {
    const room = await createRoom("anon_suspended_fresh", { monitoringSuspended: true });
    await prisma.tiktokRoom.update({
      where: { id: room.id },
      data: { lastWatchInstructedAt: new Date(staleBefore.getTime() + 60_000) },
    });
    expect(await isWatched(room.id, now, { anonymousStaleBefore: staleBefore })).toBe(false);
  });
});
