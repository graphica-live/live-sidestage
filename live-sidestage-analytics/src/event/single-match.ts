import { prisma } from "@/lib/prisma";
import { MUTATION_TX_OPTIONS, reopenAggregation } from "./reopen-aggregation";
import type { DbClient } from "./analytics-db";

// デスマッチの対戦カードを1件ずつ組む。
//
// トーナメントは表を一括生成する(tournament.ts)が、デスマッチは表がなく、
// 主催者が随時カードを追加する。検知と勝敗の決め方は両者で共通(battles.ts)。
//
// **サイドに入れるのは「実際にバトルへ出る参加者」。** チーム戦でもチーム全員を
// 入れない。検知はサイドの room 集合とバトルの room 集合の一致で行うので、
// 出ない人まで入れると永久に一致しなくなる(match-detect.ts の `assignBattles`)。

/** 1サイドに入れられる人数。2vs2 まで。 */
export const MAX_SIDE_SIZE = 2;

export class SingleMatchError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_SIDES"
      | "DUPLICATE_SUBJECT"
      | "ELIMINATED"
      | "OVERLAPPING"
      | "OUT_OF_EVENT_WINDOW"
      | "UNKNOWN_SUBJECT"
  ) {
    super(message);
    this.name = "SingleMatchError";
  }
}

export type SingleMatchSide = {
  /** チーム戦のときの出場チーム。個人戦では指定しない */
  teamId?: string | null;
  /** バトルへ出る参加者。個人戦は1人、チーム戦はそのチームから選んだ1〜2人 */
  participantIds: string[];
};

export type SingleMatchInput = {
  eventId: string;
  sideA: SingleMatchSide;
  sideB: SingleMatchSide;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
};

export async function createSingleMatch(input: SingleMatchInput): Promise<{ matchId: string }> {
  const { eventId, sideA, sideB, scheduledStartAt, scheduledEndAt } = input;
  const sides = [sideA, sideB];

  for (const side of sides) {
    if (side.participantIds.length === 0) {
      throw new SingleMatchError("両方のサイドに出場者を指定してください。", "INVALID_SIDES");
    }
    if (side.participantIds.length > MAX_SIDE_SIZE) {
      throw new SingleMatchError(
        `1サイドに指定できるのは${MAX_SIDE_SIZE}人までです。`,
        "INVALID_SIDES"
      );
    }
  }
  if (sideA.participantIds.length !== sideB.participantIds.length) {
    throw new SingleMatchError("両サイドの人数を揃えてください。", "INVALID_SIDES");
  }

  const allParticipantIds = [...sideA.participantIds, ...sideB.participantIds];
  if (new Set(allParticipantIds).size !== allParticipantIds.length) {
    throw new SingleMatchError("同じ出場者を複数の枠に入れられません。", "DUPLICATE_SUBJECT");
  }

  // 検証も含めて1つのトランザクションで完結させる。**重なり判定を外に出さない** —
  // 同じ枠を2つの操作が同時に組むと、どちらも「重なっていない」と判定して通ってしまう。
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: { entryMode: true },
    });
    if (!event) throw new SingleMatchError("イベントが見つかりません。", "UNKNOWN_SUBJECT");

    const isTeam = event.entryMode === "TEAM";
    const teamIds = sides.map((s) => s.teamId ?? null);

    if (isTeam) {
      if (teamIds.some((id) => !id)) {
        throw new SingleMatchError("両方のサイドにチームを指定してください。", "INVALID_SIDES");
      }
      if (teamIds[0] === teamIds[1]) {
        throw new SingleMatchError("同じチームどうしは組めません。", "DUPLICATE_SUBJECT");
      }
    }

    // 出場者が実在し、チーム戦なら指定チームに所属しているかを確認する。
    const participants = await tx.eventParticipant.findMany({
      where: { eventId, id: { in: allParticipantIds }, status: "ACTIVE" },
      select: { id: true, roomId: true, teamId: true },
    });
    const byId = new Map(participants.map((p) => [p.id, p]));
    if (byId.size !== allParticipantIds.length) {
      throw new SingleMatchError(
        "このイベントに参加していない出場者が含まれています。",
        "UNKNOWN_SUBJECT"
      );
    }

    if (isTeam) {
      for (const [index, side] of sides.entries()) {
        const teamId = teamIds[index];
        if (side.participantIds.some((id) => byId.get(id)!.teamId !== teamId)) {
          throw new SingleMatchError(
            "選んだ出場者がそのチームに所属していません。",
            "UNKNOWN_SUBJECT"
          );
        }
      }
      const teams = await tx.eventTeam.findMany({
        where: { eventId, id: { in: teamIds.filter((id): id is string => !!id) } },
        select: { id: true },
      });
      if (teams.length !== 2) {
        throw new SingleMatchError(
          "このイベントに存在しないチームが含まれています。",
          "UNKNOWN_SUBJECT"
        );
      }
    }

    // 脱落済みは組ませない。組んでも計算上ライフは動かないので、UI で止める。
    const eliminatedSubjects = isTeam
      ? teamIds.filter((id): id is string => !!id)
      : allParticipantIds;
    const eliminated = await tx.eventLifePoint.findMany({
      where: {
        eventId,
        subjectType: isTeam ? "TEAM" : "PARTICIPANT",
        subjectId: { in: eliminatedSubjects },
        eliminatedAt: { not: null },
      },
      select: { subjectId: true },
    });
    if (eliminated.length > 0) {
      throw new SingleMatchError("脱落した出場者は対戦に組めません。", "ELIMINATED");
    }

    await assertMatchWindow(tx, {
      eventId,
      start: scheduledStartAt,
      end: scheduledEndAt,
      roomIds: allParticipantIds.map((id) => byId.get(id)!.roomId),
    });

    const last = await tx.eventMatch.findFirst({
      where: { eventId },
      orderBy: { bracketPosition: "desc" },
      select: { bracketPosition: true },
    });

    const match = await tx.eventMatch.create({
      data: {
        eventId,
        round: 1,
        bracketPosition: (last?.bracketPosition ?? -1) + 1,
        // **サイドの人数から決める。** チーム戦でもチームの人数ではなく出場人数。
        matchType: sideA.participantIds.length === 2 ? "2V2" : "1V1",
        scheduledStartAt,
        scheduledEndAt,
        status: "SCHEDULED",
      },
    });

    for (const [sideIndex, side] of sides.entries()) {
      const created = await tx.eventMatchSide.create({
        data: {
          matchId: match.id,
          sideIndex,
          teamId: isTeam ? teamIds[sideIndex] : null,
        },
      });
      await tx.eventMatchSideParticipant.createMany({
        data: side.participantIds.map((participantId) => ({
          sideId: created.id,
          participantId,
        })),
      });
    }

    // 過去の時間枠にカードを足すと、最終集計済みのイベントでも結果が変わる。
    await reopenAggregation(tx, eventId);

    return { matchId: match.id };
  }, MUTATION_TX_OPTIONS);
}

/**
 * 対戦の時間枠を検証する。イベント期間内に収まっているか、同じ配信者の枠と
 * 重なっていないか。
 *
 * 枠が重なると、検知したバトルをどちらの対戦に割り当てるべきか決められない
 * （`assignBattles` は候補が複数あるものを割り当てないので、どちらも検知されない
 * まま NO_SHOW になる）。組む時点・動かす時点の両方で止める。
 *
 * **必ず書き込みと同じトランザクションから呼ぶこと。**
 */
export async function assertMatchWindow(
  tx: DbClient,
  params: {
    eventId: string;
    start: Date;
    end: Date;
    /** 検証対象の room。省略時は `excludeMatchId` の対戦から引く */
    roomIds?: string[];
    /** 重なり判定から除外する対戦（時間枠を動かすときの自分自身） */
    excludeMatchId?: string;
  }
): Promise<void> {
  const { eventId, start, end, excludeMatchId } = params;

  if (start >= end) {
    throw new SingleMatchError("終了は開始より後の日時にしてください。", "OUT_OF_EVENT_WINDOW");
  }

  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { startAt: true, endAt: true },
  });
  if (!event) throw new SingleMatchError("イベントが見つかりません。", "UNKNOWN_SUBJECT");
  if (start < event.startAt || end > event.endAt) {
    throw new SingleMatchError(
      "対戦の時間枠がイベント期間の外に出ています。",
      "OUT_OF_EVENT_WINDOW"
    );
  }

  let roomIds = params.roomIds;
  if (!roomIds && excludeMatchId) {
    const sides = await tx.eventMatchSide.findMany({
      where: { matchId: excludeMatchId },
      select: { participants: { select: { participant: { select: { roomId: true } } } } },
    });
    roomIds = sides.flatMap((s) => s.participants.map((p) => p.participant.roomId));
  }
  if (!roomIds || roomIds.length === 0) return;

  const overlapping = await tx.eventMatch.findFirst({
    where: {
      eventId,
      status: { not: "VOID" },
      ...(excludeMatchId ? { id: { not: excludeMatchId } } : {}),
      // 半開区間どうしの重なり判定。
      scheduledStartAt: { lt: end },
      scheduledEndAt: { gt: start },
      sides: {
        some: {
          participants: { some: { participant: { roomId: { in: roomIds } } } },
        },
      },
    },
    select: { id: true },
  });

  if (overlapping) {
    throw new SingleMatchError(
      "同じ出場者の対戦がこの時間枠と重なっています。時間をずらしてください。",
      "OVERLAPPING"
    );
  }
}
