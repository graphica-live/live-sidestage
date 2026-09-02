import { describe, it, expect } from "vitest";
import { findHostUserIdFromBattleProfiles } from "./tiktok-id-migration";

/** `tiktok_battles.hostProfiles` 1行分。実データは anchorId をキーにした Record。 */
function row(profiles: Record<string, unknown>) {
  return { hostProfiles: profiles };
}

const ME = "6745191554084586";
const OPPONENT = "6909801373216343041";

describe("findHostUserIdFromBattleProfiles", () => {
  it("自分の displayId に一致する anchorId を返す", () => {
    const rows = [
      row({
        [ME]: { displayId: "aiko", nickName: "あいこ" },
        [OPPONENT]: { displayId: "kirin0702", nickName: "きりん" },
      }),
    ];

    expect(findHostUserIdFromBattleProfiles(rows, "aiko")).toBe(ME);
  });

  it("displayId の @ 付き・大文字を正規化して比較する", () => {
    const rows = [row({ [ME]: { displayId: "@AiKo" } })];

    expect(findHostUserIdFromBattleProfiles(rows, "aiko")).toBe(ME);
    // 引数側が生値でも同じ結果になる。
    expect(findHostUserIdFromBattleProfiles(rows, " @AIKO ")).toBe(ME);
  });

  it("複数行にまたがって同じ anchorId なら採用する", () => {
    const rows = [
      row({ [ME]: { displayId: "aiko" }, [OPPONENT]: { displayId: "kirin0702" } }),
      row({ [ME]: { displayId: "aiko" } }),
    ];

    expect(findHostUserIdFromBattleProfiles(rows, "aiko")).toBe(ME);
  });

  // **合流の判定材料なので、曖昧なら「材料なし」に倒す。** 誤った hostUserId は
  // fill-once で二度と直せず、他人の履歴を吸収する事故に直結する。
  it("同じ displayId に別の anchorId が対応していたら推測しない", () => {
    const rows = [
      row({ [ME]: { displayId: "aiko" } }),
      row({ [OPPONENT]: { displayId: "aiko" } }),
    ];

    expect(findHostUserIdFromBattleProfiles(rows, "aiko")).toBeNull();
  });

  it("一致が無ければ null", () => {
    const rows = [row({ [OPPONENT]: { displayId: "kirin0702" } })];

    expect(findHostUserIdFromBattleProfiles(rows, "aiko")).toBeNull();
  });

  it("anchorId が数値文字列でなければ無視する", () => {
    const rows = [row({ "not-a-number": { displayId: "aiko" } })];

    expect(findHostUserIdFromBattleProfiles(rows, "aiko")).toBeNull();
  });

  it("壊れた hostProfiles で落ちない", () => {
    expect(findHostUserIdFromBattleProfiles([{ hostProfiles: null }], "aiko")).toBeNull();
    expect(findHostUserIdFromBattleProfiles([{ hostProfiles: "文字列" }], "aiko")).toBeNull();
    expect(findHostUserIdFromBattleProfiles([{ hostProfiles: [1, 2] }], "aiko")).toBeNull();
    expect(findHostUserIdFromBattleProfiles([row({ [ME]: null })], "aiko")).toBeNull();
    expect(findHostUserIdFromBattleProfiles([row({ [ME]: { displayId: 123 } })], "aiko")).toBeNull();
    expect(findHostUserIdFromBattleProfiles([row({})], "aiko")).toBeNull();
    expect(findHostUserIdFromBattleProfiles([], "aiko")).toBeNull();
  });

  it("空のハンドルでは何も返さない(正規化して空になる入力を含む)", () => {
    const rows = [row({ [ME]: { displayId: "" } })];

    expect(findHostUserIdFromBattleProfiles(rows, "")).toBeNull();
    expect(findHostUserIdFromBattleProfiles(rows, "@")).toBeNull();
  });
});
