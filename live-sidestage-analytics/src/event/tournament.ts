import { prisma } from "@/lib/prisma";
import { resolveBracket, roundLabel, stagedRoundLabel } from "./bracket";
import { parseBracketMethod } from "./bracket-rules";
import { parseJstLocal } from "./datetime";
import { acquireEventLock } from "./event-lock";
import { MUTATION_TX_OPTIONS, reopenAggregation } from "./reopen-aggregation";
import { resolveEventWindows, type EventWindow } from "./sessions";

// トーナメント表の作成。主催者が「表を作る」を実行したときに1回だけ走る。
//
// 進行(勝者を次のラウンドへ送る)は match-results.ts が集計のたびに作り直すので、
// ここでやるのは枠を用意することと、不戦勝を確定させることだけ。

/** 1試合の既定の長さ。TikTok のバトルは5分が標準。前後の余裕を含めて枠を取る。 */
export const DEFAULT_MATCH_WINDOW_MIN = 30;

/** ラウンド間の既定の間隔。 */
export const DEFAULT_ROUND_INTERVAL_MIN = 45;

export type BracketPlanInput = {
  eventId: string;
  /** シード順(強い順)に並べたエントリー。個人戦なら participantId、チーム戦なら teamId */
  entrantIds: string[];
  entryMode: "SOLO" | "TEAM";
  /** 1回戦の開始時刻 */
  firstRoundStartAt: Date;
  matchWindowMin?: number;
  roundIntervalMin?: number;
};

export class BracketError extends Error {
  constructor(
    message: string,
    readonly code:
      | "TOO_FEW_ENTRANTS"
      | "ALREADY_STARTED"
      | "OUT_OF_EVENT_WINDOW"
      | "UNKNOWN_ENTRANT"
  ) {
    super(message);
    this.name = "BracketError";
  }
}

/**
 * 各ラウンドの開始時刻を決める。開催日程をまたぐときは次の日程の頭へ送る。
 *
 * - **1回戦は指定された時刻から動かさない。** どの日程にも収まらなければ null を返し、
 *   主催者に直させる(黙って別の日へ動かすと、意図しない日程で表ができてしまう)
 * - 2回戦以降は `roundIntervalMin` 間隔。枠(`matchWindowMin`)がその日程からはみ出すなら
 *   次の日程の開始時刻へ送る。これで「1日目に予選、2日目に決勝」が組める
 * - 日程を使い切っても置ききれなければ null
 */
export function planRoundStarts(input: {
  windows: EventWindow[];
  firstRoundStartAt: Date;
  roundCount: number;
  matchWindowMin: number;
  roundIntervalMin: number;
}): Date[] | null {
  const { windows, firstRoundStartAt, roundCount, matchWindowMin, roundIntervalMin } = input;
  const windowMs = matchWindowMin * 60_000;
  const intervalMs = roundIntervalMin * 60_000;

  let index = windows.findIndex(
    (w) =>
      firstRoundStartAt >= w.start && firstRoundStartAt.getTime() + windowMs <= w.end.getTime()
  );
  if (index < 0) return null;

  const starts = [firstRoundStartAt];
  let cursor = firstRoundStartAt.getTime() + intervalMs;

  for (let round = 2; round <= roundCount; round++) {
    while (index < windows.length) {
      const w = windows[index];
      if (cursor < w.start.getTime()) cursor = w.start.getTime();
      if (cursor + windowMs <= w.end.getTime()) break;
      index++;
      if (index < windows.length) cursor = windows[index].start.getTime();
    }
    if (index >= windows.length) return null;

    starts.push(new Date(cursor));
    cursor += intervalMs;
  }

  return starts;
}

/**
 * トーナメント表を作る。既存の表があれば作り直す。
 *
 * **1つでも進行済みのマッチがあれば作り直さない。** 検知済みの対戦や確定した勝敗が
 * 消えてしまうため。作り直したい場合は主催者が個別に VOID にしてから実行する。
 */
export async function createBracket(input: BracketPlanInput): Promise<{ matches: number }> {
  const {
    eventId,
    entrantIds,
    entryMode,
    firstRoundStartAt,
    matchWindowMin = DEFAULT_MATCH_WINDOW_MIN,
    roundIntervalMin = DEFAULT_ROUND_INTERVAL_MIN,
  } = input;

  if (entrantIds.length < 2) {
    throw new BracketError("トーナメント表を作るには2組以上の参加が必要です。", "TOO_FEW_ENTRANTS");
  }

  // エントリーが実在するか(チーム戦ならチーム、個人戦なら参加者)を確認する。
  const participantsByEntrant = await resolveEntrantParticipants(eventId, entrantIds, entryMode);

  return prisma.$transaction(async (tx) => {
    // **日程を読む前にロックを取る。** 日程の変更と同時に走ると、古い日程で
    // 組んだ枠がそのままコミットされて日程の外に取り残される。
    await acquireEventLock(tx, eventId);

    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        startAt: true,
        endAt: true,
        rules: true,
        sessions: {
          orderBy: { startAt: "asc" },
          select: { startAt: true, endAt: true, name: true },
        },
      },
    });
    if (!event) throw new BracketError("イベントが見つかりません。", "UNKNOWN_ENTRANT");

    // ブラケット方式はイベントの rules から読む(主催者が作成ウィザードで決めた値)。
    // 表を作るたびに読み直すので、旧方式で作った表を消して別方式で作り直すこともできる。
    const method = parseBracketMethod(event.rules);
    const bracket = resolveBracket(entrantIds, method);
    const label = method === "STAGED_BYE" ? stagedRoundLabel : roundLabel;

    const roundStarts = planRoundStarts({
      windows: resolveEventWindows(event),
      firstRoundStartAt,
      roundCount: bracket.roundCount,
      matchWindowMin,
      roundIntervalMin,
    });
    if (!roundStarts) {
      throw new BracketError(
        "全ラウンドが開催日程に収まりません。1回戦の開始時刻・間隔・日程を見直してください。",
        "OUT_OF_EVENT_WINDOW"
      );
    }

    const existing = await tx.eventMatch.findMany({
      where: { eventId },
      select: { id: true, status: true, winnerDecidedBy: true },
    });
    // 不戦勝(BYE)は表を作った時点でバトルを待たずに自動確定させただけで、
    // 主催者や実際の対戦が進行したわけではない。作り直しのブロック対象にしない。
    if (existing.some((m) => m.status !== "SCHEDULED" && m.winnerDecidedBy !== "BYE")) {
      throw new BracketError(
        "すでに進行中・確定済みの対戦があるため、表を作り直せません。",
        "ALREADY_STARTED"
      );
    }
    if (existing.length > 0) {
      await tx.eventMatch.deleteMany({ where: { eventId } });
    }

    for (const match of bracket.matches) {
      const roundStart = roundStarts[match.round - 1];
      // 片方が BYE の行は「不戦勝行」として印を残す。静的(相手が確定済みの ENTRANT)・
      // 動的(段階的方式で、相手がまだ勝者未確定の WINNER_OF)のどちらも該当する。
      // match-results.ts の進行処理と [matchId] API の操作ガードがこの印を見る
      // (詳細はそれぞれのファイルのコメントを参照)。
      const isBye = match.isBye;
      const created = await tx.eventMatch.create({
        data: {
          eventId,
          round: match.round,
          bracketPosition: match.position,
          matchType: "1V1",
          scheduledStartAt: roundStart,
          scheduledEndAt: new Date(roundStart.getTime() + matchWindowMin * 60_000),
          status: "SCHEDULED",
          rules: {
            roundLabel: label(match.round, bracket.roundCount),
            ...(isBye ? { bye: true } : {}),
          },
        },
      });

      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const entrantId = match.sideIds[sideIndex];
        const side = await tx.eventMatchSide.create({
          data: {
            matchId: created.id,
            sideIndex,
            teamId: entryMode === "TEAM" ? entrantId : null,
          },
        });

        const participantIds = entrantId ? (participantsByEntrant.get(entrantId) ?? []) : [];
        if (participantIds.length > 0) {
          await tx.eventMatchSideParticipant.createMany({
            data: participantIds.map((participantId) => ({ sideId: side.id, participantId })),
          });
        }
      }

      // 不戦勝。バトルは起きないので検知を待たずに確定させる。
      // 勝者を次のラウンドへ送るのは match-results.ts が集計のたびに行う。
      if (match.autoWinnerSide !== null) {
        const sides = await tx.eventMatchSide.findMany({
          where: { matchId: created.id },
          select: { id: true, sideIndex: true },
        });
        const winner = sides.find((s) => s.sideIndex === match.autoWinnerSide);
        if (winner) {
          await tx.eventMatch.update({
            where: { id: created.id },
            data: { status: "FINISHED", winnerSideId: winner.id, winnerDecidedBy: "BYE" },
          });
        }
      }
    }

    // 表を作り直したら、最終集計が済んでいても結果が変わる。
    await reopenAggregation(tx, eventId);

    return { matches: bracket.matches.length };
  }, MUTATION_TX_OPTIONS);
}

/** エントリーID → そのサイドに入る参加者IDの一覧。 */
async function resolveEntrantParticipants(
  eventId: string,
  entrantIds: string[],
  entryMode: "SOLO" | "TEAM"
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();

  if (entryMode === "TEAM") {
    const teams = await prisma.eventTeam.findMany({
      where: { eventId, id: { in: entrantIds } },
      select: { id: true, participants: { where: { status: "ACTIVE" }, select: { id: true } } },
    });
    for (const team of teams) {
      // メンバーのいないチームを表に入れると、そのサイドの room が空になり、
      // バトルの検知(サイドの room 集合との一致)が永久に成立しない。
      if (team.participants.length === 0) {
        throw new BracketError(
          "参加者が1人もいないチームが含まれています。先に参加者をチームへ入れてください。",
          "UNKNOWN_ENTRANT"
        );
      }
      map.set(team.id, team.participants.map((p) => p.id));
    }
  } else {
    const participants = await prisma.eventParticipant.findMany({
      where: { eventId, id: { in: entrantIds }, status: "ACTIVE" },
      select: { id: true },
    });
    for (const p of participants) map.set(p.id, [p.id]);
  }

  const missing = entrantIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    throw new BracketError(
      `このイベントに存在しないエントリーが含まれています: ${missing.join(", ")}`,
      "UNKNOWN_ENTRANT"
    );
  }

  return map;
}

/**
 * シード順の既定値を作る。
 *
 * 現在の順位表(獲得ダイヤ)があればその順、なければ登録順。主催者は並べ替えできる。
 */
export async function defaultSeedOrder(
  eventId: string,
  entryMode: "SOLO" | "TEAM"
): Promise<string[]> {
  const subjectType = entryMode === "TEAM" ? "TEAM" : "PARTICIPANT";
  const standings = await prisma.eventStanding.findMany({
    where: { eventId, subjectType },
    orderBy: { rank: "asc" },
    select: { subjectId: true },
  });
  if (standings.length > 0) return standings.map((s) => s.subjectId);

  if (entryMode === "TEAM") {
    const teams = await prisma.eventTeam.findMany({
      where: { eventId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    return teams.map((t) => t.id);
  }

  const participants = await prisma.eventParticipant.findMany({
    where: { eventId, status: "ACTIVE" },
    orderBy: { joinedAt: "asc" },
    select: { id: true },
  });
  return participants.map((p) => p.id);
}

/** `<input type="datetime-local">` の値からトーナメント開始時刻を作る(JST固定)。 */
export function parseBracketStart(value: string): Date | null {
  return parseJstLocal(value);
}
