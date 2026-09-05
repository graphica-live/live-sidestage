import { prisma } from "../src/lib/prisma";
import { computeBattleSnapshot, commitBattleSnapshot } from "../src/lib/battle-history-finalize";

async function main() {
  const selfRoom = await prisma.tiktokRoom.findFirst({ where: { tiktokId: "local_test_streamer" } });
  if (!selfRoom) throw new Error("local_test_streamer room not found. run seed:local first");
  const selfHostUserId = selfRoom.hostUserId ?? "seed_self_host_user";
  if (!selfRoom.hostUserId) {
    await prisma.tiktokRoom.update({ where: { id: selfRoom.id }, data: { hostUserId: selfHostUserId } });
  }

  const opponentTiktokId = "local_test_rival_tc04";
  const opponentHostUserId = "seed_rival_host_user_tc04";
  const opponentRoom = await prisma.tiktokRoom.upsert({
    where: { tiktokId: opponentTiktokId },
    update: { hostUserId: opponentHostUserId },
    create: { tiktokId: opponentTiktokId, hostUserId: opponentHostUserId },
  });

  const now = new Date();
  const startedAt = new Date(now.getTime() - 30 * 60 * 1000);
  const endedAt = new Date(now.getTime() - 20 * 60 * 1000);
  const battleId = `scratch-finalized-battle-${now.getTime()}`;
  const hostScores = { [selfHostUserId]: "1200", [opponentHostUserId]: "900" };

  await prisma.tiktokBattle.create({
    data: {
      roomId: selfRoom.id,
      battleId,
      action: 5,
      startedAt,
      startedAtEstimated: false,
      endedAt,
      durationSec: 600,
      hostUserIds: [selfHostUserId, opponentHostUserId],
      hostScores,
    },
  });
  await prisma.tiktokBattle.create({
    data: {
      roomId: opponentRoom.id,
      battleId,
      action: 5,
      startedAt,
      startedAtEstimated: false,
      endedAt,
      durationSec: 600,
      hostUserIds: [selfHostUserId, opponentHostUserId],
      hostScores,
    },
  });

  const dayKey = now.toISOString().slice(0, 10);
  await prisma.gift.create({
    data: {
      roomId: selfRoom.id,
      uniqueId: "tc04_self_fan",
      nickname: "TC04自陣営ファン",
      giftId: 1,
      giftName: "Rose",
      repeatCount: 1,
      diamondCount: 300,
      totalDiamonds: 300,
      receivedAt: new Date(startedAt.getTime() + 10 * 1000),
      dayKey,
    },
  });
  await prisma.gift.create({
    data: {
      roomId: opponentRoom.id,
      uniqueId: "tc04_opponent_fan",
      nickname: "TC04相手陣営ファン",
      giftId: 1,
      giftName: "Rose",
      repeatCount: 1,
      diamondCount: 200,
      totalDiamonds: 200,
      receivedAt: new Date(startedAt.getTime() + 15 * 1000),
      dayKey,
    },
  });

  const snapshot = await computeBattleSnapshot(selfRoom.id, battleId, now);
  if (!snapshot) throw new Error("computeBattleSnapshot returned null — battle did not qualify for finalize");
  const result = await commitBattleSnapshot(snapshot, now);

  console.log(JSON.stringify({ battleId, selfRoomId: selfRoom.id, opponentRoomId: opponentRoom.id, result }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
