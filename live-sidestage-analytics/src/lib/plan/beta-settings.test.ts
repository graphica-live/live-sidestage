import { describe, it, expect } from "vitest";
import { parseBetaEnabled, BETA_AREAS } from "./beta-settings";

describe("parseBetaEnabled", () => {
  it("'true'のみ有効", () => {
    expect(parseBetaEnabled("true")).toBe(true);
  });

  it.each([null, "", "false", "TRUE", "1", "yes", " true", "true "])(
    "%s は無効(fail-closed)",
    (value) => {
      expect(parseBetaEnabled(value)).toBe(false);
    },
  );
});

describe("BETA_AREAS", () => {
  it("mobile/analytics/events/agencyの4領域を持つ", () => {
    expect(BETA_AREAS).toEqual(["mobile", "analytics", "events", "agency"]);
  });
});
