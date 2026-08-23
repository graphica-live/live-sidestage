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
