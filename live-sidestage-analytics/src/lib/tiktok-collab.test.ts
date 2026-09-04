import { describe, it, expect } from "vitest";
import { isCollabJoinSource, parseCollabGroupChange } from "./tiktok-collab";

// 実 payload は KNOWLEDGE.md(tiktok-probe skill)の実測記録を元に組んだ合成データ。
function groupChangePayload(source: string, overrides: Record<string, unknown> = {}) {
  return {
    messageType: 18,
    source,
    businessContent: {
      cohostContent: {
        listChangeBizContent: {
          userInfos: {
            "7058742286294189058": { displayId: "yu_ki_nojo", nickname: "配信主own" },
            "6573845034394238977": { displayId: "reokanao_", nickname: "れお" },
          },
        },
      },
    },
    ...overrides,
  };
}

describe("isCollabJoinSource", () => {
  it("REPLY_STATUS_AGREEを含むsourceはtrue", () => {
    expect(isCollabJoinSource("SOURCE_TYPE_FRIEND_LIST[REPLY_STATUS_AGREE]")).toBe(true);
  });

  it("live_end等の離脱sourceはfalse", () => {
    expect(isCollabJoinSource("live_end")).toBe(false);
  });

  it("招待送信中(返答待ち)のsourceはfalse", () => {
    expect(isCollabJoinSource("SOURCE_TYPE_FRIEND_LIST")).toBe(false);
  });

  it("非文字列はfalse", () => {
    expect(isCollabJoinSource(undefined)).toBe(false);
    expect(isCollabJoinSource(123)).toBe(false);
  });
});

describe("parseCollabGroupChange", () => {
  it("messageType:18のpayloadからdisplayIds一覧を取り出す", () => {
    const result = parseCollabGroupChange(groupChangePayload("SOURCE_TYPE_FRIEND_LIST[REPLY_STATUS_AGREE]"));
    expect(result).not.toBeNull();
    expect(result?.source).toBe("SOURCE_TYPE_FRIEND_LIST[REPLY_STATUS_AGREE]");
    expect(result?.displayIds).toEqual(["yu_ki_nojo", "reokanao_"]);
  });

  it("messageType以外(例: createChannelContent=1)はnull", () => {
    expect(parseCollabGroupChange({ messageType: 1, source: "" })).toBeNull();
  });

  it("businessContentが欠落していてもdisplayIds空配列で返す(例外にしない)", () => {
    const result = parseCollabGroupChange({ messageType: 18, source: "live_end" });
    expect(result).toEqual({ source: "live_end", displayIds: [] });
  });

  it("displayIdが空文字/欠落のuserInfosエントリは無視する", () => {
    const result = parseCollabGroupChange(
      groupChangePayload("live_end", {
        businessContent: {
          cohostContent: {
            listChangeBizContent: {
              userInfos: {
                "1": { displayId: "", nickname: "空" },
                "2": { nickname: "displayIdなし" },
                "3": { displayId: "valid_user", nickname: "有効" },
              },
            },
          },
        },
      })
    );
    expect(result?.displayIds).toEqual(["valid_user"]);
  });

  it("非オブジェクト入力はnull", () => {
    expect(parseCollabGroupChange(null)).toBeNull();
    expect(parseCollabGroupChange("string")).toBeNull();
  });

  it("重複displayIdは1回だけ含める", () => {
    const result = parseCollabGroupChange(
      groupChangePayload("x", {
        businessContent: {
          cohostContent: {
            listChangeBizContent: {
              userInfos: {
                "1": { displayId: "same_user" },
                "2": { displayId: "same_user" },
              },
            },
          },
        },
      })
    );
    expect(result?.displayIds).toEqual(["same_user"]);
  });
});
