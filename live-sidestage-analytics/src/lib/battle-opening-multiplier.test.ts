import { describe, it, expect } from "vitest";
import {
  inferOpeningMultiplier,
  GIFT_TO_SCORE_LAG_MS,
  SCORE_ASSIGNMENT_AMBIGUITY_MS,
  MIN_CANDIDATE_DIAMONDS,
  OPENING_WINDOW_MS,
  type OpeningGift,
  type OpeningScorePoint,
  type OpeningBonusInterval,
  type OpeningTapPoint,
} from "./battle-opening-multiplier";

const WINDOW_START = new Date("2026-09-07T00:00:00.000Z");
const ANCHOR = "anchor-self";

function at(offsetMs: number): Date {
  return new Date(WINDOW_START.getTime() + offsetMs);
}

/** 起点(0点)から始まり、指定した増分を順に足したスコア列を作る。 */
function scoreSeries(steps: { offsetMs: number; score: number }[]): OpeningScorePoint[] {
  return [
    { anchorId: ANCHOR, occurredAt: at(0), score: "0" },
    ...steps.map((s) => ({ anchorId: ANCHOR, occurredAt: at(s.offsetMs), score: String(s.score) })),
  ];
}

function gift(overrides: Partial<OpeningGift> & { offsetMs: number }): OpeningGift {
  const { offsetMs, ...rest } = overrides;
  return {
    id: `gift-${offsetMs}`,
    anchorId: ANCHOR,
    occurredAt: at(offsetMs),
    totalDiamonds: 1000,
    multiplierType: 0,
    ...rest,
  };
}

function infer(
  scorePoints: OpeningScorePoint[],
  gifts: OpeningGift[],
  bonusIntervals: OpeningBonusInterval[] = [],
  tapPoints: OpeningTapPoint[] = [],
  tapTrackedAnchorIds: Set<string> = new Set()
) {
  return inferOpeningMultiplier({
    windowStart: WINDOW_START,
    windowStartReliable: true,
    scorePoints,
    gifts,
    bonusIntervals,
    tapPoints,
    tapTrackedAnchorIds,
  });
}

/** 10タップ到達リスナー1人ぶんのタップ点。 */
function tap(offsetMs: number, points = 3, anchorId = ANCHOR): OpeningTapPoint {
  return { anchorId, occurredAt: at(offsetMs), points };
}

describe("inferOpeningMultiplier", () => {
  it("倍率刻印つきのクリーン候補が2件揃えば measured", () => {
    const result = infer(
      scoreSeries([
        { offsetMs: 5_000, score: 2000 },
        { offsetMs: 15_000, score: 4000 },
      ]),
      [gift({ offsetMs: 3_000 }), gift({ offsetMs: 13_000 })]
    );
    expect(result.multiplier).toBe(2);
    expect(result.confidence).toBe("measured");
    expect(result.basisGiftId).toBe("gift-3000");
  });

  it("3倍も同様に判定できる", () => {
    const result = infer(
      scoreSeries([
        { offsetMs: 5_000, score: 3000 },
        { offsetMs: 15_000, score: 6000 },
      ]),
      [gift({ offsetMs: 3_000 }), gift({ offsetMs: 13_000 })]
    );
    expect(result.multiplier).toBe(3);
    expect(result.confidence).toBe("measured");
  });

  it("倍率なし(x1)は null ではなく 1 として返す", () => {
    const result = infer(
      scoreSeries([
        { offsetMs: 5_000, score: 1000 },
        { offsetMs: 15_000, score: 2000 },
      ]),
      [gift({ offsetMs: 3_000 }), gift({ offsetMs: 13_000 })]
    );
    expect(result.multiplier).toBe(1);
    expect(result.confidence).toBe("measured");
  });

  it("候補が1件だけなら inferred に留める", () => {
    const result = infer(scoreSeries([{ offsetMs: 5_000, score: 2000 }]), [gift({ offsetMs: 3_000 })]);
    expect(result.multiplier).toBe(2);
    expect(result.confidence).toBe("inferred");
  });

  it("倍率刻印が未観測(null)の候補は measured へ上げない", () => {
    const result = infer(
      scoreSeries([
        { offsetMs: 5_000, score: 2000 },
        { offsetMs: 15_000, score: 4000 },
      ]),
      [gift({ offsetMs: 3_000, multiplierType: null }), gift({ offsetMs: 13_000, multiplierType: null })]
    );
    expect(result.multiplier).toBe(2);
    // TOP_2 / TOP_3 ブースター(x2)と区別できないため。
    expect(result.confidence).toBe("inferred");
  });

  it("1区間に複数のギフトが入っても合算して比を出す", () => {
    // armies の更新間隔は数百ms〜数秒あるので、1区間に複数ギフトが入るのはむしろ普通。
    // 「ちょうど1件」を要求していた頃は本番 976 バトル中 774 件が unknown だった。
    const result = infer(scoreSeries([{ offsetMs: 5_000, score: 4000 }]), [
      gift({ offsetMs: 4_400 }),
      gift({ offsetMs: 4_600 }),
    ]);
    expect(result.multiplier).toBe(2);
    expect(result.confidence).toBe("inferred");
  });

  it("区間内に別倍率(グローブcrit)が1件でも混ざれば区間ごと捨てる", () => {
    const result = infer(scoreSeries([{ offsetMs: 5_000, score: 4000 }]), [
      gift({ offsetMs: 4_400 }),
      gift({ offsetMs: 4_600, multiplierType: 1 }),
    ]);
    expect(result.confidence).toBe("unknown");
  });

  it("反映遅延が1.4秒でも候補として拾う(本番実測の最頻帯)", () => {
    // 本番実測 n=4838 で p50=1533ms・最頻帯 1000〜1500ms。ここを ambiguous として捨てていたのが
    // unknown 多発の主因だった。
    const result = infer(
      scoreSeries([
        { offsetMs: 5_000, score: 2000 },
        { offsetMs: 15_000, score: 4000 },
      ]),
      [gift({ offsetMs: 3_600 }), gift({ offsetMs: 13_600 })]
    );
    expect(result.multiplier).toBe(2);
    expect(result.confidence).toBe("measured");
  });

  it("別 anchor 宛のギフトを他人のスコア増分の原因にしない", () => {
    const result = infer(scoreSeries([{ offsetMs: 5_000, score: 2000 }]), [
      gift({ offsetMs: 3_000, anchorId: "anchor-rival" }),
    ]);
    expect(result.confidence).toBe("unknown");
  });

  it("小粒ギフトは候補にしない", () => {
    const result = infer(scoreSeries([{ offsetMs: 5_000, score: 2 }]), [
      gift({ offsetMs: 3_000, totalDiamonds: MIN_CANDIDATE_DIAMONDS - 1 }),
    ]);
    expect(result.confidence).toBe("unknown");
  });

  it("グローブcrit(multiplierType=1)は候補から外す", () => {
    const result = infer(scoreSeries([{ offsetMs: 5_000, score: 5000 }]), [
      gift({ offsetMs: 3_000, multiplierType: 1 }),
    ]);
    expect(result.confidence).toBe("unknown");
  });

  it("ボーナス報酬区間と重なるギフトは候補から外す", () => {
    const result = infer(scoreSeries([{ offsetMs: 5_000, score: 3000 }]), [gift({ offsetMs: 3_000 })], [
      { startedAt: at(2_500), endedAt: at(9_000) },
    ]);
    expect(result.confidence).toBe("unknown");
  });

  it("候補どうしの倍率が食い違ったら unknown(片方を採用しない)", () => {
    const result = infer(
      scoreSeries([
        { offsetMs: 5_000, score: 2000 },
        { offsetMs: 15_000, score: 5000 },
      ]),
      [gift({ offsetMs: 3_000 }), gift({ offsetMs: 13_000 })]
    );
    expect(result.confidence).toBe("unknown");
    expect(result.multiplier).toBeNull();
  });

  it("整数から離れた比は採用しない", () => {
    const result = infer(scoreSeries([{ offsetMs: 5_000, score: 2500 }]), [gift({ offsetMs: 3_000 })]);
    expect(result.confidence).toBe("unknown");
  });

  it("4倍以上は採用しない(未観測の倍率を作らない)", () => {
    const result = infer(scoreSeries([{ offsetMs: 5_000, score: 4000 }]), [gift({ offsetMs: 3_000 })]);
    expect(result.confidence).toBe("unknown");
  });

  it("候補区間(60秒)より後のギフトは見ない", () => {
    const result = infer(
      [
        { anchorId: ANCHOR, occurredAt: at(0), score: "0" },
        { anchorId: ANCHOR, occurredAt: at(90_000), score: "2000" },
      ],
      [gift({ offsetMs: 88_000 })]
    );
    expect(result.confidence).toBe("unknown");
  });

  it("スコア点が無ければ unknown", () => {
    expect(infer([], [gift({ offsetMs: 3_000 })]).confidence).toBe("unknown");
  });

  it("ギフトが無ければ unknown", () => {
    expect(infer(scoreSeries([{ offsetMs: 5_000, score: 2000 }]), []).confidence).toBe("unknown");
  });

  it("同じギフトを隣接する2区間へ二重に割り当てない", () => {
    // スコア点の間隔を lag より短くすると、素朴な (t[i-1]-lag, t[i]] の重ね合わせでは
    // 1件のギフトが2区間に入り、両方が「ちょうど1件」を満たしてしまう。
    const gap = GIFT_TO_SCORE_LAG_MS / 2;
    const result = infer(
      [
        { anchorId: ANCHOR, occurredAt: at(0), score: "0" },
        { anchorId: ANCHOR, occurredAt: at(5_000), score: "2000" },
        { anchorId: ANCHOR, occurredAt: at(5_000 + gap), score: "4000" },
      ],
      [gift({ offsetMs: 3_000 })]
    );
    // 2番目の区間はギフト0件になるので候補にならず、候補は1件だけ。
    expect(result.multiplier).toBe(2);
    expect(result.confidence).toBe("inferred");
  });

  it("スコア点の直前(曖昧判定の閾値未満)に届いたギフトは、その区間も次の区間も候補にしない", () => {
    // 増分がこのスコア点に出たのか次の点に出たのか、時刻からは決められない。
    const result = infer(
      scoreSeries([
        { offsetMs: 5_000, score: 2000 },
        { offsetMs: 15_000, score: 4000 },
      ]),
      [gift({ offsetMs: 5_000 - SCORE_ASSIGNMENT_AMBIGUITY_MS / 2 }), gift({ offsetMs: 13_000 })]
    );
    expect(result.confidence).toBe("unknown");
    expect(result.multiplier).toBeNull();
  });

  it("windowStartが推定(配信途中から接続)なら判定しない", () => {
    // バトル中盤の通常ギフトが ratio=1 で並ぶだけなので、「倍率なしと判定できた」にしてはいけない。
    const result = inferOpeningMultiplier({
      windowStart: WINDOW_START,
      windowStartReliable: false,
      scorePoints: scoreSeries([
        { offsetMs: 5_000, score: 1000 },
        { offsetMs: 15_000, score: 2000 },
      ]),
      gifts: [gift({ offsetMs: 3_000 }), gift({ offsetMs: 13_000 })],
      bonusIntervals: [],
      tapPoints: [],
      tapTrackedAnchorIds: new Set(),
    });
    expect(result.confidence).toBe("unknown");
    expect(result.multiplier).toBeNull();
  });

  it("区間の開始・終了は仮定値から埋めない(常にnull)", () => {
    const result = infer(
      scoreSeries([
        { offsetMs: 5_000, score: 2000 },
        { offsetMs: 15_000, score: 4000 },
      ]),
      [gift({ offsetMs: 3_000 }), gift({ offsetMs: 13_000 })]
    );
    expect(result.windowStartedAt).toBeNull();
    expect(result.windowEndedAt).toBeNull();
  });
});

describe("inferOpeningMultiplier — タップ点の差し引き", () => {
  // 本番実測の再現(2026-09-08)。200ダイヤのギフトに対しスコアが 406 増えており、
  // 406/200 = 2.03 は RATIO_TOLERANCE(0.02) を超えるので x2 が棄却されていた。
  // 10タップ到達2人ぶん(3点 x 2 = 6点)を引くと 400/200 = 2.00 で通る。
  const CONTAMINATED = () =>
    scoreSeries([
      { offsetMs: 5_000, score: 406 },
      { offsetMs: 15_000, score: 812 },
    ]);
  const GIFTS = () => [
    gift({ offsetMs: 3_000, totalDiamonds: 200 }),
    gift({ offsetMs: 13_000, totalDiamonds: 200 }),
  ];
  const TAPS = () => [tap(4_000), tap(4_200), tap(14_000), tap(14_200)];

  it("計測済み anchor ではタップ点を引いてから比を取る", () => {
    const result = infer(CONTAMINATED(), GIFTS(), [], TAPS(), new Set([ANCHOR]));
    expect(result.multiplier).toBe(2);
    expect(result.confidence).toBe("measured");
  });

  it("差し引かなければ同じデータが unknown になる(この修正が効いている証拠)", () => {
    const result = infer(CONTAMINATED(), GIFTS());
    expect(result.confidence).toBe("unknown");
  });

  it("未計測の anchor は行があっても差し引かない(タップ計測導入前と同じ判定)", () => {
    const result = infer(CONTAMINATED(), GIFTS(), [], TAPS(), new Set());
    expect(result.confidence).toBe("unknown");
  });

  it("別 anchor 宛のタップ点は差し引かない", () => {
    const result = infer(
      CONTAMINATED(),
      GIFTS(),
      [],
      [tap(4_000, 3, "anchor-other"), tap(4_200, 3, "anchor-other")],
      new Set([ANCHOR, "anchor-other"])
    );
    expect(result.confidence).toBe("unknown");
  });

  it("窓外のタップ点は差し引かない", () => {
    // 窓の前後のタップを足しても、汚染されていない区間の判定は動かない。
    const clean = () =>
      scoreSeries([
        { offsetMs: 5_000, score: 400 },
        { offsetMs: 15_000, score: 800 },
      ]);
    const withOutside = infer(
      clean(),
      GIFTS(),
      [],
      [tap(-1), tap(OPENING_WINDOW_MS + 1)],
      new Set([ANCHOR])
    );
    expect(withOutside).toEqual(infer(clean(), GIFTS(), [], [], new Set([ANCHOR])));
    expect(withOutside.multiplier).toBe(2);
  });

  it("スコア点の直前 SCORE_ASSIGNMENT_AMBIGUITY_MS 内のタップがある区間は候補から外す", () => {
    const result = infer(
      CONTAMINATED(),
      GIFTS(),
      [],
      [tap(5_000 - SCORE_ASSIGNMENT_AMBIGUITY_MS / 2), tap(4_200), tap(14_000), tap(14_200)],
      new Set([ANCHOR])
    );
    expect(result.confidence).toBe("unknown");
  });

  it("区間の始端 SCORE_ASSIGNMENT_AMBIGUITY_MS 内のタップがある区間も候補から外す", () => {
    // 1区間目の始端(offset 0 の起点)直後に貼り付いたタップ。手前の点に既に反映されていた
    // 可能性を消せないので、その区間は使わない。
    const result = infer(
      CONTAMINATED(),
      GIFTS(),
      [],
      [tap(SCORE_ASSIGNMENT_AMBIGUITY_MS / 2), tap(4_200), tap(14_000), tap(14_200)],
      new Set([ANCHOR])
    );
    // 1区間目が落ちて候補1件だけになるので measured へは上がらない。
    expect(result.confidence).toBe("inferred");
    expect(result.basisGiftId).toBe("gift-13000");
  });

  it("差し引き量が TAP_CORRECTION_MAX_RATIO を超える区間は候補にしない", () => {
    // 200ダイヤの区間で上限は 20点。10タップ到達10人(30点)は超える。
    const taps = Array.from({ length: 10 }, (_, i) => tap(3_500 + i * 10));
    const result = infer(
      scoreSeries([{ offsetMs: 5_000, score: 430 }]),
      [gift({ offsetMs: 3_000, totalDiamonds: 200 })],
      [],
      taps,
      new Set([ANCHOR])
    );
    expect(result.confidence).toBe("unknown");
  });

  it("差し引いた結果 delta が 0 以下になる区間は候補にしない", () => {
    const result = infer(
      scoreSeries([{ offsetMs: 5_000, score: 3 }]),
      [gift({ offsetMs: 3_000, totalDiamonds: 200 })],
      [],
      [tap(4_000)],
      new Set([ANCHOR])
    );
    expect(result.confidence).toBe("unknown");
  });

  it("計測済みでタップ点0件なら差し引き0(未計測と結果が変わらない)", () => {
    const clean = () =>
      scoreSeries([
        { offsetMs: 5_000, score: 400 },
        { offsetMs: 15_000, score: 800 },
      ]);
    const tracked = infer(clean(), GIFTS(), [], [], new Set([ANCHOR]));
    const untracked = infer(clean(), GIFTS());
    expect(tracked.multiplier).toBe(2);
    expect(tracked).toEqual(untracked);
  });
});
