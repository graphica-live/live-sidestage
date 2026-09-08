import { describe, it, expect } from "vitest";
import {
  classifyExistenceResult,
  isCleanupDisabled,
  NOT_FOUND_STREAK_REQUIRED,
  NOT_FOUND_ELAPSED_MS,
} from "./tiktok-room-cleanup";
import type { TiktokProfileResult } from "./tiktok-profile";

const NOW = new Date("2026-08-23T12:00:00.000Z");

const OK: TiktokProfileResult = {
  ok: true,
  profile: { avatarUrl: "https://p16.tiktokcdn.com/x", nickname: null, tiktokUid: null },
};
const NOT_FOUND: TiktokProfileResult = { ok: false, reason: "NOT_FOUND" };
/** TikTok が user_not_found を明示した NOT_FOUND。 */
const NOT_FOUND_EXPLICIT: TiktokProfileResult = {
  ok: false,
  reason: "NOT_FOUND",
  explicitNotFound: true,
};
const RATE_LIMITED: TiktokProfileResult = { ok: false, reason: "RATE_LIMITED" };
const ERROR: TiktokProfileResult = { ok: false, reason: "ERROR" };

describe("classifyExistenceResult", () => {
  it("ok:trueならストリークを0/nullにリセットする", () => {
    const c = classifyExistenceResult({ notFoundStreak: 2, notFoundFirstAt: NOW }, OK, NOW);
    expect(c).toEqual({
      notFoundStreak: 0,
      notFoundFirstAt: null,
      outcome: "exists",
      shouldSuspend: false,
    });
  });

  it("NOT_FOUND初回はstreak=1・firstAt=nowになり、shouldSuspendはfalse", () => {
    const c = classifyExistenceResult({ notFoundStreak: 0, notFoundFirstAt: null }, NOT_FOUND, NOW);
    expect(c.notFoundStreak).toBe(1);
    expect(c.notFoundFirstAt).toEqual(NOW);
    expect(c.outcome).toBe("not_found");
    expect(c.shouldSuspend).toBe(false);
  });

  it("streak要件未達なら経過日数が十分でもshouldSuspend=false", () => {
    const firstAt = new Date(NOW.getTime() - NOT_FOUND_ELAPSED_MS - 1000);
    const c = classifyExistenceResult(
      { notFoundStreak: NOT_FOUND_STREAK_REQUIRED - 2, notFoundFirstAt: firstAt },
      NOT_FOUND,
      NOW
    );
    expect(c.notFoundStreak).toBe(NOT_FOUND_STREAK_REQUIRED - 1);
    expect(c.shouldSuspend).toBe(false);
  });

  it("streak要件は満たすが経過日数が不足していればshouldSuspend=false", () => {
    const firstAt = new Date(NOW.getTime() - NOT_FOUND_ELAPSED_MS + 1000);
    const c = classifyExistenceResult(
      { notFoundStreak: NOT_FOUND_STREAK_REQUIRED - 1, notFoundFirstAt: firstAt },
      NOT_FOUND,
      NOW
    );
    expect(c.notFoundStreak).toBe(NOT_FOUND_STREAK_REQUIRED);
    expect(c.shouldSuspend).toBe(false);
  });

  it("streak要件を満たしかつ経過日数もちょうど閾値ならshouldSuspend=true(境界含む)", () => {
    const firstAt = new Date(NOW.getTime() - NOT_FOUND_ELAPSED_MS);
    const c = classifyExistenceResult(
      { notFoundStreak: NOT_FOUND_STREAK_REQUIRED - 1, notFoundFirstAt: firstAt },
      NOT_FOUND,
      NOW
    );
    expect(c.notFoundStreak).toBe(NOT_FOUND_STREAK_REQUIRED);
    expect(c.shouldSuspend).toBe(true);
  });

  it("streak要件・経過日数とも十分に満たせばshouldSuspend=true", () => {
    const firstAt = new Date(NOW.getTime() - NOT_FOUND_ELAPSED_MS * 2);
    const c = classifyExistenceResult(
      { notFoundStreak: NOT_FOUND_STREAK_REQUIRED, notFoundFirstAt: firstAt },
      NOT_FOUND,
      NOW
    );
    expect(c.shouldSuspend).toBe(true);
  });

  it("RATE_LIMITEDは判定不能としてstreak/firstAtを変化させない", () => {
    const current = { notFoundStreak: 2, notFoundFirstAt: NOW };
    const c = classifyExistenceResult(current, RATE_LIMITED, NOW);
    expect(c).toEqual({
      ...current,
      outcome: "inconclusive",
      shouldSuspend: false,
    });
  });

  it("ERRORは判定不能としてstreak/firstAtを変化させない", () => {
    const current = { notFoundStreak: 1, notFoundFirstAt: NOW };
    const c = classifyExistenceResult(current, ERROR, NOW);
    expect(c).toEqual({
      ...current,
      outcome: "inconclusive",
      shouldSuspend: false,
    });
  });

  // TikTok が user_not_found を明示したかどうかで判定を変えない。唯一の消費者だった
  // hostTiktokUid の補完 give-up は、room の同一性が uid になったことで廃止済み。
  it("user_not_foundの明示有無で判定は変わらない(give-up廃止の回帰)", () => {
    const current = { notFoundStreak: 0, notFoundFirstAt: null };

    expect(classifyExistenceResult(current, NOT_FOUND_EXPLICIT, NOW)).toEqual(
      classifyExistenceResult(current, NOT_FOUND, NOW)
    );
  });

  it("2回目以降のNOT_FOUNDはfirstAtを更新せず引き継ぐ", () => {
    const firstAt = new Date(NOW.getTime() - 60_000);
    const c = classifyExistenceResult({ notFoundStreak: 1, notFoundFirstAt: firstAt }, NOT_FOUND, NOW);
    expect(c.notFoundStreak).toBe(2);
    expect(c.notFoundFirstAt).toEqual(firstAt);
  });
});

describe("isCleanupDisabled", () => {
  it('"true"のときだけ無効', () => {
    expect(isCleanupDisabled("true")).toBe(true);
    expect(isCleanupDisabled("false")).toBe(false);
    expect(isCleanupDisabled(null)).toBe(false);
    expect(isCleanupDisabled("")).toBe(false);
  });
});
