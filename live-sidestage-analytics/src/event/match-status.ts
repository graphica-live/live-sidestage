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

/**
 * ⚠️トラブル対処: 検知区間の代わりに開催日程まるごとを集計対象にする強制フラグ
 * (`EventMatch.rules.forceFullPeriod === true`)。
 *
 * バトル検知が失敗して(部分一致・AMBIGUOUS・END_UNKNOWN等)主催者が勝者を手動確定した対戦は、
 * バトル区間がゼロのままだと BATTLE_ONLY 種目でダイヤが0点になる。このフラグは
 * `loadBattleRangesByRoom()` にだけ効く緊急救済で、勝敗判定には一切影響しない。
 *
 * **`FINISHED` の対戦にしか存在しない不変条件。** `route.ts` が設定を FINISHED 限定にし、
 * `reopen`/`void` で明示的に消すことでこれを保つ(`match-status.ts` 自体は状態遷移を
 * 知らないので、ここでは検証しない — 呼び出し側の責務)。
 */
export function isForceFullPeriod(rules: unknown): boolean {
  return isPlainObject(rules) && rules.forceFullPeriod === true;
}

/** 順位決定戦の行に付く印(`EventMatch.rules.placement`)。 */
export type PlacementMark = { depth: number; rank: number };

/**
 * 順位決定戦(3位決定戦など)の行か。`tournament.ts` が表の生成時に付ける。
 *
 * 本選の行と座標空間を共有しているので、**UI のグルーピングはこの印だけで行う**
 * (round で分けると本選の決勝と同じラウンドに並んでしまう)。
 */
export function parsePlacement(rules: unknown): PlacementMark | null {
  if (!isPlainObject(rules) || !isPlainObject(rules.placement)) return null;
  const { depth, rank } = rules.placement;
  if (typeof depth !== "number" || typeof rank !== "number") return null;
  return { depth, rank };
}

/**
 * 敗者の出どころ(`EventMatch.rules.loserFrom`)。sideIndex 順で、BYE 側は null。
 *
 * **順位決定戦ブロックの葉の行だけが持つ。** これが「敗者を送る辺」の実体で、
 * `match-results.ts` の進行と `battles.ts` の feeder 判定の両方が読む。
 * 座標(`nextSlot()`)からは導出できない — どの本選行が実試合かは不戦勝の配置に依存する。
 */
export function parseLoserFrom(rules: unknown): ({ round: number; position: number } | null)[] | null {
  if (!isPlainObject(rules) || !Array.isArray(rules.loserFrom)) return null;
  return rules.loserFrom.map((entry) => {
    if (!isPlainObject(entry)) return null;
    const { round, position } = entry;
    if (typeof round !== "number" || typeof position !== "number") return null;
    return { round, position };
  });
}

/**
 * 勝者フィーダーの override(`EventMatch.rules.winnerFeeders`)。**受け側(target)の行だけが持つ。**
 *
 * 通常、勝者の転送先は `nextSlot()` の座標から機械的に決まるが、組み合わせ変更
 * (winner feeder edge swap, `bracket-swap-apply.ts` の `swapWinnerFeeders()`)は
 * この座標既定を上書きして「どの座標の勝者がこのスロットに来るか」を明示する。
 *
 * `loserFrom` と異なり**厳密な検証を行う**(構造的BYE側を対象から除外しているので
 * null 要素を許さない)。`changedAt` は接続変更時刻で、`battles.ts` の検知下限
 * (`max(決着時刻, changedAt)`)に使う。
 */
export type WinnerFeeders = {
  slots: [{ round: number; position: number }, { round: number; position: number }];
  changedAt: string;
};

/**
 * `parseWinnerFeeders()` の戻り値。
 *
 * - `null` — `rules` に `winnerFeeders` キー自体が無い(override無し。旧データ・通常の対戦)
 * - `{ ok: false }` — キーはあるが形式が壊れている。呼び出し側は `BRACKET_INCONSISTENT` で止めること
 *   (`parseLoserFrom` のように既定へフォールバックしない — fail closed)
 * - `{ ok: true; value }` — 構文的に正しい override
 *
 * **ここで検証するのは構文だけ**(固定2要素・整数・非負position・重複しない2つの座標)。
 * 意味的な検証(`source.round === target.round - 1`・source実在・全単射)は、複数行を
 * またぐ判定なので `bracket.ts` の `WinnerFeederGraph` 構築側の責務にする。
 */
export type ParseWinnerFeedersResult = { ok: true; value: WinnerFeeders } | { ok: false } | null;

export function parseWinnerFeeders(rules: unknown): ParseWinnerFeedersResult {
  if (!isPlainObject(rules) || !("winnerFeeders" in rules)) return null;

  const raw = rules.winnerFeeders;
  if (!isPlainObject(raw)) return { ok: false };

  const { slots, changedAt } = raw as { slots?: unknown; changedAt?: unknown };
  if (!Array.isArray(slots) || slots.length !== 2) return { ok: false };
  if (typeof changedAt !== "string" || Number.isNaN(Date.parse(changedAt))) return { ok: false };

  const parsedSlots = slots.map((entry) => {
    if (!isPlainObject(entry)) return null;
    const { round, position } = entry;
    if (typeof round !== "number" || typeof position !== "number") return null;
    if (!Number.isInteger(round) || !Number.isInteger(position)) return null;
    if (position < 0) return null;
    return { round, position };
  });
  if (parsedSlots.some((slot) => slot === null)) return { ok: false };

  const [a, b] = parsedSlots as [{ round: number; position: number }, { round: number; position: number }];
  if (a.round === b.round && a.position === b.position) return { ok: false }; // 重複source

  return { ok: true, value: { slots: [a, b], changedAt } };
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
