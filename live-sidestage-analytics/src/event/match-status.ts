// 対戦カードの状態についての純粋な述語。サーバー・クライアント・集計ワーカーの
// すべてがここを見る。
//
// **このファイルは何も import しない。** クライアントコンポーネント
// (`MatchManager.tsx` / `DestroyBracketDialog.tsx`) から直接 import するので、
// 間接的にでも `@/lib/prisma` へ届くとクライアントバンドルが壊れる。
// `bracket.ts` / `match-detect.ts` と同じ扱い。

/**
 * 破棄しても失うものがない状態。
 *
 * **ここに無い status は「進行済み」として扱う(fail closed)。** `EventMatch.status` は
 * DB の enum ではなく文字列なので、将来 status が増えたときに破壊操作が黙って通らないようにする。
 *
 * - `SCHEDULED` — まだ何も起きていない
 * - `NO_SHOW` — 時間枠を過ぎたが検知できなかった。「起きなかった」の記録なので失うデータがない
 * - `VOID` — 主催者が明示的に無効と宣言した行
 */
export const DISCARDABLE_MATCH_STATUSES: ReadonlySet<string> = new Set([
  "SCHEDULED",
  "NO_SHOW",
  "VOID",
]);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `rules` に `reviewReason` をマージする。**既存キー(`roundLabel` / `bye` 等)を潰さない。**
 * `reason` が null なら消す(承認済みのカードに古い理由が残らないように)。
 *
 * `battles.ts`(検知)と `match-results.ts`(`resolveMatchSeries`)の両方が書き込むので
 * ここに1つだけ置く。型パラメータを `string` にして `ReviewReason`(`match-detect.ts`)への
 * 依存を避けている(このファイルは何も import しない、というファイル冒頭の制約のため)。
 */
export function mergeReviewReason(rules: unknown, reason: string | null): Record<string, unknown> {
  const base: Record<string, unknown> = isPlainObject(rules) ? { ...rules } : {};
  if (reason) base.reviewReason = reason;
  else delete base.reviewReason;
  return base;
}

export function reviewReasonOf(rules: unknown): string | null {
  if (!isPlainObject(rules)) return null;
  return typeof rules.reviewReason === "string" ? rules.reviewReason : null;
}

/**
 * 主催者が「候補過多(CANDIDATES_EXCEEDED)」画面で判定対象を選び確定したか。
 * true の間、`detectMatches` はこのマッチへ新規候補を追加しない(凍結)。
 */
export function isCandidatesConfirmedByOrganizer(rules: unknown): boolean {
  return isPlainObject(rules) && rules.candidatesConfirmedByOrganizer === true;
}

export function withCandidatesConfirmedByOrganizer(
  rules: unknown,
  confirmed: boolean
): Record<string, unknown> {
  const base: Record<string, unknown> = isPlainObject(rules) ? { ...rules } : {};
  if (confirmed) base.candidatesConfirmedByOrganizer = true;
  else delete base.candidatesConfirmedByOrganizer;
  return base;
}

/**
 * 不戦勝行(`EventMatch.rules.bye === true`)か。`tournament.ts` が表の生成時に付ける。
 *
 * 段階的不戦勝方式では、相手が実試合の勝者(WINNER_OF)である不戦勝行は生成時点では
 * 確定できず、SCHEDULED のまま作られる。この行は検知対象にならない
 * (`isReadyForDetection` が両サイドの出場者を要求する)ので LIVE/DETECTED/NEEDS_REVIEW には
 * 絶対にならない — つまり進行済みとして扱う必要がなく、上流の勝者が変わるたびに
 * 常に追従させてよい。
 */
export function isByeRow(rules: unknown): boolean {
  return isPlainObject(rules) && rules.bye === true;
}

export type MatchProgress = {
  status: string;
  winnerDecidedBy: string | null;
  isBye: boolean;
};

/**
 * 実際の対戦が付いているか、結果が確定しているか。
 *
 * **`winnerDecidedBy === "BYE"` も見るのは後方互換のため。** `rules.bye` を付けるように
 * なる前に作られた表が本番に残っていて、そちらは印を持たない。
 */
export function isStartedMatch(match: MatchProgress): boolean {
  // 不戦勝はバトルを待たずに自動確定させただけ。実際の対戦は起きていない。
  if (match.isBye || match.winnerDecidedBy === "BYE") return false;
  return !DISCARDABLE_MATCH_STATUSES.has(match.status);
}

/**
 * バトル検知の対象になる枠か。両サイドの出場者が確定していて、不戦勝行でないこと。
 *
 * **`assignBattles` と `findMissedMatches` の両方がこれを使う。** 片方だけの判定にすると、
 * 「割り当てはするが NO_SHOW にはしない」のような食い違いが出る。
 *
 * サイドの空判定に `teamId` は見ない。検知は roomId 集合の一致でしかできないので、
 * `teamId` はあるが出場者がいないサイドはそもそも永久に検知されない。
 */
export function isReadyForDetection(match: { isBye: boolean; sideRoomIds: string[][] }): boolean {
  if (match.isBye) return false;
  // `every` は空配列に true を返すので、サイドが揃っていること自体も確かめる。
  return match.sideRoomIds.length === 2 && match.sideRoomIds.every((side) => side.length > 0);
}
