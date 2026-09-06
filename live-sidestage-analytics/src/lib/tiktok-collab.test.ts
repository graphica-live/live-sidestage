import { describe, it, expect } from "vitest";
import { isCollabJoinSource, parseCollabGroupChange, shouldWatchCollabSnapshot } from "./tiktok-collab";

function userListContent(statuses: number[]) {
  return {
    groupChangeContent: {
      groupUser: {
        userList: statuses.map((status, i) => ({ channelId: `ch${i}`, status })),
      },
    },
  };
}

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
    expect(result).toEqual({
      source: "live_end",
      displayIds: [],
      linkedCount: 0,
      waitingCount: 0,
      otherCount: 0,
    });
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

  it("userListのstatusをLINKED(3)/WAITING(1)/その他で数え分ける", () => {
    const result = parseCollabGroupChange(
      groupChangePayload("live_end", userListContent([3, 3, 1, 7]))
    );
    expect(result?.linkedCount).toBe(2);
    expect(result?.waitingCount).toBe(1);
    expect(result?.otherCount).toBe(1);
  });

  it("userListが無いpayloadは件数0", () => {
    const result = parseCollabGroupChange(groupChangePayload("live_end"));
    expect(result?.linkedCount).toBe(0);
    expect(result?.waitingCount).toBe(0);
    expect(result?.otherCount).toBe(0);
  });
});

describe("shouldWatchCollabSnapshot", () => {
  function parsed(source: string, statuses: number[]) {
    const result = parseCollabGroupChange(groupChangePayload(source, userListContent(statuses)));
    if (!result) throw new Error("payload解釈に失敗");
    return result;
  }

  it("待機者0ならsourceがlive_endでも採用する", () => {
    expect(shouldWatchCollabSnapshot(parsed("live_end", [3, 3]))).toBe(true);
  });

  it("待機者0ならsourceが空文字/数字文字列でも採用する", () => {
    expect(shouldWatchCollabSnapshot(parsed("", [3, 3]))).toBe(true);
    expect(shouldWatchCollabSnapshot(parsed("1", [3, 3]))).toBe(true);
  });

  it("待機者が居る招待送信イベントは採用しない", () => {
    expect(shouldWatchCollabSnapshot(parsed("SOURCE_TYPE_RECOMMEND_LIST", [3, 1, 1, 1]))).toBe(false);
  });

  it("LINKED以外のstatus(GROUP_STATUS_UNKNOWN=0等)が混ざるイベントは採用しない", () => {
    expect(shouldWatchCollabSnapshot(parsed("live_end", [3, 0]))).toBe(false);
    expect(shouldWatchCollabSnapshot(parsed("SOURCE_TYPE_RECOMMEND_LIST", [3, 2]))).toBe(false);
  });

  it("displayIdsがLINKED件数より多い(userListに居ない人が混ざる)イベントは採用しない", () => {
    // groupChangePayloadのuserInfosは2人、userListはLINKED 1人。
    expect(shouldWatchCollabSnapshot(parsed("live_end", [3]))).toBe(false);
  });

  it("待機者が居てもREPLY_STATUS_AGREEなら採用する(従来動作の互換)", () => {
    expect(
      shouldWatchCollabSnapshot(parsed("SOURCE_TYPE_FRIEND_LIST[REPLY_STATUS_AGREE]", [3, 1]))
    ).toBe(true);
  });

  it("userListが空配列(構造は読めるがLINKEDが0人)ならAGREE以外を採用しない", () => {
    // 「linkedCount > 0 が必須条件」という境界を名指しで固定する。userList欠落ケースは
    // 空配列へ正規化された結果として同じ値になるだけで、この境界を守っていない。
    expect(shouldWatchCollabSnapshot(parsed("live_end", []))).toBe(false);
    expect(shouldWatchCollabSnapshot(parsed("x[REPLY_STATUS_AGREE]", []))).toBe(true);
  });

  it("userListが取れないpayloadはAGREE以外を採用しない(fail-closed)", () => {
    const noUserList = parseCollabGroupChange(groupChangePayload("live_end"));
    expect(shouldWatchCollabSnapshot(noUserList!)).toBe(false);
    const agree = parseCollabGroupChange(groupChangePayload("x[REPLY_STATUS_AGREE]"));
    expect(shouldWatchCollabSnapshot(agree!)).toBe(true);
  });

  it("displayIdsが空なら採用しない", () => {
    const empty = parseCollabGroupChange({ messageType: 18, source: "live_end" });
    expect(shouldWatchCollabSnapshot(empty!)).toBe(false);
  });
});
