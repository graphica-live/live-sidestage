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
});
