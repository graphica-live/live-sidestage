// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// バトル履歴の確定処理(BattleHistory系テーブルへのスナップショット保存)を検証する。
//
// ここで作る TiktokRoom は monitoringSuspended: true にする。Streamer 0人の部屋も
// watchedRoomFilter() の監視対象になったため、そのままだと並行して走る listener 系テストの
// getMyRooms() がこの部屋をグローバルに claim して workerId / listenerStatus を書きに来る。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";
import {
  attachReplayData,
  backfillSenderGroupIds,
  commitBattleSnapshot,
  computeBattleSnapshot,
  materializeBattleHistory,
  snapshotsEqual,
  type BattleSnapshot,
} from "./battle-history-finalize";
import { makeTiktokUid } from "./__fixtures__/gift";
import { ensureRoomWatchedByAdmin } from "@/lib/tiktok-room";

const SELF_TIKTOK_ID = "itest_finalize_self";
const NO_HOST_TIKTOK_ID = "itest_finalize_nohost";
const OPPONENT_ANCHOR_ID = makeTiktokUid("finalize_host_opp");
const SELF_ANCHOR_ID = makeTiktokUid("finalize_host_self");
// このバトルの hostTiktokUids に含まれない配信者。自分側を特定できない room の再現に使う
// (hostTiktokUid は NOT NULL になったので「未解決の room」はもう作れない)。
const UNRELATED_ANCHOR_ID = makeTiktokUid("finalize_host_unrelated");

const STARTED_AT = new Date("2026-08-10T10:00:00Z");
const ENDED_AT = new Date("2026-08-10T10:05:00Z");
/** 窓の外(集計に混ぜてはいけない)。 */
const AFTER_WINDOW = new Date("2026-08-10T10:30:00Z");
const NOW = new Date("2026-08-10T10:20:00Z");

let selfRoomId: string;
let noHostRoomId: string;

beforeAll(async () => {
  // specialWatch: true — このファイルの既存テスト群は「購読あり」roomでのBattleHistory
  // 確定処理そのものを検証する対象。誰も購読していないroomではBattleHistoryを作らない
  // ガード(computeBattleSnapshot冒頭のhasBattleSubscriber判定)の対象にしてしまうと
  // ここの正常系テストが軒並み無関係な理由でnullを返して壊れるため、明示的に「購読あり」
  // へ倒す。購読なし判定そのものの検証は「購読なしroomではBattleHistoryが確定されない」
  // 節の専用テストで行う。
  const selfRoom = await prisma.tiktokRoom.create({
    data: {
      monitoringSuspended: true,
      tiktokHandle: SELF_TIKTOK_ID,
      hostTiktokUid: SELF_ANCHOR_ID,
      specialWatch: true,
    },
  });
  selfRoomId = selfRoom.id;
  // このバトルの参加者ではない配信者の部屋(自分側を特定できないケースの再現)。
  const noHostRoom = await prisma.tiktokRoom.create({
    data: {
      monitoringSuspended: true,
      tiktokHandle: NO_HOST_TIKTOK_ID,
      hostTiktokUid: UNRELATED_ANCHOR_ID,
      specialWatch: true,
    },
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
  await prisma.tiktokBattleArmiesSnapshot.deleteMany({ where: { roomId: { in: [selfRoomId, noHostRoomId] } } });
});

/** windowStartからのオフセット(秒)でarmies snapshotを作る。 */
async function makeArmies(roomId: string, battleId: string, tiktokUid: string, offsetSec: number, score: string) {
  return prisma.tiktokBattleArmiesSnapshot.create({
    data: {
      roomId,
      battleId,
      tiktokUid,
      score,
      occurredAt: new Date(STARTED_AT.getTime() + offsetSec * 1000),
    },
  });
}

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
    hostTiktokUids: [SELF_ANCHOR_ID, OPPONENT_ANCHOR_ID],
    hostScores: { [SELF_ANCHOR_ID]: "1200", [OPPONENT_ANCHOR_ID]: "900" },
    hostProfiles: {
      [SELF_ANCHOR_ID]: { displayId: "self_handle", nickName: "じぶん", avatarUrl: "https://example.invalid/a.jpg" },
      [OPPONENT_ANCHOR_ID]: { displayId: "opp_handle", nickName: "あいて", avatarUrl: "https://example.invalid/b.jpg" },
    },
    ...overrides,
  };
}

/**
 * Gift 1行 + その送信者の TikTokUser 行。
 *
 * **表示名(tiktokHandle / nickname)は Gift には無い。** 確定処理が TikTokUser から解決して
 * *Snapshot へ凍結するので、テストでも同じ経路を通す。tiktokUid はハンドルから決定的に導く。
 */
type GiftOverrides = Omit<Partial<Prisma.GiftUncheckedCreateInput>, "roomId"> & {
  tiktokHandle?: string;
  nickname?: string;
};

async function makeGift(roomId: string, overrides: GiftOverrides = {}) {
  const { tiktokHandle = "fin_user", nickname = "ふぁん", ...giftOverrides } = overrides;
  const tiktokUid = giftOverrides.tiktokUid ?? makeTiktokUid(tiktokHandle);
  await prisma.tikTokUser.upsert({
    where: { tiktokUid },
    create: { tiktokUid, tiktokHandle, nickname },
    update: { tiktokHandle, nickname },
  });
  return prisma.gift.create({
    data: {
      roomId,
      tiktokUid,
      giftId: 1,
      giftName: "Rose",
      repeatCount: 1,
      diamondCount: 5,
      totalDiamonds: 5,
      dayKey: "2026-08-10",
      receivedAt: new Date(STARTED_AT.getTime() + 60 * 1000),
      ...giftOverrides,
    },
  });
}

describe("computeBattleSnapshot", () => {
  it("終了済み1vs1のスコア・参加者・貢献者を窓の中だけで集計する", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "snap_ok") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30, repeatCount: 3 });
    await makeGift(selfRoomId, { tiktokHandle: "fan_b", nickname: "ビー", totalDiamonds: 10, repeatCount: 1 });
    // 窓の外のギフトは混ぜない
    await makeGift(selfRoomId, { tiktokHandle: "fan_c", nickname: "シー", totalDiamonds: 999, receivedAt: AFTER_WINDOW });

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
        tiktokUid: SELF_ANCHOR_ID,
        score: "1200",
        roomId: selfRoomId,
        // 自分のハンドルは自room由来(`TiktokRoom.tiktokHandle`)を優先する。
        // hostProfiles の displayId へ落ちるのは room から引けない相手側だけ。
        tiktokHandleSnapshot: SELF_TIKTOK_ID,
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
        tiktokUid: OPPONENT_ANCHOR_ID,
        score: "900",
        roomId: null,
        tiktokHandleSnapshot: "opp_handle",
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
    expect(snapshot!.giftEvents.map((g) => [g.senderTiktokHandleSnapshot, g.totalDiamonds]).sort()).toEqual([
      ["fan_a", 30],
      ["fan_b", 10],
    ]);
  });

  it("接続区間ログ(RoomConnectionInterval)が窓を覆っていればcaptureStatus: completeになる", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "snap_capture") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });
    await prisma.roomConnectionInterval.create({
      data: { roomId: selfRoomId, startedAt: STARTED_AT, endedAt: ENDED_AT },
    });

    const snapshot = await computeBattleSnapshot(selfRoomId, "snap_capture", NOW);
    expect(snapshot).not.toBeNull();
    const self = snapshot!.participants.find((p) => p.tiktokUid === SELF_ANCHOR_ID);
    expect(self?.captureStatus).toBe("complete");
    expect(self?.captureCoverage).toBe(1);
  });

  it("armiesを再生用スコア点へ複製する(窓外・participant外のtiktokUidは捨てる)", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "snap_points") });
    await makeArmies(selfRoomId, "snap_points", SELF_ANCHOR_ID, 0, "0");
    await makeArmies(selfRoomId, "snap_points", SELF_ANCHOR_ID, 60, "1200");
    await makeArmies(selfRoomId, "snap_points", OPPONENT_ANCHOR_ID, 61, "900");
    // participantとして確定しないtiktokUid(観測の揺れ)は捨てる。
    await makeArmies(selfRoomId, "snap_points", makeTiktokUid("finalize_host_ghost"), 62, "5");
    // 窓の終了ちょうど(境界)は含める。
    await makeArmies(selfRoomId, "snap_points", SELF_ANCHOR_ID, 300, "1500");
    // 窓の外(バトル終了後)は複製しない。
    await prisma.tiktokBattleArmiesSnapshot.create({
      data: { roomId: selfRoomId, battleId: "snap_points", tiktokUid: SELF_ANCHOR_ID, score: "9999", occurredAt: AFTER_WINDOW },
    });

    const snapshot = await computeBattleSnapshot(selfRoomId, "snap_points", NOW);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.scorePoints.map((p) => [p.tiktokUid, p.offsetMs, p.score])).toEqual([
      // 窓の開始ちょうど = offsetMs 0、終了ちょうど = 窓長(境界は両端とも含む)。
      [SELF_ANCHOR_ID, 0, "0"],
      [SELF_ANCHOR_ID, 60_000, "1200"],
      [OPPONENT_ANCHOR_ID, 61_000, "900"],
      [SELF_ANCHOR_ID, 300_000, "1500"],
    ]);
  });

  it("窓頭に接続の欠落があっても、その区間の公式スコア増分が無視できる量ならcaptureStatus: completeへ格上げする", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "snap_refine_up") });
    // 窓300秒のうち先頭30秒が未接続 = coverage 0.9(閾値0.98割れ)。
    await prisma.roomConnectionInterval.create({
      data: { roomId: selfRoomId, startedAt: new Date(STARTED_AT.getTime() + 30_000), endedAt: ENDED_AT },
    });
    await prisma.tiktokBattleArmiesSnapshot.createMany({
      data: [
        {
          roomId: selfRoomId,
          battleId: "snap_refine_up",
          tiktokUid: SELF_ANCHOR_ID,
          occurredAt: new Date(STARTED_AT.getTime() + 30_000),
          score: "3",
        },
        {
          roomId: selfRoomId,
          battleId: "snap_refine_up",
          tiktokUid: SELF_ANCHOR_ID,
          occurredAt: new Date(STARTED_AT.getTime() + 200_000),
          score: "1200",
        },
      ],
    });

    const snapshot = await computeBattleSnapshot(selfRoomId, "snap_refine_up", NOW);
    const self = snapshot!.participants.find((p) => p.tiktokUid === SELF_ANCHOR_ID);
    expect(self?.captureStatus).toBe("complete");
    // 格上げしてもcoverageは実測値のまま残す(監査用)。
    expect(self?.captureCoverage).toBeCloseTo(0.9, 5);
  });

  it("窓頭の欠落区間で無視できない量の公式スコアが動いていた場合はcaptureStatus: partialのまま据え置く", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "snap_refine_keep") });
    await prisma.roomConnectionInterval.create({
      data: { roomId: selfRoomId, startedAt: new Date(STARTED_AT.getTime() + 30_000), endedAt: ENDED_AT },
    });
    await prisma.tiktokBattleArmiesSnapshot.createMany({
      data: [
        {
          roomId: selfRoomId,
          battleId: "snap_refine_keep",
          tiktokUid: SELF_ANCHOR_ID,
          occurredAt: new Date(STARTED_AT.getTime() + 30_000),
          score: "400",
        },
        {
          roomId: selfRoomId,
          battleId: "snap_refine_keep",
          tiktokUid: SELF_ANCHOR_ID,
          occurredAt: new Date(STARTED_AT.getTime() + 200_000),
          score: "1200",
        },
      ],
    });

    const snapshot = await computeBattleSnapshot(selfRoomId, "snap_refine_keep", NOW);
    const self = snapshot!.participants.find((p) => p.tiktokUid === SELF_ANCHOR_ID);
    expect(self?.captureStatus).toBe("partial");
    expect(self?.captureCoverage).toBeCloseTo(0.9, 5);
  });

  // 実データで3陣営以上のバトルを観測できていないため、TikTokのteamArmies由来の
  // hostTeams(tiktokUid -> teamId)を3チーム分そろえたフィクスチャで検証する。
  it("3陣営(1vs1vs1)を「自分1人vs残り全員」へ丸めず、陣営ごとにteamIndex・スコアを保存する", async () => {
    await prisma.tiktokBattle.create({
      data: battleData(selfRoomId, "snap_tri", {
        hostTiktokUids: [SELF_ANCHOR_ID, "finalize_host_x", "finalize_host_y"],
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
        tiktokUid: p.tiktokUid,
        side: p.side,
        teamIndex: p.teamIndex,
        score: p.score,
      }))
    ).toEqual([
      { tiktokUid: SELF_ANCHOR_ID, side: "self", teamIndex: 0, score: "1200" },
      { tiktokUid: "finalize_host_x", side: "opponent", teamIndex: 1, score: "900" },
      { tiktokUid: "finalize_host_y", side: "opponent", teamIndex: 2, score: "700" },
    ]);

    // 保存まで通ること(teamIndex/scoreがDB列として往復すること)を確認する。
    const result = await commitBattleSnapshot(snapshot!, NOW);
    expect(result).toEqual({ finalized: true, action: "created" });
    const stored = await prisma.battleHistoryParticipant.findMany({
      where: { battleHistory: { roomId: selfRoomId, battleId: "snap_tri" } },
      orderBy: [{ teamIndex: "asc" }, { position: "asc" }],
      select: { tiktokUid: true, teamIndex: true, score: true, battleTeamId: true },
    });
    expect(stored.map((p) => ({ tiktokUid: p.tiktokUid, teamIndex: p.teamIndex, score: p.score }))).toEqual([
      { tiktokUid: SELF_ANCHOR_ID, teamIndex: 0, score: "1200" },
      { tiktokUid: "finalize_host_x", teamIndex: 1, score: "900" },
      { tiktokUid: "finalize_host_y", teamIndex: 2, score: "700" },
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

  it("自分側のhostTiktokUidが未解決なら確定しない(nullを返す)", async () => {
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
        hostTiktokUids: [SELF_ANCHOR_ID],
        hostScores: { [SELF_ANCHOR_ID]: "500" },
      }),
    });

    expect(await computeBattleSnapshot(selfRoomId, "snap_solo", NOW)).toBeNull();
  });
});

describe("materializeBattleHistory", () => {
  it("値が安定していれば親子行を一括で作る", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "mat_ok") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30, repeatCount: 3 });
    await prisma.roomConnectionInterval.create({
      data: { roomId: selfRoomId, startedAt: STARTED_AT, endedAt: ENDED_AT },
    });

    const result = await materializeBattleHistory(selfRoomId, "mat_ok", NOW, { stabilityDelayMs: 0 });
    expect(result).toEqual({ finalized: true, action: "created" });

    const row = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "mat_ok" } },
      include: { participants: true },
    });
    expect(row).not.toBeNull();
    expect(row!.selfScore).toBe("1200");
    expect(row!.opponentScore).toBe("900");
    expect(row!.selfTotalDiamonds).toBe(30);
    expect(row!.status).toBe("finished");
    expect(row!.participants).toHaveLength(2);
    // 貢献者データは新構造(BattleHistoryGiftEvent)に書かれる。
    const self = row!.participants.find((p) => p.tiktokUid === SELF_ANCHOR_ID);
    const giftEvents = await prisma.battleHistoryGiftEvent.findMany({
      where: { participantId: self!.id },
    });
    expect(giftEvents.map((g) => g.senderTiktokHandleSnapshot)).toEqual(["fan_a"]);
    // captureStatus/captureCoverageがDB列として往復すること
    // (computeBattleSnapshotのcaptureStatus/captureCoverageがcommitBattleSnapshotの
    // `...p`spreadで実際に書き込まれることの固定)。
    expect(self?.captureStatus).toBe("complete");
    expect(self?.captureCoverage).toBe(1);
  });

  it("安定性チェックの間に値が変わったら確定しない", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "mat_unstable") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });

    // 1回目と2回目の計算の間に遅延Gift INSERTが届く状況を再現する。
    // Phase2a以降computeBattleSnapshotはparticipant毎のgift/item-use/bonus-mission問い合わせを
    // 追加で行うため1回目の計算自体が数十msかかりうる。1回目実行中に紛れ込ませないよう、
    // 2回目計算(stabilityDelayMs=300後)の直前で確実に間に合う150msに余裕を持たせる。
    const inserted = new Promise<void>((resolve) => {
      setTimeout(() => {
        void makeGift(selfRoomId, { tiktokHandle: "fan_late", nickname: "レイト", totalDiamonds: 7 }).then(() =>
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
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });

    const first = await materializeBattleHistory(selfRoomId, "mat_idempotent", NOW, { stabilityDelayMs: 0 });
    const second = await materializeBattleHistory(selfRoomId, "mat_idempotent", NOW, { stabilityDelayMs: 0 });

    expect(first).toEqual({ finalized: true, action: "created" });
    expect(second).toEqual({ finalized: true, action: "updated" });

    const rows = await prisma.battleHistory.findMany({
      where: { roomId: selfRoomId, battleId: "mat_idempotent" },
      include: { participants: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].participants).toHaveLength(2);

    // 子行も再実行で重複しないこと(cascade delete→再作成の経路を通す)。
    const giftEvents = await prisma.battleHistoryGiftEvent.findMany({
      where: { participant: { battleHistoryId: rows[0].id } },
    });
    expect(giftEvents).toHaveLength(1);
    expect(giftEvents[0].senderTiktokHandleSnapshot).toBe("fan_a");
  });
});

describe("commitBattleSnapshot", () => {
  async function buildSnapshot(battleId: string): Promise<BattleSnapshot> {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, battleId) });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });
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
    // @@unique([battleHistoryId, tiktokUid]) に違反する参加者を混ぜて、子行の作成を失敗させる
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

describe("再生用データ(scorePoints / opening / replay*Count)", () => {
  it("確定時にスコア点と件数・opening列を保存し、再実行しても重複しない", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "replay_mat") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });
    await makeArmies(selfRoomId, "replay_mat", SELF_ANCHOR_ID, 0, "0");
    await makeArmies(selfRoomId, "replay_mat", SELF_ANCHOR_ID, 60, "1200");

    expect(await materializeBattleHistory(selfRoomId, "replay_mat", NOW, { stabilityDelayMs: 0 })).toEqual({
      finalized: true,
      action: "created",
    });

    const first = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "replay_mat" } },
      select: {
        id: true,
        replayScorePointCount: true,
        replayGiftEventCount: true,
        openingMultiplierConfidence: true,
        openingWindowStartedAt: true,
        openingWindowEndedAt: true,
      },
    });
    expect(first!.replayScorePointCount).toBe(2);
    expect(first!.replayGiftEventCount).toBe(1);
    // 候補ギフトが小粒(30ダイヤ)なので逆算はできない。判定不能を明示的に保存する。
    expect(first!.openingMultiplierConfidence).toBe("unknown");
    // 倍率区間の開始・終了はTikTokが配信しないので、仮定値(60秒)からは絶対に埋めない。
    expect(first!.openingWindowStartedAt).toBeNull();
    expect(first!.openingWindowEndedAt).toBeNull();
    expect(await prisma.battleHistoryScorePoint.count({ where: { battleHistoryId: first!.id } })).toBe(2);

    await materializeBattleHistory(selfRoomId, "replay_mat", NOW, { stabilityDelayMs: 0 });
    const second = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "replay_mat" } },
      select: { id: true, replayScorePointCount: true },
    });
    expect(second!.replayScorePointCount).toBe(2);
    expect(await prisma.battleHistoryScorePoint.count({ where: { battleHistoryId: second!.id } })).toBe(2);
  });

  it("attachReplayDataは既存のparticipants/giftEventsに触れずスコア点だけを後付けする", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "replay_attach") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });
    await materializeBattleHistory(selfRoomId, "replay_attach", NOW, { stabilityDelayMs: 0 });

    const before = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "replay_attach" } },
      select: { id: true, replayScorePointCount: true, finalizedAt: true },
    });
    expect(before!.replayScorePointCount).toBe(0);
    const participantsBefore = await prisma.battleHistoryParticipant.findMany({
      where: { battleHistoryId: before!.id },
      select: { id: true, tiktokUid: true },
      orderBy: { tiktokUid: "asc" },
    });
    const giftEventIdsBefore = (
      await prisma.battleHistoryGiftEvent.findMany({
        where: { participant: { battleHistoryId: before!.id } },
        select: { id: true },
        orderBy: { id: "asc" },
      })
    ).map((g) => g.id);

    // 確定後にarmiesが取り込まれた(=後追いで再生用データを付けたい)状況。
    await makeArmies(selfRoomId, "replay_attach", SELF_ANCHOR_ID, 0, "0");
    await makeArmies(selfRoomId, "replay_attach", SELF_ANCHOR_ID, 60, "1200");

    expect(await attachReplayData(before!.id)).toEqual({ attached: true, scorePointCount: 2, giftEventCount: 1 });

    const after = await prisma.battleHistory.findUnique({
      where: { id: before!.id },
      select: { replayScorePointCount: true, replayGiftEventCount: true, finalizedAt: true },
    });
    expect(after!.replayScorePointCount).toBe(2);
    expect(after!.replayGiftEventCount).toBe(1);
    // 確定そのものはやり直していない。
    expect(after!.finalizedAt!.getTime()).toBe(before!.finalizedAt!.getTime());
    // participant / giftEvent の行IDが保存されたまま(=作り直していない)。
    expect(
      await prisma.battleHistoryParticipant.findMany({
        where: { battleHistoryId: before!.id },
        select: { id: true, tiktokUid: true },
        orderBy: { tiktokUid: "asc" },
      })
    ).toEqual(participantsBefore);
    expect(
      (
        await prisma.battleHistoryGiftEvent.findMany({
          where: { participant: { battleHistoryId: before!.id } },
          select: { id: true },
          orderBy: { id: "asc" },
        })
      ).map((g) => g.id)
    ).toEqual(giftEventIdsBefore);

    // 2回目を流しても重複しない(冪等)。
    expect(await attachReplayData(before!.id)).toEqual({ attached: true, scorePointCount: 2, giftEventCount: 1 });
    expect(await prisma.battleHistoryScorePoint.count({ where: { battleHistoryId: before!.id } })).toBe(2);
  });

  it("同一時刻のスコア点の並びが入れ替わっても安定性判定は一致とみなす", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "replay_stable") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });
    // armiesは1イベントで全anchor分を同一occurredAtで書くため、同着が常態。
    await makeArmies(selfRoomId, "replay_stable", SELF_ANCHOR_ID, 60, "1200");
    await makeArmies(selfRoomId, "replay_stable", OPPONENT_ANCHOR_ID, 60, "900");

    const snapshot = await computeBattleSnapshot(selfRoomId, "replay_stable", NOW);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.scorePoints.length).toBe(2);
    // DBの返却順が入れ替わった状態を模す。並び順に依存する判定だと不一致になる。
    const reversed: BattleSnapshot = { ...snapshot!, scorePoints: [...snapshot!.scorePoints].reverse() };
    expect(snapshotsEqual(snapshot!, reversed)).toBe(true);
  });

  it("attachReplayDataはTiktokBattle行が消えていても付加でき、倍率は判定しない", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "replay_nosource") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });
    await materializeBattleHistory(selfRoomId, "replay_nosource", NOW, { stabilityDelayMs: 0 });
    await makeArmies(selfRoomId, "replay_nosource", SELF_ANCHOR_ID, 0, "0");
    await makeArmies(selfRoomId, "replay_nosource", SELF_ANCHOR_ID, 60, "1200");
    // 窓の開始が実測かどうかの判断材料(startedAtEstimated)が失われた状態。
    await prisma.tiktokBattle.delete({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "replay_nosource" } },
    });

    const history = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "replay_nosource" } },
      select: { id: true },
    });
    expect(await attachReplayData(history!.id)).toEqual({
      attached: true,
      scorePointCount: 2,
      giftEventCount: 1,
    });

    const after = await prisma.battleHistory.findUnique({
      where: { id: history!.id },
      select: { replayScorePointCount: true, openingMultiplier: true, openingMultiplierConfidence: true },
    });
    expect(after!.replayScorePointCount).toBe(2);
    expect(after!.openingMultiplier).toBeNull();
    expect(after!.openingMultiplierConfidence).toBe("unknown");
  });

  it("attachReplayDataは存在しないBattleHistoryならnot-foundを返す", async () => {
    expect(await attachReplayData("battle_history_missing")).toEqual({ attached: false, reason: "not-found" });
  });

  it("自roomのhostTiktokUidを特定できないならattachReplayDataは付加を見送る", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "replay_nohost") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });
    await materializeBattleHistory(selfRoomId, "replay_nohost", NOW, { stabilityDelayMs: 0 });
    await makeArmies(selfRoomId, "replay_nohost", SELF_ANCHOR_ID, 0, "0");
    const history = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "replay_nohost" } },
      select: { id: true },
    });

    // hostTiktokUid は NOT NULL になったので、DBの値としては未解決状態を作れない。
    // 残っている到達経路は「room 行そのものが引けない」ケースなので、そこを再現して
    // 防御的分岐(付加を見送る)が生きていることを固定する。
    const spy = vi.spyOn(prisma.tiktokRoom, "findUnique").mockResolvedValueOnce(null);
    try {
      expect(await attachReplayData(history!.id)).toEqual({ attached: false, reason: "self-host-unresolved" });
      expect(await prisma.battleHistoryScorePoint.count({ where: { battleHistoryId: history!.id } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("同一anchor・同一時刻のarmiesは後勝ちで1点へ畳む", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "replay_dupe") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });
    // 同じ (tiktokUid, occurredAt) が二重に届いた状態。DBの返却順は不定なのでスコア値は問わない。
    await makeArmies(selfRoomId, "replay_dupe", SELF_ANCHOR_ID, 60, "1200");
    await makeArmies(selfRoomId, "replay_dupe", SELF_ANCHOR_ID, 60, "1300");

    const snapshot = await computeBattleSnapshot(selfRoomId, "replay_dupe", NOW);
    expect(snapshot!.scorePoints).toHaveLength(1);
    expect(snapshot!.scorePoints[0].offsetMs).toBe(60_000);

    expect(await commitBattleSnapshot(snapshot!, NOW)).toEqual({ finalized: true, action: "created" });
    const row = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "replay_dupe" } },
      select: { id: true, replayScorePointCount: true },
    });
    expect(row!.replayScorePointCount).toBe(1);
    expect(await prisma.battleHistoryScorePoint.count({ where: { battleHistoryId: row!.id } })).toBe(1);

    // attach 側にも同じ畳み込みがある(コピーが2箇所あるので片方だけ壊れる回帰を防ぐ)。
    expect(await attachReplayData(row!.id)).toEqual({ attached: true, scorePointCount: 1, giftEventCount: 1 });
    expect(await prisma.battleHistoryScorePoint.count({ where: { battleHistoryId: row!.id } })).toBe(1);
  });

  it("スコア点が分割単位(1000)を超えても全件保存される", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "replay_chunk") });
    await makeGift(selfRoomId, { tiktokHandle: "fan_a", nickname: "エー", totalDiamonds: 30 });
    // 窓(300秒)内に 1001 点。4コラボ×250イベントで現実に到達しうる件数。
    await prisma.tiktokBattleArmiesSnapshot.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        roomId: selfRoomId,
        battleId: "replay_chunk",
        tiktokUid: SELF_ANCHOR_ID,
        score: String(i),
        occurredAt: new Date(STARTED_AT.getTime() + i * 250),
      })),
    });

    expect(await materializeBattleHistory(selfRoomId, "replay_chunk", NOW, { stabilityDelayMs: 0 })).toEqual({
      finalized: true,
      action: "created",
    });
    const row = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "replay_chunk" } },
      select: { id: true, replayScorePointCount: true },
    });
    expect(row!.replayScorePointCount).toBe(1001);
    expect(await prisma.battleHistoryScorePoint.count({ where: { battleHistoryId: row!.id } })).toBe(1001);
    const last = await prisma.battleHistoryScorePoint.findFirst({
      where: { battleHistoryId: row!.id },
      orderBy: { offsetMs: "desc" },
    });
    expect(last!.offsetMs).toBe(1000 * 250);
  });
});

describe("初ギフトx倍の逆算(DB経路)", () => {
  /** 逆算がクリーンに成立するフィクスチャ。self へ 1000ダイヤ・倍率刻印ありのギフトを2件。 */
  async function seedOpeningBattle(battleId: string, overrides: Partial<Prisma.TiktokBattleUncheckedCreateInput> = {}) {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, battleId, overrides) });
    // 逆算はギフト明細が欠けていない anchor だけを候補にするので、窓を覆う接続区間ログが要る。
    await prisma.roomConnectionInterval.create({
      data: { roomId: selfRoomId, startedAt: STARTED_AT, endedAt: ENDED_AT },
    });
    const first = await makeGift(selfRoomId, {
      tiktokHandle: "fan_a",
      nickname: "エー",
      totalDiamonds: 1000,
      multiplierType: 0,
      receivedAt: new Date(STARTED_AT.getTime() + 3_000),
    });
    await makeGift(selfRoomId, {
      tiktokHandle: "fan_b",
      nickname: "ビー",
      totalDiamonds: 1000,
      multiplierType: 0,
      receivedAt: new Date(STARTED_AT.getTime() + 13_000),
    });
    await makeArmies(selfRoomId, battleId, SELF_ANCHOR_ID, 0, "0");
    await makeArmies(selfRoomId, battleId, SELF_ANCHOR_ID, 5, "2000");
    await makeArmies(selfRoomId, battleId, SELF_ANCHOR_ID, 15, "4000");
    // 相手陣営のスコア点は自分の逆算へ混ぜない。
    await makeArmies(selfRoomId, battleId, OPPONENT_ANCHOR_ID, 5, "999");
    return first;
  }

  it("クリーンな候補が2件そろえば確定時に倍率をmeasuredで保存する", async () => {
    const basis = await seedOpeningBattle("opening_ok");

    expect(await materializeBattleHistory(selfRoomId, "opening_ok", NOW, { stabilityDelayMs: 0 })).toEqual({
      finalized: true,
      action: "created",
    });
    const row = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "opening_ok" } },
      select: {
        id: true,
        openingMultiplier: true,
        openingMultiplierConfidence: true,
        openingMultiplierBasisGiftId: true,
        openingWindowStartedAt: true,
        openingWindowEndedAt: true,
      },
    });
    expect(row!.openingMultiplier).toBe(2);
    expect(row!.openingMultiplierConfidence).toBe("measured");
    // basisGiftId は Gift.id(= BattleHistoryGiftEvent.sourceGiftId)を指す。
    expect(row!.openingMultiplierBasisGiftId).toBe(basis.id);
    expect(row!.openingWindowStartedAt).toBeNull();
    expect(row!.openingWindowEndedAt).toBeNull();

    // attach 経路も同じ入力から同じ結論に到達する。
    expect(await attachReplayData(row!.id)).toEqual({ attached: true, scorePointCount: 4, giftEventCount: 2 });
    const after = await prisma.battleHistory.findUnique({
      where: { id: row!.id },
      select: { openingMultiplier: true, openingMultiplierConfidence: true, openingMultiplierBasisGiftId: true },
    });
    expect(after!.openingMultiplier).toBe(2);
    expect(after!.openingMultiplierConfidence).toBe("measured");
    expect(after!.openingMultiplierBasisGiftId).toBe(basis.id);
  });

  it("windowStartが推定(startedAtEstimated)なら同じ入力でも倍率を確定しない", async () => {
    await seedOpeningBattle("opening_estimated", { startedAtEstimated: true });

    await materializeBattleHistory(selfRoomId, "opening_estimated", NOW, { stabilityDelayMs: 0 });
    const row = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "opening_estimated" } },
      select: { openingMultiplier: true, openingMultiplierConfidence: true, replayScorePointCount: true },
    });
    // 配信途中から接続した窓の先頭60秒はバトル中盤の通常ギフト区間でしかない。
    expect(row!.openingMultiplier).toBeNull();
    expect(row!.openingMultiplierConfidence).toBe("unknown");
    // 逆算が不能でもスコア点の複製そのものは行う。
    expect(row!.replayScorePointCount).toBe(4);
  });

  it("ギフト明細が部分的に欠けた(captureStatus: partial)anchorのギフトは候補にしない", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "opening_partial") });
    // 窓頭30秒が未接続。その間に無視できない量(400)の公式スコアが動いているので partial のまま。
    await prisma.roomConnectionInterval.create({
      data: { roomId: selfRoomId, startedAt: new Date(STARTED_AT.getTime() + 30_000), endedAt: ENDED_AT },
    });
    await makeGift(selfRoomId, {
      tiktokHandle: "fan_a",
      nickname: "エー",
      totalDiamonds: 1000,
      multiplierType: 0,
      receivedAt: new Date(STARTED_AT.getTime() + 33_000),
    });
    await makeGift(selfRoomId, {
      tiktokHandle: "fan_b",
      nickname: "ビー",
      totalDiamonds: 1000,
      multiplierType: 0,
      receivedAt: new Date(STARTED_AT.getTime() + 43_000),
    });
    await makeArmies(selfRoomId, "opening_partial", SELF_ANCHOR_ID, 30, "400");
    await makeArmies(selfRoomId, "opening_partial", SELF_ANCHOR_ID, 35, "2400");
    await makeArmies(selfRoomId, "opening_partial", SELF_ANCHOR_ID, 45, "4400");

    await materializeBattleHistory(selfRoomId, "opening_partial", NOW, { stabilityDelayMs: 0 });
    const row = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "opening_partial" } },
      select: { openingMultiplier: true, openingMultiplierConfidence: true },
    });
    // 観測できたギフトだけで公式スコアの増分を割ると比が過大に出るため、赤帯を出してはいけない。
    expect(row!.openingMultiplierConfidence).toBe("unknown");
    expect(row!.openingMultiplier).toBeNull();
  });
});

describe("senderGroupId(コンボの束ね鍵)", () => {
  it("確定時に元Giftの groupId / multiplierValue を giftEvent へ写す", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "grp_commit") });
    await makeGift(selfRoomId, {
      tiktokHandle: "fan_a",
      nickname: "エー",
      totalDiamonds: 30,
      groupId: "combo_group_1",
      multiplierValue: 2,
    });

    await materializeBattleHistory(selfRoomId, "grp_commit", NOW, { stabilityDelayMs: 0 });

    const history = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "grp_commit" } },
      select: { id: true },
    });
    const events = await prisma.battleHistoryGiftEvent.findMany({
      where: { participant: { battleHistoryId: history!.id } },
      select: { senderGroupId: true, multiplierValue: true },
    });
    expect(events).toEqual([{ senderGroupId: "combo_group_1", multiplierValue: 2 }]);
  });

  it("後追いの backfill は null 行だけ埋め、元Giftが消えた行は null のまま残す", async () => {
    await prisma.tiktokBattle.create({ data: battleData(selfRoomId, "grp_backfill") });
    const kept = await makeGift(selfRoomId, {
      tiktokHandle: "fan_a",
      nickname: "エー",
      totalDiamonds: 30,
      groupId: "combo_group_2",
    });
    await makeGift(selfRoomId, { tiktokHandle: "fan_b", nickname: "ビー", totalDiamonds: 40, groupId: "combo_group_3" });

    await materializeBattleHistory(selfRoomId, "grp_backfill", NOW, { stabilityDelayMs: 0 });
    const history = await prisma.battleHistory.findUnique({
      where: { roomId_battleId: { roomId: selfRoomId, battleId: "grp_backfill" } },
      select: { id: true },
    });

    // 再生UIのために後から足した列なので、既存の確定済み行は全て null という状態を作る。
    await prisma.battleHistoryGiftEvent.updateMany({
      where: { participant: { battleHistoryId: history!.id } },
      data: { senderGroupId: null },
    });
    // 90日保持を過ぎて元 Gift が消えた行(fan_b)は諦めて null のまま残す。
    await prisma.gift.deleteMany({ where: { roomId: selfRoomId, tiktokUid: makeTiktokUid("fan_b") } });

    await backfillSenderGroupIds(history!.id);

    const events = await prisma.battleHistoryGiftEvent.findMany({
      where: { participant: { battleHistoryId: history!.id } },
      select: { senderTiktokHandleSnapshot: true, senderGroupId: true },
      orderBy: { senderTiktokHandleSnapshot: "asc" },
    });
    expect(events).toEqual([
      { senderTiktokHandleSnapshot: "fan_a", senderGroupId: "combo_group_2" },
      { senderTiktokHandleSnapshot: "fan_b", senderGroupId: null },
    ]);
    expect(kept.groupId).toBe("combo_group_2");
  });
});

describe("購読なしroomではBattleHistoryが確定されない", () => {
  const roomIds: string[] = [];
  const principalIds: string[] = [];
  const agencyIds: string[] = [];

  afterAll(async () => {
    if (agencyIds.length > 0) {
      await prisma.agencyWatch.deleteMany({ where: { agencyId: { in: agencyIds } } });
      await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
    }
    if (principalIds.length > 0) {
      await prisma.streamer.deleteMany({ where: { principalId: { in: principalIds } } });
      await prisma.principal.deleteMany({ where: { id: { in: principalIds } } });
    }
    if (roomIds.length > 0) {
      await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
    }
  });

  async function createRoom(
    hostTiktokUid: string,
    overrides: Partial<Prisma.TiktokRoomUncheckedCreateInput> = {}
  ) {
    const room = await prisma.tiktokRoom.create({
      data: {
        monitoringSuspended: true,
        tiktokHandle: hostTiktokUid,
        hostTiktokUid,
        ...overrides,
      },
    });
    roomIds.push(room.id);
    return room.id;
  }

  it("Streamer/AgencyWatch/specialWatch/monitorUntilいずれも無いroomはcomputeBattleSnapshotがnullを返す(TiktokBattle行自体は残る)", async () => {
    const hostTiktokUid = makeTiktokUid("nosub_self");
    const opponentTiktokUid = makeTiktokUid("nosub_opp");
    const roomId = await createRoom(hostTiktokUid);
    await prisma.tiktokBattle.create({
      data: battleData(roomId, "nosub_snap", {
        hostTiktokUids: [hostTiktokUid, opponentTiktokUid],
        hostScores: { [hostTiktokUid]: "1200", [opponentTiktokUid]: "900" },
      }),
    });

    const snapshot = await computeBattleSnapshot(roomId, "nosub_snap", NOW);
    expect(snapshot).toBeNull();

    const result = await materializeBattleHistory(roomId, "nosub_snap", NOW, { stabilityDelayMs: 0 });
    expect(result).toEqual({ finalized: false, reason: "not-ready" });

    // TiktokBattle行自体は無改修で残る(persistBattleは無関係)。
    const battle = await prisma.tiktokBattle.findUnique({
      where: { roomId_battleId: { roomId, battleId: "nosub_snap" } },
    });
    expect(battle).not.toBeNull();
  });

  it("ensureRoomWatchedByAdminで追加したroomはspecialWatchが自動セットされ確定される(HIGH指摘の回帰防止)", async () => {
    const hostTiktokUid = makeTiktokUid("adminadd_self");
    const opponentTiktokUid = makeTiktokUid("adminadd_opp");
    const { roomId } = await ensureRoomWatchedByAdmin({
      tiktokUid: hostTiktokUid,
      tiktokHandle: "adminadd_self",
      nickname: null,
    });
    roomIds.push(roomId);

    const room = await prisma.tiktokRoom.findUnique({ where: { id: roomId }, select: { specialWatch: true } });
    expect(room?.specialWatch).toBe(true);

    await prisma.tiktokBattle.create({
      data: battleData(roomId, "adminadd_snap", {
        hostTiktokUids: [hostTiktokUid, opponentTiktokUid],
        hostScores: { [hostTiktokUid]: "1200", [opponentTiktokUid]: "900" },
      }),
    });

    const snapshot = await computeBattleSnapshot(roomId, "adminadd_snap", NOW);
    expect(snapshot).not.toBeNull();
  });

  it("monitorUntilが未来のroomは確定される", async () => {
    const hostTiktokUid = makeTiktokUid("monitor_self");
    const opponentTiktokUid = makeTiktokUid("monitor_opp");
    const roomId = await createRoom(hostTiktokUid, {
      monitorUntil: new Date(NOW.getTime() + 3600_000),
    });
    await prisma.tiktokBattle.create({
      data: battleData(roomId, "monitor_snap", {
        hostTiktokUids: [hostTiktokUid, opponentTiktokUid],
        hostScores: { [hostTiktokUid]: "1200", [opponentTiktokUid]: "900" },
      }),
    });

    const snapshot = await computeBattleSnapshot(roomId, "monitor_snap", NOW);
    expect(snapshot).not.toBeNull();
  });

  // Codex-terra TestCase Modeレビュー指摘(MEDIUM): specialWatch/monitorUntilの実経路検証しか
  // 無く、Streamer/AgencyWatch relation経由でcomputeBattleSnapshotが購読ありと判定する
  // integrationケースが欠けていた。relation取得(selfRoom.streamers/watches)の回帰を固定する。
  it("Streamer登録があるroomは購読ありとして確定される", async () => {
    const hostTiktokUid = makeTiktokUid("streamersub_self");
    const opponentTiktokUid = makeTiktokUid("streamersub_opp");
    const roomId = await createRoom(hostTiktokUid);

    const user = await prisma.principal.create({
      data: { email: `itest-bhf-streamer-${roomId}@local.test`, name: "itest" },
      select: { id: true },
    });
    principalIds.push(user.id);
    await prisma.streamer.create({
      data: {
        principalId: user.id,
        roomId,
        tiktokUid: hostTiktokUid,
        tiktokHandle: hostTiktokUid,
        verificationCode: `itest-bhf-vc-${roomId}`,
        apiKey: `itest-bhf-key-${roomId}`,
        overlayToken: `itest-bhf-ov-${roomId}`,
      },
    });

    await prisma.tiktokBattle.create({
      data: battleData(roomId, "streamersub_snap", {
        hostTiktokUids: [hostTiktokUid, opponentTiktokUid],
        hostScores: { [hostTiktokUid]: "1200", [opponentTiktokUid]: "900" },
      }),
    });

    const snapshot = await computeBattleSnapshot(roomId, "streamersub_snap", NOW);
    expect(snapshot).not.toBeNull();
  });

  it("AgencyWatch登録があるroomは購読ありとして確定される", async () => {
    const hostTiktokUid = makeTiktokUid("watchsub_self");
    const opponentTiktokUid = makeTiktokUid("watchsub_opp");
    const roomId = await createRoom(hostTiktokUid);

    const agency = await prisma.agency.create({
      data: { email: `itest-bhf-agency-${roomId}@local.test`, name: "itest事務所" },
      select: { id: true },
    });
    agencyIds.push(agency.id);
    await prisma.agencyWatch.create({
      data: { agencyId: agency.id, roomId, tiktokUid: hostTiktokUid, tiktokHandle: hostTiktokUid },
    });

    await prisma.tiktokBattle.create({
      data: battleData(roomId, "watchsub_snap", {
        hostTiktokUids: [hostTiktokUid, opponentTiktokUid],
        hostScores: { [hostTiktokUid]: "1200", [opponentTiktokUid]: "900" },
      }),
    });

    const snapshot = await computeBattleSnapshot(roomId, "watchsub_snap", NOW);
    expect(snapshot).not.toBeNull();
  });
});
