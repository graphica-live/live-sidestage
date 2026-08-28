import { prisma } from "../src/lib/prisma";

async function main() {
  const selfRoom = await prisma.tiktokRoom.findFirst({ where: { tiktokId: "local_test_streamer" } });
  if (!selfRoom) throw new Error("local_test_streamer room not found. run seed:local first");

  const selfHostUserId = selfRoom.hostUserId ?? "seed_self_host_user";
  if (!selfRoom.hostUserId) {
    await prisma.tiktokRoom.update({ where: { id: selfRoom.id }, data: { hostUserId: selfHostUserId } });
  }

  const opponentTiktokId = "local_test_rival";
  const opponentHostUserId = "seed_rival_host_user";
  const opponentRoom = await prisma.tiktokRoom.upsert({
    where: { tiktokId: opponentTiktokId },
    update: { hostUserId: opponentHostUserId },
    create: { tiktokId: opponentTiktokId, hostUserId: opponentHostUserId },
  });

  const now = new Date();
  const startedAt = new Date(now.getTime() - 30 * 60 * 1000);
  const endedAt = new Date(now.getTime() - 20 * 60 * 1000);
  const battleId = `seed-battle-${now.getTime()}`;
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
      raw: {},
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
      raw: {},
    },
  });

  console.log(
    JSON.stringify({
      selfRoomId: selfRoom.id,
      selfHostUserId,
      opponentRoomId: opponentRoom.id,
      opponentHostUserId,
      battleId,
      startedAt,
      endedAt,
    })
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
