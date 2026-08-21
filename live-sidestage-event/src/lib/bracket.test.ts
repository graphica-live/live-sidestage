import { describe, it, expect } from "vitest";
import {
  bracketSize,
  buildBracket,
  nextSlot,
  resolveBracket,
  roundLabel,
  seedOrder,
} from "./bracket";

describe("bracketSize", () => {
  it("参加者数以上で最小の2のべき乗を返す", () => {
    expect(bracketSize(2)).toBe(2);
    expect(bracketSize(3)).toBe(4);
    expect(bracketSize(4)).toBe(4);
    expect(bracketSize(5)).toBe(8);
    expect(bracketSize(100)).toBe(128);
  });

  it("参加者が1人以下でも2を下回らない", () => {
    expect(bracketSize(0)).toBe(2);
    expect(bracketSize(1)).toBe(2);
  });
});

describe("seedOrder", () => {
  it("上位シードが早い段階で当たらない並びを作る", () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it("どのペアも合計が同じになる(1位は最下位と当たる)", () => {
    const size = 16;
    const order = seedOrder(size);
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i] + order[i + 1]).toBe(size + 1);
    }
  });

  it("すべてのシードが1回ずつ現れる", () => {
    const order = seedOrder(8);
    expect([...order].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("buildBracket", () => {
  it("4人なら1回戦2試合 + 決勝の3試合になる", () => {
    const bracket = buildBracket(4);
    expect(bracket.roundCount).toBe(2);
    expect(bracket.size).toBe(4);
    expect(bracket.matches).toHaveLength(3);

    const round1 = bracket.matches.filter((m) => m.round === 1);
    expect(round1).toHaveLength(2);
    expect(round1[0].sourceA).toEqual({ kind: "ENTRANT", entrantIndex: 0 });
    expect(round1[0].sourceB).toEqual({ kind: "ENTRANT", entrantIndex: 3 });

    const final = bracket.matches.find((m) => m.round === 2);
    expect(final?.sourceA).toEqual({ kind: "WINNER_OF", round: 1, position: 0 });
    expect(final?.sourceB).toEqual({ kind: "WINNER_OF", round: 1, position: 1 });
  });

  it("2のべき乗でない人数では余った枠がBYEになる", () => {
    const bracket = buildBracket(5);
    expect(bracket.size).toBe(8);
    expect(bracket.roundCount).toBe(3);

    const round1 = bracket.matches.filter((m) => m.round === 1);
    const byeCount = round1.flatMap((m) => [m.sourceA, m.sourceB]).filter(
      (s) => s.kind === "BYE"
    ).length;
    expect(byeCount).toBe(3); // 8枠 - 5人
  });

  it("BYEは下位シード側に入り、第1シードは不戦勝になる", () => {
    const bracket = buildBracket(5);
    const first = bracket.matches.find((m) => m.round === 1 && m.position === 0);
    expect(first?.sourceA).toEqual({ kind: "ENTRANT", entrantIndex: 0 });
    expect(first?.sourceB).toEqual({ kind: "BYE" });
  });

  it("試合数は参加枠数 - 1 になる", () => {
    for (const n of [2, 3, 4, 7, 8, 16, 100]) {
      const bracket = buildBracket(n);
      expect(bracket.matches).toHaveLength(bracket.size - 1);
    }
  });

  it("参加者が2人未満なら表を作らない", () => {
    expect(buildBracket(1).matches).toEqual([]);
    expect(buildBracket(0).matches).toEqual([]);
  });

  it("100人でも決勝まで7ラウンドで収まる", () => {
    const bracket = buildBracket(100);
    expect(bracket.size).toBe(128);
    expect(bracket.roundCount).toBe(7);
  });
});

describe("nextSlot", () => {
  it("勝者は次のラウンドの半分の位置へ進む", () => {
    expect(nextSlot(1, 0, 3)).toEqual({ round: 2, position: 0, sideIndex: 0 });
    expect(nextSlot(1, 1, 3)).toEqual({ round: 2, position: 0, sideIndex: 1 });
    expect(nextSlot(1, 2, 3)).toEqual({ round: 2, position: 1, sideIndex: 0 });
    expect(nextSlot(1, 3, 3)).toEqual({ round: 2, position: 1, sideIndex: 1 });
  });

  it("決勝の勝者には進む先がない", () => {
    expect(nextSlot(3, 0, 3)).toBeNull();
  });
});

describe("resolveBracket", () => {
  it("シード順に参加者を配置する", () => {
    const { matches } = resolveBracket(["a", "b", "c", "d"]);
    const first = matches.find((m) => m.round === 1 && m.position === 0);
    // 第1シード(a)と第4シード(d)が1回戦
    expect(first?.sideIds).toEqual(["a", "d"]);

    const second = matches.find((m) => m.round === 1 && m.position === 1);
    expect(second?.sideIds).toEqual(["b", "c"]);
  });

  it("BYEと当たった参加者は不戦勝になる", () => {
    const { matches } = resolveBracket(["a", "b", "c"]);
    const first = matches.find((m) => m.round === 1 && m.position === 0);

    expect(first?.sideIds).toEqual(["a", null]);
    expect(first?.autoWinnerSide).toBe(0);
  });

  it("両方に参加者がいるマッチは不戦勝にならない", () => {
    const { matches } = resolveBracket(["a", "b", "c", "d"]);
    for (const m of matches.filter((x) => x.round === 1)) {
      expect(m.autoWinnerSide).toBeNull();
    }
  });

  it("2回戦以降は参加者未確定で始まる", () => {
    const { matches } = resolveBracket(["a", "b", "c", "d"]);
    const final = matches.find((m) => m.round === 2);
    expect(final?.sideIds).toEqual([null, null]);
    expect(final?.autoWinnerSide).toBeNull();
  });
});

describe("roundLabel", () => {
  it("決勝から逆算した呼び名を返す", () => {
    expect(roundLabel(3, 3)).toBe("決勝");
    expect(roundLabel(2, 3)).toBe("準決勝");
    expect(roundLabel(1, 3)).toBe("準々決勝");
  });

  it("それより前は人数で表す", () => {
    expect(roundLabel(1, 4)).toBe("16人制 1回戦");
  });
});
