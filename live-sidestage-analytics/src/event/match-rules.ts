// 対戦ルール(グローブ/ブースター/ボーナスタイム/ミスト/違反時の取り扱い)。
//
// `Event.rules` の "matchRules" 名前空間に置く。種目を問わず主催者が作成ウィザードで決める、
// デスマッチの初期ライフ(parseDeathmatchRules)とは別の名前空間 — 同じ `rules` 列に同居するので、
// 書き込み側は必ず既存の名前空間を残したままマージすること(deathmatch.ts 参照)。

export const GLOVE_LEVELS = ["NONE", "ONE", "TWO", "THREE", "FREE"] as const;
export type GloveLevel = (typeof GLOVE_LEVELS)[number];

export const BOOSTER_LEVELS = ["NONE", "ONE_EACH", "TWO_EACH", "FREE"] as const;
export type BoosterLevel = (typeof BOOSTER_LEVELS)[number];

export const VIOLATION_HANDLINGS = ["DISQUALIFY", "REVIEW", "WARNING_ONLY"] as const;
export type ViolationHandling = (typeof VIOLATION_HANDLINGS)[number];

export const RETRY_LEVELS = ["NONE", "FIRST_X3", "SPICHA_X3"] as const;
export type RetryLevel = (typeof RETRY_LEVELS)[number];

export const WIN_CONDITIONS = ["SINGLE", "BEST_OF_THREE"] as const;
export type WinCondition = (typeof WIN_CONDITIONS)[number];

export type MatchRules = {
  winCondition: WinCondition;
  glove: GloveLevel;
  booster: BoosterLevel;
  bonusTime: boolean;
  mist: boolean;
  violation: ViolationHandling;
  retry: RetryLevel;
};

export const MATCH_RULES_DEFAULT: MatchRules = {
  winCondition: "SINGLE",
  glove: "NONE",
  booster: "NONE",
  bonusTime: false,
  mist: false,
  violation: "DISQUALIFY",
  retry: "NONE",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `Event.rules` が "matchRules" 名前空間を持つか。持たないイベントに既定値をでっち上げて
 * 表示しない(主催者が決めていない禁止事項を公開ページに出さない)ための判定。 */
export function hasMatchRules(rules: unknown): boolean {
  return isPlainObject(rules) && isPlainObject(rules.matchRules);
}

/** `Event.rules` の "matchRules" キーを読む。不正値・欠損は既定へ丸める(エラーにしない)。 */
export function parseMatchRules(rules: unknown): MatchRules {
  const source = isPlainObject(rules) && isPlainObject(rules.matchRules) ? rules.matchRules : {};

  const winCondition = WIN_CONDITIONS.includes(source.winCondition as WinCondition)
    ? (source.winCondition as WinCondition)
    : MATCH_RULES_DEFAULT.winCondition;
  const glove = GLOVE_LEVELS.includes(source.glove as GloveLevel)
    ? (source.glove as GloveLevel)
    : MATCH_RULES_DEFAULT.glove;
  const booster = BOOSTER_LEVELS.includes(source.booster as BoosterLevel)
    ? (source.booster as BoosterLevel)
    : MATCH_RULES_DEFAULT.booster;
  const bonusTime = typeof source.bonusTime === "boolean" ? source.bonusTime : MATCH_RULES_DEFAULT.bonusTime;
  const mist = typeof source.mist === "boolean" ? source.mist : MATCH_RULES_DEFAULT.mist;
  const violation = VIOLATION_HANDLINGS.includes(source.violation as ViolationHandling)
    ? (source.violation as ViolationHandling)
    : MATCH_RULES_DEFAULT.violation;
  const retry = RETRY_LEVELS.includes(source.retry as RetryLevel)
    ? (source.retry as RetryLevel)
    : MATCH_RULES_DEFAULT.retry;

  return { winCondition, glove, booster, bonusTime, mist, violation, retry };
}

/** 勝利条件から、対戦カード1件が成立しうる最大試合数と先取本数を導く。 */
export function seriesRequirement(winCondition: WinCondition): {
  maxGames: number;
  winsNeeded: number;
} {
  switch (winCondition) {
    case "SINGLE":
      return { maxGames: 1, winsNeeded: 1 };
    case "BEST_OF_THREE":
      return { maxGames: 3, winsNeeded: 2 };
  }
}
