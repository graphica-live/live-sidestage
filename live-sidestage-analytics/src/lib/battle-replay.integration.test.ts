// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// 再生ペイロードの読み出しとシェアトークンの発行を検証する。
//
// TiktokRoom は monitoringSuspended: true にする(並行して走る listener 系テストの
// getMyRooms() がこの部屋を claim しに来るのを防ぐ)。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";
import { materializeBattleHistory } from "./battle-history-finalize";
import { ensureShareToken, queryBattleReplay, queryBattleReplayByShareToken } from "./battle-replay";

const SELF_TIKTOK_ID = "itest_replay_self";
const SELF_ANCHOR_ID = "replay_host_self";
const OPPONENT_ANCHOR_ID = "replay_host_opp";

const STARTED_AT = new Date("2026-08-11T10:00:00Z");
const ENDED_AT = new Date("2026-08-11T10:05:00Z");
const NOW = new Date("2026-08-11T10:20:00Z");

/** 再生できるバトル。 */
const OK_BATTLE_ID = "replay_ok";
/** armies が1件も無く再生できないバトル。 */
const NO_POINTS_BATTLE_ID = "replay_no_points";
/** 件数列は非0だが実際のスコア点が読めない(再確定と交差した)状態を作るバトル。 */
const STALE_COUNT_BATTLE_ID = "replay_stale_count";

let selfRoomId: string;

function battleData(battleId: string): Prisma.TiktokBattleUncheckedCreateInput {
  return {
    roomId: selfRoomId,
    battleId,
    action: BATTLE_ACTION.FINISH,
    startedAt: STARTED_AT,
    startedAtEstimated: false,
    endedAt: ENDED_AT,
    durationSec: 300,
    hostUserIds: [SELF_ANCHOR_ID, OPPONENT_ANCHOR_ID],
    hostScores: { [SELF_ANCHOR_ID]: "1200", [OPPONENT_ANCHOR_ID]: "900" },
    hostProfiles: {
      [SELF_ANCHOR_ID]: { displayId: "self_handle", nickName: "じぶん", avatarUrl: "https://example.invalid/a.jpg" },
      [OPPONENT_ANCHOR_ID]: { displayId: "opp_handle", nickName: "あいて", avatarUrl: "https://example.invalid/b.jpg" },
    },
  };
}

async function makeArmies(battleId: string, anchorId: string, offsetSec: number, score: string) {
  await prisma.tiktokBattleArmiesSnapshot.create({
    data: {
      roomId: selfRoomId,
      battleId,
      anchorId,
      score,
      occurredAt: new Date(STARTED_AT.getTime() + offsetSec * 1000),
    },
  });
}

beforeAll(async () => {
  const room = await prisma.tiktokRoom.create({
    data: { monitoringSuspended: true, tiktokId: SELF_TIKTOK_ID, hostUserId: SELF_ANCHOR_ID },
  });
  selfRoomId = room.id;

  await prisma.tiktokBattle.create({ data: battleData(OK_BATTLE_ID) });
  await prisma.gift.create({
    data: {
      roomId: selfRoomId,
      uniqueId: "replay_fan",
      nickname: "ふぁん",
      giftId: 5655,
      giftName: "Rose",
      repeatCount: 3,
      diamondCount: 10,
      totalDiamonds: 30,
      dayKey: "2026-08-11",
      receivedAt: new Date(STARTED_AT.getTime() + 30_000),
    },
  });
  for (const [offsetSec, selfScore, oppScore] of [
    [0, "0", "0"],
    [30, "300", "100"],
    [60, "1200", "900"],
  ] as const) {
    await makeArmies(OK_BATTLE_ID, SELF_ANCHOR_ID, offsetSec, selfScore);
    await makeArmies(OK_BATTLE_ID, OPPONENT_ANCHOR_ID, offsetSec, oppScore);
  }
  await materializeBattleHistory(selfRoomId, OK_BATTLE_ID, NOW, { stabilityDelayMs: 0 });

  // armies を1件も持たないバトル(スコア点が作られない)。
  await prisma.tiktokBattle.create({ data: battleData(NO_POINTS_BATTLE_ID) });
  await materializeBattleHistory(selfRoomId, NO_POINTS_BATTLE_ID, NOW, { stabilityDelayMs: 0 });

  // 確定後にスコア点だけ消し、件数列を残す(ネストしたselectは1トランザクションにまとまらないので
  // 親行の件数と子行の実配列長がずれうる)。
  await prisma.tiktokBattle.create({ data: battleData(STALE_COUNT_BATTLE_ID) });
  for (const [offsetSec, selfScore, oppScore] of [
    [0, "0", "0"],
    [60, "1200", "900"],
  ] as const) {
    await makeArmies(STALE_COUNT_BATTLE_ID, SELF_ANCHOR_ID, offsetSec, selfScore);
    await makeArmies(STALE_COUNT_BATTLE_ID, OPPONENT_ANCHOR_ID, offsetSec, oppScore);
  }
  await materializeBattleHistory(selfRoomId, STALE_COUNT_BATTLE_ID, NOW, { stabilityDelayMs: 0 });
  const stale = await prisma.battleHistory.findUniqueOrThrow({
    where: { roomId_battleId: { roomId: selfRoomId, battleId: STALE_COUNT_BATTLE_ID } },
    select: { id: true, replayScorePointCount: true },
  });
  expect(stale.replayScorePointCount).toBeGreaterThanOrEqual(2);
  await prisma.battleHistoryScorePoint.deleteMany({ where: { battleHistoryId: stale.id } });
});

afterAll(async () => {
  await prisma.tiktokRoom.delete({ where: { id: selfRoomId } }).catch(() => {});
  await prisma.$disconnect();
});

describe("queryBattleReplay", () => {
  it("確定済みでスコア点が揃っていれば再生ペイロードを返す", async () => {
    const result = await queryBattleReplay(selfRoomId, OK_BATTLE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const payload = result.payload;
    expect(payload.version).toBe(1);
    expect(payload.battleId).toBe(OK_BATTLE_ID);
    expect(payload.durationMs).toBe(300_000);
    expect(payload.anchors).toEqual([SELF_ANCHOR_ID, OPPONENT_ANCHOR_ID]);
    expect(payload.scorePoints).toHaveLength(6);
    // 自陣営のギフト明細は載る。相手roomは監視していないので相手側は0件。
    expect(payload.giftEvents).toHaveLength(1);
    expect(payload.gifts[0].id).toBe(5655);
    expect(payload.opponentGiftsMissing).toBe(true);
    expect(payload.truncated).toBe(false);
  });

  it("スコア点が無いバトルは no_score_points で再生できない", async () => {
    const result = await queryBattleReplay(selfRoomId, NO_POINTS_BATTLE_ID);
    expect(result).toEqual({ ok: false, availability: { available: false, reason: "no_score_points" } });
  });

  it("件数列が非0でも実際に読めたスコア点が足りなければ no_score_points", async () => {
    const result = await queryBattleReplay(selfRoomId, STALE_COUNT_BATTLE_ID);
    expect(result).toEqual({ ok: false, availability: { available: false, reason: "no_score_points" } });
  });

  it("確定していない battleId は not_finalized", async () => {
    const result = await queryBattleReplay(selfRoomId, "replay_missing");
    expect(result).toEqual({ ok: false, availability: { available: false, reason: "not_finalized" } });
  });
});

describe("ensureShareToken", () => {
  it("同時に発行しても1本に収まり、2回目以降は同じトークンを返す", async () => {
    const [a, b, c] = await Promise.all([
      ensureShareToken(selfRoomId, OK_BATTLE_ID),
      ensureShareToken(selfRoomId, OK_BATTLE_ID),
      ensureShareToken(selfRoomId, OK_BATTLE_ID),
    ]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(c).toBe(a);
    // 推測可能な識別子にしない(crypto.randomBytes(24) の16進)。
    expect(a).toMatch(/^[0-9a-f]{48}$/);

    const again = await ensureShareToken(selfRoomId, OK_BATTLE_ID);
    expect(again).toBe(a);
  });

  it("確定していない battleId には発行しない", async () => {
    expect(await ensureShareToken(selfRoomId, "replay_missing")).toBeNull();
  });

  it("再生できない確定済みバトルにも発行する(シェアは貢献者一覧モードにも置くため)", async () => {
    const token = await ensureShareToken(selfRoomId, NO_POINTS_BATTLE_ID);
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    // 再生ペイロードだけが取れない。リンク自体は貢献者一覧の共有として成立する。
    const result = await queryBattleReplayByShareToken(token!);
    expect(result).toEqual({ ok: false, availability: { available: false, reason: "no_score_points" } });
  });
});

describe("queryBattleReplayByShareToken", () => {
  it("公開ペイロードは観測メタと TikTokハンドルを一切含まない", async () => {
    const token = await ensureShareToken(selfRoomId, OK_BATTLE_ID);
    expect(token).not.toBeNull();

    const result = await queryBattleReplayByShareToken(token!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.payload);
    for (const forbidden of [
      selfRoomId,
      "roomId",
      "battleHistoryId",
      "sourceGiftId",
      "streamerId",
      "captureCoverage",
      "captureStatus",
      "sourceUpdatedAt",
      // 配信者・リスナーの TikTokハンドル。
      "self_handle",
      "opp_handle",
      "replay_fan",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    // ニックネームとスコアは公開でも載せる(再生UIに要る)。
    expect(serialized).toContain("じぶん");
    // 相手の陣営スコアは BattleTeam 由来で載る。
    expect(result.payload.teams.map((t) => t.officialScore)).toEqual(["1200", "900"]);
    expect(result.payload.teams.every((t) => t.participants.every((p) => p.uniqueId === null))).toBe(true);
    expect(result.payload.senders.every((s) => s.u === null)).toBe(true);
  });

  it("存在しないトークンは not_finalized(トークンの実在を漏らさない)", async () => {
    const result = await queryBattleReplayByShareToken("0".repeat(48));
    expect(result).toEqual({ ok: false, availability: { available: false, reason: "not_finalized" } });
  });
});
