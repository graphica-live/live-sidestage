import { prisma } from "../src/lib/prisma";

async function main() {
  const selfRoom = await prisma.tiktokRoom.findFirst({ where: { tiktokId: "local_test_streamer" } });
  if (!selfRoom) throw new Error("local_test_streamer room not found. run seed:local first");

  const selfHostUserId = selfRoom.hostUserId ?? "seed_self_host_user";
  if (!selfRoom.hostUserId) {
    await prisma.tiktokRoom.update({ where: { id: selfRoom.id }, data: { hostUserId: selfHostUserId } });
  }

  const opponentHostUserId = "seed_live_rival_host_user_unresolved";
  const now = new Date();
  const startedAt = new Date(now.getTime() - 60 * 1000);
  const battleId = `scratch-live-battle-${now.getTime()}`;
  const hostScores = { [selfHostUserId]: "450", [opponentHostUserId]: "300" };

  await prisma.tiktokBattle.create({
    data: {
      roomId: selfRoom.id,
      battleId,
      action: 4,
      startedAt,
      startedAtEstimated: false,
      endedAt: null,
      durationSec: null,
      hostUserIds: [selfHostUserId, opponentHostUserId],
      hostScores,
    },
  });

  const dayKey = now.toISOString().slice(0, 10);
  const contributors = [
    { uniqueId: "scratch_fan_1", nickname: "スクラッチ太郎", totalDiamonds: 500 },
    { uniqueId: "scratch_fan_2", nickname: "スクラッチ花子", totalDiamonds: 120 },
  ];
  for (const c of contributors) {
    await prisma.gift.create({
      data: {
        roomId: selfRoom.id,
        uniqueId: c.uniqueId,
        nickname: c.nickname,
        profileImageUrl: null,
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
      selfHostUserId,
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
