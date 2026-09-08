import { prisma } from "../src/lib/prisma";

async function main() {
  const selfRoom = await prisma.tiktokRoom.findFirst({ where: { tiktokHandle: "local_test_streamer" } });
  if (!selfRoom) throw new Error("local_test_streamer room not found. run seed:local first");

  const selfHostTiktokUid = selfRoom.hostTiktokUid;

  // room を解決できない相手(= TikTokUser 行も作らない)を意図的に残す。
  const opponentHostTiktokUid = "7000000000000000921";
  const now = new Date();
  const startedAt = new Date(now.getTime() - 60 * 1000);
  const battleId = `scratch-live-battle-${now.getTime()}`;
  const hostScores = { [selfHostTiktokUid]: "450", [opponentHostTiktokUid]: "300" };

  await prisma.tiktokBattle.create({
    data: {
      roomId: selfRoom.id,
      battleId,
      action: 4,
      startedAt,
      startedAtEstimated: false,
      endedAt: null,
      durationSec: null,
      hostTiktokUids: [selfHostTiktokUid, opponentHostTiktokUid],
      hostScores,
    },
  });

  const dayKey = now.toISOString().slice(0, 10);
  const contributors = [
    { tiktokUid: "7000000000000000931", tiktokHandle: "scratch_fan_1", nickname: "スクラッチ太郎", totalDiamonds: 500 },
    { tiktokUid: "7000000000000000932", tiktokHandle: "scratch_fan_2", nickname: "スクラッチ花子", totalDiamonds: 120 },
  ];
  for (const c of contributors) {
    await prisma.tikTokUser.upsert({
      where: { tiktokUid: c.tiktokUid },
      update: { tiktokHandle: c.tiktokHandle, nickname: c.nickname },
      create: { tiktokUid: c.tiktokUid, tiktokHandle: c.tiktokHandle, nickname: c.nickname },
    });
    await prisma.gift.create({
      data: {
        roomId: selfRoom.id,
        tiktokUid: c.tiktokUid,
        giftId: 1,
        giftName: "Rose",
        repeatCount: 1,
        diamondCount: c.totalDiamonds,
        totalDiamonds: c.totalDiamonds,
        receivedAt: new Date(startedAt.getTime() + 10 * 1000),
        dayKey,
      },
    });
  }

  console.log(
    JSON.stringify({
      selfRoomId: selfRoom.id,
      selfHostTiktokUid,
      battleId,
      startedAt,
    })
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
