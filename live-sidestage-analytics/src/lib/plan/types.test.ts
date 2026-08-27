import { describe, it, expect } from "vitest";
import { meetsPlan } from "./types";

describe("meetsPlan", () => {
  it("同じプラン同士は満たす", () => {
    expect(meetsPlan("FREE", "FREE")).toBe(true);
    expect(meetsPlan("PRO", "PRO")).toBe(true);
    expect(meetsPlan("ULTRA", "ULTRA")).toBe(true);
  });

  it("上位プランは下位の要求を満たす", () => {
    expect(meetsPlan("PRO", "FREE")).toBe(true);
    expect(meetsPlan("ULTRA", "FREE")).toBe(true);
    expect(meetsPlan("ULTRA", "PRO")).toBe(true);
  });

  it("下位プランは上位の要求を満たさない", () => {
    expect(meetsPlan("FREE", "PRO")).toBe(false);
    expect(meetsPlan("FREE", "ULTRA")).toBe(false);
    expect(meetsPlan("PRO", "ULTRA")).toBe(false);
  });
});
