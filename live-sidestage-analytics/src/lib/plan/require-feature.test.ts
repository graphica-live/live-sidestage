import { describe, it, expect, vi, beforeEach } from "vitest";

const getEffectiveMobilePlan = vi.fn();
vi.mock("./effective-mobile-plan", () => ({
  getEffectiveMobilePlan: (...args: unknown[]) => getEffectiveMobilePlan(...args),
}));

import { requireFeature, hasFeatureAccess } from "./require-feature";
import { FEATURE_REQUIREMENTS, type FeatureKey } from "./features";

const PROBE_FEATURE = Object.keys(FEATURE_REQUIREMENTS)[0] as FeatureKey;

beforeEach(() => {
  getEffectiveMobilePlan.mockReset();
});

describe("requireFeature", () => {
  it("権限があればnullを返す(通過)", async () => {
    getEffectiveMobilePlan.mockResolvedValue({ plan: "ULTRA", betaAccess: true });

    const result = await requireFeature("user_1", PROBE_FEATURE);

    expect(result).toBeNull();
  });

  it("権限が無ければ403を返す", async () => {
    getEffectiveMobilePlan.mockResolvedValue({ plan: "FREE", betaAccess: false });

    const result = await requireFeature("user_1", PROBE_FEATURE);

    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });
});

describe("hasFeatureAccess", () => {
  it("planとallowedを返す", async () => {
    getEffectiveMobilePlan.mockResolvedValue({ plan: "PRO", betaAccess: false });

    const result = await hasFeatureAccess("user_1", PROBE_FEATURE);

    expect(result).toEqual({ allowed: true, plan: "PRO" });
  });
});
