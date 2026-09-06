import { describe, it, expect } from "vitest";
import {
  coverageFromIntervals,
  refineCaptureByScore,
  type CaptureGap,
  type ConnectionIntervalRow,
} from "./room-connection-log";

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

const WHOLE_WINDOW_GAP: CaptureGap[] = [{ startMs: WINDOW_START.getTime(), endMs: WINDOW_END.getTime() }];

describe("coverageFromIntervals", () => {
  it("区間が0件なら unavailable/coverage 0", () => {
    expect(coverageFromIntervals([], WINDOW_START, WINDOW_END, NOW)).toEqual({
      status: "unavailable",
      coverage: 0,
      gaps: WHOLE_WINDOW_GAP,
    });
  });

  it("windowを完全に覆う1区間なら complete/coverage 1", () => {
    const rows = [row({ startedAt: WINDOW_START, endedAt: WINDOW_END })];
    expect(coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW)).toEqual({
      status: "complete",
      coverage: 1,
      gaps: [],
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
      gaps: WHOLE_WINDOW_GAP,
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
      gaps: [],
    });
  });

  it("窓の半分だけ覆うなら partial", () => {
    const half = new Date(WINDOW_START.getTime() + 150_000);
    const rows = [row({ startedAt: WINDOW_START, endedAt: half })];
    const result = coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW);
    expect(result.status).toBe("partial");
    expect(result.coverage).toBeCloseTo(0.5, 5);
    expect(result.gaps).toEqual([{ startMs: half.getTime(), endMs: WINDOW_END.getTime() }]);
  });

  it("endedAt:nullでheartbeatが新しい(生存中)ならwindowEndまで継続とみなす", () => {
    const rows = [
      row({ startedAt: WINDOW_START, endedAt: null, lastHeartbeatAt: new Date(NOW.getTime() - 10_000) }),
    ];
    expect(coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW)).toEqual({
      status: "complete",
      coverage: 1,
      gaps: [],
    });
  });

  it("endedAt:nullでheartbeatが90秒以上停止(Worker crash)ならlastHeartbeatAtで打ち切る", () => {
    // windowの半分(150秒経過時点)でheartbeatが止まった想定
    const staleAt = new Date(WINDOW_START.getTime() + 150_000);
    const rows = [row({ startedAt: WINDOW_START, endedAt: null, lastHeartbeatAt: staleAt })];
    const result = coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW);
    expect(result.status).toBe("partial");
    expect(result.coverage).toBeCloseTo(0.5, 5);
    expect(result.gaps).toEqual([{ startMs: staleAt.getTime(), endMs: WINDOW_END.getTime() }]);
  });

  it("startedAtが実効終了より後(異常データ)なら無視する", () => {
    const rows = [row({ startedAt: WINDOW_END, endedAt: WINDOW_START })];
    expect(coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW)).toEqual({
      status: "unavailable",
      coverage: 0,
      gaps: WHOLE_WINDOW_GAP,
    });
  });

  it("windowEnd <= windowStart(異常な窓)なら unavailable/coverage 0", () => {
    expect(coverageFromIntervals([row({})], WINDOW_END, WINDOW_START, NOW)).toEqual({
      status: "unavailable",
      coverage: 0,
      gaps: [],
    });
  });

  it("わずかな欠落(2%未満)は complete として扱う(閾値0.98)", () => {
    const almostFull = new Date(WINDOW_END.getTime() - 5_000); // 300秒中5秒欠落 ≒ 1.7%欠落
    const rows = [row({ startedAt: WINDOW_START, endedAt: almostFull })];
    const result = coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW);
    expect(result.status).toBe("complete");
    expect(result.gaps).toEqual([{ startMs: almostFull.getTime(), endMs: WINDOW_END.getTime() }]);
  });

  it("窓頭・合間・窓尾の欠落をすべてgapとして返す", () => {
    const t = (sec: number) => new Date(WINDOW_START.getTime() + sec * 1000);
    const rows = [
      row({ startedAt: t(10), endedAt: t(100) }),
      row({ startedAt: t(150), endedAt: t(280) }),
    ];
    const result = coverageFromIntervals(rows, WINDOW_START, WINDOW_END, NOW);
    expect(result.gaps).toEqual([
      { startMs: t(0).getTime(), endMs: t(10).getTime() },
      { startMs: t(100).getTime(), endMs: t(150).getTime() },
      { startMs: t(280).getTime(), endMs: t(300).getTime() },
    ]);
  });
});

describe("refineCaptureByScore", () => {
  const t = (sec: number) => WINDOW_START.getTime() + sec * 1000;
  // 相手roomがバトル開始から10秒遅れて接続した想定(窓頭に10秒のgap)
  const lateJoin = {
    status: "partial" as const,
    coverage: 0.967,
    gaps: [{ startMs: t(0), endMs: t(10) }],
  };

  it("欠落区間でスコアが動いていなければ complete へ格上げする", () => {
    const result = refineCaptureByScore(
      lateJoin,
      [
        { atMs: t(10), score: 0 },
        { atMs: t(200), score: 5000 },
      ],
      5000
    );
    expect(result).toEqual({ status: "complete", coverage: 0.967, missedScore: 0 });
  });

  it("欠落区間のスコア増分が最終スコアに対して十分小さければ complete へ格上げする", () => {
    const result = refineCaptureByScore(
      lateJoin,
      [
        { atMs: t(10), score: 3 }, // 窓頭gapで+3だけ動いた
        { atMs: t(200), score: 11548 },
      ],
      11548
    );
    expect(result.status).toBe("complete");
    expect(result.missedScore).toBe(3);
  });

  it("欠落区間で無視できない量のスコアが動いていたら partial のまま", () => {
    const result = refineCaptureByScore(
      lateJoin,
      [
        { atMs: t(10), score: 3000 },
        { atMs: t(200), score: 11548 },
      ],
      11548
    );
    expect(result).toEqual({ status: "partial", coverage: 0.967, missedScore: 3000 });
  });

  it("絶対値が閾値以上なら、割合が小さくても partial のまま", () => {
    const result = refineCaptureByScore(
      lateJoin,
      [
        { atMs: t(10), score: 150 }, // 最終1,000,000に対し0.015%だが絶対値150
        { atMs: t(200), score: 1_000_000 },
      ],
      1_000_000
    );
    expect(result.status).toBe("partial");
    expect(result.missedScore).toBe(150);
  });

  it("最終スコアが極小のバトルでは、割合が大きいので格上げしない", () => {
    const result = refineCaptureByScore(
      lateJoin,
      [
        { atMs: t(10), score: 3 },
        { atMs: t(200), score: 10 },
      ],
      10
    );
    expect(result.status).toBe("partial");
    expect(result.missedScore).toBe(3);
  });

  it("最終スコアが0のバトルではゼロ除算せず、割合条件を満たさないので格上げしない", () => {
    const result = refineCaptureByScore(
      lateJoin,
      [
        { atMs: t(10), score: 0 },
        { atMs: t(200), score: 0 },
      ],
      0
    );
    // missedScore 0 は「欠落区間で何も動いていない」ので格上げしてよい。
    expect(result).toEqual({ status: "complete", coverage: 0.967, missedScore: 0 });
  });

  it("最終スコアが0なのに欠落区間でスコアが動いた矛盾データでは格上げしない", () => {
    const result = refineCaptureByScore(
      lateJoin,
      [
        { atMs: t(10), score: 50 },
        { atMs: t(200), score: 50 },
      ],
      0
    );
    expect(result).toEqual({ status: "partial", coverage: 0.967, missedScore: 50 });
  });

  it("窓尾のgapは最終スコアを終端として使う", () => {
    const tailGap = {
      status: "partial" as const,
      coverage: 0.9,
      gaps: [{ startMs: t(270), endMs: t(300) }],
    };
    const result = refineCaptureByScore(tailGap, [{ atMs: t(260), score: 5000 }], 5000);
    expect(result).toEqual({ status: "complete", coverage: 0.9, missedScore: 0 });
  });

  it("窓尾のgapで最終スコアも無ければ判定不能(missedScore: null)", () => {
    const tailGap = {
      status: "partial" as const,
      coverage: 0.9,
      gaps: [{ startMs: t(270), endMs: t(300) }],
    };
    const result = refineCaptureByScore(tailGap, [{ atMs: t(260), score: 5000 }], null);
    expect(result).toEqual({ status: "partial", coverage: 0.9, missedScore: null });
  });

  it("スコア観測が1件も無ければ判定不能(missedScore: null)で元の判定を維持する", () => {
    expect(refineCaptureByScore(lateJoin, [], 5000)).toEqual({
      status: "partial",
      coverage: 0.967,
      missedScore: null,
    });
  });

  it("unavailable は格上げしない", () => {
    const unavailable = {
      status: "unavailable" as const,
      coverage: 0,
      gaps: [{ startMs: t(0), endMs: t(300) }],
    };
    expect(refineCaptureByScore(unavailable, [{ atMs: t(10), score: 0 }], 0)).toEqual({
      status: "unavailable",
      coverage: 0,
      missedScore: null,
    });
  });

  it("すでに complete ならスコアを見ずにそのまま返す", () => {
    const complete = { status: "complete" as const, coverage: 1, gaps: [] };
    expect(refineCaptureByScore(complete, [], null)).toEqual({
      status: "complete",
      coverage: 1,
      missedScore: 0,
    });
  });

  it("複数gapの欠損を合算して判定する", () => {
    const twoGaps = {
      status: "partial" as const,
      coverage: 0.8,
      gaps: [
        { startMs: t(0), endMs: t(10) },
        { startMs: t(100), endMs: t(150) },
      ],
    };
    const result = refineCaptureByScore(
      twoGaps,
      [
        { atMs: t(10), score: 40 }, // 窓頭gapで +40
        { atMs: t(100), score: 100 },
        { atMs: t(150), score: 170 }, // 合間のgapで +70
        { atMs: t(280), score: 20_000 },
      ],
      20_000
    );
    // 合計110は絶対値閾値100以上なので格上げしない
    expect(result.status).toBe("partial");
    expect(result.missedScore).toBe(110);
  });

  it("スコアが減少して観測された異常データでも負値を足し込まない", () => {
    const result = refineCaptureByScore(
      lateJoin,
      [
        { atMs: t(10), score: -5 },
        { atMs: t(200), score: 5000 },
      ],
      5000
    );
    expect(result.missedScore).toBe(0);
    expect(result.status).toBe("complete");
  });
});
