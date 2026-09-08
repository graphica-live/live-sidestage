import { prisma } from "../src/lib/prisma";

async function main() {
  const selfRoom = await prisma.tiktokRoom.findFirst({ where: { tiktokHandle: "local_test_streamer" } });
  if (!selfRoom) throw new Error("local_test_streamer room not found. run seed:local first");

  const selfHostTiktokUid = selfRoom.hostTiktokUid;

  const opponentTiktokHandle = "local_test_rival";
  const opponentHostTiktokUid = "7000000000000000901";
  await prisma.tikTokUser.upsert({
    where: { tiktokUid: opponentHostTiktokUid },
    update: { tiktokHandle: opponentTiktokHandle, nickname: "ローカル対戦相手" },
    create: {
      tiktokUid: opponentHostTiktokUid,
      tiktokHandle: opponentTiktokHandle,
      nickname: "ローカル対戦相手",
    },
  });
  const opponentRoom = await prisma.tiktokRoom.upsert({
    where: { hostTiktokUid: opponentHostTiktokUid },
    update: { tiktokHandle: opponentTiktokHandle },
    create: { tiktokHandle: opponentTiktokHandle, hostTiktokUid: opponentHostTiktokUid },
  });

  const now = new Date();
  const startedAt = new Date(now.getTime() - 30 * 60 * 1000);
  const endedAt = new Date(now.getTime() - 20 * 60 * 1000);
  const battleId = `seed-battle-${now.getTime()}`;
  const hostScores = { [selfHostTiktokUid]: "1200", [opponentHostTiktokUid]: "900" };

  await prisma.tiktokBattle.create({
    data: {
      roomId: selfRoom.id,
      battleId,
      action: 5,
      startedAt,
      startedAtEstimated: false,
      endedAt,
      durationSec: 600,
      hostTiktokUids: [selfHostTiktokUid, opponentHostTiktokUid],
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
      hostTiktokUids: [selfHostTiktokUid, opponentHostTiktokUid],
      hostScores,
    },
  });

  console.log(
    JSON.stringify({
      selfRoomId: selfRoom.id,
      selfHostTiktokUid,
      opponentRoomId: opponentRoom.id,
      opponentHostTiktokUid,
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
