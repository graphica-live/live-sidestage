import { describe, it, expect } from "vitest";
import { getPlanDisplay } from "./plan-display";
import type { PlanTier } from "./types";

const PLANS: PlanTier[] = ["FREE", "PRO", "ULTRA"];

describe("getPlanDisplay", () => {
  it.each(PLANS)("β無効時は%sそのまま", (plan) => {
    expect(getPlanDisplay(plan, false)).toEqual({ plan, betaActive: false, label: plan });
  });

  it.each(PLANS)("β有効時はβ%sになる", (plan) => {
    expect(getPlanDisplay(plan, true)).toEqual({ plan, betaActive: true, label: `β${plan}` });
  });
});
