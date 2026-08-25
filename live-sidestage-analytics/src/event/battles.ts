import type { Prisma } from "@prisma/client";
import { fetchBattles, type DbClient } from "./analytics-db";
import {
  assignBattles,
  findMissedMatches,
  MANUAL_DECISIONS,
  type BattleObservation,
  type MatchCandidate,
  type ReviewReason,
} from "./match-detect";
import { isByeRow, parseLoserFrom } from "./match-status";
import type { TimeRange } from "./scoring";

// analytics で観測されたバトルの取り込みと、対戦カードとの照合。
//
// 照合そのものは match-detect.ts の純粋関数が持つ。ここは DB の出し入れだけ。

/**
 * 対戦カードの時間枠より広めに取り込む(枠外で始まったバトルも見えるようにする)。
 *
 * 広げるのは**呼び出し側**(aggregate.ts が開催日程を前後に広げてつなぐ)。
 * ここで広げると、隣り合う日程を広げた区間が重なって同じバトルを二度 upsert する。
 */
export const BATTLE_INGEST_GRACE_MS = 60 * 60 * 1000;

/** 主催者が手を入れたマッチは自動検知で上書きしない。 */
const LOCKED_STATUSES = new Set(["VOID"]);

/** 自動確定できない検知。主催者が承認するまで勝敗を出さない。 */
export const NEEDS_REVIEW = "NEEDS_REVIEW";

/**
 * 参加者の room で観測されたバトルを DetectedBattle へ取り込む。
 *
 * analytics 側は room ごとに行を持つので、1つのバトルにつき最大で参加人数ぶんの行が入る。
 * 取り込みは冪等(roomId + battleId が一意キー)。
 *
 * `start` / `end` は**そのまま**使う。猶予(`BATTLE_INGEST_GRACE_MS`)を足すのは呼び出し側。
 */
export async function ingestBattles(
  tx: DbClient,
  params: { roomIds: string[]; start: Date; end: Date }
): Promise<number> {
  if (params.roomIds.length === 0) return 0;

  const rows = await fetchBattles(tx, {
    roomIds: params.roomIds,
    start: params.start,
    end: params.end,
  });

  for (const row of rows) {
    const data = {
      startedAt: row.startedAt,
      startedAtEstimated: row.startedAtEstimated,
      endedAt: row.endedAt,
      durationSec: row.durationSec,
      lastAction: row.action,
      hostUserIds: row.hostUserIds,
      hostDisplayIds: row.hostDisplayIds,
      hostScores: (row.hostScores ?? {}) as Prisma.InputJsonObject,
    };
    await tx.detectedBattle.upsert({
      where: { battleId_roomId: { battleId: row.battleId, roomId: row.roomId } },
      create: { battleId: row.battleId, roomId: row.roomId, ...data },
      update: data,
    });
  }

  return rows.length;
}

type MatchWithSides = {
  id: string;
  status: string;
  round: number;
  bracketPosition: number;
  session: { startAt: Date; endAt: Date } | null;
  detectedBattleId: string | null;
  detectedEndAt: Date | null;
  decidedAt: Date | null;
  winnerDecidedBy: string | null;
  rules: unknown;
  sides: {
    id: string;
    sideIndex: number;
    participants: { participant: { roomId: string } }[];
  }[];
};

/**
 * 検知を付け替えてはいけない状態。**一度確定した `detectedBattleId` は、主催者が
 * 「検知をやり直す」まで動かさない。** 日程まるごとが検知対象になったことで、後から
 * 取り込まれたバトルによって過去の割り当てが揺れうるため。
 */
const LOCKED_DETECTION_STATUSES = new Set(["DETECTED", "FINISHED", "NEEDS_REVIEW"]);

/**
 * `rules` に承認待ちの理由を書き足す。**既存のキー(`roundLabel` / `bye`)を潰さない。**
 * 理由が無くなったら消す(承認済みのカードに古い理由が残らないように)。
 */
function mergeReviewReason(rules: unknown, reason: ReviewReason | null): Prisma.InputJsonObject {
  const base: Record<string, unknown> =
    rules && typeof rules === "object" && !Array.isArray(rules)
      ? { ...(rules as Record<string, unknown>) }
      : {};
  if (reason) base.reviewReason = reason;
  else delete base.reviewReason;
  return base as Prisma.InputJsonObject;
}

/** ブラケットの座標 → その対戦。上流(feeder)を座標から引くために使う。 */
function bySlotIndex(matches: MatchWithSides[]): Map<string, MatchWithSides> {
  const bySlot = new Map<string, MatchWithSides>();
  for (const match of matches) bySlot.set(`${match.round}:${match.bracketPosition}`, match);
  return bySlot;
}

/**
 * その座標の対戦が決着した時刻。**不戦勝行は自分では時刻を持たない**ので、
 * さらに上流へ遡る(段階的不戦勝方式では不戦勝行が連続することがある)。
 * 見つからなければ null = 制約なし。
 */
function decidedAtOfSlot(
  round: number,
  position: number,
  bySlot: Map<string, MatchWithSides>,
  depth = 0
): Date | null {
  if (round < 1 || depth > 32) return null;
  const match = bySlot.get(`${round}:${position}`);
  if (!match) return null;

  const decided = match.detectedEndAt ?? match.decidedAt;
  if (decided) return decided;

  // 不戦勝(バトルが起きていない)行は時刻を持たない。その上流まで遡る。
  const upstream = upstreamSlots(match)
    .map((slot) => decidedAtOfSlot(slot.round, slot.position, bySlot, depth + 1))
    .filter((d): d is Date => !!d);
  if (upstream.length === 0) return null;
  return upstream.reduce((max, d) => (d > max ? d : max));
}

/**
 * この行に出場者を送り込んでくる上流の座標。
 *
 * 通常は `nextSlot()` の逆（round-1 の position*2 と position*2+1）。
 * **順位決定戦の葉だけは例外**で、`rules.loserFrom`（本選のどの行の敗者が来るか）を見る —
 * 座標の上流には何も無いので、そのままだと制約なし(null)になってしまう。
 *
 * 上流のラウンドは必ず自分より小さいので、辿っても循環しない。
 */
function upstreamSlots(match: MatchWithSides): { round: number; position: number }[] {
  const loserFrom = parseLoserFrom(match.rules);
  if (loserFrom) {
    return loserFrom.filter((slot): slot is { round: number; position: number } => slot !== null);
  }
  if (match.round <= 1) return [];
  return [
    { round: match.round - 1, position: match.bracketPosition * 2 },
    { round: match.round - 1, position: match.bracketPosition * 2 + 1 },
  ];
}

/**
 * 上流(feeder)の決着時刻。
 *
 * これがないと、2回戦のカードが埋まった瞬間に「同じ組み合わせで前に行われたバトル」
 * (1回戦そのもの、練習バトル)が候補に入る。時間枠がラウンドを分けていた前提の代わり。
 *
 * 順位決定戦でも同じ危険がある — 3位決定戦の枠が埋まった瞬間に、その2人が過去に
 * 行った別のバトルを拾いうる。`upstreamSlots()` が `loserFrom` を見るのはそのため。
 */
function feederDecidedAt(
  match: MatchWithSides,
  bySlot: Map<string, MatchWithSides>
): Date | null {
  const feeders = upstreamSlots(match)
    .map((slot) => decidedAtOfSlot(slot.round, slot.position, bySlot))
    .filter((d): d is Date => !!d);
  if (feeders.length === 0) return null;
  return feeders.reduce((max, d) => (d > max ? d : max));
}

/** 日程が付いていない対戦(移行前のデータ)は検知しようがないので候補にしない。 */
function toCandidate(
  match: MatchWithSides,
  bySlot: Map<string, MatchWithSides>
): MatchCandidate | null {
  if (!match.session) return null;
  const bySide = [...match.sides].sort((a, b) => a.sideIndex - b.sideIndex);
  return {
    id: match.id,
    round: match.round,
    bracketPosition: match.bracketPosition,
    sessionStart: match.session.startAt,
    sessionEnd: match.session.endAt,
    sideRoomIds: bySide.map((s) => s.participants.map((p) => p.participant.roomId)),
    isBye: isByeRow(match.rules),
    feederDecidedAt: feederDecidedAt(match, bySlot),
    lockedBattleId:
      match.detectedBattleId && LOCKED_DETECTION_STATUSES.has(match.status)
        ? match.detectedBattleId
        : null,
  };
}

function toObservations(
  rows: {
    battleId: string;
    roomId: string;
    startedAt: Date;
    startedAtEstimated: boolean;
    endedAt: Date | null;
    durationSec: number | null;
  }[]
): BattleObservation[] {
  const grouped = new Map<string, BattleObservation>();
  for (const row of rows) {
    let entry = grouped.get(row.battleId);
    if (!entry) {
      entry = { battleId: row.battleId, rooms: [] };
      grouped.set(row.battleId, entry);
    }
    entry.rooms.push({
      roomId: row.roomId,
      startedAt: row.startedAt,
      startedAtEstimated: row.startedAtEstimated,
      endedAt: row.endedAt,
      // 開始が推定値のままなら「両端を観測できた」とは言えない。
      complete: !row.startedAtEstimated && row.endedAt !== null,
      durationSec: row.durationSec,
    });
  }
  return [...grouped.values()];
}

export type DetectionResult = {
  detected: number;
  missed: number;
};

/**
 * 対戦カードと取り込んだバトルを突き合わせ、EventMatch へ反映する。
 *
 * - 主催者が VOID にしたマッチ、手動で勝者を確定したマッチには触らない
 * - 終了をまだ観測できていないバトルは**暫定関連**(`detectedEndAt` は null のまま LIVE)。
 *   勝敗もバトル倍率も出さずに次の周回を待つ
 * - 暫定のまま日程が終わったら `NEEDS_REVIEW`(主催者が手で決める)
 * - 暫定関連が次の周回で候補から外れたら関連を解除する(実際の終了が日程の外だった等)
 * - 日程が終わっても検知できなかったマッチは NO_SHOW にする
 */
export async function detectMatches(
  tx: DbClient,
  params: { eventId: string; now: Date }
): Promise<DetectionResult> {
  const matches = (await tx.eventMatch.findMany({
    where: { eventId: params.eventId },
    select: {
      id: true,
      status: true,
      round: true,
      bracketPosition: true,
      // 検知の対象区間は「割り当てた開催日程まるごと」。対戦に個別の時間枠は無い。
      session: { select: { startAt: true, endAt: true } },
      detectedBattleId: true,
      detectedEndAt: true,
      decidedAt: true,
      winnerDecidedBy: true,
      // 不戦勝行を検知にも NO_SHOW にも関わらせないために要る(toCandidate)。
      rules: true,
      sides: {
        select: {
          id: true,
          sideIndex: true,
          participants: { select: { participant: { select: { roomId: true } } } },
        },
      },
    },
  })) as MatchWithSides[];

  const open = matches.filter(
    (m) =>
      !LOCKED_STATUSES.has(m.status) &&
      !(m.winnerDecidedBy && MANUAL_DECISIONS.has(m.winnerDecidedBy))
  );
  if (open.length === 0) return { detected: 0, missed: 0 };

  // 上流は**全マッチ**から引く(VOID や手動確定の行も上流にはなりうる)。
  const bySlot = bySlotIndex(matches);
  const candidates = open
    .map((m) => toCandidate(m, bySlot))
    .filter((c): c is MatchCandidate => c !== null);
  if (candidates.length === 0) return { detected: 0, missed: 0 };

  // 対象の room と、対象になりうる時間帯(日程の前後 grace)だけを読む。
  const starts = candidates.map((c) => c.sessionStart.getTime());
  const ends = candidates.map((c) => c.sessionEnd.getTime());
  const rows = await tx.detectedBattle.findMany({
    where: {
      roomId: {
        in: open.flatMap((m) =>
          m.sides.flatMap((s) => s.participants.map((p) => p.participant.roomId))
        ),
      },
      // 日程内に**終了した**バトルが対象。開始はそれより前にありうるので grace で広げる
      // (TikTok のバトルは長くても数十分なので、1時間で足りる)。
      startedAt: {
        gte: new Date(Math.min(...starts) - BATTLE_INGEST_GRACE_MS),
        lte: new Date(Math.max(...ends) + BATTLE_INGEST_GRACE_MS),
      },
    },
    select: {
      battleId: true,
      roomId: true,
      startedAt: true,
      startedAtEstimated: true,
      endedAt: true,
      durationSec: true,
    },
  });

  const assignments = assignBattles({
    matches: candidates,
    battles: toObservations(rows),
  });

  const byId = new Map(open.map((m) => [m.id, m]));

  for (const a of assignments) {
    const current = byId.get(a.matchId);
    // 主催者が一度承認したマッチ(NEEDS_REVIEW → DETECTED)を再び承認待ちへ戻さない。
    const alreadyApproved = current?.status === "DETECTED" || current?.status === "FINISHED";
    const sessionEnd = current?.session?.endAt ?? null;

    let status: string;
    let reviewReason: ReviewReason | null = a.reviewReason;
    if (a.endedAt === null) {
      // 終了がまだ確定していない暫定関連。日程が終わっても分からなければ主催者へ回す。
      if (sessionEnd && sessionEnd <= params.now) {
        status = NEEDS_REVIEW;
        reviewReason = "END_UNKNOWN";
      } else {
        status = "LIVE";
      }
    } else if (!a.autoConfirm && !alreadyApproved) {
      status = NEEDS_REVIEW;
    } else if (a.endedAt > params.now) {
      status = "LIVE";
    } else if (current?.status === "FINISHED") {
      status = "FINISHED";
    } else {
      status = "DETECTED";
    }

    await tx.eventMatch.update({
      where: { id: a.matchId },
      data: {
        detectedBattleId: a.battleId,
        detectedStartAt: a.startedAt,
        detectedEndAt: a.endedAt,
        // 決着時刻はライフの適用順に使う。終了が確定するまでは決着していない。
        decidedAt: a.endedAt,
        detectionConfidence: a.confidence,
        detectedEndSource: a.endedAtSource,
        status,
        rules: mergeReviewReason(current?.rules, status === NEEDS_REVIEW ? reviewReason : null),
      },
    });
  }

  const assigned = new Set(assignments.map((a) => a.matchId));

  // **暫定関連の取り消し。** 実際の終了が日程の外だった、候補が変わったなどで外れた
  // 「まだ終わっていないはずのバトル」を、いつまでも LIVE のまま残さない。
  const retracted = open.filter(
    (m) => m.status === "LIVE" && m.detectedEndAt === null && !assigned.has(m.id)
  );
  if (retracted.length > 0) {
    await tx.eventMatch.updateMany({
      where: { id: { in: retracted.map((m) => m.id) } },
      data: {
        detectedBattleId: null,
        detectedStartAt: null,
        detectedEndAt: null,
        detectionConfidence: null,
        detectedEndSource: null,
        decidedAt: null,
        status: "SCHEDULED",
      },
    });
  }

  const retractedIds = new Set(retracted.map((m) => m.id));
  const missed = findMissedMatches({
    matches: candidates.filter(
      (c) => byId.get(c.id)?.status === "SCHEDULED" || retractedIds.has(c.id)
    ),
    assigned,
    now: params.now,
  });

  if (missed.length > 0) {
    await tx.eventMatch.updateMany({
      where: { id: { in: missed }, status: "SCHEDULED" },
      data: { status: "NO_SHOW" },
    });
  }

  return { detected: assignments.length, missed: missed.length };
}

/**
 * 参加者(room)ごとのバトル区間を返す。
 *
 * **イベント全体で1本のリストにしてはいけない。** バトルは配信者ごとに起きるので、
 * 1人がバトル中というだけで同時刻の他の参加者にまで BATTLE 倍率がかかってしまう。
 *
 * 対象は検知できたマッチのみ。VOID と NO_SHOW は含めない
 * (バトルが成立していないので BATTLE 倍率をかける根拠がない)。
 */
export async function loadBattleRangesByRoom(
  tx: DbClient,
  eventId: string
): Promise<Map<string, TimeRange[]>> {
  const matches = await tx.eventMatch.findMany({
    where: {
      eventId,
      status: { in: ["LIVE", "DETECTED", "FINISHED"] },
      detectedStartAt: { not: null },
      detectedEndAt: { not: null },
    },
    select: {
      detectedStartAt: true,
      detectedEndAt: true,
      // 倍率区間は**割り当てた日程で切る**。日程の前から始まったバトルの、日程の外の
      // 部分にまでバトル倍率をかけない(勝敗の集計と同じ扱いに揃える)。
      session: { select: { startAt: true, endAt: true } },
      sides: {
        select: { participants: { select: { participant: { select: { roomId: true } } } } },
      },
    },
  });

  const byRoom = new Map<string, TimeRange[]>();
  for (const match of matches) {
    const start =
      match.session && match.detectedStartAt! < match.session.startAt
        ? match.session.startAt
        : match.detectedStartAt!;
    const end =
      match.session && match.detectedEndAt! > match.session.endAt
        ? match.session.endAt
        : match.detectedEndAt!;
    if (start >= end) continue;
    const range: TimeRange = { start, end };
    for (const side of match.sides) {
      for (const p of side.participants) {
        const roomId = p.participant.roomId;
        const list = byRoom.get(roomId);
        if (list) list.push(range);
        else byRoom.set(roomId, [range]);
      }
    }
  }

  return byRoom;
}
