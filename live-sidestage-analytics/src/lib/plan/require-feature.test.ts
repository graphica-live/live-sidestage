import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserPlan = vi.fn();
vi.mock("./get-user-plan", () => ({
  getUserPlan: (...args: unknown[]) => getUserPlan(...args),
}));

const isBetaEnabled = vi.fn();
vi.mock("./beta-settings", () => ({
  isBetaEnabled: (...args: unknown[]) => isBetaEnabled(...args),
}));

import { requireFeature, hasFeatureAccess } from "./require-feature";
import { FEATURE_POLICIES, type FeatureKey } from "./features";

const PROBE_FEATURE = Object.keys(FEATURE_POLICIES)[0] as FeatureKey;
const ANALYTICS_BETA_FEATURE: FeatureKey = "mobile.history.extendedRange";

beforeEach(() => {
  getUserPlan.mockReset();
  isBetaEnabled.mockReset();
});

describe("requireFeature", () => {
  it("プランが要求を満たせばnullを返す(通過)", async () => {
    getUserPlan.mockResolvedValue("ULTRA");

    const result = await requireFeature("user_1", PROBE_FEATURE);

    expect(result).toBeNull();
    expect(isBetaEnabled).not.toHaveBeenCalled();
  });

  it("権限が無ければ403を返す", async () => {
    getUserPlan.mockResolvedValue("FREE");
    isBetaEnabled.mockResolvedValue(false);

    const result = await requireFeature("user_1", PROBE_FEATURE);

    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });
});

describe("hasFeatureAccess", () => {
  it("planとallowedを返す(プランで許可)", async () => {
    getUserPlan.mockResolvedValue("PRO");

    const result = await hasFeatureAccess("user_1", PROBE_FEATURE);

    expect(result).toEqual({ allowed: true, plan: "PRO" });
  });

  it("実プランは書き換えない: β有効でもplanはFREEのまま返る", async () => {
    getUserPlan.mockResolvedValue("FREE");
    isBetaEnabled.mockResolvedValue(true);

    const result = await hasFeatureAccess("user_1", ANALYTICS_BETA_FEATURE);

    expect(result).toEqual({ allowed: true, plan: "FREE" });
    expect(isBetaEnabled).toHaveBeenCalledWith("analytics");
  });

  it("対応するβ領域が無効ならプラン不足のまま不許可", async () => {
    getUserPlan.mockResolvedValue("FREE");
    isBetaEnabled.mockResolvedValue(false);

    const result = await hasFeatureAccess("user_1", ANALYTICS_BETA_FEATURE);

    expect(result).toEqual({ allowed: false, plan: "FREE" });
  });

  it("betaArea未設定の機能はisBetaEnabledを呼ばずに不許可", async () => {
    getUserPlan.mockResolvedValue("FREE");

    const result = await hasFeatureAccess("user_1", PROBE_FEATURE);

    expect(result).toEqual({ allowed: false, plan: "FREE" });
    expect(isBetaEnabled).not.toHaveBeenCalled();
  });
});
