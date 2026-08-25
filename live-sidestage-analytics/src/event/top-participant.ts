import { MAX_BREAKDOWN_ENTRIES, type ListenerBreakdownEntry } from "./contribution-breakdown";

// リスナーごとの「支援先」と「枠ごとの内訳」を決める。
//
// イベント全体のリスナー貢献(scope=EVENT)は誰に投げたリスナーなのかが分からないので、
// 集計時に「最も多く入れた参加者」「入れた参加者の人数」「参加者ごとの内訳」を確定させて
// EVENT 行に持たせる。
//
// **判定は常にポイント(倍率適用後)基準**。公開ページは実弾(ダイヤ)順に並べ替えられるが、
// 支援先も内訳の並び順もポイント基準のまま動かさない(並べ替えのたびに所属や順番が
// 変わると読めない)。

/** ポイントとダイヤだけ見る。aggregate.ts の Bucket はこれを満たす。 */
export type ContributionAmount = { points: bigint; diamonds: bigint };

export type ListenerAttribution = {
  /** 最も多くポイントを入れた参加者 */
  topParticipantId: string;
  /** ギフトを入れた参加者の人数。**打ち切り前**の件数 */
  participantCount: number;
  /**
   * 参加者ごとの内訳。points desc → diamonds desc → participantId asc。
   * 先頭は必ず `topParticipantId` の行になる。
   */
  breakdown: ListenerBreakdownEntry[];
};

/**
 * 参加者ごとのリスナー内訳から、リスナーごとの支援先と内訳を出す。
 *
 * 打ち切り(MAX_CONTRIBUTION_ROWS)より前の全量を渡すこと。打ち切り後だと、
 * 参加者側の上位に入らなかったリスナーの支援先が取れない。
 *
 * 並び替え規則は aggregate.ts の topRows() と揃える(points desc → diamonds desc)。
 * 完全に同点なら participantId の昇順で決める — 集計は10秒ごとに走るので、
 * 決定的にしないと表示が毎周ちらつく。
 */
export function resolveListenerAttribution(
  byParticipant: Map<string, Map<string, ContributionAmount>>
): Map<string, ListenerAttribution> {
  const entries = new Map<string, ListenerBreakdownEntry[]>();

  for (const [participantId, listeners] of byParticipant) {
    for (const [uniqueId, amount] of listeners) {
      const row = { participantId, diamonds: amount.diamonds, points: amount.points };
      const cur = entries.get(uniqueId);
      if (cur) cur.push(row);
      else entries.set(uniqueId, [row]);
    }
  }

  const result = new Map<string, ListenerAttribution>();
  for (const [uniqueId, rows] of entries) {
    rows.sort(compareEntries);
    result.set(uniqueId, {
      topParticipantId: rows[0].participantId,
      participantCount: rows.length,
      // 参加者数自体が MAX_PARTICIPANTS で頭打ちなので実質は全件。
      breakdown: rows.slice(0, MAX_BREAKDOWN_ENTRIES),
    });
  }

  return result;
}

function compareEntries(a: ListenerBreakdownEntry, b: ListenerBreakdownEntry): number {
  if (a.points !== b.points) return a.points > b.points ? -1 : 1;
  if (a.diamonds !== b.diamonds) return a.diamonds > b.diamonds ? -1 : 1;
  return a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0;
}
