import { describe, it, expect } from "vitest";
import {
  bracketSize,
  buildBracket,
  buildStagedBracket,
  nextSlot,
  resolveBracket,
  roundLabel,
  seedOrder,
  stagedRoundLabel,
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

describe("buildStagedBracket", () => {
  it("ラウンド数は標準方式と一致する", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 100]) {
      expect(buildStagedBracket(n).roundCount).toBe(buildBracket(n).roundCount);
    }
  });

  it("実試合数は参加者数-1になる(方式によらず標準方式と同じ)", () => {
    for (const n of [2, 3, 4, 5, 6, 9, 10, 17, 100]) {
      const bracket = buildStagedBracket(n);
      const realMatches = bracket.matches.filter(
        (m) => m.sourceA.kind !== "BYE" && m.sourceB.kind !== "BYE"
      );
      expect(realMatches).toHaveLength(n - 1);
    }
  });

  it("各ラウンドの不戦勝は最大1人(標準方式のように複数人が同時に不戦勝にならない)", () => {
    for (const n of [5, 6, 9, 10, 17, 18, 33, 100]) {
      const bracket = buildStagedBracket(n);
      const byeCountByRound = new Map<number, number>();
      for (const m of bracket.matches) {
        if (m.sourceA.kind === "BYE" || m.sourceB.kind === "BYE") {
          byeCountByRound.set(m.round, (byeCountByRound.get(m.round) ?? 0) + 1);
        }
      }
      for (const count of byeCountByRound.values()) {
        expect(count).toBeLessThanOrEqual(1);
      }
    }
  });

  it("5人の場合、1回戦で同時に複数人が不戦勝にならない(標準方式との違い)", () => {
    const bracket = buildStagedBracket(5);
    const round1Byes = bracket.matches.filter(
      (m) => m.round === 1 && (m.sourceA.kind === "BYE" || m.sourceB.kind === "BYE")
    );
    expect(round1Byes).toHaveLength(1);

    // 総不戦勝は2つ(1回戦と準決勝で1人ずつ)。標準方式の「1回戦で3人同時」とは違う形になる。
    // 葉に空きを均等配置していないため、同じ枠(最後尾のENTRANT)が両方の不戦勝を通過することが
    // ある — 「同時に複数人」は避けているが「同じ人が複数ラウンド」までは保証しない
    // (下の「位置の整合性」テストが保証するのは、そのケースでもデータが壊れないことだけ)。
    const totalByes = bracket.matches.filter(
      (m) => m.sourceA.kind === "BYE" || m.sourceB.kind === "BYE"
    );
    expect(totalByes).toHaveLength(2);
  });

  it("参加者が2人未満なら表を作らない", () => {
    expect(buildStagedBracket(1).matches).toEqual([]);
    expect(buildStagedBracket(0).matches).toEqual([]);
  });

  it("nextSlot の機械的な転送先と、実際に作られた行の座標が完全に一致する(座標の整合性)", () => {
    // buildStagedBracket が「rules.bye」の印を付けた行に、nextSlot() が実際に転送する
    // 中身が一致していることを保証する回帰テスト。これがずれると、無関係な2人の実試合を
    // 誤って不戦勝処理してしまう(過去に実データで発生したバグ)。
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 18, 33, 100]) {
      const bracket = buildStagedBracket(n);
      const byPos = new Map(bracket.matches.map((m) => [`${m.round}:${m.position}`, m]));

      // 各ラウンドで実際に存在する行(round1は葉から、round2以降は前ラウンドの行から)の
      // position 集合を再現し、それぞれの勝者が nextSlot() で計算した転送先に
      // 「ちょうど1人ぶんの空き」があることを確認する。
      const aliveByRound = new Map<number, Set<number>>();
      // round0(葉)の alive position を entrantIndex から逆算する代わりに、
      // round1 の行の sourceA/B が ENTRANT か WINNER_OF(その回はまだ存在しない)かで判定できないため、
      // ここでは「roundごとに存在する行の position 集合」を直接使う。
      for (let round = 1; round <= bracket.roundCount; round++) {
        aliveByRound.set(round, new Set(bracket.matches.filter((m) => m.round === round).map((m) => m.position)));
      }

      for (let round = 1; round < bracket.roundCount; round++) {
        const alive = aliveByRound.get(round)!;
        const nextAlive = aliveByRound.get(round + 1)!;
        for (const position of alive) {
          const slot = nextSlot(round, position, bracket.roundCount);
          expect(slot).not.toBeNull();
          // 転送先のラウンドに、対応する行が実在すること
          expect(nextAlive.has(slot!.position)).toBe(true);
          const target = byPos.get(`${slot!.round}:${slot!.position}`)!;
          expect(target).toBeDefined();
          // 転送先の行が BYE 行なら、転送されてくるのはその行の「唯一の生きている側」で
          // なければならない(=もう片方は BYE、つまり相手は存在しない)。
          const targetIsBye = target.sourceA.kind === "BYE" || target.sourceB.kind === "BYE";
          if (targetIsBye) {
            // 相手側 sideIndex に、alive集合内の別の position から同時に転送されてこないこと
            // = そのラウンドで、この target position を共有する position は alive のうち高々1つ。
            const siblings = [...alive].filter(
              (p) => nextSlot(round, p, bracket.roundCount)!.position === slot!.position
            );
            expect(siblings).toHaveLength(1);
          }
        }
      }
    }
  });
});

describe("resolveBracket (STAGED_BYE)", () => {
  it("1回戦の不戦勝(相手がENTRANT)は作成時点で自動確定する", () => {
    // 5人(size=8): 葉は [a,b,c,d,e,BYE,BYE,BYE]。position2 = (e, BYE) が1回戦唯一の不戦勝。
    const { matches } = resolveBracket(["a", "b", "c", "d", "e"], "STAGED_BYE");
    const byeMatch = matches.find(
      (m) => m.round === 1 && m.sideIds.includes(null) && m.autoWinnerSide !== null
    );
    expect(byeMatch?.sideIds).toEqual(["e", null]);
    expect(byeMatch?.autoWinnerSide).toBe(0);

    const real = matches.find((m) => m.round === 1 && m.position === 0);
    expect(real?.sideIds).toEqual(["a", "b"]);
    expect(real?.autoWinnerSide).toBeNull();
  });

  it("2ラウンド目以降の不戦勝(相手が実試合の勝者)は作成時点では自動確定しない", () => {
    // 6人: 1回戦は3試合とも実試合(不戦勝なし)、2回戦で動的な不戦勝が1つ出る
    const bracket = buildStagedBracket(6);
    const dynamicByeMatch = bracket.matches.find(
      (m) =>
        (m.sourceA.kind === "BYE" && m.sourceB.kind === "WINNER_OF") ||
        (m.sourceB.kind === "BYE" && m.sourceA.kind === "WINNER_OF")
    );
    expect(dynamicByeMatch).toBeDefined();

    const { matches } = resolveBracket(["a", "b", "c", "d", "e", "f"], "STAGED_BYE");
    const resolved = matches.find(
      (m) => m.round === dynamicByeMatch!.round && m.position === dynamicByeMatch!.position
    );
    expect(resolved?.sideIds).toEqual([null, null]);
    expect(resolved?.autoWinnerSide).toBeNull();
  });

  it("標準方式(method省略時の既定)は今までどおり動く", () => {
    const { matches } = resolveBracket(["a", "b", "c", "d"]);
    const first = matches.find((m) => m.round === 1 && m.position === 0);
    expect(first?.sideIds).toEqual(["a", "d"]);
  });
});

describe("stagedRoundLabel", () => {
  it("決勝・準決勝・準々決勝は標準方式と同じ呼び名", () => {
    expect(stagedRoundLabel(3, 3)).toBe("決勝");
    expect(stagedRoundLabel(2, 3)).toBe("準決勝");
    expect(stagedRoundLabel(2, 4)).toBe("準々決勝");
  });

  it("それより前は「N人制」を付けず回戦数だけで表す(実人数が2のべき乗の等比数列にならないため)", () => {
    expect(stagedRoundLabel(1, 5)).toBe("1回戦");
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
