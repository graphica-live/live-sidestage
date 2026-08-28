import { describe, it, expect, vi, beforeEach } from "vitest";

const isMobileBetaEnabled = vi.fn();
vi.mock("../mobile-settings", () => ({
  isMobileBetaEnabled: () => isMobileBetaEnabled(),
}));

const getUserPlan = vi.fn();
vi.mock("./get-user-plan", () => ({
  getUserPlan: (...args: unknown[]) => getUserPlan(...args),
}));

import { getEffectiveMobilePlan } from "./effective-mobile-plan";

beforeEach(() => {
  isMobileBetaEnabled.mockReset();
  getUserPlan.mockReset();
});

describe("getEffectiveMobilePlan", () => {
  it("β有効時はSubscriptionを見ずにULTRAへ収束する", async () => {
    isMobileBetaEnabled.mockResolvedValue(true);

    const result = await getEffectiveMobilePlan("user_1");

    expect(result).toEqual({ plan: "ULTRA", betaAccess: true });
    expect(getUserPlan).not.toHaveBeenCalled();
  });

  it("β無効時は既存のgetUserPlan()の結果をそのまま使う", async () => {
    isMobileBetaEnabled.mockResolvedValue(false);
    getUserPlan.mockResolvedValue("PRO");

    const result = await getEffectiveMobilePlan("user_1");

    expect(result).toEqual({ plan: "PRO", betaAccess: false });
    expect(getUserPlan).toHaveBeenCalledWith("user_1");
  });

  it("β無効かつSubscription無しはFREE", async () => {
    isMobileBetaEnabled.mockResolvedValue(false);
    getUserPlan.mockResolvedValue("FREE");

    const result = await getEffectiveMobilePlan("user_1");

    expect(result).toEqual({ plan: "FREE", betaAccess: false });
  });
});
