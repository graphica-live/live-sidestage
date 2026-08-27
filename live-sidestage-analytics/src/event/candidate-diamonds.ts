import { type DbClient } from "./analytics-db";
import { scoreSides, type SideRow } from "./match-results";
import { resolveEventWindows, type EventWindow } from "./sessions";

// 候補選択UI(候補調整モード/CANDIDATES_EXCEEDED)の「1000ダイヤ以下のバトルを隠す」
// トグル用の、候補ごとの生ダイヤ集計。**主催者が候補パネルを開いたときだけ叩く
// オンデマンドAPIから呼ぶ**(page.tsx の事前計算にしない理由は src/event/CLAUDE.md
// 「候補調整モード」参照 — canAdjustCandidates() は確定済みBEST_OF_THREEも含むため、
// 対戦一覧ページの毎回のポーリングで全対戦分を計算すると無駄が大きい)。
//
// **倍率はかけない。** 「1000ダイヤ以下」の判定は倍率適用前の生ダイヤで行う
// (resolveGameWinner() が倍率適用前ダイヤで勝者を決めているのと同じ考え方)。
// scoreSides() へ multipliers: [] を渡せば、buildRateSegments が1セグメントを返し
// 倍率がかからないまま生ダイヤの合計になる。

export type CandidateDiamondsResult = { id: string; diamonds: string | null };

/** ローダーが要求するイベント側の最小情報。`resolveEventWindows()` のフォールバックに要る。 */
export type CandidateDiamondsEventInput = {
  startAt: Date;
  endAt: Date;
  sessions: { id: string; startAt: Date; endAt: Date; name: string | null }[];
};

/**
 * 対戦1件ぶんの、候補ごとの生ダイヤ合計(両サイド合計)を返す。対戦が無ければ null。
 *
 * - 終了が確定していない候補(`endedAt === null`)、まだ未来の候補(duration由来のLIVE)は
 *   計算せず `diamonds: null` を返す(進行中の候補が低ダイヤ扱いで隠れる事故を防ぐ)
 * - **区間は対戦に割り当てられた `EventSession` 単体を使う。** 日程未割り当ての旧データ
 *   だけ `resolveEventWindows(event)` へフォールバックする(`src/event/CLAUDE.md`
 *   「期間の正本は EventSession」の不変条件を満たす)
 * - **fail-open。** 集計に失敗した候補は該当候補だけ `diamonds: null` を返し、
 *   対戦全体・APIレスポンス全体は落とさない
 */
export async function loadCandidateDiamonds(
  client: DbClient,
  params: { event: CandidateDiamondsEventInput; matchId: string; eventId: string; now: Date }
): Promise<CandidateDiamondsResult[] | null> {
  const match = await client.eventMatch.findFirst({
    where: { id: params.matchId, eventId: params.eventId },
    select: {
      session: { select: { startAt: true, endAt: true, name: true } },
      sides: {
        orderBy: { sideIndex: "asc" },
        select: {
          id: true,
          sideIndex: true,
          teamId: true,
          participants: {
            select: { participantId: true, participant: { select: { roomId: true } } },
          },
        },
      },
      battleCandidates: {
        orderBy: { startedAt: "asc" },
        select: { id: true, startedAt: true, endedAt: true },
      },
    },
  });
  if (!match) return null;

  const windows: EventWindow[] = match.session
    ? [{ id: null, start: match.session.startAt, end: match.session.endAt, name: match.session.name }]
    : resolveEventWindows(params.event);

  const sides: SideRow[] = match.sides;

  return Promise.all(
    match.battleCandidates.map(async (candidate): Promise<CandidateDiamondsResult> => {
      if (!candidate.endedAt || candidate.endedAt > params.now) {
        return { id: candidate.id, diamonds: null };
      }
      try {
        const totals = await scoreSides(client, {
          sides,
          start: candidate.startedAt,
          end: candidate.endedAt,
          windows,
          multipliers: [],
        });
        const sum = totals.reduce((acc, t) => acc + t.diamonds, 0n);
        return { id: candidate.id, diamonds: sum.toString() };
      } catch {
        return { id: candidate.id, diamonds: null };
      }
    })
  );
}
