import { describe, it, expect } from "vitest";
import {
  checkTiktokHandleChangeAllowed,
  checkTiktokUidMatch,
  formatTiktokHandleLockError,
  isTiktokUidMismatchCheckDisabled,
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

describe("isTiktokUidMismatchCheckDisabled", () => {
  const ENV_KEY = "TIKTOK_UID_MISMATCH_CHECK_DISABLED";

  it("未設定(既定)のときは無効化(true)を返す", () => {
    const original = process.env[ENV_KEY];
    try {
      delete process.env[ENV_KEY];
      expect(isTiktokUidMismatchCheckDisabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = original;
    }
  });

  it('"0"を明示したときだけ有効化(false)になる', () => {
    const original = process.env[ENV_KEY];
    try {
      process.env[ENV_KEY] = "0";
      expect(isTiktokUidMismatchCheckDisabled()).toBe(false);

      // "0"以外の値(例: "1"、空文字、空白)は既定と同じく無効化のまま。設定ミスで
      // 意図せず有効化(false)側へ倒れないことを確認する。
      process.env[ENV_KEY] = "1";
      expect(isTiktokUidMismatchCheckDisabled()).toBe(true);

      process.env[ENV_KEY] = "";
      expect(isTiktokUidMismatchCheckDisabled()).toBe(true);

      process.env[ENV_KEY] = " ";
      expect(isTiktokUidMismatchCheckDisabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = original;
    }
  });
});

describe("checkTiktokUidMatch", () => {
  const ENV_KEY = "TIKTOK_UID_MISMATCH_CHECK_DISABLED";

  function withEnv<T>(value: string | undefined, fn: () => T): T {
    const original = process.env[ENV_KEY];
    try {
      if (value === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = value;
      return fn();
    } finally {
      if (original === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = original;
    }
  }

  it("exempt:true なら、チェック有効時でもtiktokUidが不一致でも常に許可する(判定順序: exemptが最優先)", () => {
    const result = withEnv("0", () =>
      checkTiktokUidMatch({ tiktokUid: "uid-a" }, "uid-b", { exempt: true })
    );
    expect(result.ok).toBe(true);
  });

  it("exempt:false かつ既定(未設定=無効化)状態では、tiktokUidが不一致でも許可する", () => {
    const result = withEnv(undefined, () =>
      checkTiktokUidMatch({ tiktokUid: "uid-a" }, "uid-b", { exempt: false })
    );
    expect(result.ok).toBe(true);
  });

  it('exempt:false かつチェック有効時("0")は、tiktokUidが不一致なら拒否する', () => {
    const result = withEnv("0", () =>
      checkTiktokUidMatch({ tiktokUid: "uid-a" }, "uid-b", { exempt: false })
    );
    expect(result.ok).toBe(false);
  });

  it('exempt:false かつチェック有効時("0")でも、tiktokUidが一致すれば許可する', () => {
    const result = withEnv("0", () =>
      checkTiktokUidMatch({ tiktokUid: "uid-a" }, "uid-a", { exempt: false })
    );
    expect(result.ok).toBe(true);
  });
});
