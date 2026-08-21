import { describe, it, expect } from "vitest";
import {
  DEFAULT_DEATHMATCH_RULES,
  computeLifePoints,
  parseDeathmatchRules,
  rankByLife,
  type DeathmatchRules,
  type LifeEvent,
} from "./deathmatch";

const T = (iso: string) => new Date(iso);

function rules(overrides: Partial<DeathmatchRules> = {}): DeathmatchRules {
  return { ...DEFAULT_DEATHMATCH_RULES, ...overrides };
}

function match(
  matchId: string,
  at: string,
  results: { subjectId: string; outcome: "WIN" | "LOSS" | "DRAW" }[]
): LifeEvent {
  return { matchId, decidedAt: T(at), results };
}

describe("parseDeathmatchRules", () => {
  it("未設定なら既定値を使う", () => {
    expect(parseDeathmatchRules(null)).toEqual(DEFAULT_DEATHMATCH_RULES);
    expect(parseDeathmatchRules({})).toEqual(DEFAULT_DEATHMATCH_RULES);
    expect(parseDeathmatchRules({ deathmatch: null })).toEqual(DEFAULT_DEATHMATCH_RULES);
  });

  it("設定した値を読む", () => {
    const parsed = parseDeathmatchRules({
      deathmatch: { initialLife: 5, lossDelta: 2, winDelta: 1, drawDelta: 1, maxLife: 8 },
    });
    expect(parsed).toEqual({
      initialLife: 5,
      lossDelta: 2,
      winDelta: 1,
      drawDelta: 1,
      maxLife: 8,
    });
  });

  it("不正な値は既定値へ落として例外を投げない(集計を止めないため)", () => {
    const parsed = parseDeathmatchRules({
      deathmatch: { initialLife: "abc", lossDelta: -5, winDelta: 999, drawDelta: null },
    });
    expect(parsed.initialLife).toBe(3);
    expect(parsed.lossDelta).toBe(0);
    expect(parsed.winDelta).toBe(99);
    expect(parsed.drawDelta).toBe(0);
  });

  it("maxLife は initialLife を下回らない", () => {
    const parsed = parseDeathmatchRules({ deathmatch: { initialLife: 5, maxLife: 2 } });
    expect(parsed.maxLife).toBe(5);
  });

  it("小数は切り捨てる", () => {
    expect(parseDeathmatchRules({ deathmatch: { initialLife: 3.9 } }).initialLife).toBe(3);
  });
});

describe("computeLifePoints", () => {
  it("対戦がなければ全員が初期ライフのまま", () => {
    const states = computeLifePoints({
      subjectIds: ["a", "b"],
      events: [],
      rules: rules({ initialLife: 3 }),
    });

    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({ subjectId: "a", current: 3, max: 3, eliminatedAt: null });
    expect(states[0].ledger).toEqual([]);
  });

  it("敗北でライフが減り、勝者は変わらない", () => {
    const states = computeLifePoints({
      subjectIds: ["a", "b"],
      events: [
        match("m1", "2026-09-01T20:00:00+09:00", [
          { subjectId: "a", outcome: "WIN" },
          { subjectId: "b", outcome: "LOSS" },
        ]),
      ],
      rules: rules({ initialLife: 3, lossDelta: 1, winDelta: 0 }),
    });

    expect(states.find((s) => s.subjectId === "a")?.current).toBe(3);
    expect(states.find((s) => s.subjectId === "b")?.current).toBe(2);
    // 増減が 0 の勝者は履歴に残さない
    expect(states.find((s) => s.subjectId === "a")?.ledger).toEqual([]);
    expect(states.find((s) => s.subjectId === "b")?.ledger).toHaveLength(1);
    expect(states.find((s) => s.subjectId === "b")?.ledger[0]).toMatchObject({
      matchId: "m1",
      delta: -1,
      reason: "MATCH_LOSS",
    });
  });

  it("ライフが0になったら脱落する", () => {
    const states = computeLifePoints({
      subjectIds: ["a", "b"],
      events: [
        match("m1", "2026-09-01T20:00:00+09:00", [
          { subjectId: "a", outcome: "WIN" },
          { subjectId: "b", outcome: "LOSS" },
        ]),
        match("m2", "2026-09-01T21:00:00+09:00", [
          { subjectId: "a", outcome: "WIN" },
          { subjectId: "b", outcome: "LOSS" },
        ]),
      ],
      rules: rules({ initialLife: 2, lossDelta: 1 }),
    });

    const b = states.find((s) => s.subjectId === "b")!;
    expect(b.current).toBe(0);
    expect(b.eliminatedAt?.toISOString()).toBe(T("2026-09-01T21:00:00+09:00").toISOString());
  });

  it("脱落した後の対戦は適用しない", () => {
    const states = computeLifePoints({
      subjectIds: ["a", "b"],
      events: [
        match("m1", "2026-09-01T20:00:00+09:00", [{ subjectId: "b", outcome: "LOSS" }]),
        // 脱落後。負けても勝ってもライフは動かない
        match("m2", "2026-09-01T21:00:00+09:00", [{ subjectId: "b", outcome: "LOSS" }]),
        match("m3", "2026-09-01T22:00:00+09:00", [{ subjectId: "b", outcome: "WIN" }]),
      ],
      rules: rules({ initialLife: 1, lossDelta: 1, winDelta: 1, maxLife: 5 }),
    });

    const b = states.find((s) => s.subjectId === "b")!;
    expect(b.current).toBe(0);
    expect(b.ledger).toHaveLength(1);
    expect(b.eliminatedAt?.toISOString()).toBe(T("2026-09-01T20:00:00+09:00").toISOString());
  });

  it("脱落者が含まれる対戦は相手にも適用しない", () => {
    const states = computeLifePoints({
      subjectIds: ["a", "b"],
      events: [
        // b がここで脱落する
        match("m1", "2026-09-01T20:00:00+09:00", [
          { subjectId: "a", outcome: "WIN" },
          { subjectId: "b", outcome: "LOSS" },
        ]),
        // 脱落した b との対戦。a は勝っても回復しない(対戦が成立していないため)
        match("m2", "2026-09-01T21:00:00+09:00", [
          { subjectId: "a", outcome: "WIN" },
          { subjectId: "b", outcome: "LOSS" },
        ]),
      ],
      rules: rules({ initialLife: 1, lossDelta: 1, winDelta: 1, maxLife: 5 }),
    });

    const a = states.find((s) => s.subjectId === "a")!;
    // 1試合目の勝利ぶんだけ回復している
    expect(a.current).toBe(2);
    expect(a.ledger).toHaveLength(1);
  });

  it("勝利で回復するが上限を超えない", () => {
    const states = computeLifePoints({
      subjectIds: ["a"],
      events: [
        match("m1", "2026-09-01T20:00:00+09:00", [{ subjectId: "a", outcome: "WIN" }]),
        match("m2", "2026-09-01T21:00:00+09:00", [{ subjectId: "a", outcome: "WIN" }]),
      ],
      rules: rules({ initialLife: 3, winDelta: 1, maxLife: 4 }),
    });

    const a = states[0];
    expect(a.current).toBe(4);
    expect(a.max).toBe(4);
    // 上限に張り付いた2回目は履歴に残さない
    expect(a.ledger).toHaveLength(1);
  });

  it("maxLife 未設定なら初期ライフが上限になる", () => {
    const states = computeLifePoints({
      subjectIds: ["a"],
      events: [match("m1", "2026-09-01T20:00:00+09:00", [{ subjectId: "a", outcome: "WIN" }])],
      rules: rules({ initialLife: 3, winDelta: 2, maxLife: null }),
    });

    expect(states[0].current).toBe(3);
    expect(states[0].max).toBe(3);
  });

  it("引き分けは設定した量だけ減る", () => {
    const states = computeLifePoints({
      subjectIds: ["a", "b"],
      events: [
        match("m1", "2026-09-01T20:00:00+09:00", [
          { subjectId: "a", outcome: "DRAW" },
          { subjectId: "b", outcome: "DRAW" },
        ]),
      ],
      rules: rules({ initialLife: 3, drawDelta: 1 }),
    });

    expect(states.every((s) => s.current === 2)).toBe(true);
    expect(states[0].ledger[0].reason).toBe("MATCH_DRAW");
  });

  it("ライフは0未満にならない", () => {
    const states = computeLifePoints({
      subjectIds: ["a"],
      events: [match("m1", "2026-09-01T20:00:00+09:00", [{ subjectId: "a", outcome: "LOSS" }])],
      rules: rules({ initialLife: 1, lossDelta: 5 }),
    });

    expect(states[0].current).toBe(0);
    expect(states[0].ledger[0].delta).toBe(-1);
  });

  it("適用順は決着時刻。入力の並びに依存しない", () => {
    const events = [
      match("m2", "2026-09-01T21:00:00+09:00", [{ subjectId: "a", outcome: "WIN" }]),
      match("m1", "2026-09-01T20:00:00+09:00", [{ subjectId: "a", outcome: "LOSS" }]),
    ];

    const states = computeLifePoints({
      subjectIds: ["a"],
      events,
      rules: rules({ initialLife: 1, lossDelta: 1, winDelta: 1, maxLife: 5 }),
    });

    // 先に負けて 0 = 脱落。その後の勝利は適用されない。
    expect(states[0].current).toBe(0);
    expect(states[0].eliminatedAt?.toISOString()).toBe(
      T("2026-09-01T20:00:00+09:00").toISOString()
    );
  });

  it("同時刻の決着は matchId で安定して並ぶ", () => {
    const build = (order: LifeEvent[]) =>
      computeLifePoints({
        subjectIds: ["a"],
        events: order,
        rules: rules({ initialLife: 2, lossDelta: 1, winDelta: 1, maxLife: 5 }),
      })[0];

    const m1 = match("m1", "2026-09-01T20:00:00+09:00", [{ subjectId: "a", outcome: "LOSS" }]);
    const m2 = match("m2", "2026-09-01T20:00:00+09:00", [{ subjectId: "a", outcome: "WIN" }]);

    expect(build([m1, m2]).ledger.map((l) => l.matchId)).toEqual(["m1", "m2"]);
    expect(build([m2, m1]).ledger.map((l) => l.matchId)).toEqual(["m1", "m2"]);
  });

  it("参加者一覧にない subject は無視する", () => {
    const states = computeLifePoints({
      subjectIds: ["a"],
      events: [match("m1", "2026-09-01T20:00:00+09:00", [{ subjectId: "zzz", outcome: "LOSS" }])],
      rules: rules(),
    });

    expect(states).toHaveLength(1);
    expect(states[0].current).toBe(3);
  });
});

describe("rankByLife", () => {
  it("残ライフが多い順に並ぶ", () => {
    const ranked = rankByLife([
      { subjectId: "a", current: 1, eliminatedAt: null, diamonds: "100" },
      { subjectId: "b", current: 3, eliminatedAt: null, diamonds: "50" },
    ]);

    expect(ranked.map((r) => r.subjectId)).toEqual(["b", "a"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("同ライフなら獲得ダイヤが多いほうが上", () => {
    const ranked = rankByLife([
      { subjectId: "a", current: 2, eliminatedAt: null, diamonds: "100" },
      { subjectId: "b", current: 2, eliminatedAt: null, diamonds: "300" },
    ]);

    expect(ranked.map((r) => r.subjectId)).toEqual(["b", "a"]);
  });

  it("脱落者どうしは遅く落ちたほうが上", () => {
    const ranked = rankByLife([
      {
        subjectId: "early",
        current: 0,
        eliminatedAt: new Date("2026-09-01T20:00:00+09:00"),
        diamonds: "999",
      },
      {
        subjectId: "late",
        current: 0,
        eliminatedAt: new Date("2026-09-01T22:00:00+09:00"),
        diamonds: "1",
      },
    ]);

    expect(ranked.map((r) => r.subjectId)).toEqual(["late", "early"]);
  });

  it("21億を超えるダイヤでも正しく比較する", () => {
    const ranked = rankByLife([
      { subjectId: "a", current: 1, eliminatedAt: null, diamonds: "9007199254740993" },
      { subjectId: "b", current: 1, eliminatedAt: null, diamonds: "9007199254740992" },
    ]);

    expect(ranked.map((r) => r.subjectId)).toEqual(["a", "b"]);
  });

  it("完全に同条件なら同順位になる", () => {
    const ranked = rankByLife([
      { subjectId: "a", current: 2, eliminatedAt: null, diamonds: "100" },
      { subjectId: "b", current: 2, eliminatedAt: null, diamonds: "100" },
      { subjectId: "c", current: 1, eliminatedAt: null, diamonds: "100" },
    ]);

    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });
});
