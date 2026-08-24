import type { DbClient } from "./analytics-db";
import {
  computeLifePoints,
  type DeathmatchRules,
  type LifeEvent,
  type LifeOutcome,
} from "./deathmatch";

// デスマッチのライフを DB へ反映する。計算そのものは deathmatch.ts の純粋関数が持つ。
//
// **全期間再計算して置き換える。** マッチの勝敗は主催者が後から変えられるし VOID にも
// できるので、増分では直せない。集計本体と同じ思想。

/** ライフの対象。個人戦なら participantId、チーム戦なら teamId。 */
export type LifeSubjectType = "PARTICIPANT" | "TEAM";

export type LifePointsResult = {
  subjects: number;
  eliminated: number;
  ledgerRows: number;
};

/**
 * 確定したマッチからライフを計算し直し、`EventLifePoint` と `EventLifeLedger` を入れ替える。
 *
 * 集計トランザクションの中から呼ぶ。
 */
export async function applyLifePoints(
  tx: DbClient,
  params: {
    eventId: string;
    entryMode: string;
    rules: DeathmatchRules;
  }
): Promise<LifePointsResult> {
  const subjectType: LifeSubjectType = params.entryMode === "TEAM" ? "TEAM" : "PARTICIPANT";

  // ライフが1件もない参加者・チームも「初期ライフのまま」として載せるので、
  // 対戦の出場者ではなく参加者・チームの一覧そのものから作る。
  const subjectIds =
    subjectType === "TEAM"
      ? (
          await tx.eventTeam.findMany({
            where: { eventId: params.eventId },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: { id: true },
          })
        ).map((t) => t.id)
      : (
          await tx.eventParticipant.findMany({
            where: { eventId: params.eventId, status: "ACTIVE" },
            orderBy: { joinedAt: "asc" },
            select: { id: true },
          })
        ).map((p) => p.id);

  const events = await loadLifeEvents(tx, { eventId: params.eventId, subjectType });

  const states = computeLifePoints({ subjectIds, events, rules: params.rules });

  // 参加者が外れた場合に古い行が残らないよう、丸ごと入れ替える。
  await tx.eventLifePoint.deleteMany({ where: { eventId: params.eventId } });
  if (states.length > 0) {
    await tx.eventLifePoint.createMany({
      data: states.map((s) => ({
        eventId: params.eventId,
        subjectType,
        subjectId: s.subjectId,
        current: s.current,
        max: s.max,
        eliminatedAt: s.eliminatedAt,
      })),
    });
  }

  await tx.eventLifeLedger.deleteMany({ where: { eventId: params.eventId } });
  const ledgerRows = states.flatMap((s) =>
    s.ledger.map((entry) => ({
      eventId: params.eventId,
      subjectType,
      subjectId: s.subjectId,
      matchId: entry.matchId,
      delta: entry.delta,
      reason: entry.reason,
      // 再計算しても履歴の並びが変わらないよう、決着時刻をそのまま入れる。
      createdAt: entry.at,
    }))
  );
  if (ledgerRows.length > 0) {
    await tx.eventLifeLedger.createMany({ data: ledgerRows });
  }

  return {
    subjects: states.length,
    eliminated: states.filter((s) => s.eliminatedAt).length,
    ledgerRows: ledgerRows.length,
  };
}

/**
 * 確定したマッチをライフ計算の入力に変換する。
 *
 * 対象は `status = "FINISHED"` のみ。VOID / NO_SHOW / 進行中・承認待ちは含めない。
 * 勝者が決まっていないまま FINISHED になっているのは主催者が引き分けとして確定した場合
 * (`winnerDecidedBy = "DRAW"`)。
 */
async function loadLifeEvents(
  tx: DbClient,
  params: { eventId: string; subjectType: LifeSubjectType }
): Promise<LifeEvent[]> {
  const matches = await tx.eventMatch.findMany({
    where: { eventId: params.eventId, status: "FINISHED" },
    select: {
      id: true,
      winnerSideId: true,
      winnerDecidedBy: true,
      detectedEndAt: true,
      decidedAt: true,
      sides: {
        select: {
          id: true,
          teamId: true,
          participants: { select: { participantId: true } },
        },
      },
    },
  });

  const events: LifeEvent[] = [];

  for (const match of matches) {
    // 不戦勝はライフを動かさない。対戦が行われていないため。
    if (match.winnerDecidedBy === "BYE") continue;

    const isDraw = match.winnerDecidedBy === "DRAW";
    if (!isDraw && !match.winnerSideId) continue;

    const results: { subjectId: string; outcome: LifeOutcome }[] = [];
    for (const side of match.sides) {
      const outcome: LifeOutcome = isDraw ? "DRAW" : side.id === match.winnerSideId ? "WIN" : "LOSS";

      if (params.subjectType === "TEAM") {
        if (side.teamId) results.push({ subjectId: side.teamId, outcome });
      } else {
        // 2vs2 ではサイドの全員に同じ結果が付く。
        for (const p of side.participants) {
          results.push({ subjectId: p.participantId, outcome });
        }
      }
    }

    if (results.length === 0) continue;

    // 決着時刻。updatedAt は再集計のたびに動いて順序が不安定になるので使わない。
    // 自動検知なら実測の終了時刻、主催者が確定したならその時刻(`decidedAt`)。
    // **対戦は予定時刻を持たない**ので、どちらも無い行は順番を決められない。
    // 適用順に依存する脱落判定を壊さないよう、ここで落とす(通常は起きない)。
    const decidedAt = match.detectedEndAt ?? match.decidedAt;
    if (!decidedAt) continue;

    events.push({
      matchId: match.id,
      decidedAt,
      results,
    });
  }

  return events;
}
