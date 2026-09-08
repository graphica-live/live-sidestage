import { prisma } from "../src/lib/prisma";
import { computeBattleSnapshot, commitBattleSnapshot } from "../src/lib/battle-history-finalize";

async function main() {
  const selfRoom = await prisma.tiktokRoom.findFirst({ where: { tiktokHandle: "local_test_streamer" } });
  if (!selfRoom) throw new Error("local_test_streamer room not found. run seed:local first");
  const selfHostTiktokUid = selfRoom.hostTiktokUid;

  const opponentTiktokHandle = "local_test_rival_tc04";
  const opponentHostTiktokUid = "7000000000000000904";
  await prisma.tikTokUser.upsert({
    where: { tiktokUid: opponentHostTiktokUid },
    update: { tiktokHandle: opponentTiktokHandle, nickname: "TC04対戦相手" },
    create: {
      tiktokUid: opponentHostTiktokUid,
      tiktokHandle: opponentTiktokHandle,
      nickname: "TC04対戦相手",
    },
  });
  const opponentRoom = await prisma.tiktokRoom.upsert({
    where: { hostTiktokUid: opponentHostTiktokUid },
    update: { tiktokHandle: opponentTiktokHandle },
    create: { tiktokHandle: opponentTiktokHandle, hostTiktokUid: opponentHostTiktokUid },
  });

  // 生観測系(Gift)は表示列を持たないので、送信者は TikTokUser 側に用意する。
  const selfFanUid = "7000000000000000911";
  const opponentFanUid = "7000000000000000912";
  for (const fan of [
    { tiktokUid: selfFanUid, tiktokHandle: "tc04_self_fan", nickname: "TC04自陣営ファン" },
    { tiktokUid: opponentFanUid, tiktokHandle: "tc04_opponent_fan", nickname: "TC04相手陣営ファン" },
  ]) {
    await prisma.tikTokUser.upsert({
      where: { tiktokUid: fan.tiktokUid },
      update: { tiktokHandle: fan.tiktokHandle, nickname: fan.nickname },
      create: fan,
    });
  }

  const now = new Date();
  const startedAt = new Date(now.getTime() - 30 * 60 * 1000);
  const endedAt = new Date(now.getTime() - 20 * 60 * 1000);
  const battleId = `scratch-finalized-battle-${now.getTime()}`;
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

  const dayKey = now.toISOString().slice(0, 10);
  await prisma.gift.create({
    data: {
      roomId: selfRoom.id,
      tiktokUid: selfFanUid,
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
      tiktokUid: opponentFanUid,
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
