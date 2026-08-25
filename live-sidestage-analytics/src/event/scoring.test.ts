import { describe, it, expect } from "vitest";
import {
  assignRanks,
  buildRateSegments,
  factorToScaled,
  formatScaledPoints,
  isBattleOnlyFormat,
  scaledPoints,
} from "./scoring";

const T = (iso: string) => new Date(iso);
const START = T("2026-09-01T00:00:00.000Z");
const END = T("2026-09-08T00:00:00.000Z");

describe("factorToScaled", () => {
  it("小数2桁までの倍率を100倍の整数にする", () => {
    expect(factorToScaled("2.5")).toBe(250n);
    expect(factorToScaled("1")).toBe(100n);
    expect(factorToScaled("0.01")).toBe(1n);
    expect(factorToScaled("9999.99")).toBe(999999n);
    expect(factorToScaled(2)).toBe(200n);
    expect(factorToScaled(1.25)).toBe(125n);
  });

  it("小数第3位以下は切り捨てる", () => {
    expect(factorToScaled("2.509")).toBe(250n);
  });

  it("数値として解釈できない値は例外にする", () => {
    expect(() => factorToScaled("abc")).toThrow();
    expect(() => factorToScaled("")).toThrow();
  });
});

describe("formatScaledPoints", () => {
  it("100倍の整数をDecimal列用の文字列にする", () => {
    expect(formatScaledPoints(25050n)).toBe("250.50");
    expect(formatScaledPoints(0n)).toBe("0.00");
    expect(formatScaledPoints(5n)).toBe("0.05");
    expect(formatScaledPoints(100n)).toBe("1.00");
  });

  it("numberの安全整数を超える値でも精度を落とさない", () => {
    // 2^53 を超えるダイヤ合計に倍率をかけたケース
    const huge = 9_007_199_254_740_993n * 100n;
    expect(formatScaledPoints(huge)).toBe("9007199254740993.00");
  });
});

describe("scaledPoints", () => {
  it("ダイヤ実数に倍率を適用する", () => {
    expect(formatScaledPoints(scaledPoints(100n, 250n))).toBe("250.00");
    expect(formatScaledPoints(scaledPoints(1n, 100n))).toBe("1.00");
    expect(formatScaledPoints(scaledPoints(3n, 133n))).toBe("3.99");
  });
});

describe("buildRateSegments", () => {
  it("倍率がなければ全期間が1区間の等倍になる", () => {
    const segments = buildRateSegments({ eventStart: START, eventEnd: END, multipliers: [] });
    expect(segments).toHaveLength(1);
    expect(segments[0].start).toEqual(START);
    expect(segments[0].end).toEqual(END);
    expect(segments[0].scaledFactor).toBe(100n);
  });

  it("期間指定のない倍率はイベント全期間に効く", () => {
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [{ kind: "SOLO_STREAM", factor: "2", startAt: null, endAt: null }],
    });
    expect(segments).toHaveLength(1);
    expect(segments[0].scaledFactor).toBe(200n);
  });

  it("期間限定の倍率は前後と分かれて3区間になる", () => {
    const from = T("2026-09-03T00:00:00.000Z");
    const to = T("2026-09-04T00:00:00.000Z");
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [{ kind: "SOLO_STREAM", factor: "3", startAt: from, endAt: to }],
    });

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ start: START, end: from, scaledFactor: 100n });
    expect(segments[1]).toMatchObject({ start: from, end: to, scaledFactor: 300n });
    expect(segments[2]).toMatchObject({ start: to, end: END, scaledFactor: 100n });
  });

  it("同じkindの倍率が複数該当したら最大の1つだけを採る(合計も乗算もしない)", () => {
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [
        { kind: "SOLO_STREAM", factor: "2", startAt: null, endAt: null },
        { kind: "SOLO_STREAM", factor: "3", startAt: null, endAt: null },
        { kind: "SOLO_STREAM", factor: "1.5", startAt: null, endAt: null },
      ],
    });

    expect(segments).toHaveLength(1);
    // 2+3+1.5 でも 2*3*1.5 でもなく、最大の 3 だけ
    expect(segments[0].scaledFactor).toBe(300n);
  });

  it("バトル区間がなければBATTLE倍率は効かない", () => {
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [{ kind: "BATTLE", factor: "5", startAt: null, endAt: null }],
      battleRanges: [],
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].scaledFactor).toBe(100n);
  });

  it("バトル区間の中はBATTLE倍率、外はSOLO_STREAM倍率になる", () => {
    const bStart = T("2026-09-02T20:00:00.000Z");
    const bEnd = T("2026-09-02T20:05:00.000Z");
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [
        { kind: "BATTLE", factor: "5", startAt: null, endAt: null },
        { kind: "SOLO_STREAM", factor: "2", startAt: null, endAt: null },
      ],
      battleRanges: [{ start: bStart, end: bEnd }],
    });

    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ start: START, end: bStart, scaledFactor: 200n });
    expect(segments[1]).toMatchObject({ start: bStart, end: bEnd, scaledFactor: 500n });
    expect(segments[2]).toMatchObject({ start: bEnd, end: END, scaledFactor: 200n });
  });

  it("BATTLE_ONLY ではバトル区間の外を1つも返さない", () => {
    const bStart = T("2026-09-02T20:00:00.000Z");
    const bEnd = T("2026-09-02T20:05:00.000Z");
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [
        { kind: "BATTLE", factor: "5", startAt: null, endAt: null },
        // 枠投げ倍率は BATTLE_ONLY では区間そのものが無いので効きようがない。
        { kind: "SOLO_STREAM", factor: "2", startAt: null, endAt: null },
      ],
      battleRanges: [{ start: bStart, end: bEnd }],
      coverage: "BATTLE_ONLY",
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: bStart, end: bEnd, scaledFactor: 500n });
  });

  it("BATTLE_ONLY で離れた2つのバトル区間は1本にマージされない", () => {
    const a = { start: T("2026-09-02T20:00:00.000Z"), end: T("2026-09-02T20:05:00.000Z") };
    const b = { start: T("2026-09-02T21:00:00.000Z"), end: T("2026-09-02T21:05:00.000Z") };
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [],
      battleRanges: [a, b],
      coverage: "BATTLE_ONLY",
    });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ start: a.start, end: a.end });
    expect(segments[1]).toMatchObject({ start: b.start, end: b.end });
  });

  it("BATTLE_ONLY で隣接するバトル区間は1本に結合される", () => {
    const mid = T("2026-09-02T20:05:00.000Z");
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [],
      battleRanges: [
        { start: T("2026-09-02T20:00:00.000Z"), end: mid },
        { start: mid, end: T("2026-09-02T20:10:00.000Z") },
      ],
      coverage: "BATTLE_ONLY",
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      start: T("2026-09-02T20:00:00.000Z"),
      end: T("2026-09-02T20:10:00.000Z"),
    });
  });

  it("BATTLE_ONLY で重なったバトル区間を渡しても二重計上しない(合計が和集合と一致する)", () => {
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [],
      battleRanges: [
        { start: T("2026-09-02T20:00:00.000Z"), end: T("2026-09-02T20:06:00.000Z") },
        { start: T("2026-09-02T20:04:00.000Z"), end: T("2026-09-02T20:10:00.000Z") },
      ],
      coverage: "BATTLE_ONLY",
    });

    const totalMs = segments.reduce((sum, s) => sum + (s.end.getTime() - s.start.getTime()), 0);
    // 和集合は 20:00〜20:10 の10分。重なった2分を二重に数えていたら12分になる。
    expect(totalMs).toBe(10 * 60 * 1000);
    // 区間どうしも重なっていないこと。
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].start.getTime()).toBeGreaterThanOrEqual(segments[i - 1].end.getTime());
    }
  });

  it("BATTLE_ONLY のバトル区間は開始を含み終了を含まない(半開区間)", () => {
    const bStart = T("2026-09-02T20:00:00.000Z");
    const bEnd = T("2026-09-02T20:05:00.000Z");
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [],
      battleRanges: [{ start: bStart, end: bEnd }],
      coverage: "BATTLE_ONLY",
    });

    expect(segments[0].start.getTime()).toBe(bStart.getTime());
    expect(segments[0].end.getTime()).toBe(bEnd.getTime());
  });

  it("BATTLE_ONLY でバトル区間が無ければ空になる(全員0点)", () => {
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [{ kind: "SOLO_STREAM", factor: "2", startAt: null, endAt: null }],
      battleRanges: [],
      coverage: "BATTLE_ONLY",
    });

    expect(segments).toEqual([]);
  });

  it("BATTLE_ONLY で日程の外へはみ出したバトルは日程の中だけ残る", () => {
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [],
      battleRanges: [
        // 日程の開始前から始まり、終了後まで続くバトル。
        { start: T("2026-08-31T23:00:00.000Z"), end: T("2026-09-09T00:00:00.000Z") },
      ],
      coverage: "BATTLE_ONLY",
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: START, end: END });
  });

  it("隣接する同じ倍率の区間はマージされる(クエリ本数を増やさない)", () => {
    const mid = T("2026-09-04T00:00:00.000Z");
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [
        { kind: "SOLO_STREAM", factor: "2", startAt: START, endAt: mid },
        { kind: "SOLO_STREAM", factor: "2", startAt: mid, endAt: END },
      ],
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: START, end: END, scaledFactor: 200n });
  });

  it("イベント期間の外にはみ出した倍率は範囲内だけ効く", () => {
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [
        {
          kind: "SOLO_STREAM",
          factor: "2",
          startAt: T("2026-08-01T00:00:00.000Z"),
          endAt: T("2026-09-02T00:00:00.000Z"),
        },
      ],
    });

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ start: START, scaledFactor: 200n });
    expect(segments[0].end).toEqual(T("2026-09-02T00:00:00.000Z"));
    expect(segments[1].scaledFactor).toBe(100n);
  });

  it("イベント期間が空なら区間も空になる", () => {
    expect(buildRateSegments({ eventStart: END, eventEnd: START, multipliers: [] })).toEqual([]);
    expect(buildRateSegments({ eventStart: START, eventEnd: START, multipliers: [] })).toEqual([]);
  });

  it("区間は隙間なく連続し、互いに重ならない", () => {
    const segments = buildRateSegments({
      eventStart: START,
      eventEnd: END,
      multipliers: [
        {
          kind: "SOLO_STREAM",
          factor: "2",
          startAt: T("2026-09-02T00:00:00.000Z"),
          endAt: T("2026-09-03T00:00:00.000Z"),
        },
        {
          kind: "SOLO_STREAM",
          factor: "3",
          startAt: T("2026-09-05T00:00:00.000Z"),
          endAt: T("2026-09-06T00:00:00.000Z"),
        },
      ],
      battleRanges: [{ start: T("2026-09-07T00:00:00.000Z"), end: T("2026-09-07T01:00:00.000Z") }],
    });

    expect(segments[0].start).toEqual(START);
    expect(segments[segments.length - 1].end).toEqual(END);
    for (let i = 0; i < segments.length - 1; i++) {
      expect(segments[i].end).toEqual(segments[i + 1].start);
      expect(segments[i].start.getTime()).toBeLessThan(segments[i].end.getTime());
    }
  });
});

describe("assignRanks", () => {
  it("ポイント降順で順位を振る", () => {
    const ranked = assignRanks([
      { subjectId: "a", points: 100n, diamonds: 1n },
      { subjectId: "b", points: 300n, diamonds: 3n },
      { subjectId: "c", points: 200n, diamonds: 2n },
    ]);

    expect(ranked.map((r) => [r.subjectId, r.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ]);
  });

  it("完全に同値なら同順位になり、次の順位は飛ぶ", () => {
    const ranked = assignRanks([
      { subjectId: "a", points: 200n, diamonds: 2n },
      { subjectId: "b", points: 200n, diamonds: 2n },
      { subjectId: "c", points: 100n, diamonds: 1n },
    ]);

    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it("ポイントが同じならダイヤ実数の多い方が上位になる", () => {
    const ranked = assignRanks([
      { subjectId: "a", points: 200n, diamonds: 100n },
      { subjectId: "b", points: 200n, diamonds: 200n },
    ]);

    expect(ranked.map((r) => [r.subjectId, r.rank])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  it("空の入力を受け付ける", () => {
    expect(assignRanks([])).toEqual([]);
  });
});

describe("isBattleOnlyFormat", () => {
  it("対戦する種目だけバトル中のみ集計する", () => {
    expect(isBattleOnlyFormat("TOURNAMENT")).toBe(true);
    expect(isBattleOnlyFormat("DEATHMATCH")).toBe(true);
  });

  it("獲得ダイヤレースは開催日程の全ギフトを数える", () => {
    // 対戦が無くバトル検知も回していないので、絞ると全員0点になる。
    expect(isBattleOnlyFormat("DIAMOND_RACE")).toBe(false);
  });
});
