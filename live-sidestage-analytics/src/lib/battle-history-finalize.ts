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
//    END検知の瞬間には集計対象の Gift がまだ INSERT されていない。トリガはEND検知の**30秒後**
//    (2026-09-02に10分から短縮)。
// 2. 30秒後でも「スコアが一度も観測できていない」ことがある(resolveBattleScore の
//    kind !== "unknown" は自分の anchorId を識別できたことしか保証しない)。selfScore が null なら
//    確定しない。不完全な値を確定すると、行が存在するせいでライブ集計へ戻れなくなり永久に残る。
// 3. さらに**60秒待って同じ計算をやり直し、全項目が完全一致した場合のみ**確定する。
//    armies の score_updated や遅延 Gift INSERT が届き続けている最中に確定しないための実測。
//
// 既知の残存リスク: 60秒の無変化は「今後もう変化しない」ことの証明ではない(TikTok側に完了
// マーカーが無い)。2回目の計算直後〜コミット後に遅延更新が届くと、確定値がわずかに古いまま
// 残ることがありうる。**トリガを10分→30秒に短縮したことで、END検知から確定判定(2回目の計算)
// までの実時間は最短90秒(30秒+60秒)となり、以前(11分)より遅延Giftを取りこぼすリスクが明確に
// 上がる。取りこぼして確定した行は BattleHistory に存在してしまうため、
// scripts/backfill-battle-history.ts は「既確定スキップ」で素通りし、自動では直らない
// (手動で該当行を削除してから backfill を再実行する必要がある)。** 実害は「表示が数ダイヤ・
// 数秒古い」程度に限られる、という従来の想定はこの変更で崩れうる。

import { prisma } from "@/lib/prisma";
import { aggregateGiftUsers } from "@/lib/gift-analytics";
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

/** BattleHistoryGiftEvent等の子行createManyを分割する単位。Postgresのbind数上限対策
 * (1バトルのギフト送信回数は数百〜数千になりうる)。Prismaの自動分割に依存しない。 */
const GIFT_EVENT_CHUNK_SIZE = 1000;

/** 安定性チェックの待ち時間。1回目と2回目の計算の間隔。 */
export const STABILITY_DELAY_MS = 60 * 1000;

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

  // --- Phase2a(新構造dual-write)拡張。captureStatus等の捕捉率系は別サブフェーズで
  // 未実装のため常にnull(schema上nullable)。 ---
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
};

export type BattleSnapshotContributor = {
  uniqueId: string;
  nickname: string;
  giftCount: number;
  totalDiamonds: number;
  lastGiftAt: Date;
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
  contributors: BattleSnapshotContributor[];
  teams: BattleSnapshotTeam[];
  giftEvents: BattleSnapshotGiftEvent[];
  itemCardEvents: BattleSnapshotItemCardEvent[];
  bonusMissions: BattleSnapshotBonusMission[];
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
        isSelf: faction.index === 0,
      };
    })
  );

  // roomId解決できたparticipantについてのみ、そのroomの生gift行を窓内で読み取り、
  // BattleHistoryGiftEvent用の行とobservedGiftTotalを作る(自room・相手roomとも同じクエリ形)。
  // resolveParticipantRoomIdは「1 room = 1 participant」を前提にしている(schema設計上の前提、
  // src/lib/battle-history.tsのコメント参照)ので、roomIdごとに高々1回のクエリで済む。
  const giftEvents: BattleSnapshotGiftEvent[] = [];
  const observedGiftTotalByAnchorId = new Map<string, number>();
  for (const p of participantsBase) {
    if (p.roomId === null) continue;
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

  const participants: BattleSnapshotParticipant[] = participantsBase.map((p) => ({
    ...p,
    observedGiftTotal: p.roomId === null ? null : observedGiftTotalByAnchorId.get(p.anchorId) ?? 0,
  }));

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

  // BattleTeamはfactions順(=teamIndex順)で1件ずつ作る。externalTeamIdはteamArmies由来の
  // hostTeams(kind==="teams"のときだけ意味を持つ。1v1/solo/multiはteamの概念が無いのでnull)。
  const teamOf = new Map(asTeamEntries(own.hostTeams));
  const teams: BattleSnapshotTeam[] = factions.map((faction) => ({
    teamIndex: faction.index,
    externalTeamId: resolved.kind === "teams" ? teamOf.get(faction.anchorIds[0]) ?? null : null,
    officialScore: faction.score,
  }));

  // 貢献者は閲覧者非依存で集計する。確定は全閲覧者で共有される。
  // アバターの署名付きURLは保存しないので解決も省く。
  const { users, total } = await aggregateGiftUsers(
    { roomId, receivedAt: { gte: windowStart, lte: windowEnd } },
    { resolveAvatars: false }
  );

  const contributors: BattleSnapshotContributor[] = users
    .map((u) => ({
      uniqueId: u.uniqueId,
      nickname: u.nickname,
      giftCount: u.giftCount,
      totalDiamonds: u.totalDiamonds,
      lastGiftAt: new Date(u.lastGiftAt),
    }))
    // groupByの返り順は保証されないので、安定性チェックの比較と読み出し順の両方のために明示ソートする。
    .sort(
      (a, b) =>
        b.totalDiamonds - a.totalDiamonds ||
        b.lastGiftAt.getTime() - a.lastGiftAt.getTime() ||
        a.uniqueId.localeCompare(b.uniqueId)
    );

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
    selfTotalDiamonds: total.totalDiamonds,
    sourceUpdatedAt,
    participants,
    contributors,
    teams,
    giftEvents,
    itemCardEvents,
    bonusMissions,
  };
}

/**
 * 「直近60秒で値が変化していない」ことの判定。**sourceUpdatedAt は比較しない**
 * (行のupdatedAtだけが動いても、導出値が同じなら安定しているとみなしてよい)。
 */
export function snapshotsEqual(a: BattleSnapshot, b: BattleSnapshot): boolean {
  if (
    a.windowStart.getTime() !== b.windowStart.getTime() ||
    a.windowEnd.getTime() !== b.windowEnd.getTime() ||
    a.status !== b.status ||
    a.selfScore !== b.selfScore ||
    a.opponentScore !== b.opponentScore ||
    a.selfTotalDiamonds !== b.selfTotalDiamonds ||
    a.participants.length !== b.participants.length ||
    a.contributors.length !== b.contributors.length ||
    a.giftEvents.length !== b.giftEvents.length ||
    a.itemCardEvents.length !== b.itemCardEvents.length ||
    a.bonusMissions.length !== b.bonusMissions.length
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

  for (let i = 0; i < a.contributors.length; i++) {
    const x = a.contributors[i];
    const y = b.contributors[i];
    if (
      x.uniqueId !== y.uniqueId ||
      x.nickname !== y.nickname ||
      x.giftCount !== y.giftCount ||
      x.totalDiamonds !== y.totalDiamonds ||
      x.lastGiftAt.getTime() !== y.lastGiftAt.getTime()
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
        await tx.battleHistoryParticipant.deleteMany({ where: { battleHistoryId: existing.id } });
        await tx.battleHistoryContributor.deleteMany({ where: { battleHistoryId: existing.id } });
        await tx.battleTeam.deleteMany({ where: { battleHistoryId: existing.id } });
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
      if (snapshot.contributors.length > 0) {
        await tx.battleHistoryContributor.createMany({
          data: snapshot.contributors.map((c) => ({ battleHistoryId, ...c })),
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

      return { finalized: true, action };
    }, COMMIT_TX_OPTIONS);
  } catch (err) {
    // @@unique([roomId, battleId]) の競合。並行materializeがほぼ同時にcreateした場合に起きる。
    // 先に入ったほうの確定値を尊重し、こちらは諦める(確定は最適化なので実害はない)。
    if (isUniqueConstraintError(err)) return { finalized: false, reason: "conflict" };
    throw err;
  }
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
 * バトルの確定処理本体。1回目の計算 → 60秒待って2回目 → 完全一致した場合のみコミット。
 *
 * 1回のトリガにつき再試行はしない(「確定は最適化」の原則)。不一致・情報不足なら未確定のまま。
 *
 * `stabilityDelayMs` はテスト用の注入口。本番では既定の60秒を使う。
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
