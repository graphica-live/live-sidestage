import { describe, it, expect } from "vitest";
import { hasBattleSubscriber, type BattleSubscriptionRoom } from "./battle-subscription";

const now = new Date("2026-09-09T00:00:00Z");

function baseRoom(overrides: Partial<BattleSubscriptionRoom> = {}): BattleSubscriptionRoom {
  return {
    streamerCount: 0,
    watchCount: 0,
    specialWatch: false,
    monitorUntil: null,
    ...overrides,
  };
}

describe("hasBattleSubscriber", () => {
  it("returns false when no condition is met (匿名監視roomのみ)", () => {
    expect(hasBattleSubscriber(baseRoom(), now)).toBe(false);
  });

  it("returns true when streamerCount > 0", () => {
    expect(hasBattleSubscriber(baseRoom({ streamerCount: 1 }), now)).toBe(true);
  });

  it("returns true when watchCount > 0", () => {
    expect(hasBattleSubscriber(baseRoom({ watchCount: 1 }), now)).toBe(true);
  });

  it("returns true when specialWatch is true", () => {
    expect(hasBattleSubscriber(baseRoom({ specialWatch: true }), now)).toBe(true);
  });

  it("returns true when monitorUntil is in the future", () => {
    const future = new Date(now.getTime() + 60_000);
    expect(hasBattleSubscriber(baseRoom({ monitorUntil: future }), now)).toBe(true);
  });

  it("returns false when monitorUntil is in the past", () => {
    const past = new Date(now.getTime() - 60_000);
    expect(hasBattleSubscriber(baseRoom({ monitorUntil: past }), now)).toBe(false);
  });

  it("returns false when monitorUntil equals now (境界、未来ではない)", () => {
    expect(hasBattleSubscriber(baseRoom({ monitorUntil: now }), now)).toBe(false);
  });

  it("returns true when multiple conditions are met", () => {
    expect(
      hasBattleSubscriber(baseRoom({ streamerCount: 1, specialWatch: true }), now)
    ).toBe(true);
  });
});
