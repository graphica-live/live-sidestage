import { describe, it, expect } from "vitest";
import { simplifyObject } from "tiktok-live-connector";
import { resolveMsgId } from "./tiktok-listener";

/**
 * msgIdの取り出し口がconnectorの実挙動とズレていないことを守るテスト。
 *
 * 以前ここは data.common?.msgId を読んでいたが、connectorのsimplifyObject()は
 * commonの中身をトップレベルへ移してからcommon自体をdeleteするため、msgIdが常にnullになり、
 * listenerインスタンス側とWebプロセス側の2層のdedupがどちらも発動していなかった。
 *
 * 手書きのfixtureで「トップレベルにmsgIdがある形」を作ってしまうと、
 * connector側の仕様が変わったときにこのテストは素通りしてしまう。
 * そのため入力はネストしたprotobuf相当の形にして、平坦化はconnectorの実関数に行わせる。
 */
describe("resolveMsgId", () => {
  function flattenAsConnectorDoes(type: string, nested: Record<string, unknown>) {
    // WebcastPushConnection.processProtoMessageFetchResult() がハンドラへ渡す前に通す変換と同じ。
    return simplifyObject(type as Parameters<typeof simplifyObject>[0], nested) as Record<string, unknown>;
  }

  it("connectorが平坦化した後のchatイベントからmsgIdを取り出せる", () => {
    const flattened = flattenAsConnectorDoes("WebcastChatMessage", {
      common: { msgId: "7300000000000000001", createTime: "1750000000000" },
      user: { uniqueId: "someone", nickname: "だれか" },
      content: "こんにちは",
      emotes: [],
    });

    // connectorがcommonを畳んだことをまず確認する(前提が崩れたらここで落ちる)。
    expect(flattened.common).toBeUndefined();
    expect(resolveMsgId(flattened)).toBe("7300000000000000001");
  });

  it("connectorが平坦化した後のfollowイベント(WebcastSocialMessage)からmsgIdを取り出せる", () => {
    const flattened = flattenAsConnectorDoes("WebcastSocialMessage", {
      common: { msgId: "7300000000000000002", displayText: { key: "pm_main_follow_message_viewer_2" } },
      user: { uniqueId: "follower", nickname: "フォロワー" },
    });

    expect(flattened.common).toBeUndefined();
    expect(resolveMsgId(flattened)).toBe("7300000000000000002");
  });

  it("msgIdが欠落していればnullを返す(握りつぶさずdedupを諦める側に倒す)", () => {
    const flattened = flattenAsConnectorDoes("WebcastChatMessage", {
      common: { createTime: "1750000000000" },
      user: { uniqueId: "someone" },
      content: "msgIdなし",
      emotes: [],
    });

    expect(resolveMsgId(flattened)).toBeNull();
  });

  it("msgIdが空文字ならnull扱いにする", () => {
    expect(resolveMsgId({ msgId: "" })).toBeNull();
  });

  it("msgIdが文字列でなければnull扱いにする", () => {
    expect(resolveMsgId({ msgId: 12345 })).toBeNull();
    expect(resolveMsgId({ msgId: null })).toBeNull();
    expect(resolveMsgId({})).toBeNull();
  });

  it("旧実装が読んでいた data.common.msgId は平坦化後に存在しない", () => {
    const flattened = flattenAsConnectorDoes("WebcastChatMessage", {
      common: { msgId: "7300000000000000003" },
      user: { uniqueId: "someone" },
      content: "回帰テスト",
      emotes: [],
    });

    // このexpectが落ちる = connectorがcommonを残すようになった、という意味。
    // その場合はresolveMsgId側もcommon経由のフォールバックを足すこと。
    expect((flattened.common as { msgId?: unknown } | undefined)?.msgId).toBeUndefined();
  });
});
