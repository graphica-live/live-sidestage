import { describe, it, expect } from "vitest";
import {
  checkTiktokHandleChangeAllowed,
  formatTiktokHandleLockError,
  TIKTOK_ID_CHANGE_LOCK_DAYS,
} from "./tiktok-id-lock";

describe("checkTiktokHandleChangeAllowed", () => {
  const LOCK_MS = TIKTOK_ID_CHANGE_LOCK_DAYS * 24 * 60 * 60 * 1000;

  it("正規化後の値が同じなら常に許可する(冪等リトライ)", () => {
    const now = new Date("2026-09-07T00:00:00Z");
    const result = checkTiktokHandleChangeAllowed(
      { normalizedTiktokHandle: "same_id", tiktokHandleChangedAt: now },
      "same_id",
      now
    );
    expect(result.ok).toBe(true);
  });

  it("tiktokHandleChangedAtがnull(migration前の既存streamer)なら常に許可する", () => {
    const now = new Date("2026-09-07T00:00:00Z");
    const result = checkTiktokHandleChangeAllowed(
      { normalizedTiktokHandle: "old_id", tiktokHandleChangedAt: null },
      "new_id",
      now
    );
    expect(result.ok).toBe(true);
  });

  it("7日未満(直前、6日23時間59分59秒)はロック中として拒否する", () => {
    const changedAt = new Date("2026-09-01T00:00:00Z");
    const now = new Date(changedAt.getTime() + LOCK_MS - 1000);
    const result = checkTiktokHandleChangeAllowed(
      { normalizedTiktokHandle: "old_id", tiktokHandleChangedAt: changedAt },
      "new_id",
      now
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryAfter.getTime()).toBe(changedAt.getTime() + LOCK_MS);
    }
  });

  it("ちょうど7日経過した瞬間は許可する", () => {
    const changedAt = new Date("2026-09-01T00:00:00Z");
    const now = new Date(changedAt.getTime() + LOCK_MS);
    const result = checkTiktokHandleChangeAllowed(
      { normalizedTiktokHandle: "old_id", tiktokHandleChangedAt: changedAt },
      "new_id",
      now
    );
    expect(result.ok).toBe(true);
  });

  it("7日経過直後は許可する", () => {
    const changedAt = new Date("2026-09-01T00:00:00Z");
    const now = new Date(changedAt.getTime() + LOCK_MS + 1000);
    const result = checkTiktokHandleChangeAllowed(
      { normalizedTiktokHandle: "old_id", tiktokHandleChangedAt: changedAt },
      "new_id",
      now
    );
    expect(result.ok).toBe(true);
  });
});

describe("formatTiktokHandleLockError", () => {
  it("残り日数を切り上げで返す", () => {
    const now = new Date("2026-09-07T00:00:00Z");
    const retryAfter = new Date(now.getTime() + 1.5 * 24 * 60 * 60 * 1000);
    const result = formatTiktokHandleLockError(retryAfter, now);
    expect(result.code).toBe("TIKTOK_ID_CHANGE_LOCKED");
    expect(result.retryAfter).toBe(retryAfter.toISOString());
    expect(result.error).toContain("あと2日");
  });

  it("残り日数が1日未満でも最低1日と表示する", () => {
    const now = new Date("2026-09-07T00:00:00Z");
    const retryAfter = new Date(now.getTime() + 1000);
    const result = formatTiktokHandleLockError(retryAfter, now);
    expect(result.error).toContain("あと1日");
  });
});
