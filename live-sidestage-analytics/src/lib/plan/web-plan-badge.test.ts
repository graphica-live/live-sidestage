import { describe, expect, it, vi, beforeEach } from "vitest";
import { getWebPlanBadgeDisplay, WEB_PLAN_BADGE_AREA } from "./web-plan-badge";

const getUserPlan = vi.fn();
const getBetaStatuses = vi.fn();

vi.mock("./get-user-plan", () => ({
  getUserPlan: (...args: unknown[]) => getUserPlan(...args),
}));

vi.mock("./beta-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./beta-settings")>();
  return {
    ...actual,
    getBetaStatuses: (...args: unknown[]) => getBetaStatuses(...args),
  };
});

describe("WEB_PLAN_BADGE_AREA", () => {
  it("overlaysはanalytics領域を共有する", () => {
    expect(WEB_PLAN_BADGE_AREA.overlays).toBe("analytics");
  });

  it("billingはβ前置きしない", () => {
    expect(WEB_PLAN_BADGE_AREA.billing).toBeNull();
  });
});

describe("getWebPlanBadgeDisplay", () => {
  beforeEach(() => {
    getUserPlan.mockReset();
    getBetaStatuses.mockReset();
  });

  it("analyticsβ有効時はplanLabelにβを付ける", async () => {
    getUserPlan.mockResolvedValue("FREE");
    getBetaStatuses.mockResolvedValue({ analytics: true });

    const display = await getWebPlanBadgeDisplay("principal-1", "analytics");
    expect(display).toEqual({ plan: "FREE", betaActive: true, label: "βFREE" });
    expect(getBetaStatuses).toHaveBeenCalledWith(["analytics"]);
  });

  it("billingはβ状態に関わらずβを付けない", async () => {
    getUserPlan.mockResolvedValue("FREE");
    getBetaStatuses.mockResolvedValue({ analytics: true });

    const display = await getWebPlanBadgeDisplay("principal-1", "billing");
    expect(display).toEqual({ plan: "FREE", betaActive: false, label: "FREE" });
    expect(getBetaStatuses).not.toHaveBeenCalled();
  });
});
