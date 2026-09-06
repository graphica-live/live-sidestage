import { describe, it, expect } from "vitest";
import {
  inferOpeningMultiplier,
  GIFT_TO_SCORE_LAG_MS,
  MIN_CANDIDATE_DIAMONDS,
  type OpeningGift,
  type OpeningScorePoint,
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
    occurredAt: at(offsetMs),
    totalDiamonds: 1000,
    multiplierType: 0,
    ...rest,
  };
}

function infer(scorePoints: OpeningScorePoint[], gifts: OpeningGift[], bonusIntervals = []) {
  return inferOpeningMultiplier({
    windowStart: WINDOW_START,
    windowStartReliable: true,
    scorePoints,
    gifts,
    bonusIntervals,
  });
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

  it("1区間に2件のギフトが入ったら候補にしない(同時多発)", () => {
    const result = infer(scoreSeries([{ offsetMs: 5_000, score: 4000 }]), [
      gift({ offsetMs: 4_400 }),
      gift({ offsetMs: 4_600 }),
    ]);
    expect(result.confidence).toBe("unknown");
    expect(result.multiplier).toBeNull();
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
    const result = inferOpeningMultiplier({
      windowStart: WINDOW_START,
      windowStartReliable: true,
      scorePoints: scoreSeries([{ offsetMs: 5_000, score: 3000 }]),
      gifts: [gift({ offsetMs: 3_000 })],
      bonusIntervals: [{ startedAt: at(2_500), endedAt: at(9_000) }],
    });
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

  it("スコア点の直前(lag未満)に届いたギフトは、その区間も次の区間も候補にしない", () => {
    // 増分がこのスコア点に出たのか次の点に出たのか、時刻からは決められない。
    const result = infer(
      scoreSeries([
        { offsetMs: 5_000, score: 2000 },
        { offsetMs: 15_000, score: 4000 },
      ]),
      [gift({ offsetMs: 5_000 - GIFT_TO_SCORE_LAG_MS / 2 }), gift({ offsetMs: 13_000 })]
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
