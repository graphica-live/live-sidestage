// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// loadTapPointsForBattle が「差し引いてよい anchor」を room 単位のフラグから正しく
// 組み立てるかを実DBで確認する。**未計測 room のタップ点を tracked に混ぜると、
// 取りこぼしのある delta を「補正済み」として扱ってしまう**ため、ここが要。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { loadTapPointsForBattle } from "./battle-tap-points";
import { makeTiktokUid } from "./__fixtures__/gift";

const roomIds: string[] = [];

function handle(tag: string) {
  return `itesttap${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom(tag: string) {
  const h = handle(tag);
  const room = await prisma.tiktokRoom.create({
    // hostTiktokUid は @unique。ハンドルから導くと room ごとに必ず別値になる。
    data: { tiktokHandle: h, hostTiktokUid: makeTiktokUid(h) },
    select: { id: true },
  });
  roomIds.push(room.id);
  return room;
}

async function makeBattle(roomId: string, battleId: string, tapPointsTracked: boolean) {
  await prisma.tiktokBattle.create({
    data: { roomId, battleId, action: 5, startedAt: new Date(), endedAt: new Date(), tapPointsTracked },
  });
}

afterAll(async () => {
  for (const id of roomIds) {
    await prisma.tiktokRoom.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe("loadTapPointsForBattle", () => {
  it("計測済み room の anchor だけ tracked に入り、タップ点は両サイド分返る", async () => {
    const selfRoom = await makeRoom("self");
    const opponentRoom = await makeRoom("opp");
    const battleId = `b-${Math.random().toString(36).slice(2, 10)}`;
    const occurredAt = new Date();

    await makeBattle(selfRoom.id, battleId, true);
    await makeBattle(opponentRoom.id, battleId, false);
    // hostTiktokUid が「タップの宛先の配信者」、tiktokUid が「10タップしたリスナー」。
    // 差し引き対象(tapTrackedTiktokUids)は前者で、リスナー側と取り違えないこと。
    const selfHostUid = makeTiktokUid("tap_self_host");
    const opponentHostUid = makeTiktokUid("tap_opp_host");
    await prisma.tiktokBattleTapPoint.createMany({
      data: [
        {
          roomId: selfRoom.id,
          battleId,
          hostTiktokUid: selfHostUid,
          tiktokUid: makeTiktokUid("tap_listener_a"),
          occurredAt,
          points: 3,
        },
        {
          roomId: opponentRoom.id,
          battleId,
          hostTiktokUid: opponentHostUid,
          tiktokUid: makeTiktokUid("tap_listener_b"),
          occurredAt,
          points: 3,
        },
      ],
    });

    const input = await loadTapPointsForBattle(battleId);
    expect(input.tapPoints).toHaveLength(2);
    expect(input.tapPoints.map((t) => t.tiktokUid).sort()).toEqual([selfHostUid, opponentHostUid].sort());
    // 相手 room は tapPointsTracked=false なので差し引き対象にしない。
    expect(Array.from(input.tapTrackedTiktokUids)).toEqual([selfHostUid]);
  });

  it("該当バトルが無ければ空(呼び出し側は差し引かない)", async () => {
    const input = await loadTapPointsForBattle(`b-missing-${Math.random().toString(36).slice(2, 10)}`);
    expect(input.tapPoints).toHaveLength(0);
    expect(input.tapTrackedTiktokUids.size).toBe(0);
  });
});
