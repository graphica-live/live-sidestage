// バトル陣営色の正本。一覧・詳細モーダル・再生UIが**同じ関数**を通ることで色が一致する。
//
// もとは BattleDetailModal.tsx 内の非公開関数だったが、再生UI(battle-replay/)からも
// 使うため切り出した。モーダル側が再生UIを import するので、色をモーダルに置いたままだと
// 循環 import になる。**サーバーは色を返さない**(この関数の出力が唯一の色決定)。

export const SELF_COLOR = "#fe4d4d";
export const OPPONENT_COLORS = ["#4d9fff", "#ffa64d", "#b98aff"];
export const GOLD = "#f5c451";
export const FALLBACK_COLOR = "#9a9ea6";

/** 自陣営は常に赤固定、相手陣営はバトルスコア降順で青→橙→紫を割り当てる。 */
export function assignFactionColors(
  teams: { index: number; isSelf: boolean; score: string | null }[]
): Map<number, string> {
  const colorByIndex = new Map<number, string>();
  for (const t of teams) if (t.isSelf) colorByIndex.set(t.index, SELF_COLOR);
  const opponents = teams
    .filter((t) => !t.isSelf)
    .slice()
    .sort((a, b) => {
      const av = a.score === null ? -1n : BigInt(a.score);
      const bv = b.score === null ? -1n : BigInt(b.score);
      return av > bv ? -1 : av < bv ? 1 : 0;
    });
  opponents.forEach((t, i) => colorByIndex.set(t.index, OPPONENT_COLORS[i % OPPONENT_COLORS.length]));
  return colorByIndex;
}

/** スコアが確定していない陣営が2つ未満、または最高スコアが同点のときはnull(WINバッジを出さない)。 */
export function resolveWinningTeamIndex(teams: { index: number; score: string | null }[]): number | null {
  const scored = teams.filter((t) => t.score !== null);
  if (scored.length < 2) return null;
  let maxIndex: number | null = null;
  let maxScore: bigint | null = null;
  let tied = false;
  for (const t of scored) {
    const value = BigInt(t.score!);
    if (maxScore === null || value > maxScore) {
      maxScore = value;
      maxIndex = t.index;
      tied = false;
    } else if (value === maxScore) {
      tied = true;
    }
  }
  return tied ? null : maxIndex;
}
