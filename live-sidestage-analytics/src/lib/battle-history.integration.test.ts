// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// queryBattles() の DB 依存部分(相手roomの解決、opponent.count)を検証する。
// 純粋関数(resolveBattleScore等)のユニットテストは battle-history.test.ts 側にある。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "./prisma";
import { queryBattles } from "./battle-history";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";

const SELF_TIKTOK_ID = "itest_battle_self";
const OPPONENT_B_TIKTOK_ID = "itest_battle_opponent_b";
const OPPONENT_C_TIKTOK_ID = "itest_battle_opponent_c";

let selfRoomId: string;
let opponentBRoomId: string;
let opponentCRoomId: string;

beforeAll(async () => {
  // selfRoom.hostUserId をあえて未解決(null)にする。resolveBattleScore が必ず
  // "unknown" を返す状態を作り、opponent.count が otherRoomIds(others.length > 0 分岐)
  // 経由で決まるケースだけを切り出して検証するため。
  const selfRoom = await prisma.tiktokRoom.create({ data: { tiktokId: SELF_TIKTOK_ID, hostUserId: null } });
  selfRoomId = selfRoom.id;
  const opponentB = await prisma.tiktokRoom.create({ data: { tiktokId: OPPONENT_B_TIKTOK_ID, hostUserId: "host_b" } });
  opponentBRoomId = opponentB.id;
  const opponentC = await prisma.tiktokRoom.create({ data: { tiktokId: OPPONENT_C_TIKTOK_ID, hostUserId: "host_c" } });
  opponentCRoomId = opponentC.id;
});

afterAll(async () => {
  await prisma.tiktokRoom.delete({ where: { id: selfRoomId } }).catch(() => {}); // cascades TiktokBattle
  await prisma.tiktokRoom.delete({ where: { id: opponentBRoomId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: opponentCRoomId } }).catch(() => {});
  await prisma.$disconnect();
});

describe("queryBattles opponent.count", () => {
  it("バトルごとの相手room数を返す(期間全体で観測した他room数の合算にならない)", async () => {
    const range = { start: new Date("2026-08-20T00:00:00Z"), end: new Date("2026-08-21T00:00:00Z") };

    // battle1: 自分 vs 相手B のみ
    await prisma.tiktokBattle.create({
      data: {
        roomId: selfRoomId,
        battleId: "battle1",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-20T10:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-20T10:05:00Z"),
        durationSec: 300,
        hostUserIds: ["host_self"],
        hostScores: {},
        raw: {},
      },
    });
    await prisma.tiktokBattle.create({
      data: {
        roomId: opponentBRoomId,
        battleId: "battle1",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-20T10:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-20T10:05:00Z"),
        durationSec: 300,
        hostUserIds: ["host_b"],
        hostScores: {},
        raw: {},
      },
    });

    // battle2: 自分 vs 相手C のみ(別バトル)
    await prisma.tiktokBattle.create({
      data: {
        roomId: selfRoomId,
        battleId: "battle2",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-20T11:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-20T11:05:00Z"),
        durationSec: 300,
        hostUserIds: ["host_self"],
        hostScores: {},
        raw: {},
      },
    });
    await prisma.tiktokBattle.create({
      data: {
        roomId: opponentCRoomId,
        battleId: "battle2",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-20T11:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-20T11:05:00Z"),
        durationSec: 300,
        hostUserIds: ["host_c"],
        hostScores: {},
        raw: {},
      },
    });

    const { battles } = await queryBattles(selfRoomId, "itest-battle-viewer", range);
    expect(battles).toHaveLength(2);

    const battle1 = battles.find((b) => b.battleId === "battle1")!;
    const battle2 = battles.find((b) => b.battleId === "battle2")!;

    // 修正前は otherRoomIds.length(=2, B と C の合算)が両方に入ってしまっていた。
    expect(battle1.opponent).toEqual({
      tiktokId: OPPONENT_B_TIKTOK_ID,
      displayId: null,
      nickName: null,
      avatarUrl: null,
      count: 1,
    });
    expect(battle2.opponent).toEqual({
      tiktokId: OPPONENT_C_TIKTOK_ID,
      displayId: null,
      nickName: null,
      avatarUrl: null,
      count: 1,
    });
  });
});
