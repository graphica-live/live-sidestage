// リスナーごとの「支援先」を決める。
//
// イベント全体のリスナー貢献(scope=EVENT)は誰に投げたリスナーなのかが分からないので、
// 集計時に「最も多く入れた参加者」と「入れた参加者の人数」を確定させて EVENT 行に持たせる。
//
// **判定は常にポイント(倍率適用後)基準**。公開ページは実弾(ダイヤ)順に並べ替えられるが、
// 支援先はポイント基準のまま動かさない(並べ替えのたびに所属が変わると読めない)。

/** ポイントとダイヤだけ見る。aggregate.ts の Bucket はこれを満たす。 */
export type ContributionAmount = { points: bigint; diamonds: bigint };

export type ListenerAttribution = {
  /** 最も多くポイントを入れた参加者 */
  topParticipantId: string;
  /** ギフトを入れた参加者の人数 */
  participantCount: number;
};

/**
 * 参加者ごとのリスナー内訳から、リスナーごとの支援先を出す。
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
  const best = new Map<string, { id: string; amount: ContributionAmount; count: number }>();

  for (const [participantId, listeners] of byParticipant) {
    for (const [uniqueId, amount] of listeners) {
      const cur = best.get(uniqueId);
      if (!cur) {
        best.set(uniqueId, { id: participantId, amount, count: 1 });
        continue;
      }
      cur.count += 1;
      if (isBetter(participantId, amount, cur.id, cur.amount)) {
        cur.id = participantId;
        cur.amount = amount;
      }
    }
  }

  return new Map(
    [...best].map(([uniqueId, v]) => [
      uniqueId,
      { topParticipantId: v.id, participantCount: v.count },
    ])
  );
}

function isBetter(
  id: string,
  amount: ContributionAmount,
  curId: string,
  curAmount: ContributionAmount
): boolean {
  if (amount.points !== curAmount.points) return amount.points > curAmount.points;
  if (amount.diamonds !== curAmount.diamonds) return amount.diamonds > curAmount.diamonds;
  return id < curId;
}
