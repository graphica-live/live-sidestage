import { describe, expect, it } from "vitest";
import { assignFactionColors, GOLD, OPPONENT_COLORS, resolveWinningTeamIndex, SELF_COLOR } from "./battle-colors";

describe("assignFactionColors", () => {
  it("自陣営は常に赤、相手はバトルスコア降順で青→橙→紫", () => {
    const colors = assignFactionColors([
      { index: 0, isSelf: true, score: "100" },
      { index: 1, isSelf: false, score: "300" },
      { index: 2, isSelf: false, score: "900" },
      { index: 3, isSelf: false, score: null },
    ]);
    expect(colors.get(0)).toBe(SELF_COLOR);
    expect(colors.get(2)).toBe(OPPONENT_COLORS[0]);
    expect(colors.get(1)).toBe(OPPONENT_COLORS[1]);
    // スコア未確定の陣営は最後尾へ回す(色は残りの1つ)
    expect(colors.get(3)).toBe(OPPONENT_COLORS[2]);
    expect(GOLD).toBe("#f5c451");
  });
});

describe("resolveWinningTeamIndex", () => {
  it("陣営の公式スコアが最大の陣営を返す", () => {
    expect(
      resolveWinningTeamIndex([
        { index: 0, score: "5000" },
        { index: 1, score: "9000" },
      ])
    ).toBe(1);
  });

  it("最高スコアが同点なら誰にも WIN を出さない", () => {
    expect(
      resolveWinningTeamIndex([
        { index: 0, score: "5000" },
        { index: 1, score: "5000" },
        { index: 2, score: "10" },
      ])
    ).toBeNull();
  });

  it("スコアが確定している陣営が2つ未満なら null", () => {
    expect(resolveWinningTeamIndex([{ index: 0, score: "100" }])).toBeNull();
    expect(
      resolveWinningTeamIndex([
        { index: 0, score: "100" },
        { index: 1, score: null },
      ])
    ).toBeNull();
  });
});
