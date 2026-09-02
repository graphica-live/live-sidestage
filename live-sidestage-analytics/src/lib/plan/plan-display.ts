import type { PlanTier } from "./types";

export interface PlanDisplay {
  plan: PlanTier;
  betaActive: boolean;
  /** UIにそのまま出す表示文字列。βactiveなら"β"を前置する。この文字列組み立ての唯一の正本。 */
  label: string;
}

export function getPlanDisplay(plan: PlanTier, betaActive: boolean): PlanDisplay {
  return {
    plan,
    betaActive,
    label: betaActive ? `β${plan}` : plan,
  };
}
