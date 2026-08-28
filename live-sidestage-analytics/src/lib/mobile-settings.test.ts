import { describe, it, expect } from "vitest";
import {
  parseMobileBetaEnabled,
  parseMobileMinSupportedVersion,
  parseMobileMaintenanceMode,
} from "./mobile-settings";

describe("parseMobileBetaEnabled", () => {
  it("'true'のみ有効", () => {
    expect(parseMobileBetaEnabled("true")).toBe(true);
  });

  it.each([null, "", "false", "TRUE", "1", "yes", " true", "true "])(
    "%s は無効(fail-closed)",
    (value) => {
      expect(parseMobileBetaEnabled(value)).toBe(false);
    },
  );
});

describe("parseMobileMinSupportedVersion", () => {
  it("未設定・空文字は0.0.0(常に許可)", () => {
    expect(parseMobileMinSupportedVersion(null)).toBe("0.0.0");
    expect(parseMobileMinSupportedVersion("")).toBe("0.0.0");
    expect(parseMobileMinSupportedVersion("   ")).toBe("0.0.0");
  });

  it("設定値をtrimして返す", () => {
    expect(parseMobileMinSupportedVersion(" 1.2.3 ")).toBe("1.2.3");
  });
});

describe("parseMobileMaintenanceMode", () => {
  it("'true'のみ有効", () => {
    expect(parseMobileMaintenanceMode("true")).toBe(true);
  });

  it.each([null, "", "false", "TRUE"])("%s は無効", (value) => {
    expect(parseMobileMaintenanceMode(value)).toBe(false);
  });
});
