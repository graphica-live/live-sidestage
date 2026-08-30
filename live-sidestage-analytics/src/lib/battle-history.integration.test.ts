// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// queryBattles() の DB 依存部分(相手roomの解決、opponent.count)を検証する。
// 純粋関数(resolveBattleScore等)のユニットテストは battle-history.test.ts 側にある。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Prisma } from "@prisma/client";
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

describe("queryBattles teams (2vs2)", () => {
  const SELF_TEAMS_TIKTOK_ID = "itest_teams_self";
  const ALLY_TIKTOK_ID = "itest_teams_ally";
  const OPPONENT_C_TEAMS_TIKTOK_ID = "itest_teams_opponent_c";
  const OPPONENT_D_TEAMS_TIKTOK_ID = "itest_teams_opponent_d";

  let selfTeamsRoomId: string;
  let allyRoomId: string;
  let opponentCTeamsRoomId: string;
  let opponentDTeamsRoomId: string;

  beforeAll(async () => {
    const selfRoom = await prisma.tiktokRoom.create({
      data: { tiktokId: SELF_TEAMS_TIKTOK_ID, hostUserId: "host_self" },
    });
    selfTeamsRoomId = selfRoom.id;
    const ally = await prisma.tiktokRoom.create({ data: { tiktokId: ALLY_TIKTOK_ID, hostUserId: "host_b" } });
    allyRoomId = ally.id;
    const opponentC = await prisma.tiktokRoom.create({
      data: { tiktokId: OPPONENT_C_TEAMS_TIKTOK_ID, hostUserId: "host_c" },
    });
    opponentCTeamsRoomId = opponentC.id;
    const opponentD = await prisma.tiktokRoom.create({
      data: { tiktokId: OPPONENT_D_TEAMS_TIKTOK_ID, hostUserId: "host_d" },
    });
    opponentDTeamsRoomId = opponentD.id;
  });

  afterAll(async () => {
    await prisma.tiktokRoom.delete({ where: { id: selfTeamsRoomId } }).catch(() => {}); // cascades TiktokBattle
    await prisma.tiktokRoom.delete({ where: { id: allyRoomId } }).catch(() => {});
    await prisma.tiktokRoom.delete({ where: { id: opponentCTeamsRoomId } }).catch(() => {});
    await prisma.tiktokRoom.delete({ where: { id: opponentDTeamsRoomId } }).catch(() => {});
  });

  it("2vs2でhostTeamsが全員分あれば、selfTeam/opponentTeamを左右split用に組み立て、旧opponentもmulti時代と同じ形で残す", async () => {
    const range = { start: new Date("2026-08-22T00:00:00Z"), end: new Date("2026-08-23T00:00:00Z") };

    await prisma.tiktokBattle.create({
      data: {
        roomId: selfTeamsRoomId,
        battleId: "teams_battle",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-22T10:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-22T10:05:00Z"),
        durationSec: 300,
        hostUserIds: ["host_self", "host_b", "host_c", "host_d"],
        hostScores: { host_self: "100", host_b: "50", host_c: "80", host_d: "20" },
        hostProfiles: {
          host_self: { displayId: "self_handle", nickName: "自分", avatarUrl: null },
          host_b: { displayId: "ally_handle", nickName: "味方", avatarUrl: null },
          host_c: { displayId: "opponent_c_handle", nickName: "相手C", avatarUrl: null },
          host_d: { displayId: "opponent_d_handle", nickName: "相手D", avatarUrl: null },
        },
        hostTeams: { host_self: "1", host_b: "1", host_c: "2", host_d: "2" },
        raw: {},
      },
    });
    // 各roomも同じbattleIdの行を持つ。teamArmiesは両チーム分を1payloadに含むため、
    // どのroomが観測してもcollectHosts()の結果は同じ(=参加者全員分のhostUserIds)になる
    // (自室分だけに絞られない)。この形を再現しないと、buildParticipant()が
    // 「hostUserIdsにanchorIdを含むroom」を探すだけの実装だった場合の取り違えバグを
    // 検出できない(2vs2以上で他room行が複数あると、どのanchorIdを探しても最初の
    // 他room行がヒットしてしまい、全員に同じtiktokIdが割り当てられる)。
    const allHostUserIds = ["host_self", "host_b", "host_c", "host_d"];
    await prisma.tiktokBattle.create({
      data: {
        roomId: allyRoomId,
        battleId: "teams_battle",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-22T10:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-22T10:05:00Z"),
        durationSec: 300,
        hostUserIds: allHostUserIds,
        hostScores: {},
        raw: {},
      },
    });
    await prisma.tiktokBattle.create({
      data: {
        roomId: opponentCTeamsRoomId,
        battleId: "teams_battle",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-22T10:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-22T10:05:00Z"),
        durationSec: 300,
        hostUserIds: allHostUserIds,
        hostScores: {},
        raw: {},
      },
    });
    await prisma.tiktokBattle.create({
      data: {
        roomId: opponentDTeamsRoomId,
        battleId: "teams_battle",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-22T10:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-22T10:05:00Z"),
        durationSec: 300,
        hostUserIds: allHostUserIds,
        hostScores: {},
        raw: {},
      },
    });

    const { battles } = await queryBattles(selfTeamsRoomId, "itest-teams-viewer", range);
    expect(battles).toHaveLength(1);
    const battle = battles[0];

    expect(battle.selfTeam).toEqual([
      { anchorId: "host_self", tiktokId: SELF_TEAMS_TIKTOK_ID, displayId: "self_handle", nickName: "自分", avatarUrl: null },
      { anchorId: "host_b", tiktokId: ALLY_TIKTOK_ID, displayId: "ally_handle", nickName: "味方", avatarUrl: null },
    ]);
    expect(battle.opponentTeam).toEqual([
      {
        anchorId: "host_c",
        tiktokId: OPPONENT_C_TEAMS_TIKTOK_ID,
        displayId: "opponent_c_handle",
        nickName: "相手C",
        avatarUrl: null,
      },
      {
        anchorId: "host_d",
        tiktokId: OPPONENT_D_TEAMS_TIKTOK_ID,
        displayId: "opponent_d_handle",
        nickName: "相手D",
        avatarUrl: null,
      },
    ]);

    // 旧opponentフィールドはmulti時代と同じ形(人数のみ)を保つ(モバイル互換)。
    expect(battle.opponent).toEqual({ tiktokId: null, displayId: null, nickName: null, avatarUrl: null, count: 3 });
    expect(battle.selfScore).toBe("100");
  });
});

describe("queryBattles selfTeam/opponentTeamのtiktokId解決はバトルごとに絞る", () => {
  // TiktokRoom.tiktokId はunique だが hostUserId にはunique制約が無い(ハンドル変更で
  // 旧ハンドルのroom行が残ると、同じhostUserIdを持つroomが複数存在しうる)。表示対象の
  // 複数バトルをまたいで無条件にhostUserIdを検索すると、どのroomがヒットするかが
  // 不定になり、別バトル・別ハンドルのtiktokIdを取り違える(実装時レビューで指摘)。
  const SELF_DUP_TIKTOK_ID = "itest_dup_self";
  const OLD_HANDLE_TIKTOK_ID = "itest_dup_old_handle";
  const NEW_HANDLE_TIKTOK_ID = "itest_dup_new_handle";
  const SHARED_HOST_USER_ID = "host_dup_shared";

  let selfDupRoomId: string;
  let oldHandleRoomId: string;
  let newHandleRoomId: string;

  beforeAll(async () => {
    const selfRoom = await prisma.tiktokRoom.create({
      data: { tiktokId: SELF_DUP_TIKTOK_ID, hostUserId: "host_self_dup" },
    });
    selfDupRoomId = selfRoom.id;
    // 同じ人物のハンドル変更前後を2つのroom行として持つ(hostUserIdが同じ、tiktokIdだけ違う)。
    const oldHandle = await prisma.tiktokRoom.create({
      data: { tiktokId: OLD_HANDLE_TIKTOK_ID, hostUserId: SHARED_HOST_USER_ID },
    });
    oldHandleRoomId = oldHandle.id;
    const newHandle = await prisma.tiktokRoom.create({
      data: { tiktokId: NEW_HANDLE_TIKTOK_ID, hostUserId: SHARED_HOST_USER_ID },
    });
    newHandleRoomId = newHandle.id;
  });

  afterAll(async () => {
    await prisma.tiktokRoom.delete({ where: { id: selfDupRoomId } }).catch(() => {}); // cascades TiktokBattle
    await prisma.tiktokRoom.delete({ where: { id: oldHandleRoomId } }).catch(() => {});
    await prisma.tiktokRoom.delete({ where: { id: newHandleRoomId } }).catch(() => {});
  });

  it("同じhostUserIdを持つ別roomが別バトルに混ざっても、そのバトルで実際に観測されたroomのtiktokIdだけを使う", async () => {
    const range = { start: new Date("2026-08-24T00:00:00Z"), end: new Date("2026-08-25T00:00:00Z") };

    // バトル1: 自分 vs 旧ハンドルroom。
    await prisma.tiktokBattle.create({
      data: {
        roomId: selfDupRoomId,
        battleId: "dup_battle_1",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-24T10:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-24T10:05:00Z"),
        durationSec: 300,
        hostUserIds: ["host_self_dup", SHARED_HOST_USER_ID],
        hostScores: { host_self_dup: "10", [SHARED_HOST_USER_ID]: "5" },
        raw: {},
      },
    });
    await prisma.tiktokBattle.create({
      data: {
        roomId: oldHandleRoomId,
        battleId: "dup_battle_1",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-24T10:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-24T10:05:00Z"),
        durationSec: 300,
        hostUserIds: ["host_self_dup", SHARED_HOST_USER_ID],
        hostScores: {},
        raw: {},
      },
    });

    // バトル2: 自分 vs 新ハンドルroom(同じ表示期間・同じ相手anchorId、別バトル)。
    await prisma.tiktokBattle.create({
      data: {
        roomId: selfDupRoomId,
        battleId: "dup_battle_2",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-24T11:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-24T11:05:00Z"),
        durationSec: 300,
        hostUserIds: ["host_self_dup", SHARED_HOST_USER_ID],
        hostScores: { host_self_dup: "20", [SHARED_HOST_USER_ID]: "8" },
        raw: {},
      },
    });
    await prisma.tiktokBattle.create({
      data: {
        roomId: newHandleRoomId,
        battleId: "dup_battle_2",
        action: BATTLE_ACTION.FINISH,
        startedAt: new Date("2026-08-24T11:00:00Z"),
        startedAtEstimated: false,
        endedAt: new Date("2026-08-24T11:05:00Z"),
        durationSec: 300,
        hostUserIds: ["host_self_dup", SHARED_HOST_USER_ID],
        hostScores: {},
        raw: {},
      },
    });

    const { battles } = await queryBattles(selfDupRoomId, "itest-dup-viewer", range);
    expect(battles).toHaveLength(2);

    const battle1 = battles.find((b) => b.startedAt === new Date("2026-08-24T10:00:00Z").toISOString())!;
    const battle2 = battles.find((b) => b.startedAt === new Date("2026-08-24T11:00:00Z").toISOString())!;

    expect(battle1.opponentTeam?.[0].tiktokId).toBe(OLD_HANDLE_TIKTOK_ID);
    expect(battle2.opponentTeam?.[0].tiktokId).toBe(NEW_HANDLE_TIKTOK_ID);
  });
});

describe("queryBattles listenerQuery", () => {
  const LISTENER_ROOM_TIKTOK_ID = "itest_battle_listener_self";
  let listenerRoomId: string;

  beforeAll(async () => {
    const room = await prisma.tiktokRoom.create({ data: { tiktokId: LISTENER_ROOM_TIKTOK_ID, hostUserId: null } });
    listenerRoomId = room.id;
  });

  afterAll(async () => {
    await prisma.tiktokRoom.delete({ where: { id: listenerRoomId } }).catch(() => {}); // cascades TiktokBattle, Gift
  });

  function battleData(
    battleId: string,
    startedAt: Date,
    overrides: Partial<Prisma.TiktokBattleUncheckedCreateInput> = {}
  ): Prisma.TiktokBattleUncheckedCreateInput {
    return {
      roomId: listenerRoomId,
      battleId,
      action: BATTLE_ACTION.FINISH,
      startedAt,
      startedAtEstimated: false,
      endedAt: new Date(startedAt.getTime() + 5 * 60 * 1000),
      durationSec: 300,
      hostUserIds: ["host_self"],
      hostScores: {},
      raw: {},
      ...overrides,
    };
  }

  async function makeGift(overrides: Partial<Prisma.GiftUncheckedCreateInput>) {
    return prisma.gift.create({
      data: {
        roomId: listenerRoomId,
        uniqueId: "listener_user",
        nickname: "リスナー",
        giftId: 1,
        giftName: "Rose",
        repeatCount: 1,
        diamondCount: 1,
        totalDiamonds: 1,
        dayKey: "2026-08-25",
        receivedAt: new Date("2026-08-25T10:00:00Z"),
        ...overrides,
      },
    });
  }

  it("listenerQueryはギフト送信者のuniqueId/nickname一致(大小文字無視)でバトルを絞り込む", async () => {
    const range = { start: new Date("2026-08-25T00:00:00Z"), end: new Date("2026-08-25T12:00:00Z") };
    const startedAt = new Date("2026-08-25T09:00:00Z");
    await prisma.tiktokBattle.create({ data: battleData("basic_match_battle", startedAt) });
    await prisma.tiktokBattle.create({ data: battleData("basic_nomatch_battle", new Date("2026-08-25T08:00:00Z")) });

    await makeGift({
      uniqueId: "Taro_Listener",
      nickname: "たろう",
      receivedAt: new Date(startedAt.getTime() + 60 * 1000),
    });

    const { battles } = await queryBattles(listenerRoomId, "itest-battle-viewer", range, { listenerQuery: "taro" });

    expect(battles.map((b) => b.battleId)).toEqual(["basic_match_battle"]);
  });

  it("window不明のバトルは一致対象から除外される(偽陽性を返さない)", async () => {
    const startedAt = new Date("2026-08-25T13:00:00Z");
    await prisma.tiktokBattle.create({
      data: battleData("unknown_window_battle", startedAt, {
        action: BATTLE_ACTION.OPEN,
        startedAtEstimated: true,
        endedAt: null,
        durationSec: null,
      }),
    });
    // 開始直後(猶予5分以内)だとliveとして扱われてしまうため、猶予を超えたnowを明示する
    const now = new Date(startedAt.getTime() + 60 * 60 * 1000);
    await makeGift({
      uniqueId: "unknown_window_listener",
      nickname: "判定不能対象",
      receivedAt: new Date(startedAt.getTime() + 60 * 1000),
    });

    const range = { start: new Date("2026-08-25T12:30:00Z"), end: new Date("2026-08-25T14:00:00Z") };
    const { battles } = await queryBattles(listenerRoomId, "itest-battle-viewer", range, {
      listenerQuery: "unknown_window_listener",
      now,
    });

    expect(battles.map((b) => b.battleId)).not.toContain("unknown_window_battle");
  });

  it("1チャンク(CHUNK_SIZE=1000件)を超える候補からでも一致バトルが正しく見つかる(チャンク境界をまたぐ一致)", async () => {
    const rangeStart = new Date("2026-08-26T00:00:00Z");
    const rangeEnd = new Date("2026-08-27T00:00:00Z");
    const total = 1001;

    const battles = Array.from({ length: total }, (_, i) =>
      battleData(`chunk_boundary_battle_${i}`, new Date(rangeEnd.getTime() - (i + 1) * 60 * 1000))
    );
    await prisma.tiktokBattle.createMany({ data: battles });

    // 最も古い(=2チャンク目に入る)バトルの区間内にだけ、対象リスナーのギフトを送る。
    const oldest = battles[battles.length - 1];
    await makeGift({
      uniqueId: "chunk_boundary_listener",
      nickname: "境界リスナー",
      receivedAt: new Date((oldest.startedAt as Date).getTime() + 30 * 1000),
      dayKey: "2026-08-26",
    });

    const { battles: result } = await queryBattles(
      listenerRoomId,
      "itest-battle-viewer",
      { start: rangeStart, end: rangeEnd },
      { listenerQuery: "chunk_boundary_listener" }
    );

    expect(result.map((b) => b.battleId)).toEqual([oldest.battleId]);
  }, 30000);

  it("一致件数がDISPLAY_LIMIT(200)ちょうどならhasMore=false、201件ならtrueになり200件にスライスされる", async () => {
    const rangeStart = new Date("2026-08-28T00:00:00Z");
    const rangeEnd = new Date("2026-08-29T00:00:00Z");

    async function createMatchingBattles(count: number, prefix: string) {
      const battles = Array.from({ length: count }, (_, i) =>
        battleData(`${prefix}_${i}`, new Date(rangeEnd.getTime() - (i + 1) * 60 * 1000))
      );
      await prisma.tiktokBattle.createMany({ data: battles });
      const gifts = battles.map((b) => ({
        roomId: listenerRoomId,
        uniqueId: `${prefix}_listener`,
        nickname: "境界人数リスナー",
        giftId: 1,
        giftName: "Rose",
        repeatCount: 1,
        diamondCount: 1,
        totalDiamonds: 1,
        dayKey: "2026-08-28",
        receivedAt: new Date((b.startedAt as Date).getTime() + 30 * 1000),
      }));
      await prisma.gift.createMany({ data: gifts });
      return battles;
    }

    await createMatchingBattles(200, "exact200");
    const exact = await queryBattles(
      listenerRoomId,
      "itest-battle-viewer",
      { start: rangeStart, end: rangeEnd },
      { listenerQuery: "exact200_listener" }
    );
    expect(exact.battles).toHaveLength(200);
    expect(exact.hasMore).toBe(false);

    await createMatchingBattles(201, "over201");
    const over = await queryBattles(
      listenerRoomId,
      "itest-battle-viewer",
      { start: rangeStart, end: rangeEnd },
      { listenerQuery: "over201_listener" }
    );
    expect(over.battles).toHaveLength(200);
    expect(over.hasMore).toBe(true);
  }, 30000);

  it("一致するバトルが無ければ空配列とhasMore=falseを返す(レンジを走査し切って終了する)", async () => {
    const rangeStart = new Date("2026-08-30T00:00:00Z");
    const rangeEnd = new Date("2026-08-31T00:00:00Z");
    await prisma.tiktokBattle.create({ data: battleData("no_match_battle", new Date("2026-08-30T10:00:00Z")) });

    const { battles, hasMore } = await queryBattles(
      listenerRoomId,
      "itest-battle-viewer",
      { start: rangeStart, end: rangeEnd },
      { listenerQuery: "nonexistent_xyz" }
    );

    expect(battles).toEqual([]);
    expect(hasMore).toBe(false);
  });
});
