import { describe, it, expect } from "vitest";
import {
  isByeRow,
  isForceFullPeriod,
  isReadyForDetection,
  isStartedMatch,
  parseWinnerFeeders,
} from "./match-status";

const progress = (
  status: string,
  winnerDecidedBy: string | null = null,
  isBye = false
) => ({ status, winnerDecidedBy, isBye });

describe("isStartedMatch", () => {
  it("実際の対戦が付いている状態は進行中と数える", () => {
    for (const status of ["LIVE", "DETECTED", "NEEDS_REVIEW"]) {
      expect(isStartedMatch(progress(status))).toBe(true);
    }
    expect(isStartedMatch(progress("FINISHED", "AGGREGATE"))).toBe(true);
    expect(isStartedMatch(progress("FINISHED", "MANUAL"))).toBe(true);
  });

  it("SCHEDULED は進行中と数えない", () => {
    expect(isStartedMatch(progress("SCHEDULED"))).toBe(false);
  });

  it("NO_SHOW は進行中と数えない(表を作り直せなくなるため)", () => {
    // 1回戦の開始時刻を過去に置くと、表を作った直後の集計で NO_SHOW が並ぶ。
    // これを進行済みに数えると、その表は二度と作り直せなくなる。
    expect(isStartedMatch(progress("NO_SHOW"))).toBe(false);
  });

  it("VOID は進行中と数えない(無効にしたのに作り直せないのは矛盾する)", () => {
    expect(isStartedMatch(progress("VOID"))).toBe(false);
  });

  it("未知の status は進行中と数える(fail closed)", () => {
    expect(isStartedMatch(progress("SOMETHING_NEW"))).toBe(true);
    expect(isStartedMatch(progress(""))).toBe(true);
  });

  it("不戦勝行は FINISHED でも進行中と数えない", () => {
    expect(isStartedMatch(progress("FINISHED", "BYE", true))).toBe(false);
  });

  it("rules.bye を持たない旧データも winnerDecidedBy で不戦勝と分かる", () => {
    expect(isStartedMatch(progress("FINISHED", "BYE", false))).toBe(false);
  });
});

describe("isByeRow", () => {
  it("rules.bye === true のときだけ true", () => {
    expect(isByeRow({ bye: true })).toBe(true);
    expect(isByeRow({ bye: false })).toBe(false);
    expect(isByeRow({ roundLabel: "決勝" })).toBe(false);
  });

  it("オブジェクト以外は false", () => {
    expect(isByeRow(null)).toBe(false);
    expect(isByeRow(undefined)).toBe(false);
    expect(isByeRow([{ bye: true }])).toBe(false);
    expect(isByeRow("bye")).toBe(false);
  });
});

describe("isReadyForDetection", () => {
  it("両サイドに出場者がいれば検知の対象", () => {
    expect(isReadyForDetection({ isBye: false, sideRoomIds: [["a"], ["b"]] })).toBe(true);
    expect(
      isReadyForDetection({ isBye: false, sideRoomIds: [["a1", "a2"], ["b1", "b2"]] })
    ).toBe(true);
  });

  it("片側の出場者が未確定なら対象にしない", () => {
    // 上流の勝者が片方しか決まっていない枠。room の和集合で見ると {a} になり、
    // a が部外者と戦ったバトルが完全一致で載ってしまう。
    expect(isReadyForDetection({ isBye: false, sideRoomIds: [["a"], []] })).toBe(false);
    expect(isReadyForDetection({ isBye: false, sideRoomIds: [[], ["b"]] })).toBe(false);
  });

  it("両サイドとも未確定なら対象にしない", () => {
    expect(isReadyForDetection({ isBye: false, sideRoomIds: [[], []] })).toBe(false);
  });

  it("不戦勝行は両サイドが埋まっていても対象にしない", () => {
    expect(isReadyForDetection({ isBye: true, sideRoomIds: [["a"], ["b"]] })).toBe(false);
  });

  it("サイドが2つ揃っていなければ対象にしない", () => {
    expect(isReadyForDetection({ isBye: false, sideRoomIds: [] })).toBe(false);
    expect(isReadyForDetection({ isBye: false, sideRoomIds: [["a"]] })).toBe(false);
  });
});

describe("isForceFullPeriod", () => {
  it("forceFullPeriod: true のときだけ true を返す", () => {
    expect(isForceFullPeriod({ forceFullPeriod: true })).toBe(true);
    expect(isForceFullPeriod({ forceFullPeriod: false })).toBe(false);
    expect(isForceFullPeriod({})).toBe(false);
    expect(isForceFullPeriod(null)).toBe(false);
    expect(isForceFullPeriod(undefined)).toBe(false);
    expect(isForceFullPeriod("forceFullPeriod")).toBe(false);
  });

  it("既存キー(roundLabel/bye/reviewReason)を潰さずに forceFullPeriod だけ見る", () => {
    const rules = {
      roundLabel: "1回戦",
      bye: false,
      reviewReason: "PARTIAL",
      forceFullPeriod: true,
    };
    expect(isForceFullPeriod(rules)).toBe(true);
    expect(isByeRow(rules)).toBe(false);
    expect(rules.roundLabel).toBe("1回戦");
    expect(rules.reviewReason).toBe("PARTIAL");
  });
});

describe("parseWinnerFeeders", () => {
  const valid = {
    winnerFeeders: {
      slots: [
        { round: 1, position: 0 },
        { round: 1, position: 1 },
      ],
      changedAt: "2026-08-26T00:00:00.000Z",
    },
  };

  it("キーが無ければ null(override無し)", () => {
    expect(parseWinnerFeeders({})).toBeNull();
    expect(parseWinnerFeeders({ roundLabel: "準決勝" })).toBeNull();
    expect(parseWinnerFeeders(null)).toBeNull();
    expect(parseWinnerFeeders(undefined)).toBeNull();
  });

  it("正しい形式なら ok:true で値を返す", () => {
    const result = parseWinnerFeeders(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        slots: [
          { round: 1, position: 0 },
          { round: 1, position: 1 },
        ],
        changedAt: "2026-08-26T00:00:00.000Z",
      },
    });
  });

  it("既存キー(roundLabel等)と共存しても正しく読める", () => {
    const rules = { roundLabel: "準決勝", ...valid };
    expect(parseWinnerFeeders(rules)).toEqual({ ok: true, value: valid.winnerFeeders });
  });

  it("slots が2要素でなければ ok:false(fail closed)", () => {
    expect(
      parseWinnerFeeders({
        winnerFeeders: { slots: [{ round: 1, position: 0 }], changedAt: "2026-08-26T00:00:00.000Z" },
      })
    ).toEqual({ ok: false });
    expect(
      parseWinnerFeeders({
        winnerFeeders: {
          slots: [
            { round: 1, position: 0 },
            { round: 1, position: 1 },
            { round: 1, position: 2 },
          ],
          changedAt: "2026-08-26T00:00:00.000Z",
        },
      })
    ).toEqual({ ok: false });
  });

  it("slots の要素に null は許さない(loserFrom と違う。BYE側を対象外にしているため)", () => {
    expect(
      parseWinnerFeeders({
        winnerFeeders: { slots: [null, { round: 1, position: 1 }], changedAt: "2026-08-26T00:00:00.000Z" },
      })
    ).toEqual({ ok: false });
  });

  it("round/position が整数でない、または position が負なら ok:false", () => {
    const base = { round: 1, position: 1 };
    for (const bad of [
      { round: 1.5, position: 0 },
      { round: "1", position: 0 },
      { round: 1, position: -1 },
      { round: 1, position: 0.5 },
    ]) {
      expect(
        parseWinnerFeeders({
          winnerFeeders: { slots: [bad, base], changedAt: "2026-08-26T00:00:00.000Z" },
        })
      ).toEqual({ ok: false });
    }
  });

  it("両方の座標が同じ(重複source)なら ok:false", () => {
    expect(
      parseWinnerFeeders({
        winnerFeeders: {
          slots: [
            { round: 1, position: 0 },
            { round: 1, position: 0 },
          ],
          changedAt: "2026-08-26T00:00:00.000Z",
        },
      })
    ).toEqual({ ok: false });
  });

  it("changedAt が不正な日時文字列なら ok:false", () => {
    expect(
      parseWinnerFeeders({
        winnerFeeders: {
          slots: [
            { round: 1, position: 0 },
            { round: 1, position: 1 },
          ],
          changedAt: "not-a-date",
        },
      })
    ).toEqual({ ok: false });
  });

  it("winnerFeeders 自体がオブジェクトでなければ ok:false", () => {
    expect(parseWinnerFeeders({ winnerFeeders: "broken" })).toEqual({ ok: false });
    expect(parseWinnerFeeders({ winnerFeeders: null })).toEqual({ ok: false });
    expect(parseWinnerFeeders({ winnerFeeders: [1, 2] })).toEqual({ ok: false });
  });
});
