import type { Prisma } from "@prisma/client";
import { fetchBattles, type DbClient } from "./analytics-db";
import {
  assignBattles,
  findMissedMatches,
  type BattleObservation,
  type MatchCandidate,
} from "./match-detect";
import type { TimeRange } from "./scoring";

// analytics で観測されたバトルの取り込みと、対戦カードとの照合。
//
// 照合そのものは match-detect.ts の純粋関数が持つ。ここは DB の出し入れだけ。

/** 対戦カードの時間枠より広めに取り込む(枠外で始まったバトルも見えるようにする)。 */
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
 */
export async function ingestBattles(
  tx: DbClient,
  params: { roomIds: string[]; start: Date; end: Date }
): Promise<number> {
  if (params.roomIds.length === 0) return 0;

  const rows = await fetchBattles(tx, {
    roomIds: params.roomIds,
    start: new Date(params.start.getTime() - BATTLE_INGEST_GRACE_MS),
    end: new Date(params.end.getTime() + BATTLE_INGEST_GRACE_MS),
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
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  winnerDecidedBy: string | null;
  sides: {
    id: string;
    sideIndex: number;
    participants: { participant: { roomId: string } }[];
  }[];
};

function toCandidate(match: MatchWithSides): MatchCandidate {
  const bySide = [...match.sides].sort((a, b) => a.sideIndex - b.sideIndex);
  return {
    id: match.id,
    scheduledStartAt: match.scheduledStartAt,
    scheduledEndAt: match.scheduledEndAt,
    sideRoomIds: bySide.map((s) => s.participants.map((p) => p.participant.roomId)),
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
 * - 時間枠を過ぎても検知できなかったマッチは NO_SHOW にする
 *   (主催者は管理画面から手動で勝者を確定できる)
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
      scheduledStartAt: true,
      scheduledEndAt: true,
      winnerDecidedBy: true,
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
    (m) => !LOCKED_STATUSES.has(m.status) && m.winnerDecidedBy !== "MANUAL"
  );
  if (open.length === 0) return { detected: 0, missed: 0 };

  const rows = await tx.detectedBattle.findMany({
    where: { roomId: { in: open.flatMap((m) => m.sides.flatMap((s) => s.participants.map((p) => p.participant.roomId))) } },
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
    matches: open.map(toCandidate),
    battles: toObservations(rows),
  });

  const byId = new Map(open.map((m) => [m.id, m]));

  for (const a of assignments) {
    const current = byId.get(a.matchId);
    // 主催者が一度承認したマッチ(NEEDS_REVIEW → DETECTED)を再び承認待ちへ戻さない。
    const alreadyApproved = current?.status === "DETECTED" || current?.status === "FINISHED";

    let status: string;
    if (!a.autoConfirm && !alreadyApproved) status = NEEDS_REVIEW;
    else if (a.endedAt > params.now) status = "LIVE";
    else if (current?.status === "FINISHED") status = "FINISHED";
    else status = "DETECTED";

    await tx.eventMatch.update({
      where: { id: a.matchId },
      data: {
        detectedBattleId: a.battleId,
        detectedStartAt: a.startedAt,
        detectedEndAt: a.endedAt,
        detectionConfidence: a.confidence,
        detectedEndSource: a.endedAtSource,
        status,
      },
    });
  }

  const assigned = new Set(assignments.map((a) => a.matchId));
  const missed = findMissedMatches({
    matches: open.filter((m) => m.status === "SCHEDULED").map(toCandidate),
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
      sides: {
        select: { participants: { select: { participant: { select: { roomId: true } } } } },
      },
    },
  });

  const byRoom = new Map<string, TimeRange[]>();
  for (const match of matches) {
    const range: TimeRange = { start: match.detectedStartAt!, end: match.detectedEndAt! };
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
