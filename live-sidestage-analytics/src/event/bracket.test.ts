import { describe, it, expect } from "vitest";
import {
  MAX_BRACKET_SIZE,
  bracketSize,
  buildBracket,
  buildManualBracket,
  buildStagedBracket,
  nextSlot,
  resolveBracket,
  resolveManualBracket,
  roundLabel,
  seedOrder,
  stagedRoundLabel,
  validatePlacement,
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

/** 決定的な擬似乱数(テストを再現可能にする)。 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** size 枠のうち count 個を擬似乱数で埋めた配置。 */
function randomOccupied(size: number, count: number, seed: number): boolean[] {
  const next = rng(seed);
  const indexes = Array.from({ length: size }, (_, i) => i);
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  const taken = new Set(indexes.slice(0, count));
  return Array.from({ length: size }, (_, i) => taken.has(i));
}

describe("buildManualBracket", () => {
  it("両側とも空の枝は行を作らない", () => {
    // 8枠に葉0,1,2 だけ。position3(葉6,7)は誰も来ないので行が無い。
    const bracket = buildManualBracket([true, true, true, false, false, false, false, false]);
    const round1 = bracket.matches.filter((m) => m.round === 1).map((m) => m.position);
    expect(round1).toEqual([0, 1]);
    expect(bracket.roundCount).toBe(3);
  });

  it("右側だけ埋まった枠は、右側(sourceB)のまま不戦勝行になる", () => {
    // 主催者が「カードの下段」へ置いた指定を、生成器が上段へ寄せてはいけない。
    const bracket = buildManualBracket([false, true, false, true]);
    const first = bracket.matches.find((m) => m.round === 1 && m.position === 0);
    expect(first?.sourceA).toEqual({ kind: "BYE" });
    expect(first?.sourceB).toEqual({ kind: "ENTRANT", entrantIndex: 1 });
  });

  it("実試合(両側にエントリー・勝者が来る行)の数は配置数-1になる", () => {
    for (const [size, count] of [
      [4, 3],
      [8, 5],
      [8, 8],
      [16, 9],
      [16, 11],
      [32, 17],
    ] as const) {
      const bracket = buildManualBracket(randomOccupied(size, count, size * 31 + count));
      const real = bracket.matches.filter(
        (m) => m.sourceA.kind !== "BYE" && m.sourceB.kind !== "BYE"
      );
      expect(real).toHaveLength(count - 1);
    }
  });

  it("配置が2組未満なら表を作らない", () => {
    expect(buildManualBracket([true, false, false, false]).matches).toEqual([]);
    expect(buildManualBracket([false, false]).matches).toEqual([]);
  });

  it("nextSlot の機械的な転送先と、実際に作られた行の座標が完全に一致する(座標の整合性)", () => {
    // 段階的方式と同じ回帰テストを、任意配置(飛び地・片側寄せ)に対して回す。
    // ここがずれると、無関係な2人の実試合を丸ごと不戦勝処理するデータ破損になる。
    const cases: boolean[][] = [
      [true, false, false, true],
      [false, true, true, false],
      [true, true, false, false, false, false, true, true],
      [false, false, true, true, true, false, false, true],
      ...[
        [8, 5],
        [16, 9],
        [16, 12],
        [32, 17],
        [32, 30],
        [64, 33],
      ].map(([size, count]) => randomOccupied(size, count, size + count)),
    ];

    for (const occupied of cases) {
      const bracket = buildManualBracket(occupied);
      const byPos = new Map(bracket.matches.map((m) => [`${m.round}:${m.position}`, m]));
      const aliveByRound = new Map<number, Set<number>>();
      for (let round = 1; round <= bracket.roundCount; round++) {
        aliveByRound.set(
          round,
          new Set(bracket.matches.filter((m) => m.round === round).map((m) => m.position))
        );
      }

      for (let round = 1; round < bracket.roundCount; round++) {
        const alive = aliveByRound.get(round)!;
        const nextAlive = aliveByRound.get(round + 1)!;
        for (const position of alive) {
          const slot = nextSlot(round, position, bracket.roundCount)!;
          expect(slot).not.toBeNull();
          expect(nextAlive.has(slot.position)).toBe(true);

          const target = byPos.get(`${slot.round}:${slot.position}`)!;
          expect(target).toBeDefined();

          const targetSources = [target.sourceA, target.sourceB];
          if (targetSources.some((s) => s.kind === "BYE")) {
            // 不戦勝行へ入ってくる生きた枠は高々1つ(相手側には構造的に誰も来ない)。
            const siblings = [...alive].filter(
              (p) => nextSlot(round, p, bracket.roundCount)!.position === slot.position
            );
            expect(siblings).toHaveLength(1);
            // **その1つが入る側(sideIndex)と、BYE でない側が一致すること。**
            // ここがずれると「不戦勝の印」と実際の転送内容が食い違う。
            expect(targetSources[slot.sideIndex].kind).not.toBe("BYE");
            expect(targetSources[1 - slot.sideIndex].kind).toBe("BYE");
          }
        }
      }
    }
  });
});

describe("resolveManualBracket", () => {
  it("葉に置いたとおりに1回戦のサイドへ入る", () => {
    const { matches, roundCount } = resolveManualBracket(["a", "b", "c", "d"]);
    expect(roundCount).toBe(2);
    expect(matches.find((m) => m.round === 1 && m.position === 0)?.sideIds).toEqual(["a", "b"]);
    expect(matches.find((m) => m.round === 1 && m.position === 1)?.sideIds).toEqual(["c", "d"]);
  });

  it("右側だけ置いた枠は sideIndex 1 が不戦勝の勝者になる", () => {
    const { matches } = resolveManualBracket([null, "a", "b", "c"]);
    const bye = matches.find((m) => m.round === 1 && m.position === 0);
    expect(bye?.sideIds).toEqual([null, "a"]);
    expect(bye?.autoWinnerSide).toBe(1);
    expect(bye?.isBye).toBe(true);
  });

  it("左側だけ置いた枠は sideIndex 0 が不戦勝の勝者になる", () => {
    const { matches } = resolveManualBracket(["a", null, "b", "c"]);
    const bye = matches.find((m) => m.round === 1 && m.position === 0);
    expect(bye?.sideIds).toEqual(["a", null]);
    expect(bye?.autoWinnerSide).toBe(0);
  });

  it("2回戦以降の不戦勝(相手が実試合の勝者)は作成時点では確定しない", () => {
    // 8枠に3組。position0 は実試合、position1 は空なので、2回戦は動的な不戦勝になる。
    const { matches } = resolveManualBracket(["a", "b", null, null, "c", null, null, null]);
    const dynamic = matches.find((m) => m.round === 2 && m.position === 0);
    expect(dynamic?.sideIds).toEqual([null, null]);
    expect(dynamic?.autoWinnerSide).toBeNull();
    expect(dynamic?.isBye).toBe(true);
  });
});

describe("validatePlacement", () => {
  it("枠数が配置数に対して最小の2のべき乗なら通る", () => {
    expect(validatePlacement(["a", "b"])).toEqual({ ok: true });
    expect(validatePlacement(["a", null, "b", "c"])).toEqual({ ok: true });
    expect(validatePlacement([null, "a", "b", null, "c", null, "d", "e"])).toEqual({ ok: true });
  });

  it("配置が2組未満なら弾く", () => {
    expect(validatePlacement(["a", null]).ok).toBe(false);
    expect(validatePlacement([null, null, null, null]).ok).toBe(false);
  });

  it("同じエントリーを複数の枠に置いたら弾く", () => {
    expect(validatePlacement(["a", "b", "a", null]).ok).toBe(false);
  });

  it("枠数が配置数に見合わないものは弾く(疎な巨大ツリーを作らせない)", () => {
    // 2組しか置いていないのに8枠、のような配置。
    expect(validatePlacement(["a", "b", null, null, null, null, null, null]).ok).toBe(false);
    // 2のべき乗でない枠数も同じ判定で落ちる。
    expect(validatePlacement(["a", "b", "c"]).ok).toBe(false);
  });

  it("上限を超える枠数は弾く", () => {
    const huge = Array.from({ length: MAX_BRACKET_SIZE * 2 }, (_, i) => (i < 300 ? `p${i}` : null));
    expect(validatePlacement(huge).ok).toBe(false);
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
