import { describe, it, expect } from "vitest";
import { MATCH_RULES_DEFAULT, hasMatchRules, parseMatchRules } from "./match-rules";

describe("hasMatchRules", () => {
  it("matchRules名前空間が無いイベントはfalse(既定値をでっち上げない)", () => {
    expect(hasMatchRules({})).toBe(false);
    expect(hasMatchRules(null)).toBe(false);
    expect(hasMatchRules({ deathmatch: { initialLife: 3 } })).toBe(false);
  });

  it("matchRules名前空間があればtrue", () => {
    expect(hasMatchRules({ matchRules: {} })).toBe(true);
  });
});

describe("parseMatchRules", () => {
  it("欠損・不正値は既定へ丸める", () => {
    expect(parseMatchRules(null)).toEqual(MATCH_RULES_DEFAULT);
    expect(parseMatchRules({})).toEqual(MATCH_RULES_DEFAULT);
    expect(
      parseMatchRules({
        matchRules: { glove: "UNKNOWN", booster: 123, bonusTime: "yes", mist: 1, violation: "???" },
      })
    ).toEqual(MATCH_RULES_DEFAULT);
  });

  it("deathmatch名前空間と混在していてもmatchRulesだけを読む", () => {
    const result = parseMatchRules({
      deathmatch: { initialLife: 3 },
      matchRules: { glove: "TWO", booster: "ONE_EACH", bonusTime: true, mist: true, violation: "REVIEW" },
    });
    expect(result).toEqual({
      glove: "TWO",
      booster: "ONE_EACH",
      bonusTime: true,
      mist: true,
      violation: "REVIEW",
    });
  });

  it("部分的に正しい値は活かし、不正な項目だけ既定に落とす", () => {
    const result = parseMatchRules({ matchRules: { glove: "FREE", violation: "not-a-choice" } });
    expect(result.glove).toBe("FREE");
    expect(result.violation).toBe(MATCH_RULES_DEFAULT.violation);
    expect(result.booster).toBe(MATCH_RULES_DEFAULT.booster);
  });
});
