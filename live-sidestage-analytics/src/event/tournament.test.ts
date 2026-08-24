import { describe, it, expect } from "vitest";
import { planRoundSessions } from "./tournament";

const at = (iso: string) => new Date(iso);

// JST 22:00-23:00 を2日ぶん(1日目 予選 / 2日目 決勝)。
const DAY1 = { id: "s1", startAt: at("2026-09-01T13:00:00.000Z") };
const DAY2 = { id: "s2", startAt: at("2026-09-02T13:00:00.000Z") };

describe("planRoundSessions", () => {
  it("指定が無ければ全ラウンドを最初の日程に置く", () => {
    const result = planRoundSessions({ sessions: [DAY1, DAY2], roundCount: 3 });
    expect(result).toEqual({ ok: true, value: ["s1", "s1", "s1"] });
  });

  it("日程が startAt 昇順でなくても最初の日程を選ぶ", () => {
    const result = planRoundSessions({ sessions: [DAY2, DAY1], roundCount: 2 });
    expect(result).toEqual({ ok: true, value: ["s1", "s1"] });
  });

  it("ラウンドごとに別の日程を割り当てられる", () => {
    const result = planRoundSessions({
      sessions: [DAY1, DAY2],
      roundCount: 2,
      requested: ["s1", "s2"],
    });
    expect(result).toEqual({ ok: true, value: ["s1", "s2"] });
  });

  it("同じ日程を続けて指定してよい", () => {
    const result = planRoundSessions({
      sessions: [DAY1, DAY2],
      roundCount: 3,
      requested: ["s1", "s1", "s2"],
    });
    expect(result).toEqual({ ok: true, value: ["s1", "s1", "s2"] });
  });

  it("日程が1件も無ければ拒否する", () => {
    const result = planRoundSessions({ sessions: [], roundCount: 2 });
    expect(result.ok).toBe(false);
  });

  it("ラウンド数と指定数が合わなければ拒否する", () => {
    const result = planRoundSessions({
      sessions: [DAY1, DAY2],
      roundCount: 3,
      requested: ["s1", "s2"],
    });
    expect(result.ok).toBe(false);
  });

  it("このイベントに無い日程は拒否する", () => {
    const result = planRoundSessions({
      sessions: [DAY1, DAY2],
      roundCount: 2,
      requested: ["s1", "other-event-session"],
    });
    expect(result.ok).toBe(false);
  });

  it("後のラウンドが前のラウンドより前の日程になったら拒否する", () => {
    // 2回戦を1日目に置くと、1回戦(2日目)の勝者が決まる前の時間帯を検知することになる。
    const result = planRoundSessions({
      sessions: [DAY1, DAY2],
      roundCount: 2,
      requested: ["s2", "s1"],
    });
    expect(result.ok).toBe(false);
  });
});
