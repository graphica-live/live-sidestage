import { describe, expect, it } from "vitest";
import { resolveGameWinner } from "./match-results";

describe("resolveGameWinner", () => {
  it("ダイヤが多いサイドを勝者にする", () => {
    const winner = resolveGameWinner([
      { sideId: "a", diamonds: 100n },
      { sideId: "b", diamonds: 50n },
    ]);
    expect(winner).toBe("a");
  });

  it("同点なら勝者なし", () => {
    const winner = resolveGameWinner([
      { sideId: "a", diamonds: 100n },
      { sideId: "b", diamonds: 100n },
    ]);
    expect(winner).toBeNull();
  });

  it("全サイド0なら勝者なし", () => {
    const winner = resolveGameWinner([
      { sideId: "a", diamonds: 0n },
      { sideId: "b", diamonds: 0n },
    ]);
    expect(winner).toBeNull();
  });

  it("サイドが1つも無ければ勝者なし", () => {
    expect(resolveGameWinner([])).toBeNull();
  });

  it("3サイド以上でも最大ダイヤのサイドを勝者にする(デスマッチ等の多者対戦を想定)", () => {
    const winner = resolveGameWinner([
      { sideId: "a", diamonds: 10n },
      { sideId: "b", diamonds: 30n },
      { sideId: "c", diamonds: 20n },
    ]);
    expect(winner).toBe("b");
  });

  it("合算グループの候補ごとの部分和を1組のtotalsへ合算してから渡しても、シグネチャは単一候補と同じで判定できる(バトル合算機能)", () => {
    // resolveMatchSeries() は合算グループのメンバー(候補)ごとの scoreSides() 結果を
    // groupTotals へ加算してから resolveGameWinner() を1回だけ呼ぶ。ここでは
    // 「候補Aが70、候補Bが30」を合算した100と、単独候補が80のケースを対比し、
    // resolveGameWinner() 自体は合算後の1組のtotalsを渡すだけで従来どおり動くことを固定する。
    const candidateATotals = 70n;
    const candidateBTotals = 30n;
    const combinedWinner = resolveGameWinner([
      { sideId: "a", diamonds: candidateATotals + candidateBTotals },
      { sideId: "b", diamonds: 80n },
    ]);
    expect(combinedWinner).toBe("a");
  });
});
