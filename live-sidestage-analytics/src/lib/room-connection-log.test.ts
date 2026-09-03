import { describe, it, expect } from "vitest";
import { coverageFromIntervals, type ConnectionIntervalRow } from "./room-connection-log";

const WINDOW_START = new Date("2026-08-10T10:00:00Z");
const WINDOW_END = new Date("2026-08-10T10:05:00Z"); // 300秒窓
const NOW = new Date("2026-08-10T10:06:30Z"); // finalize時点(窓終了から90秒後)

function row(overrides: Partial<ConnectionIntervalRow>): ConnectionIntervalRow {
  return {
    startedAt: WINDOW_START,
    endedAt: WINDOW_END,
    lastHeartbeatAt: WINDOW_END,
    ...overrides,
  };
}

describe("coverageFromIntervals", () => {
  it("区間が0件なら unavailable/coverage 0", () => {
    expect(coverageFromIntervals([], WINDOW_START, WINDOW_END, NOW)).toEqual({
      status: "unavailable",
      coverage: 0,
    });
  });

  it("windowを完全に覆う1区間なら complete/coverage 1", () => {
    const rows = [row({ startedAt: WINDOW_START, endedAt: WINDOW_END })];
    expect(coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW)).toEqual({
      status: "complete",
      coverage: 1,
    });
  });

  it("window外の区間は無視する(window前に終了/window後に開始)", () => {
    const rows = [
      row({ startedAt: new Date(WINDOW_START.getTime() - 60_000), endedAt: new Date(WINDOW_START.getTime() - 1) }),
      row({ startedAt: new Date(WINDOW_END.getTime() + 1), endedAt: new Date(WINDOW_END.getTime() + 60_000) }),
    ];
    expect(coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW)).toEqual({
      status: "unavailable",
      coverage: 0,
    });
  });

  it("重なる複数区間をunionしてから被覆率を出す(二重計上しない)", () => {
    const mid = new Date(WINDOW_START.getTime() + 60_000);
    const rows = [
      row({ startedAt: WINDOW_START, endedAt: new Date(WINDOW_START.getTime() + 120_000) }),
      row({ startedAt: mid, endedAt: WINDOW_END }), // 前の区間と60秒重なる
    ];
    // union後は[0, 300]秒=window全体を覆う
    expect(coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW)).toEqual({
      status: "complete",
      coverage: 1,
    });
  });

  it("窓の半分だけ覆うなら partial", () => {
    const half = new Date(WINDOW_START.getTime() + 150_000);
    const rows = [row({ startedAt: WINDOW_START, endedAt: half })];
    const result = coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW);
    expect(result.status).toBe("partial");
    expect(result.coverage).toBeCloseTo(0.5, 5);
  });

  it("endedAt:nullでheartbeatが新しい(生存中)ならwindowEndまで継続とみなす", () => {
    const rows = [
      row({ startedAt: WINDOW_START, endedAt: null, lastHeartbeatAt: new Date(NOW.getTime() - 10_000) }),
    ];
    expect(coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW)).toEqual({
      status: "complete",
      coverage: 1,
    });
  });

  it("endedAt:nullでheartbeatが90秒以上停止(Worker crash)ならlastHeartbeatAtで打ち切る", () => {
    // windowの半分(150秒経過時点)でheartbeatが止まった想定
    const staleAt = new Date(WINDOW_START.getTime() + 150_000);
    const rows = [row({ startedAt: WINDOW_START, endedAt: null, lastHeartbeatAt: staleAt })];
    const result = coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW);
    expect(result.status).toBe("partial");
    expect(result.coverage).toBeCloseTo(0.5, 5);
  });

  it("startedAtが実効終了より後(異常データ)なら無視する", () => {
    const rows = [row({ startedAt: WINDOW_END, endedAt: WINDOW_START })];
    expect(coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW)).toEqual({
      status: "unavailable",
      coverage: 0,
    });
  });

  it("windowEnd <= windowStart(異常な窓)なら unavailable/coverage 0", () => {
    expect(coverageFromIntervals([row({})], WINDOW_END, WINDOW_START, NOW)).toEqual({
      status: "unavailable",
      coverage: 0,
    });
  });

  it("わずかな欠落(2%未満)は complete として扱う(閾値0.98)", () => {
    const almostFull = new Date(WINDOW_END.getTime() - 5_000); // 300秒中5秒欠落 ≒ 1.7%欠落
    const rows = [row({ startedAt: WINDOW_START, endedAt: almostFull })];
    const result = coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW);
    expect(result.status).toBe("complete");
  });
});
