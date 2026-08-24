import { prisma } from "@/lib/prisma";
import { MUTATION_TX_OPTIONS, reopenAggregation } from "./reopen-aggregation";
import { acquireEventLock } from "./event-lock";
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
      | "INVALID_SESSION"
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
  /** この対戦を行う開催日程。日程まるごとが検知の対象になる */
  sessionId: string;
};

export async function createSingleMatch(input: SingleMatchInput): Promise<{ matchId: string }> {
  const { eventId, sideA, sideB, sessionId } = input;
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
    // **読む前にロックを取る。** 開催日程の変更と同時に走ると、古い日程で
    // 「期間内」と判定した枠が、日程が縮んだ後にコミットされてしまう。
    await acquireEventLock(tx, eventId);

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

    const session = await assertEventSession(tx, eventId, sessionId);

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
        sessionId,
        // 旧列への dual-write(読まない。旧コードとの同居のためだけに入れる)。
        scheduledStartAt: session.startAt,
        scheduledEndAt: session.endAt,
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
 * その日程がこのイベントのものかを確認する。
 *
 * 対戦は開催日程まるごとを検知の対象にするので、**日程の中で対戦どうしの時間が重なるのは
 * 常態**（1回戦と2回戦が同じ日程に並ぶ）。かつて時間枠の重なりを禁止していた検証は、
 * 個別の時間枠そのものを廃止したのでなくなった。曖昧な検知は `assignBattles` が
 * 自動確定を諦める（`NEEDS_REVIEW`）ことで受け止める。
 *
 * DB 側にも複合FK `(eventId, sessionId)` があるが、それだと違反が Prisma の
 * 外部キーエラーとして出て主催者に意味が伝わらないので、ここで先に弾く。
 *
 * **必ず書き込みと同じトランザクションから呼ぶこと。**
 */
export async function assertEventSession(
  tx: DbClient,
  eventId: string,
  sessionId: string
): Promise<{ id: string; startAt: Date; endAt: Date }> {
  const session = await tx.eventSession.findFirst({
    where: { id: sessionId, eventId },
    select: { id: true, startAt: true, endAt: true },
  });
  if (!session) {
    throw new SingleMatchError("この対戦を行う開催日程を選んでください。", "INVALID_SESSION");
  }
  return session;
}
