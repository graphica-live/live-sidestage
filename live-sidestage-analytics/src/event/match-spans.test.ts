import { describe, it, expect } from "vitest";
import { resolveMatchSpans } from "./match-spans";
import type { EventWindow } from "./sessions";

const T = (iso: string) => new Date(iso);

/** 1日目 22:00-23:00 / 2日目 22:00-23:00 (JST 相当の UTC で書く)。 */
const WINDOWS: EventWindow[] = [
  { id: "s1", start: T("2026-09-01T13:00:00.000Z"), end: T("2026-09-01T14:00:00.000Z"), name: null },
  { id: "s2", start: T("2026-09-02T13:00:00.000Z"), end: T("2026-09-02T14:00:00.000Z"), name: null },
];

const NOW = T("2026-09-01T13:30:00.000Z");

describe("resolveMatchSpans", () => {
  it("バトルを検知していない対戦は no-detection", () => {
    const result = resolveMatchSpans(
      { status: "SCHEDULED", detectedStartAt: null, detectedEndAt: null },
      WINDOWS,
      NOW
    );
    expect(result.status).toBe("no-detection");
  });

  it("終了を観測できていない非LIVEの対戦は no-end（日程の終端まで数えない）", () => {
    const result = resolveMatchSpans(
      {
        status: "NEEDS_REVIEW",
        detectedStartAt: T("2026-09-01T13:05:00.000Z"),
        detectedEndAt: null,
      },
      WINDOWS,
      NOW
    );
    expect(result.status).toBe("no-end");
  });

  it("LIVE で終了未確定なら now までの暫定区間を返す", () => {
    const result = resolveMatchSpans(
      { status: "LIVE", detectedStartAt: T("2026-09-01T13:05:00.000Z"), detectedEndAt: null },
      WINDOWS,
      NOW
    );
    expect(result).toMatchObject({
      status: "ok",
      provisional: true,
      spans: [{ start: T("2026-09-01T13:05:00.000Z"), end: NOW }],
    });
  });

  it("detectedEndAt が未来なら now で切って provisional にする", () => {
    // resolveEndedAt() は OPEN 時に duration から将来の終了時刻を作る。
    const result = resolveMatchSpans(
      {
        status: "LIVE",
        detectedStartAt: T("2026-09-01T13:05:00.000Z"),
        detectedEndAt: T("2026-09-01T13:50:00.000Z"),
      },
      WINDOWS,
      NOW
    );
    expect(result).toMatchObject({
      status: "ok",
      provisional: true,
      spans: [{ start: T("2026-09-01T13:05:00.000Z"), end: NOW }],
    });
  });

  it("終了済みの対戦は provisional にしない", () => {
    const result = resolveMatchSpans(
      {
        status: "FINISHED",
        detectedStartAt: T("2026-09-01T13:05:00.000Z"),
        detectedEndAt: T("2026-09-01T13:10:00.000Z"),
      },
      WINDOWS,
      NOW
    );
    expect(result).toMatchObject({
      status: "ok",
      provisional: false,
      spans: [{ start: T("2026-09-01T13:05:00.000Z"), end: T("2026-09-01T13:10:00.000Z") }],
    });
  });

  it("duration 由来の終了時刻が過去になっても LIVE なら provisional のまま", () => {
    const result = resolveMatchSpans(
      {
        status: "LIVE",
        detectedStartAt: T("2026-09-01T13:05:00.000Z"),
        detectedEndAt: T("2026-09-01T13:10:00.000Z"),
      },
      WINDOWS,
      NOW
    );
    expect(result).toMatchObject({ status: "ok", provisional: true });
  });

  it("日程の終わりをまたいだバトルは日程で切る", () => {
    // 22:59 開始 → 23:04 終了。日程の外の5分は数えない。
    const result = resolveMatchSpans(
      {
        status: "FINISHED",
        detectedStartAt: T("2026-09-01T13:59:00.000Z"),
        detectedEndAt: T("2026-09-01T14:04:00.000Z"),
      },
      WINDOWS,
      T("2026-09-01T15:00:00.000Z")
    );
    expect(result).toMatchObject({
      status: "ok",
      spans: [{ start: T("2026-09-01T13:59:00.000Z"), end: T("2026-09-01T14:00:00.000Z") }],
    });
  });

  it("複数の日程にまたがる区間は日程ごとに割れる", () => {
    const result = resolveMatchSpans(
      {
        status: "FINISHED",
        detectedStartAt: T("2026-09-01T13:30:00.000Z"),
        detectedEndAt: T("2026-09-02T13:30:00.000Z"),
      },
      WINDOWS,
      T("2026-09-03T00:00:00.000Z")
    );
    expect(result).toMatchObject({
      status: "ok",
      spans: [
        { start: T("2026-09-01T13:30:00.000Z"), end: T("2026-09-01T14:00:00.000Z") },
        { start: T("2026-09-02T13:00:00.000Z"), end: T("2026-09-02T13:30:00.000Z") },
      ],
    });
  });

  it("どの日程とも交差しない区間は no-window", () => {
    const result = resolveMatchSpans(
      {
        status: "FINISHED",
        detectedStartAt: T("2026-09-01T10:00:00.000Z"),
        detectedEndAt: T("2026-09-01T11:00:00.000Z"),
      },
      WINDOWS,
      T("2026-09-01T15:00:00.000Z")
    );
    expect(result.status).toBe("no-window");
  });

  it("開始直後で区間が空なら no-window", () => {
    const startedNow = T("2026-09-01T13:30:00.000Z");
    const result = resolveMatchSpans(
      { status: "LIVE", detectedStartAt: startedNow, detectedEndAt: null },
      WINDOWS,
      NOW
    );
    expect(result.status).toBe("no-window");
  });
});
