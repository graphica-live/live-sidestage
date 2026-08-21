// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// Workerが接続を維持すべき部屋の判定条件(getMyRooms()が使うwatchedRoomFilter)を検証する。
// 事務所のtiktokId直指定では配信者本人の登録(Streamer)が0人の部屋が生まれるため、
// この条件が正しくないと接続が一切張られずデータが1件も溜まらない。
import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { watchedRoomFilter } from "@/lib/tiktok-listener";

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const createdRoomIds: string[] = [];
const createdUserIds: string[] = [];

async function createRoom(prefix: string) {
  const room = await prisma.tiktokRoom.create({ data: { tiktokId: `itest_watched_${prefix}_${suffix()}` } });
  createdRoomIds.push(room.id);
  return room;
}

async function createAgency(approved = true) {
  const user = await prisma.user.create({ data: { email: `itest-watched-${suffix()}@local.test` } });
  createdUserIds.push(user.id);
  return prisma.agency.create({
    data: { userId: user.id, name: "テスト事務所", approved, approvedAt: approved ? new Date() : null },
  });
}

async function isWatched(roomId: string): Promise<boolean> {
  const hit = await prisma.tiktokRoom.findFirst({
    where: { id: roomId, ...watchedRoomFilter() },
    select: { id: true },
  });
  return hit !== null;
}

afterEach(async () => {
  await Promise.all(
    createdUserIds.splice(0).map((id) => prisma.user.delete({ where: { id } }).catch(() => {}))
  );
  await Promise.all(
    createdRoomIds.splice(0).map((id) => prisma.tiktokRoom.delete({ where: { id } }).catch(() => {}))
  );
});

describe("watchedRoomFilter", () => {
  it("StreamerもAgencyWatchも無い部屋は接続対象外", async () => {
    const room = await createRoom("bare");
    expect(await isWatched(room.id)).toBe(false);
  });

  it("Streamerが0人でもAgencyWatchがあれば接続対象になる", async () => {
    const room = await createRoom("agency_only");
    const agency = await createAgency();
    await prisma.agencyWatch.create({
      data: { agencyId: agency.id, roomId: room.id, tiktokId: "someliver" },
    });

    expect(await isWatched(room.id)).toBe(true);

    // 参照が本当にStreamer0人のまま成立していることを確認する。
    const streamerCount = await prisma.streamer.count({ where: { roomId: room.id } });
    expect(streamerCount).toBe(0);
  });

  it("AgencyWatchを削除すると接続対象から外れる", async () => {
    const room = await createRoom("revoke");
    const agency = await createAgency();
    const watch = await prisma.agencyWatch.create({
      data: { agencyId: agency.id, roomId: room.id, tiktokId: "someliver" },
    });

    expect(await isWatched(room.id)).toBe(true);

    await prisma.agencyWatch.delete({ where: { id: watch.id } });
    expect(await isWatched(room.id)).toBe(false);
  });

  it("事務所の承認が取り消されると接続対象から外れる", async () => {
    const room = await createRoom("unapproved");
    const agency = await createAgency();
    await prisma.agencyWatch.create({
      data: { agencyId: agency.id, roomId: room.id, tiktokId: "someliver" },
    });

    expect(await isWatched(room.id)).toBe(true);

    await prisma.agency.update({
      where: { id: agency.id },
      data: { approved: false, approvedAt: null },
    });
    expect(await isWatched(room.id)).toBe(false);
  });

  it("承認済み事務所が1つでも監視していれば接続を続ける", async () => {
    const room = await createRoom("mixed");
    const revoked = await createAgency(false);
    const active = await createAgency(true);
    await prisma.agencyWatch.create({
      data: { agencyId: revoked.id, roomId: room.id, tiktokId: "someliver" },
    });
    await prisma.agencyWatch.create({
      data: { agencyId: active.id, roomId: room.id, tiktokId: "someliver" },
    });

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
