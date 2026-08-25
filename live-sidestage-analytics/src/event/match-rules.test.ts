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
        matchRules: {
          winCondition: "UNKNOWN",
          glove: "UNKNOWN",
          booster: 123,
          bonusTime: "yes",
          mist: 1,
          violation: "???",
          retry: "UNKNOWN",
        },
      })
    ).toEqual(MATCH_RULES_DEFAULT);
  });

  it("deathmatch名前空間と混在していてもmatchRulesだけを読む", () => {
    const result = parseMatchRules({
      deathmatch: { initialLife: 3 },
      matchRules: {
        winCondition: "BEST_OF_THREE",
        glove: "TWO",
        booster: "ONE_EACH",
        bonusTime: true,
        mist: true,
        violation: "REVIEW",
        retry: "FIRST_X3",
      },
    });
    expect(result).toEqual({
      winCondition: "BEST_OF_THREE",
      glove: "TWO",
      booster: "ONE_EACH",
      bonusTime: true,
      mist: true,
      violation: "REVIEW",
      retry: "FIRST_X3",
    });
  });

  it("部分的に正しい値は活かし、不正な項目だけ既定に落とす", () => {
    const result = parseMatchRules({ matchRules: { glove: "FREE", violation: "not-a-choice" } });
    expect(result.glove).toBe("FREE");
    expect(result.violation).toBe(MATCH_RULES_DEFAULT.violation);
    expect(result.booster).toBe(MATCH_RULES_DEFAULT.booster);
    expect(result.retry).toBe(MATCH_RULES_DEFAULT.retry);
  });

  it("retryはSPICHA_X3も受け付ける", () => {
    const result = parseMatchRules({ matchRules: { retry: "SPICHA_X3" } });
    expect(result.retry).toBe("SPICHA_X3");
  });
});
