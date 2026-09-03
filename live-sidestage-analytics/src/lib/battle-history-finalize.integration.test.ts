// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// バトル履歴の確定処理(BattleHistory系テーブルへのスナップショット保存)を検証する。
//
// ここで作る TiktokRoom は monitoringSuspended: true にする。Streamer 0人の部屋も
// watchedRoomFilter() の監視対象になったため、そのままだと並行して走る listener 系テストの
// getMyRooms() がこの部屋をグローバルに claim して workerId / listenerStatus を書きに来る。
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";
import {
  commitBattleSnapshot,
  computeBattleSnapshot,
  materializeBattleHistory,
  type BattleSnapshot,
} from "./battle-history-finalize";

const SELF_TIKTOK_ID = "itest_finalize_self";
const NO_HOST_TIKTOK_ID = "itest_finalize_nohost";
const OPPONENT_ANCHOR_ID = "finalize_host_opp";
const SELF_ANCHOR_ID = "finalize_host_self";

const STARTED_AT = new Date("2026-08-10T10:00:00Z");
const ENDED_AT = new Date("2026-08-10T10:05:00Z");
/** 窓の外(集計に混ぜてはいけない)。 */
const AFTER_WINDOW = new Date("2026-08-10T10:30:00Z");
const NOW = new Date("2026-08-10T10:20:00Z");

let selfRoomId: string;
let noHostRoomId: string;

beforeAll(async () => {
  const selfRoom = await prisma.tiktokRoom.create({
    data: { monitoringSuspended: true, tiktokId: SELF_TIKTOK_ID, hostUserId: SELF_ANCHOR_ID },
  });
  selfRoomId = selfRoom.id;
  // hostUserId が未解決(fill-onceのバックフィル待ち)の部屋。
  const noHostRoom = await prisma.tiktokRoom.create({
    data: { monitoringSuspended: true, tiktokId: NO_HOST_TIKTOK_ID, hostUserId: null },
  });
  noHostRoomId = noHostRoom.id;
});

afterAll(async () => {
  // TiktokBattle / Gift / BattleHistory はいずれも room から cascade する。
  await prisma.tiktokRoom.delete({ where: { id: selfRoomId } }).catch(() => {});
  await prisma.tiktokRoom.delete({ where: { id: noHostRoomId } }).catch(() => {});
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.battleHistory.deleteMany({ where: { roomId: { in: [selfRoomId, noHostRoomId] } } });
  await prisma.tiktokBattle.deleteMany({ where: { roomId: { in: [selfRoomId, noHostRoomId] } } });
  await prisma.gift.deleteMany({ where: { roomId: { in: [selfRoomId, noHostRoomId] } } });
  await prisma.roomConnectionInterval.deleteMany({ where: { roomId: { in: [selfRoomId, noHostRoomId] } } });
});

function battleData(
  roomId: string,
  battleId: string,
  overrides: Partial<Prisma.TiktokBattleUncheckedCreateInput> = {}
): Prisma.TiktokBattleUncheckedCreateInput {
  return {
    roomId,
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
    raw: {},
    ...overrides,
  };
}

async function makeGift(roomId: string, overrides: Partial<Prisma.GiftUncheckedCreateInput> = {}) {
  return prisma.gift.create({
    data: {
      roomId,
      uniqueId: "fin_user",
      nickname: "ふぁん",
      giftId: 1,
      giftName: "Rose",
      repeatCount: 1,
      diamondCount: 5,
      totalDiamonds: 5,
      dayKey: "2026-08-10",
      receivedAt: new Date(STARTED_AT.getTime() + 60 * 1000),
      ...overrides,
    },
  });
}

describe("computeBattleSnapshot", () => {
  it("終了済み1vs1のスコア・参加者・貢献者を窓の中だけで集計する", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "snap_ok") });
    await makeGift(selfRoomId, { uniqueId: "fan_a", nickname: "エー", totalDiamonds: 30, repeatCount: 3 });
    await makeGift(selfRoomId, { uniqueId: "fan_b", nickname: "ビー", totalDiamonds: 10, repeatCount: 1 });
    // 窓の外のギフトは混ぜない
    await makeGift(selfRoomId, { uniqueId: "fan_c", nickname: "シー", totalDiamonds: 999, receivedAt: AFTER_WINDOW });

    const snapshot = await computeBattleSnapshot(selfRoomId, "snap_ok", NOW);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.status).toBe("finished");
    expect(snapshot!.windowStart.getTime()).toBe(STARTED_AT.getTime());
    expect(snapshot!.windowEnd.getTime()).toBe(ENDED_AT.getTime());
    expect(snapshot!.selfScore).toBe("1200");
    expect(snapshot!.opponentScore).toBe("900");
    expect(snapshot!.selfTotalDiamonds).toBe(40);
    expect(snapshot!.participants).toEqual([
      {
        side: "self",
        teamIndex: 0,
        position: 0,
        anchorId: SELF_ANCHOR_ID,
        tiktokId: SELF_TIKTOK_ID,
        displayId: "self_handle",
        nickName: "じぶん",
        score: "1200",
        roomId: selfRoomId,
        uniqueIdSnapshot: "self_handle",
        nicknameSnapshot: "じぶん",
        officialScore: "1200",
        isSelf: true,
        observedGiftTotal: 40,
        // 接続履歴ログ(RoomConnectionInterval)行が無いフィクスチャなのでunavailable/coverage 0。
        captureStatus: "unavailable",
        captureCoverage: 0,
      },
      {
        side: "opponent",
        teamIndex: 1,
        position: 0,
        anchorId: OPPONENT_ANCHOR_ID,
        tiktokId: null,
        displayId: "opp_handle",
        nickName: "あいて",
        score: "900",
        roomId: null,
        uniqueIdSnapshot: "opp_handle",
        nicknameSnapshot: "あいて",
        officialScore: "900",
        isSelf: false,
        observedGiftTotal: null,
        // roomId未解決なのでcaptureStatus/captureCoverageとも算出不可。
        captureStatus: "unavailable",
        captureCoverage: null,
      },
    ]);
    // roomId解決できた自分側だけgiftEventsが複製される(相手roomは未監視なのでnull)
    expect(snapshot!.giftEvents.map((g) => [g.senderUniqueIdSnapshot, g.totalDiamonds]).sort()).toEqual([
      ["fan_a", 30],
      ["fan_b", 10],
    ]);
    // totalDiamonds降順に明示ソートされている
    expect(snapshot!.contributors.map((c) => [c.uniqueId, c.totalDiamonds, c.giftCount])).toEqual([
      ["fan_a", 30, 3],
      ["fan_b", 10, 1],
    ]);
  });

  it("接続区間ログ(RoomConnectionInterval)が窓を覆っていればcaptureStatus: completeになる", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "snap_capture") });
    await makeGift(selfRoomId, { uniqueId: "fan_a", nickname: "エー", totalDiamonds: 30 });
    await prisma.roomConnectionInterval.create({
      data: { roomId: selfRoomId, startedAt: STARTED_AT, endedAt: ENDED_AT },
    });

    const snapshot = await computeBattleSnapshot(selfRoomId, "snap_capture", NOW);
    expect(snapshot).not.toBeNull();
    const self = snapshot!.participants.find((p) => p.anchorId === SELF_ANCHOR_ID);
    expect(self?.captureStatus).toBe("complete");
    expect(self?.captureCoverage).toBe(1);
  });

  // 実データで3陣営以上のバトルを観測できていないため、TikTokのteamArmies由来の
  // hostTeams(anchorId -> teamId)を3チーム分そろえたフィクスチャで検証する。
  it("3陣営(1vs1vs1)を「自分1人vs残り全員」へ丸めず、陣営ごとにteamIndex・スコアを保存する", async () => {
    await prisma.tiktokBattle.create({
      data: battleData(selfRoomId, "snap_tri", {
        hostUserIds: [SELF_ANCHOR_ID, "finalize_host_x", "finalize_host_y"],
        hostScores: { [SELF_ANCHOR_ID]: "1200", finalize_host_x: "900", finalize_host_y: "700" },
        hostTeams: { [SELF_ANCHOR_ID]: "1", finalize_host_x: "2", finalize_host_y: "3" },
        hostProfiles: {
          [SELF_ANCHOR_ID]: { displayId: "self_handle", nickName: "じぶん", avatarUrl: null },
          finalize_host_x: { displayId: "x_handle", nickName: "エックス", avatarUrl: null },
          finalize_host_y: { displayId: "y_handle", nickName: "ワイ", avatarUrl: null },
        },
      }),
    });
    await makeGift(selfRoomId);

    const snapshot = await computeBattleSnapshot(selfRoomId, "snap_tri", NOW);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.selfScore).toBe("1200");
    // 旧opponentScoreは1v1のときだけ入れる仕様のまま(3陣営では意味を持たない)。
    expect(snapshot!.opponentScore).toBeNull();
    expect(
      snapshot!.participants.map((p) => ({
        anchorId: p.anchorId,
        side: p.side,
        teamIndex: p.teamIndex,
        score: p.score,
      }))
    ).toEqual([
      { anchorId: SELF_ANCHOR_ID, side: "self", teamIndex: 0, score: "1200" },
      { anchorId: "finalize_host_x", side: "opponent", teamIndex: 1, score: "900" },
      { anchorId: "finalize_host_y", side: "opponent", teamIndex: 2, score: "700" },
    ]);

    // 保存まで通ること(teamIndex/scoreがDB列として往復すること)を確認する。
    const result = await commitBattleSnapshot(snapshot!, NOW);
    expect(result).toEqual({ finalized: true, action: "created" });
    const stored = await prisma.battleHistoryParticipant.findMany({
      where: { battleHistory: { roomId: selfRoomId, battleId: "snap_tri" } },
      orderBy: [{ teamIndex: "asc" }, { position: "asc" }],
      select: { anchorId: true, teamIndex: true, score: true, battleTeamId: true },
    });
    expect(stored.map((p) => ({ anchorId: p.anchorId, teamIndex: p.teamIndex, score: p.score }))).toEqual([
      { anchorId: SELF_ANCHOR_ID, teamIndex: 0, score: "1200" },
      { anchorId: "finalize_host_x", teamIndex: 1, score: "900" },
      { anchorId: "finalize_host_y", teamIndex: 2, score: "700" },
    ]);
    // dual-write先(新構造)のBattleTeamが3陣営分作られ、各participantが別々の自陣営BattleTeamへ紐づくこと
    // (BattleTeamはteamIndex列を持たないので、1:1対応は「3人とも非null・3件とも別id」で確認する)。
    expect(stored.every((p) => p.battleTeamId !== null)).toBe(true);
    expect(new Set(stored.map((p) => p.battleTeamId))).toHaveProperty("size", 3);
    const teams = await prisma.battleTeam.findMany({
      where: { battleHistory: { roomId: selfRoomId, battleId: "snap_tri" } },
    });
    expect(teams).toHaveLength(3);
  });

  it("自分側のhostUserIdが未解決なら確定しない(nullを返す)", async () => {
    await prisma.tiktokBattle.create({ data: battleData(noHostRoomId, "snap_nohost") });
    await makeGift(noHostRoomId);

    expect(await computeBattleSnapshot(noHostRoomId, "snap_nohost", NOW)).toBeNull();
  });

  it("スコアを一度も観測できていない(selfScoreがnull)なら確定しない", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "snap_noscore", { hostScores: {} }) });
    await makeGift(selfRoomId);

    expect(await computeBattleSnapshot(selfRoomId, "snap_noscore", NOW)).toBeNull();
  });

  it("進行中(終了扱いでない)なら確定しない", async () => {
    await prisma.tiktokBattle.create({
      data: battleData(selfRoomId, "snap_live", { action: BATTLE_ACTION.OPEN, endedAt: null }),
    });

    // 開始から1分後 = duration(300秒)未経過なのでlive
    const during = new Date(STARTED_AT.getTime() + 60 * 1000);
    expect(await computeBattleSnapshot(selfRoomId, "snap_live", during)).toBeNull();
  });

  it("相手が1人も特定できない(solo)なら確定しない", async () => {
    await prisma.tiktokBattle.create({
      data: battleData(selfRoomId, "snap_solo", {
        hostUserIds: [SELF_ANCHOR_ID],
        hostScores: { [SELF_ANCHOR_ID]: "500" },
      }),
    });

    expect(await computeBattleSnapshot(selfRoomId, "snap_solo", NOW)).toBeNull();
  });
});

describe("materializeBattleHistory", () => {
  it("値が安定していれば親子行を一括で作る", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "mat_ok") });
    await makeGift(selfRoomId, { uniqueId: "fan_a", nickname: "エー", totalDiamonds: 30, repeatCount: 3 });
    await prisma.roomConnectionInterval.create({
      data: { roomId: selfRoomId, startedAt: STARTED_AT, endedAt: ENDED_AT },
    });

    const result = await materializeBattleHistory(selfRoomId, "mat_ok", NOW, { stabilityDelayMs: 0 });
    expect(result).toEqual({ finalized: true, action: "created" });

    const row = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "mat_ok" } },
      include: { participants: true, contributors: true },
    });
    expect(row).not.toBeNull();
    expect(row!.selfScore).toBe("1200");
    expect(row!.opponentScore).toBe("900");
    expect(row!.selfTotalDiamonds).toBe(30);
    expect(row!.status).toBe("finished");
    expect(row!.participants).toHaveLength(2);
    expect(row!.contributors.map((c) => c.uniqueId)).toEqual(["fan_a"]);
    // dual-write先(新構造)のcaptureStatus/captureCoverageがDB列として往復すること
    // (computeBattleSnapshotのcaptureStatus/captureCoverageがcommitBattleSnapshotの
    // `...p`spreadで実際に書き込まれることの固定)。
    const self = row!.participants.find((p) => p.anchorId === SELF_ANCHOR_ID);
    expect(self?.captureStatus).toBe("complete");
    expect(self?.captureCoverage).toBe(1);
  });

  it("60秒の安定性チェックの間に値が変わったら確定しない", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "mat_unstable") });
    await makeGift(selfRoomId, { uniqueId: "fan_a", nickname: "エー", totalDiamonds: 30 });

    // 1回目と2回目の計算の間に遅延Gift INSERTが届く状況を再現する。
    // Phase2a以降computeBattleSnapshotはparticipant毎のgift/item-use/bonus-mission問い合わせを
    // 追加で行うため1回目の計算自体が数十msかかりうる。1回目実行中に紛れ込ませないよう、
    // 2回目計算(stabilityDelayMs=300後)の直前で確実に間に合う150msに余裕を持たせる。
    const inserted = new Promise<void>((resolve) => {
      setTimeout(() => {
        void makeGift(selfRoomId, { uniqueId: "fan_late", nickname: "レイト", totalDiamonds: 7 }).then(() =>
          resolve()
        );
      }, 150);
    });

    const result = await materializeBattleHistory(selfRoomId, "mat_unstable", NOW, { stabilityDelayMs: 300 });
    await inserted;

    expect(result).toEqual({ finalized: false, reason: "unstable" });
    expect(
      await prisma.battleHistory.findUnique({
        where: { roomId_battleId: { roomId: selfRoomId, battleId: "mat_unstable" } },
      })
    ).toBeNull();
  });

  it("自分側が未解決なら確定せずnot-readyで終わる(行を作らない)", async () => {
    await prisma.tiktokBattle.create({ data: battleData(noHostRoomId, "mat_nohost") });

    const result = await materializeBattleHistory(noHostRoomId, "mat_nohost", NOW, { stabilityDelayMs: 0 });
    expect(result).toEqual({ finalized: false, reason: "not-ready" });
    expect(await prisma.battleHistory.count({ where: { roomId: noHostRoomId } })).toBe(0);
  });

  it("再実行しても冪等(子行が重複しない)", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "mat_idempotent") });
    await makeGift(selfRoomId, { uniqueId: "fan_a", nickname: "エー", totalDiamonds: 30 });

    const first = await materializeBattleHistory(selfRoomId, "mat_idempotent", NOW, { stabilityDelayMs: 0 });
    const second = await materializeBattleHistory(selfRoomId, "mat_idempotent", NOW, { stabilityDelayMs: 0 });

    expect(first).toEqual({ finalized: true, action: "created" });
    expect(second).toEqual({ finalized: true, action: "updated" });

    const rows = await prisma.battleHistory.findMany({
      where: { roomId: selfRoomId, battleId: "mat_idempotent" },
      include: { participants: true, contributors: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].participants).toHaveLength(2);
    expect(rows[0].contributors).toHaveLength(1);

    // dual-write先(新構造)の子行も再実行で重複しないこと(cascade delete→再作成の経路を通す)。
    const giftEvents = await prisma.battleHistoryGiftEvent.findMany({
      where: { participant: { battleHistoryId: rows[0].id } },
    });
    expect(giftEvents).toHaveLength(1);
    expect(giftEvents[0].senderUniqueIdSnapshot).toBe("fan_a");
  });
});

describe("commitBattleSnapshot", () => {
  async function buildSnapshot(battleId: string): Promise<BattleSnapshot> {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, battleId) });
    await makeGift(selfRoomId, { uniqueId: "fan_a", nickname: "エー", totalDiamonds: 30 });
    const snapshot = await computeBattleSnapshot(selfRoomId, battleId, NOW);
    if (snapshot === null) throw new Error("snapshotが作れていない");
    return snapshot;
  }

  it("sourceUpdatedAtが古い書き込みは、新しい確定済み行を上書きしない(CAS)", async () => {
    const snapshot = await buildSnapshot("cas_battle");
    // 「新しいWorkerが後の状態を見て確定した」行をあらかじめ作る
    const newer: BattleSnapshot = {
      ...snapshot,
      selfScore: "9999",
      sourceUpdatedAt: new Date(snapshot.sourceUpdatedAt.getTime() + 60_000),
    };
    expect(await commitBattleSnapshot(newer, NOW)).toEqual({ finalized: true, action: "created" });

    // 旧Workerの遅れた計算(sourceUpdatedAtが古い)が届く
    const stale: BattleSnapshot = { ...snapshot, selfScore: "1" };
    expect(await commitBattleSnapshot(stale, NOW)).toEqual({ finalized: false, reason: "stale" });

    const row = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "cas_battle" } },
    });
    expect(row!.selfScore).toBe("9999");
  });

  it("sourceUpdatedAtが同じ以上なら上書きする", async () => {
    const snapshot = await buildSnapshot("cas_equal_battle");
    await commitBattleSnapshot(snapshot, NOW);

    const same: BattleSnapshot = { ...snapshot, selfScore: "4242" };
    expect(await commitBattleSnapshot(same, NOW)).toEqual({ finalized: true, action: "updated" });

    const row = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "cas_equal_battle" } },
    });
    expect(row!.selfScore).toBe("4242");
  });

  it("子行の作成に失敗したら親行もロールバックされる(部分確定を残さない)", async () => {
    const snapshot = await buildSnapshot("tx_battle");
    // @@unique([battleHistoryId, anchorId]) に違反する参加者を混ぜて、子行の作成を失敗させる
    const broken: BattleSnapshot = {
      ...snapshot,
      participants: [...snapshot.participants, { ...snapshot.participants[0], position: 1 }],
    };

    const result = await commitBattleSnapshot(broken, NOW);
    expect(result.finalized).toBe(false);

    expect(
      await prisma.battleHistory.findUnique({
        where: { roomId_battleId: { roomId: selfRoomId, battleId: "tx_battle" } },
      })
    ).toBeNull();
  });
});
