// トーナメントのブラケット方式(標準シード方式 / 段階的不戦勝方式)。
// `Event.rules` の "bracket" 名前空間に置く。matchRules / deathmatch と同じ理由
// (種目を問わず主催者が決める設定が Event.rules に同居する)で、書き込み側は
// 既存の名前空間を残したままマージすること。

import { BRACKET_METHODS, type BracketMethod } from "./bracket";

export const BRACKET_METHOD_DEFAULT: BracketMethod = "STANDARD";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `Event.rules` の "bracket" キーを読む。不正値・欠損は既定(STANDARD)へ丸める。 */
export function parseBracketMethod(rules: unknown): BracketMethod {
  const source = isPlainObject(rules) && isPlainObject(rules.bracket) ? rules.bracket : {};
  return BRACKET_METHODS.includes(source.method as BracketMethod)
    ? (source.method as BracketMethod)
    : BRACKET_METHOD_DEFAULT;
}

/**
 * 順位決定戦をどの深さまで行うかの**希望値**。
 *
 * **作成ウィザードで決めるので、この時点では参加人数が分からない。** 実際に組める深さは
 * ブラケットが確定してからでないと算出できない(`placementOptions()`)ので、これはあくまで
 * 既定値であり、`createBracket` が実際の上限へ丸める。
 */
export const PLACEMENT_DEPTH_DEFAULT = 0;

/** ウィザードで選ばせる上限。実際の上限はブラケット確定後に算出する。 */
export const PLACEMENT_DEPTH_MAX = 3;

/** `Event.rules.bracket.placementDepth` を読む。不正値・欠損は 0(行わない)へ丸める。 */
export function parsePlacementDepth(rules: unknown): number {
  const source = isPlainObject(rules) && isPlainObject(rules.bracket) ? rules.bracket : {};
  return normalizePlacementDepth(source.placementDepth);
}

/** 0..PLACEMENT_DEPTH_MAX の整数へ丸める。非数値・負値・小数は 0。 */
export function normalizePlacementDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return PLACEMENT_DEPTH_DEFAULT;
  }
  return Math.min(value, PLACEMENT_DEPTH_MAX);
}
