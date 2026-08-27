import { describe, expect, it } from "vitest";
import { classifyMatchBattleState } from "./match-detail";

describe("classifyMatchBattleState", () => {
  it("VOIDの対戦はVOID", () => {
    expect(
      classifyMatchBattleState({ status: "VOID", winnerDecidedBy: null, battleCandidateCount: 3 })
    ).toBe("VOID");
  });

  it("NO_SHOWの対戦はNO_SHOW", () => {
    expect(
      classifyMatchBattleState({ status: "NO_SHOW", winnerDecidedBy: null, battleCandidateCount: 0 })
    ).toBe("NO_SHOW");
  });

  it("不戦勝(winnerDecidedBy=BYE)はBYE", () => {
    expect(
      classifyMatchBattleState({ status: "FINISHED", winnerDecidedBy: "BYE", battleCandidateCount: 0 })
    ).toBe("BYE");
  });

  it("候補が0件かつ手動確定はMANUAL_WITHOUT_BATTLE_BREAKDOWN", () => {
    expect(
      classifyMatchBattleState({ status: "FINISHED", winnerDecidedBy: "MANUAL", battleCandidateCount: 0 })
    ).toBe("MANUAL_WITHOUT_BATTLE_BREAKDOWN");
  });

  it("候補が0件でBYE/MANUALでもなければNO_DETECTED_BATTLE", () => {
    expect(
      classifyMatchBattleState({ status: "SCHEDULED", winnerDecidedBy: null, battleCandidateCount: 0 })
    ).toBe("NO_DETECTED_BATTLE");
  });

  it("候補が1件以上あればAVAILABLE(selectedの値は問わない)", () => {
    expect(
      classifyMatchBattleState({ status: "FINISHED", winnerDecidedBy: "AGGREGATE", battleCandidateCount: 2 })
    ).toBe("AVAILABLE");
  });

  it("候補が1件以上あれば手動確定でもAVAILABLE(選ばれなかった候補が残るMANUAL確定を誤ってNO_DETECTED_BATTLEに分類しない)", () => {
    expect(
      classifyMatchBattleState({ status: "FINISHED", winnerDecidedBy: "MANUAL", battleCandidateCount: 1 })
    ).toBe("AVAILABLE");
  });
});
