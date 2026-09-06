// バトル履歴の確定処理(非正規化スナップショットの作成)。
//
// **確定は「正しさの前提」ではなくキャッシュ的な最適化。** 未確定の間、読み出し側
// (src/lib/battle-history.ts)は従来どおり TiktokBattle + Gift のライブ集計へフォールバックする。
// したがって確定に失敗しても・取りこぼしても表示は壊れず、複雑なリトライや定期リコンサイラは
// 設けない。取りこぼしをまとめて解消したいときは scripts/backfill-battle-history.ts を再実行する
// (冪等)。
//
// 確定してよい条件は「時間が経ったこと」ではなく「値が実際に静止していること」で判定する:
//
// 1. Gift の保存は persistBattle と非同期・非awaitの別経路(saveGift(...).then(...))なので、
//    END検知の瞬間には集計対象の Gift がまだ INSERT されていない。トリガはEND検知の**10秒後**
//    (2026-09-02に10分→30秒、2026-09-06に30秒→10秒へさらに短縮)。
// 2. 10秒後でも「スコアが一度も観測できていない」ことがある(resolveBattleScore の
//    kind !== "unknown" は自分の anchorId を識別できたことしか保証しない)。selfScore が null なら
//    確定しない。不完全な値を確定すると、行が存在するせいでライブ集計へ戻れなくなり永久に残る。
// 3. さらに**10秒待って同じ計算をやり直し、全項目が完全一致した場合のみ**確定する。
//    armies の score_updated や遅延 Gift INSERT が届き続けている最中に確定しないための実測。
//
// 既知の残存リスク: 10秒の無変化は「今後もう変化しない」ことの証明ではない(TikTok側に完了
// マーカーが無い)。2回目の計算直後〜コミット後に遅延更新が届くと、確定値がわずかに古いまま
// 残ることがありうる。**トリガを10分→30秒→10秒、安定性チェック間隔を60秒→10秒へ短縮した
// ことで、END検知から確定判定(2回目の計算)までの実時間は最短20秒(10秒+10秒)となり、
// 以前(90秒、さらに以前は11分)より遅延Giftを取りこぼすリスクが明確に上がる。**表示速度を
// 優先した明示的なトレードオフ。** 取りこぼして確定した行は BattleHistory に存在してしまう
// ため、scripts/backfill-battle-history.ts は「既確定スキップ」で素通りし、自動では直らない
// (手動で該当行を削除してから backfill を再実行する必要がある)。実害は「表示が数ダイヤ・
// 数秒古い」程度に限られる、という従来の想定はこの変更でさらに崩れやすくなる。

import { prisma } from "@/lib/prisma";
import { computeCaptureCoverage, refineCaptureByScore, type CaptureGap, type CaptureStatus } from "@/lib/room-connection-log";
import {
  asTeamEntries,
  mergeMaxScores,
  resolveBattleScore,
  resolveBattleSides,
  resolveBattleWindow,
  resolveParticipantIdentity,
  resolveParticipantRoomId,
  type BattleRow,
} from "@/lib/battle-history";
import type { HostProfiles } from "@/lib/tiktok-battle";
import { inferOpeningMultiplier, type OpeningMultiplierResult } from "@/lib/battle-opening-multiplier";

/** BattleHistoryGiftEvent等の子行createManyを分割する単位。Postgresのbind数上限対策
 * (1バトルのギフト送信回数は数百〜数千になりうる)。Prismaの自動分割に依存しない。 */
const GIFT_EVENT_CHUNK_SIZE = 1000;

/** 安定性チェックの待ち時間。1回目と2回目の計算の間隔。 */
export const STABILITY_DELAY_MS = 10 * 1000;

export type BattleSnapshotParticipant = {
  /** 後方互換の2値。teamIndex===0 が "self"、それ以外が "opponent"。 */
  side: "self" | "opponent";
  /** 陣営番号。0が自分の陣営。**3陣営以上もここで区別する**(sideでは潰れる)。 */
  teamIndex: number;
  /** 陣営内の表示順。 */
  position: number;
  anchorId: string;
  tiktokId: string | null;
  displayId: string | null;
  nickName: string | null;
  /** 確定時に観測できていたこのメンバーのスコア。未観測ならnull。 */
  score: string | null;

  // --- Phase2a(新構造dual-write)拡張。 ---
  /** このメンバーの配信room。自分は必ず解決できる。相手はSidestageが別途そのroomを
   * 監視できていた場合のみ解決できる(できなければnull=新構造の個別ギフトイベントは保存不可)。 */
  roomId: string | null;
  /** displayIdの後継。同一値をコピーするだけ(新構造での正としての位置づけ)。 */
  uniqueIdSnapshot: string | null;
  /** nickNameの後継。同一値をコピーするだけ。 */
  nicknameSnapshot: string | null;
  /** scoreの後継。同一値をコピーするだけ。 */
  officialScore: string | null;
  /** teamIndex===0の導出値。 */
  isSelf: boolean;
  /** roomId解決できた場合のみ、そのroomでの窓内gift合計diamond。解決不能ならnull。 */
  observedGiftTotal: number | null;
  /** roomId解決できた場合のみ、RoomConnectionIntervalから算出した捕捉率区分(Phase2b)。
   * roomId nullなら"unavailable"(監視対象外)、解決できたが接続区間が0件なら"unavailable"(coverage: 0)。 */
  captureStatus: "complete" | "partial" | "unavailable" | null;
  /** roomId解決できた場合のみ、窓時間に対する接続区間の被覆率(0.0〜1.0)。roomId nullならnull。 */
  captureCoverage: number | null;
};

/** BattleHistoryGiftEvent 1行分。participantId確定前なのでanchorIdで紐付ける。 */
export type BattleSnapshotGiftEvent = {
  participantAnchorId: string;
  occurredAt: Date;
  senderUniqueIdSnapshot: string;
  senderNicknameSnapshot: string;
  giftId: number;
  giftNameSnapshot: string;
  repeatCount: number;
  diamondCount: number;
  totalDiamonds: number;
  multiplierType: number | null;
  multiplierValue: number | null;
  sourceGiftId: string;
};

/** BattleHistoryItemCardEvent 1行分。自room(snapshot.roomId)で観測したものだけを対象にする
 * (両room監視時の重複複製を避けるため)。使用対象(targetHostUserId)でparticipantへ配る。 */
export type BattleSnapshotItemCardEvent = {
  participantAnchorId: string;
  occurredAt: Date;
  cardType: number;
  senderUniqueIdSnapshot: string | null;
  senderNicknameSnapshot: string | null;
  senderTiktokUserId: string | null;
};

/** BattleHistoryBonusMission 1行分。roomId解決できたparticipantのみ対象。 */
export type BattleSnapshotBonusMission = {
  participantAnchorId: string;
  targetType: number;
  progressTarget: number;
  rewardMultiple: number;
  startedAt: Date;
  settledAt: Date | null;
  taskResult: number | null;
  rewardStartedAt: Date | null;
  rewardEndedAt: Date | null;
  rewardSum: number | null;
};

/** BattleHistoryScorePoint 1行分。**自room(このBattleHistoryを確定させるroom)のwindow内の
 * TiktokBattleArmiesSnapshotだけを複製する**(itemCardEventsと同じ原則。自roomのarmiesに全anchorの
 * スコアが含まれるので、4コラボでも全員分のバーが作れる)。offsetMsはwindowStartからの経過ms。 */
export type BattleSnapshotScorePoint = {
  anchorId: string;
  offsetMs: number;
  occurredAt: Date;
  score: string;
};

/** BattleTeam 1行分。teamIndexでBattleSnapshotParticipant.teamIndexと対応づける
 * (BattleTeam自体はteamIndex列を持たないため、作成順=factions順で紐付ける)。 */
export type BattleSnapshotTeam = {
  teamIndex: number;
  externalTeamId: string | null;
  officialScore: string | null;
};

export type BattleSnapshot = {
  roomId: string;
  battleId: string;
  windowStart: Date;
  windowEnd: Date;
  status: "finished" | "cut_short";
  /** 確定するのは selfScore を観測できた場合だけなので必ず非null。 */
  selfScore: string;
  opponentScore: string | null;
  selfTotalDiamonds: number;
  /** 集計に使った全room TiktokBattle行のupdatedAt最大値。並行materialize時のCASに使う。 */
  sourceUpdatedAt: Date;
  participants: BattleSnapshotParticipant[];
  teams: BattleSnapshotTeam[];
  giftEvents: BattleSnapshotGiftEvent[];
  itemCardEvents: BattleSnapshotItemCardEvent[];
  bonusMissions: BattleSnapshotBonusMission[];
  /** バトル再生のスコアバー用。件数が0でも確定はする(再生できないだけ)。 */
  scorePoints: BattleSnapshotScorePoint[];
  /** 「初ギフトx倍」の逆算結果。多くのバトルで unknown になる。 */
  opening: OpeningMultiplierResult;
};

export type MaterializeResult =
  | { finalized: true; action: "created" | "updated" }
  | { finalized: false; reason: "not-ready" | "unstable" | "stale" | "conflict" };

/**
 * 確定に使うスナップショットを1回計算する。**副作用なし**(DBは読むだけ)。
 *
 * 以下のいずれかなら null(=確定してはいけない)を返す:
 * - TiktokBattle行が無い
 * - 窓が決まらない / 終了扱いでない(live・unknown・end===nullのcut_short)
 * - 自分のanchorIdを識別できない(resolveBattleScore が unknown)
 * - スコアを一度も観測できていない(selfScore === null)
 * - 相手が1人も特定できない(solo)。旧`opponent`フィールドの復元に必要な情報が
 *   スナップショットに残らないため、確定せずライブ集計に任せる
 */
/**
 * 接続の欠落区間で公式スコアが実際に動いていたかを`TiktokBattleArmiesSnapshot`で確かめ、
 * 動いていなければ捕捉状態を"complete"へ格上げする(`refineCaptureByScore`)。
 *
 * 相手roomはバトル開始検知後にオンデマンド接続するため窓頭を必ず数秒取り逃し、時間被覆率だけで
 * 判定すると常に"partial"(UI表示「一部」)になる。実データが欠けていないのに欠損を示唆するため、
 * スコアの動きで裏を取る。
 *
 * **確定処理は最適化であって必須ではない**ので、この見積もりが失敗しても確定そのものは止めない
 * (ログを残して元の判定をそのまま使う)。
 */
async function refineCaptureWithOfficialScore(
  base: { status: CaptureStatus; coverage: number; gaps: CaptureGap[] },
  battleId: string,
  anchorId: string,
  officialScore: string | null
): Promise<{ status: CaptureStatus; coverage: number }> {
  if (base.status === "complete" || base.gaps.length === 0) {
    return { status: base.status, coverage: base.coverage };
  }
  try {
    const rows = await prisma.tiktokBattleArmiesSnapshot.findMany({
      where: { battleId, anchorId },
      select: { occurredAt: true, score: true },
      orderBy: { occurredAt: "asc" },
    });
    const scorePoints = rows
      .map((r) => ({ atMs: r.occurredAt.getTime(), score: Number(r.score) }))
      .filter((p) => Number.isFinite(p.score));
    const finalScore = officialScore === null ? null : Number(officialScore);
    const refined = refineCaptureByScore(
      base,
      scorePoints,
      finalScore !== null && Number.isFinite(finalScore) ? finalScore : null
    );
    return { status: refined.status, coverage: refined.coverage };
  } catch (err) {
    console.error("[battle-history-finalize] refineCaptureWithOfficialScore failed", { battleId, anchorId, err });
    return { status: base.status, coverage: base.coverage };
  }
}

export async function computeBattleSnapshot(
  roomId: string,
  battleId: string,
  now: Date
): Promise<BattleSnapshot | null> {
  const own = await prisma.tiktokBattle.findUnique({
    where: { roomId_battleId: { roomId, battleId } },
    select: {
      battleId: true,
      action: true,
      startedAt: true,
      startedAtEstimated: true,
      endedAt: true,
      durationSec: true,
      hostUserIds: true,
      hostScores: true,
      hostProfiles: true,
      hostTeams: true,
      updatedAt: true,
    },
  });
  if (!own) return null;

  const windowInfo = resolveBattleWindow(own, now);
  if (windowInfo.status !== "finished" && windowInfo.status !== "cut_short") return null;
  if (windowInfo.window === null || windowInfo.window.end === null) return null;
  const windowStart = windowInfo.window.start;
  const windowEnd = windowInfo.window.end;

  const selfRoom = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { hostUserId: true, tiktokId: true },
  });
  // hostUserId は fill-once で、閲覧契機の遅延バックフィル(backfillHostUserIds)でしか埋まらない。
  // 30秒後の時点でも未解決なことがある。その場合は確定しない(以後もライブ集計にフォールバックする)。
  const selfHostUserId = selfRoom?.hostUserId ?? null;
  if (selfHostUserId === null) return null;
  const selfTiktokId = selfRoom?.tiktokId ?? null;

  const others = await prisma.tiktokBattle.findMany({
    where: { battleId, roomId: { not: roomId } },
    select: { battleId: true, roomId: true, hostUserIds: true, hostScores: true, updatedAt: true },
  });

  const rows: BattleRow[] = [
    { battleId: own.battleId, hostUserIds: own.hostUserIds, hostScores: own.hostScores },
    ...others.map((o) => ({ battleId: o.battleId, hostUserIds: o.hostUserIds, hostScores: o.hostScores })),
  ];

  const resolved = resolveBattleScore({ rows, selfHostUserId, selfHostTeams: own.hostTeams });
  if (resolved.selfScore === null) return null;
  // 1v1で相手スコアが一度も観測できていない場合も確定しない(H5と対称の保護)。opponentScore=nullを
  // 確定してしまうと、以後もライブ集計に戻れず永久に空欄のまま残る。
  if (resolved.kind === "1v1" && resolved.opponentScore === null) return null;

  const sides = resolveBattleSides(resolved, selfHostUserId);
  if (
    sides.selfTeamAnchorIds === null ||
    sides.opponentTeamAnchorIds === null ||
    sides.opponentTeamAnchorIds.length === 0
  ) {
    return null;
  }

  const otherRoomIds = [...new Set(others.map((o) => o.roomId))];
  const otherRooms =
    otherRoomIds.length > 0
      ? await prisma.tiktokRoom.findMany({
          where: { id: { in: otherRoomIds } },
          select: { id: true, tiktokId: true, hostUserId: true },
        })
      : [];
  const otherRoomById = new Map(otherRooms.map((r) => [r.id, r]));
  const otherRoomIdsForBattle = others.map((o) => o.roomId);
  const hostProfiles = own.hostProfiles as HostProfiles | null;

  // 陣営の内訳は resolveBattleScore が出した factions をそのまま保存する
  // (**「自分1人 vs 残り全員」へ丸めない**)。sides は旧side列の値を決めるためだけに使う。
  const factions = "factions" in resolved ? resolved.factions : null;
  if (factions === null || factions.length === 0) return null;

  // メンバー個別のスコアは faction の合計からは復元できないので、ここで anchorId 単位に引き直す。
  const merged = mergeMaxScores(rows);

  const participantsBase = factions.flatMap((faction) =>
    faction.anchorIds.map((anchorId, position) => {
      const identity = resolveParticipantIdentity(
        anchorId,
        hostProfiles,
        otherRoomIdsForBattle,
        otherRoomById,
        selfHostUserId,
        selfTiktokId
      );
      const score = merged.get(anchorId)?.toString() ?? null;
      return {
        side: (faction.index === 0 ? "self" : "opponent") as "self" | "opponent",
        teamIndex: faction.index,
        position,
        ...identity,
        score,
        roomId: resolveParticipantRoomId(anchorId, otherRoomIdsForBattle, otherRoomById, selfHostUserId, roomId),
        uniqueIdSnapshot: identity.displayId,
        nicknameSnapshot: identity.nickName,
        officialScore: score,
        // 陣営(faction.index===0)でなく参加者個人がselfHostUserIdと一致するかで判定する。
        // 陣営全体フラグのままだとチームメイトも isSelf: true として確定保存されてしまう。
        isSelf: anchorId === selfHostUserId,
      };
    })
  );

  // roomId解決できたparticipantについてのみ、そのroomの生gift行を窓内で読み取り、
  // BattleHistoryGiftEvent用の行とobservedGiftTotalを作る(自room・相手roomとも同じクエリ形)。
  // resolveParticipantRoomIdは「1 room = 1 participant」を前提にしている(schema設計上の前提、
  // src/lib/battle-history.tsのコメント参照)ので、roomIdごとに高々1回のクエリで済む。
  const giftEvents: BattleSnapshotGiftEvent[] = [];
  const observedGiftTotalByAnchorId = new Map<string, number>();
  const captureByAnchorId = new Map<string, { status: "complete" | "partial" | "unavailable"; coverage: number }>();
  for (const p of participantsBase) {
    if (p.roomId === null) continue;
    const baseCapture = await computeCaptureCoverage(p.roomId, windowStart, windowEnd, now);
    captureByAnchorId.set(
      p.anchorId,
      await refineCaptureWithOfficialScore(baseCapture, battleId, p.anchorId, p.score)
    );
    const rows = await prisma.gift.findMany({
      where: { roomId: p.roomId, receivedAt: { gte: windowStart, lte: windowEnd } },
      select: {
        id: true,
        uniqueId: true,
        nickname: true,
        giftId: true,
        giftName: true,
        repeatCount: true,
        diamondCount: true,
        totalDiamonds: true,
        multiplierType: true,
        multiplierValue: true,
        receivedAt: true,
      },
    });
    let total = 0;
    for (const g of rows) {
      total += g.totalDiamonds;
      giftEvents.push({
        participantAnchorId: p.anchorId,
        occurredAt: g.receivedAt,
        senderUniqueIdSnapshot: g.uniqueId,
        senderNicknameSnapshot: g.nickname,
        giftId: g.giftId,
        giftNameSnapshot: g.giftName,
        repeatCount: g.repeatCount,
        diamondCount: g.diamondCount,
        totalDiamonds: g.totalDiamonds,
        multiplierType: g.multiplierType,
        multiplierValue: g.multiplierValue,
        sourceGiftId: g.id,
      });
    }
    observedGiftTotalByAnchorId.set(p.anchorId, total);
  }

  const participants: BattleSnapshotParticipant[] = participantsBase.map((p) => {
    const capture = p.roomId === null ? null : captureByAnchorId.get(p.anchorId) ?? null;
    return {
      ...p,
      observedGiftTotal: p.roomId === null ? null : observedGiftTotalByAnchorId.get(p.anchorId) ?? 0,
      captureStatus: capture?.status ?? "unavailable",
      captureCoverage: capture?.coverage ?? null,
    };
  });

  // アイテムカード使用(グローブ/ハンマー等)は自room(このBattleHistory行が確定させるroom)で
  // 観測したものだけを対象にする。相手roomも監視していた場合、相手側のmaterializeが自分の
  // BattleHistory行で同じイベントをもう一度複製するので、targetHostUserId(使用対象)一致で
  // participantへ配る(schema comment通り「このroomのwindow内のものだけ複製する」)。
  const itemUseRows = await prisma.tiktokBattleItemUse.findMany({
    where: { roomId, battleId, receivedAt: { gte: windowStart, lte: windowEnd } },
    select: {
      cardType: true,
      senderUserId: true,
      senderUniqueId: true,
      senderNickname: true,
      targetHostUserId: true,
      receivedAt: true,
    },
  });
  const participantAnchorIds = new Set(participants.map((p) => p.anchorId));
  const itemCardEvents: BattleSnapshotItemCardEvent[] = itemUseRows
    .filter((r) => participantAnchorIds.has(r.targetHostUserId))
    .map((r) => ({
      participantAnchorId: r.targetHostUserId,
      occurredAt: r.receivedAt,
      cardType: r.cardType,
      senderUniqueIdSnapshot: r.senderUniqueId || null,
      senderNicknameSnapshot: r.senderNickname || null,
      senderTiktokUserId: r.senderUserId || null,
    }));

  // ボーナスミッションはroomId解決できたparticipantのみ(観測roomごとの進捗のため)。
  const bonusMissions: BattleSnapshotBonusMission[] = [];
  for (const p of participants) {
    if (p.roomId === null) continue;
    const rows = await prisma.tiktokBattleBonusMission.findMany({
      where: { roomId: p.roomId, battleId },
      select: {
        targetType: true,
        progressTarget: true,
        rewardMultiple: true,
        startedAt: true,
        settledAt: true,
        taskResult: true,
        rewardStartedAt: true,
        rewardEndedAt: true,
        rewardSum: true,
      },
    });
    for (const r of rows) {
      bonusMissions.push({ participantAnchorId: p.anchorId, ...r });
    }
  }

  // スコア曲線は**自roomのwindow内だけ**読む(itemCardEventsと同じ原則)。自roomのarmiesには
  // 全anchorのスコアが入っているので、4コラボでも全員分のバーが作れる。participantとして
  // 確定しないanchorId(観測の揺れ)は捨てる。
  const armiesRows = await prisma.tiktokBattleArmiesSnapshot.findMany({
    where: { roomId, battleId, occurredAt: { gte: windowStart, lte: windowEnd } },
    select: { anchorId: true, occurredAt: true, score: true },
    // 1イベントで全anchor分を同一occurredAtで書くため同着が常態。anchorIdまで指定しないと
    // 並びが非決定になり、逆算の入力順も再生の点順もDBの気分次第になる。
    orderBy: [{ occurredAt: "asc" }, { anchorId: "asc" }],
  });
  const windowStartMs = windowStart.getTime();
  const windowLengthMs = Math.max(0, windowEnd.getTime() - windowStartMs);
  // (anchorId, offsetMs)が重複したら後勝ち。同一msに複数点があっても再生側は1点しか使えない。
  const scorePointByKey = new Map<string, BattleSnapshotScorePoint>();
  for (const row of armiesRows) {
    if (!participantAnchorIds.has(row.anchorId)) continue;
    const offsetMs = Math.min(windowLengthMs, Math.max(0, row.occurredAt.getTime() - windowStartMs));
    scorePointByKey.set(`${row.anchorId}:${offsetMs}`, {
      anchorId: row.anchorId,
      offsetMs,
      occurredAt: row.occurredAt,
      score: row.score,
    });
  }
  const scorePoints = [...scorePointByKey.values()].sort(
    (a, b) => a.offsetMs - b.offsetMs || a.anchorId.localeCompare(b.anchorId)
  );

  // 「初ギフトx倍」の逆算。既に読んである armies と giftEvents / bonusMissions を渡すだけで、
  // 追加クエリは発生しない。自陣営(self)のギフトとスコアだけを使う(相手roomのギフトは
  // 相手のスコアへ効くが、時刻基準が揃わないうえ相手roomのarmiesは読んでいないため)。
  const opening = inferOpeningMultiplier({
    windowStart,
    // 配信途中から接続した場合 windowStart は「気づいた時刻」でしかない(startedAtEstimated)。
    // その60秒はバトル中盤なので、倍率区間として判定させない。
    windowStartReliable: !own.startedAtEstimated,
    scorePoints: armiesRows.filter((r) => r.anchorId === selfHostUserId),
    gifts: giftEvents
      .filter((g) => g.participantAnchorId === selfHostUserId)
      .map((g) => ({
        id: g.sourceGiftId,
        occurredAt: g.occurredAt,
        totalDiamonds: g.totalDiamonds,
        multiplierType: g.multiplierType,
      })),
    bonusIntervals: bonusMissions.map((m) => ({ startedAt: m.rewardStartedAt, endedAt: m.rewardEndedAt })),
  });

  // BattleTeamはfactions順(=teamIndex順)で1件ずつ作る。externalTeamIdはteamArmies由来の
  // hostTeams(kind==="teams"のときだけ意味を持つ。1v1/solo/multiはteamの概念が無いのでnull)。
  const teamOf = new Map(asTeamEntries(own.hostTeams));
  const teams: BattleSnapshotTeam[] = factions.map((faction) => ({
    teamIndex: faction.index,
    externalTeamId: resolved.kind === "teams" ? teamOf.get(faction.anchorIds[0]) ?? null : null,
    officialScore: faction.score,
  }));

  // selfTotalDiamondsはself participant(必ずroomId===roomIdに解決される)のobservedGiftTotal
  // と同じ集計(自room・窓内のGift.totalDiamonds合計)なので、上のgiftEventsループで
  // 算出済みの値をそのまま使う(aggregateGiftUsers([roomId, window])での再集計は不要)。
  const selfTotalDiamonds = observedGiftTotalByAnchorId.get(selfHostUserId) ?? 0;

  const sourceUpdatedAt = [own.updatedAt, ...others.map((o) => o.updatedAt)].reduce((max, d) =>
    d.getTime() > max.getTime() ? d : max
  );

  return {
    roomId,
    battleId,
    windowStart,
    windowEnd,
    status: windowInfo.status,
    selfScore: resolved.selfScore,
    opponentScore: resolved.kind === "1v1" ? resolved.opponentScore : null,
    selfTotalDiamonds,
    sourceUpdatedAt,
    participants,
    teams,
    giftEvents,
    itemCardEvents,
    bonusMissions,
    scorePoints,
    opening,
  };
}

/**
 * 「直近10秒で値が変化していない」ことの判定。**sourceUpdatedAt は比較しない**
 * (行のupdatedAtだけが動いても、導出値が同じなら安定しているとみなしてよい)。
 */
/** anchorIdごとの最終スコア(offsetMsが最大の点)が両者で一致するか。配列の並び順に依存しない。 */
function lastScoreByAnchorEqual(a: BattleSnapshotScorePoint[], b: BattleSnapshotScorePoint[]): boolean {
  const lastByAnchor = (points: BattleSnapshotScorePoint[]) => {
    const map = new Map<string, BattleSnapshotScorePoint>();
    for (const p of points) {
      const current = map.get(p.anchorId);
      if (current === undefined || p.offsetMs >= current.offsetMs) map.set(p.anchorId, p);
    }
    return map;
  };
  const aLast = lastByAnchor(a);
  const bLast = lastByAnchor(b);
  if (aLast.size !== bLast.size) return false;
  for (const [anchorId, point] of aLast) {
    if (bLast.get(anchorId)?.score !== point.score) return false;
  }
  return true;
}

export function snapshotsEqual(a: BattleSnapshot, b: BattleSnapshot): boolean {
  if (
    a.windowStart.getTime() !== b.windowStart.getTime() ||
    a.windowEnd.getTime() !== b.windowEnd.getTime() ||
    a.status !== b.status ||
    a.selfScore !== b.selfScore ||
    a.opponentScore !== b.opponentScore ||
    a.selfTotalDiamonds !== b.selfTotalDiamonds ||
    a.participants.length !== b.participants.length ||
    a.giftEvents.length !== b.giftEvents.length ||
    a.itemCardEvents.length !== b.itemCardEvents.length ||
    a.bonusMissions.length !== b.bonusMissions.length ||
    // scorePointsは**件数とanchorIdごとの最終スコアだけ**比較する(全点比較はしない)。armiesが
    // 届き続けている最中は件数が増えるので、安定性判定としてはこれで十分。
    // **「配列末尾1点」で比較しない。** armiesは1イベントで全anchor分を同一occurredAtで
    // createManyするため同着が常態で、DBの返却順が入れ替わると別anchorのスコアを比べて
    // 偽の不一致になる(= 確定されずに再生データが永久に付かない)。
    a.scorePoints.length !== b.scorePoints.length ||
    !lastScoreByAnchorEqual(a.scorePoints, b.scorePoints)
  ) {
    return false;
  }

  for (let i = 0; i < a.participants.length; i++) {
    const x = a.participants[i];
    const y = b.participants[i];
    if (
      x.side !== y.side ||
      x.teamIndex !== y.teamIndex ||
      x.score !== y.score ||
      x.position !== y.position ||
      x.anchorId !== y.anchorId ||
      x.tiktokId !== y.tiktokId ||
      x.displayId !== y.displayId ||
      x.nickName !== y.nickName ||
      x.roomId !== y.roomId ||
      x.observedGiftTotal !== y.observedGiftTotal
    ) {
      return false;
    }
  }

  // giftEventsは複数roomからの取得順であり並び順が安定している保証が無いため、
  // sourceGiftId(=元Gift.id)の集合比較にする(遅延Gift INSERTを安定性判定に反映させたい
  // 主目的には十分)。
  const giftIds = (snapshot: BattleSnapshot) => snapshot.giftEvents.map((g) => g.sourceGiftId).sort();
  const aGiftIds = giftIds(a);
  const bGiftIds = giftIds(b);
  for (let i = 0; i < aGiftIds.length; i++) {
    if (aGiftIds[i] !== bGiftIds[i]) return false;
  }

  return true;
}

/**
 * スナップショットを1トランザクションでコミットする。
 *
 * - **親子の全書き込みを1つの interactive transaction に入れる**(コールバック内では必ず tx を使う)。
 *   コミットまでどの行も見えないので、「親行だけ見える瞬間」「deleteMany直後に空データを読む」
 *   といった部分状態が外から観測されない。
 * - **sourceUpdatedAt による CAS**。既存行のほうが新しい(= もっと後のTiktokBattle更新を見て
 *   確定された)なら上書きしない。デプロイ時に新旧Workerが並走し、新Workerが書いた確定値を
 *   旧Workerの遅れた計算が踏み潰すのを防ぐ。
 */
/** commitBattleSnapshotのtransaction timeout。既定(5秒)だと数百〜数千件のgiftEvents
 * createManyを含む確定処理が容易に超過するため、src/event/reopen-aggregation.tsの
 * MUTATION_TX_OPTIONSと同水準まで延ばす。 */
const COMMIT_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

export async function commitBattleSnapshot(snapshot: BattleSnapshot, now: Date): Promise<MaterializeResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<MaterializeResult> => {
      const existing = await tx.battleHistory.findUnique({
        where: { roomId_battleId: { roomId: snapshot.roomId, battleId: snapshot.battleId } },
        select: { id: true },
      });

      const data = {
        windowStart: snapshot.windowStart,
        windowEnd: snapshot.windowEnd,
        status: snapshot.status,
        selfScore: snapshot.selfScore,
        opponentScore: snapshot.opponentScore,
        selfTotalDiamonds: snapshot.selfTotalDiamonds,
        sourceUpdatedAt: snapshot.sourceUpdatedAt,
        finalizedAt: now,
        openingMultiplier: snapshot.opening.multiplier,
        openingMultiplierBasisGiftId: snapshot.opening.basisGiftId,
        openingMultiplierConfidence: snapshot.opening.confidence,
        openingWindowStartedAt: snapshot.opening.windowStartedAt,
        openingWindowEndedAt: snapshot.opening.windowEndedAt,
        replayScorePointCount: snapshot.scorePoints.length,
        replayGiftEventCount: snapshot.giftEvents.length,
      };

      let battleHistoryId: string;
      let action: "created" | "updated";
      if (existing) {
        // sourceUpdatedAtの比較をUPDATE文自体のWHEREへ埋め込み、CASを1つのSQL文で原子的に行う。
        // findUniqueでの事前チェックだけでは行ロックを伴わないため、2つのトランザクションが
        // 同時にチェックを通過しうる(Read Committedの通常挙動)。UPDATE...WHEREはPostgresが
        // 対象行をロックしたうえで評価するので、後続の更新は先行コミット後の値で再評価される。
        const updateResult = await tx.battleHistory.updateMany({
          where: { id: existing.id, sourceUpdatedAt: { lte: snapshot.sourceUpdatedAt } },
          data,
        });
        if (updateResult.count === 0) {
          return { finalized: false, reason: "stale" };
        }
        // battleHistoryParticipant削除はonDelete: CascadeでgiftEvents/itemCardEvents/
        // bonusMissionsも道連れに消える。battleTeamはparticipant.battleTeamIdがonDelete:
        // SetNullなので、参加者削除より先に消しても後でも実害はないが、対称性のため
        // 参加者削除の後に置く。
        // 旧構造BattleHistoryContributorはPhase3(Contract)で削除済み(新構造giftEventsに一本化)。
        await tx.battleHistoryParticipant.deleteMany({ where: { battleHistoryId: existing.id } });
        await tx.battleTeam.deleteMany({ where: { battleHistoryId: existing.id } });
        // scorePointsはparticipantにぶら下がっていない(anchorIdで持つ)ので、cascadeでは消えない。
        await tx.battleHistoryScorePoint.deleteMany({ where: { battleHistoryId: existing.id } });
        battleHistoryId = existing.id;
        action = "updated";
      } else {
        const created = await tx.battleHistory.create({
          data: { roomId: snapshot.roomId, battleId: snapshot.battleId, ...data },
          select: { id: true },
        });
        battleHistoryId = created.id;
        action = "created";
      }

      // BattleTeamはteamIndex列を持たないため、factions順(=snapshot.teams順)に個別createして
      // 生成idをteamIndexへ紐付ける(件数は陣営数=通常2〜数件なのでcreateManyにする必要はない)。
      const teamIdByIndex = new Map<number, string>();
      for (const team of snapshot.teams) {
        const row = await tx.battleTeam.create({
          data: { battleHistoryId, externalTeamId: team.externalTeamId, officialScore: team.officialScore },
          select: { id: true },
        });
        teamIdByIndex.set(team.teamIndex, row.id);
      }

      if (snapshot.participants.length > 0) {
        await tx.battleHistoryParticipant.createMany({
          data: snapshot.participants.map((p) => ({
            battleHistoryId,
            ...p,
            battleTeamId: teamIdByIndex.get(p.teamIndex) ?? null,
          })),
        });
      }
      // giftEvents/itemCardEvents/bonusMissionsはparticipantId(子行FK)が要るので、
      // createMany後にunique制約(battleHistoryId, anchorId)でid引き直す。
      if (snapshot.giftEvents.length > 0 || snapshot.itemCardEvents.length > 0 || snapshot.bonusMissions.length > 0) {
        const createdParticipants = await tx.battleHistoryParticipant.findMany({
          where: { battleHistoryId },
          select: { id: true, anchorId: true },
        });
        const participantIdByAnchorId = new Map(createdParticipants.map((p) => [p.anchorId, p.id]));

        const giftEventRows = snapshot.giftEvents.flatMap((g) => {
          const participantId = participantIdByAnchorId.get(g.participantAnchorId);
          if (!participantId) return [];
          const { participantAnchorId: _participantAnchorId, ...rest } = g;
          return [{ participantId, ...rest }];
        });
        for (let i = 0; i < giftEventRows.length; i += GIFT_EVENT_CHUNK_SIZE) {
          await tx.battleHistoryGiftEvent.createMany({ data: giftEventRows.slice(i, i + GIFT_EVENT_CHUNK_SIZE) });
        }

        const itemCardEventRows = snapshot.itemCardEvents.flatMap((e) => {
          const participantId = participantIdByAnchorId.get(e.participantAnchorId);
          if (!participantId) return [];
          const { participantAnchorId: _participantAnchorId, ...rest } = e;
          return [{ participantId, ...rest }];
        });
        if (itemCardEventRows.length > 0) {
          await tx.battleHistoryItemCardEvent.createMany({ data: itemCardEventRows });
        }

        const bonusMissionRows = snapshot.bonusMissions.flatMap((m) => {
          const participantId = participantIdByAnchorId.get(m.participantAnchorId);
          if (!participantId) return [];
          const { participantAnchorId: _participantAnchorId, ...rest } = m;
          return [{ participantId, battleHistoryId, ...rest }];
        });
        if (bonusMissionRows.length > 0) {
          await tx.battleHistoryBonusMission.createMany({ data: bonusMissionRows });
        }
      }

      // scorePointsはparticipantIdを使わないので、上のparticipant引き直しブロックの外で書く。
      for (let i = 0; i < snapshot.scorePoints.length; i += GIFT_EVENT_CHUNK_SIZE) {
        await tx.battleHistoryScorePoint.createMany({
          data: snapshot.scorePoints.slice(i, i + GIFT_EVENT_CHUNK_SIZE).map((p) => ({ battleHistoryId, ...p })),
        });
      }

      return { finalized: true, action };
    }, COMMIT_TX_OPTIONS);
  } catch (err) {
    // @@unique([roomId, battleId]) の競合。並行materializeがほぼ同時にcreateした場合に起きる。
    // 先に入ったほうの確定値を尊重し、こちらは諦める(確定は最適化なので実害はない)。
    if (isUniqueConstraintError(err)) return { finalized: false, reason: "conflict" };
    throw err;
  }
}

export type AttachReplayResult =
  | { attached: true; scorePointCount: number; giftEventCount: number }
  | { attached: false; reason: "not-found" | "self-host-unresolved" };

/**
 * 確定済みの BattleHistory へ**再生用データだけを後付けする**(バックフィル用)。
 *
 * `materializeBattleHistory` による全置換と違い、**`participants` / `giftEvents` /
 * `itemCardEvents` / `bonusMissions` / `teams` には一切触らない**。触ると
 * (a) 旧room削除で armies/bonusMission が cascade 消滅している (b) 発見済みの相手roomが
 * 消えていると相手側 giftEvents が失われる (c) RoomConnectionInterval の変化で
 * captureCoverage が変わる、といった経路で**確定済みデータを劣化させる**ため。
 *
 * 書くのは `battle_history_score_points` の全入れ替えと、opening 4列・`replay*Count` の
 * update だけ。sourceUpdatedAt の CAS は行わない(既存の確定値を上書きしないため)。並行する
 * `commitBattleSnapshot` とは **BattleHistory 行のロックで直列化する**(後述)。
 * 何度実行しても同じ結果になる(冪等)。
 */
export async function attachReplayData(battleHistoryId: string): Promise<AttachReplayResult> {
  const history = await prisma.battleHistory.findUnique({
    where: { id: battleHistoryId },
    select: { id: true, roomId: true, battleId: true, windowStart: true, windowEnd: true },
  });
  if (!history) return { attached: false, reason: "not-found" };

  const room = await prisma.tiktokRoom.findUnique({
    where: { id: history.roomId },
    select: { hostUserId: true },
  });
  const selfHostUserId = room?.hostUserId ?? null;
  // hostUserId は fill-once の遅延バックフィルでしか埋まらない。未解決なら「自陣営のギフト」を
  // 特定できず opening を誤って埋めうるので、付加そのものを見送る(後日再実行で拾える)。
  if (selfHostUserId === null) return { attached: false, reason: "self-host-unresolved" };

  const participants = await prisma.battleHistoryParticipant.findMany({
    where: { battleHistoryId },
    select: { anchorId: true },
  });
  const participantAnchorIds = new Set(participants.map((p) => p.anchorId));

  const armiesRows = await prisma.tiktokBattleArmiesSnapshot.findMany({
    where: {
      roomId: history.roomId,
      battleId: history.battleId,
      occurredAt: { gte: history.windowStart, lte: history.windowEnd },
    },
    select: { anchorId: true, occurredAt: true, score: true },
    // 1イベントで全anchor分を同一occurredAtで書くため同着が常態。anchorIdまで指定しないと
    // 並びが非決定になり、逆算の入力順も再生の点順もDBの気分次第になる。
    orderBy: [{ occurredAt: "asc" }, { anchorId: "asc" }],
  });

  const windowStartMs = history.windowStart.getTime();
  const windowLengthMs = Math.max(0, history.windowEnd.getTime() - windowStartMs);
  const scorePointByKey = new Map<string, BattleSnapshotScorePoint>();
  for (const row of armiesRows) {
    if (!participantAnchorIds.has(row.anchorId)) continue;
    const offsetMs = Math.min(windowLengthMs, Math.max(0, row.occurredAt.getTime() - windowStartMs));
    scorePointByKey.set(`${row.anchorId}:${offsetMs}`, {
      anchorId: row.anchorId,
      offsetMs,
      occurredAt: row.occurredAt,
      score: row.score,
    });
  }
  const scorePoints = [...scorePointByKey.values()].sort(
    (a, b) => a.offsetMs - b.offsetMs || a.anchorId.localeCompare(b.anchorId)
  );

  // ギフトは元の Gift ではなく**確定済みの複製**から読む。Gift は90日で削除されるため、
  // 元テーブルを引くと古いバトルほど「ギフトが無い」ことになって逆算が不能になる。
  const giftRows = await prisma.battleHistoryGiftEvent.findMany({
    where: { participant: { battleHistoryId } },
    select: {
      occurredAt: true,
      totalDiamonds: true,
      multiplierType: true,
      sourceGiftId: true,
      participant: { select: { anchorId: true } },
    },
  });

  const bonusRows = await prisma.battleHistoryBonusMission.findMany({
    where: { battleHistoryId },
    select: { rewardStartedAt: true, rewardEndedAt: true },
  });

  // 窓の開始が実測かどうかは TiktokBattle 側にしか無い。行が消えている(古いバトル)なら
  // 実測と断定できないので判定させない。
  const sourceBattle = await prisma.tiktokBattle.findUnique({
    where: { roomId_battleId: { roomId: history.roomId, battleId: history.battleId } },
    select: { startedAtEstimated: true },
  });

  const opening = inferOpeningMultiplier({
    windowStart: history.windowStart,
    windowStartReliable: sourceBattle !== null && !sourceBattle.startedAtEstimated,
    scorePoints: armiesRows.filter((r) => r.anchorId === selfHostUserId),
    gifts: giftRows
      .filter((g) => g.participant.anchorId === selfHostUserId)
      .map((g) => ({
        id: g.sourceGiftId,
        occurredAt: g.occurredAt,
        totalDiamonds: g.totalDiamonds,
        multiplierType: g.multiplierType,
      })),
    bonusIntervals: bonusRows.map((m) => ({ startedAt: m.rewardStartedAt, endedAt: m.rewardEndedAt })),
  });

  const committed = await prisma.$transaction(async (tx) => {
    // **先に BattleHistory 行のロックを取る。** commitBattleSnapshot は updateMany で行ロックを
    // 取ってから score points を消すので、こちらが後にロックを取ると「相手の deleteMany が
    // こちらの未コミット行を見ない」窓ができ、点が二重に残る(Read Committed)。
    const locked = await tx.battleHistory.updateMany({
      where: { id: battleHistoryId },
      data: { replayScorePointCount: 0 },
    });
    // 最初の findUnique とこの時点の間に行が消えた(room削除など)。FK違反で投げる前に諦める。
    if (locked.count === 0) return false;
    await tx.battleHistoryScorePoint.deleteMany({ where: { battleHistoryId } });
    for (let i = 0; i < scorePoints.length; i += GIFT_EVENT_CHUNK_SIZE) {
      await tx.battleHistoryScorePoint.createMany({
        data: scorePoints.slice(i, i + GIFT_EVENT_CHUNK_SIZE).map((p) => ({ battleHistoryId, ...p })),
      });
    }
    await tx.battleHistory.update({
      where: { id: battleHistoryId },
      data: {
        openingMultiplier: opening.multiplier,
        openingMultiplierBasisGiftId: opening.basisGiftId,
        openingMultiplierConfidence: opening.confidence,
        openingWindowStartedAt: opening.windowStartedAt,
        openingWindowEndedAt: opening.windowEndedAt,
        replayScorePointCount: scorePoints.length,
        replayGiftEventCount: giftRows.length,
      },
    });
    return true;
  }, COMMIT_TX_OPTIONS);

  if (!committed) return { attached: false, reason: "not-found" };
  return { attached: true, scorePointCount: scorePoints.length, giftEventCount: giftRows.length };
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * バトルの確定処理本体。1回目の計算 → 10秒待って2回目 → 完全一致した場合のみコミット。
 *
 * 1回のトリガにつき再試行はしない(「確定は最適化」の原則)。不一致・情報不足なら未確定のまま。
 *
 * `stabilityDelayMs` はテスト用の注入口。本番では既定の10秒を使う。
 */
export async function materializeBattleHistory(
  roomId: string,
  battleId: string,
  now: Date = new Date(),
  options: { stabilityDelayMs?: number } = {}
): Promise<MaterializeResult> {
  const delayMs = options.stabilityDelayMs ?? STABILITY_DELAY_MS;

  const first = await computeBattleSnapshot(roomId, battleId, now);
  if (first === null) return { finalized: false, reason: "not-ready" };

  await sleep(delayMs);

  const secondNow = new Date(now.getTime() + delayMs);
  const second = await computeBattleSnapshot(roomId, battleId, secondNow);
  if (second === null || !snapshotsEqual(first, second)) return { finalized: false, reason: "unstable" };

  return commitBattleSnapshot(second, secondNow);
}
