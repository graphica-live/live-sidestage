import { describe, it, expect } from "vitest";
import {
  clampOverlayDisplaySpeed,
  OVERLAY_DISPLAY_SPEED_MIN,
  OVERLAY_DISPLAY_SPEED_MAX,
  OVERLAY_DISPLAY_SPEED_DEFAULT,
} from "./contracts";

describe("clampOverlayDisplaySpeed", () => {
  it("範囲内の値はそのまま返す", () => {
    expect(clampOverlayDisplaySpeed(3)).toBe(3);
  });

  it("最小値未満は最小値にクランプする", () => {
    expect(clampOverlayDisplaySpeed(0)).toBe(OVERLAY_DISPLAY_SPEED_MIN);
    expect(clampOverlayDisplaySpeed(-10)).toBe(OVERLAY_DISPLAY_SPEED_MIN);
  });

  it("最大値超過は最大値にクランプする", () => {
    expect(clampOverlayDisplaySpeed(10)).toBe(OVERLAY_DISPLAY_SPEED_MAX);
  });

  it("小数は丸める", () => {
    expect(clampOverlayDisplaySpeed(2.6)).toBe(3);
  });

  it("NaN/Infinityはデフォルト値3にフォールバックする", () => {
    expect(OVERLAY_DISPLAY_SPEED_DEFAULT).toBe(3);
    expect(clampOverlayDisplaySpeed(NaN)).toBe(3);
    expect(clampOverlayDisplaySpeed(Infinity)).toBe(3);
  });
});
