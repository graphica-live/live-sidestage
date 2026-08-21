import { describe, it, expect } from "vitest";
import {
  ANALYTICS_MAX_LEASE_DAYS,
  LEASE_GRACE_MS,
  computeLeaseWindow,
} from "./room-lease";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("computeLeaseWindow", () => {
  const now = new Date("2026-09-01T00:00:00.000Z");

  it("イベント終了の24時間後までを監視期限にする", () => {
    const endAt = new Date("2026-09-10T12:00:00.000Z");
    const w = computeLeaseWindow(endAt, now);

    expect(w.requested.getTime()).toBe(endAt.getTime() + LEASE_GRACE_MS);
    expect(w.granted).toEqual(w.requested);
    expect(w.clamped).toBe(false);
  });

  it("終了が遠すぎる場合はanalyticsの上限まで切り詰め、本来の期限は保持する", () => {
    // 上限(120日)を確実に超える終了日時
    const endAt = new Date(now.getTime() + 200 * DAY_MS);
    const w = computeLeaseWindow(endAt, now);

    expect(w.clamped).toBe(true);
    expect(w.granted.getTime()).toBe(now.getTime() + ANALYTICS_MAX_LEASE_DAYS * DAY_MS);
    // 本来必要な期限は切り詰めない(将来の再要求に使う)
    expect(w.requested.getTime()).toBe(endAt.getTime() + LEASE_GRACE_MS);
    expect(w.granted.getTime()).toBeLessThan(w.requested.getTime());
  });

  it("猶予を足した結果がちょうど上限なら切り詰めない", () => {
    // requested === maxUntil になるように終了日時を逆算する
    const endAt = new Date(now.getTime() + ANALYTICS_MAX_LEASE_DAYS * DAY_MS - LEASE_GRACE_MS);
    const w = computeLeaseWindow(endAt, now);

    expect(w.clamped).toBe(false);
    expect(w.granted.getTime()).toBe(now.getTime() + ANALYTICS_MAX_LEASE_DAYS * DAY_MS);
  });

  it("上限を1ミリ秒でも超えたら切り詰める", () => {
    const endAt = new Date(
      now.getTime() + ANALYTICS_MAX_LEASE_DAYS * DAY_MS - LEASE_GRACE_MS + 1
    );
    const w = computeLeaseWindow(endAt, now);

    expect(w.clamped).toBe(true);
    expect(w.granted.getTime()).toBe(now.getTime() + ANALYTICS_MAX_LEASE_DAYS * DAY_MS);
  });

  it("すでに終了しているイベントでも猶予の分だけ未来の期限になる", () => {
    const endAt = new Date(now.getTime() - 1000);
    const w = computeLeaseWindow(endAt, now);

    expect(w.clamped).toBe(false);
    expect(w.granted.getTime()).toBeGreaterThan(now.getTime());
  });
});
