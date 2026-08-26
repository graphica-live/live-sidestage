import { describe, it, expect } from "vitest";
import { buildPlacementBlocks, placementRounds } from "./bracket";
import { planPlacementSessions, planRoundSessions } from "./tournament";

const at = (iso: string) => new Date(iso);

// JST 22:00-23:00 を2日ぶん(1日目 予選 / 2日目 決勝)。
const DAY1 = { id: "s1", startAt: at("2026-09-01T13:00:00.000Z") };
const DAY2 = { id: "s2", startAt: at("2026-09-02T13:00:00.000Z") };
const DAY3 = { id: "s3", startAt: at("2026-09-03T13:00:00.000Z") };

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

describe("planPlacementSessions", () => {
  const SESSIONS = [DAY1, DAY2, DAY3];

  // 8人・標準方式: R=3。d=1(3位決定戦=1ラウンド) と d=2(5位決定戦=2ラウンド)。
  const rounds = (depth: number) =>
    placementRounds(buildPlacementBlocks(8, "STANDARD", depth), 3);

  it("順位決定戦が無ければ空を返す", () => {
    const result = planPlacementSessions({
      sessions: SESSIONS,
      rounds: [],
      mainRoundSessionIds: ["s1", "s2", "s3"],
    });
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("指定が無ければ本選の決勝と同じ日程に置く", () => {
    const result = planPlacementSessions({
      sessions: SESSIONS,
      rounds: rounds(2),
      mainRoundSessionIds: ["s1", "s2", "s3"],
    });
    // 3位決定戦1つ + 5位決定戦ブロックの2ラウンド
    expect(result).toEqual({ ok: true, value: ["s3", "s3", "s3"] });
  });

  it("本選の決勝と同じ日程に置くのを許す(3位決定戦を決勝の前後にやる運用)", () => {
    const result = planPlacementSessions({
      sessions: SESSIONS,
      rounds: rounds(1),
      mainRoundSessionIds: ["s1", "s2", "s2"],
      requested: ["s2"],
    });
    expect(result).toEqual({ ok: true, value: ["s2"] });
  });

  it("ラウンド数と指定数が合わなければ拒否する", () => {
    const result = planPlacementSessions({
      sessions: SESSIONS,
      rounds: rounds(2),
      mainRoundSessionIds: ["s1", "s2", "s3"],
      requested: ["s3"],
    });
    expect(result.ok).toBe(false);
  });

  it("このイベントに無い日程は拒否する", () => {
    const result = planPlacementSessions({
      sessions: SESSIONS,
      rounds: rounds(1),
      mainRoundSessionIds: ["s1", "s2", "s3"],
      requested: ["other-event-session"],
    });
    expect(result.ok).toBe(false);
  });

  it("ブロック内で後のラウンドが前より early なら拒否する", () => {
    const plan = rounds(2);
    // 並びは [3位決定戦, 5位決定 1回戦, 5位決定戦]。ブロック内の2ラウンド目を前へ戻す。
    const requested = plan.map((r) => (r.depth === 2 && r.roundInBlock === 1 ? "s3" : "s2"));
    const result = planPlacementSessions({
      sessions: SESSIONS,
      rounds: plan,
      mainRoundSessionIds: ["s1", "s1", "s2"],
      requested,
    });
    expect(result.ok).toBe(false);
  });

  it("ブロック同士の前後関係は制約しない(独立しているのでどちらが先でもよい)", () => {
    const plan = rounds(2);
    // 5位決定戦ブロックを 3位決定戦より前の日程に置く。
    const requested = plan.map((r) => (r.depth === 1 ? "s3" : "s2"));
    const result = planPlacementSessions({
      sessions: SESSIONS,
      rounds: plan,
      mainRoundSessionIds: ["s1", "s1", "s2"],
      requested,
    });
    expect(result).toEqual({ ok: true, value: requested });
  });

  it("出場者が決まる本選ラウンドより前の日程は拒否する", () => {
    // 3位決定戦の出どころは準決勝(2回戦)。準決勝を2日目に置いたなら1日目には置けない。
    const result = planPlacementSessions({
      sessions: SESSIONS,
      rounds: rounds(1),
      mainRoundSessionIds: ["s1", "s2", "s3"],
      requested: ["s1"],
    });
    expect(result.ok).toBe(false);
  });

  it("出どころの本選ラウンドと同じ日程なら通す", () => {
    const result = planPlacementSessions({
      sessions: SESSIONS,
      rounds: rounds(1),
      mainRoundSessionIds: ["s1", "s2", "s3"],
      requested: ["s2"],
    });
    expect(result).toEqual({ ok: true, value: ["s2"] });
  });
});
