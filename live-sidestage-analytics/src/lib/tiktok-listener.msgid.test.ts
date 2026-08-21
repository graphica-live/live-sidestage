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

  it("connectorが平坦化した後のgiftイベントからもmsgIdを取り出せる", () => {
    // giftをdedupキー付きでDBへ保存できるかは、この平坦化が効いているかにかかっている。
    // (WebcastGiftMessageもcommonを持つが、簡略化処理はchatと別のcase節を通る)
    const flattened = flattenAsConnectorDoes("WebcastGiftMessage", {
      common: { msgId: "7300000000000000004", createTime: "1750000000000" },
      user: { uniqueId: "gifter", nickname: "ギフター" },
      giftId: 5,
      repeatCount: 3,
      repeatEnd: 0,
      groupId: "1783125250341",
    });

    expect(flattened.common).toBeUndefined();
    expect(resolveMsgId(flattened)).toBe("7300000000000000004");
  });

  it('protobufの既定値 "0" はnull扱いにする', () => {
    // メッセージ側がフィールドを持たないと、デコーダは空ではなく既定値の "0" を埋める。
    // これを実IDとして扱うと無関係なイベント同士が同じキーを共有し、
    // chatでは2件目以降が捨てられ、giftでは将来のunique制約が誤爆する。
    // 同じ既定値の流入はgroupId="0"が本番に3591件ある事実で確認済み。
    const flattened = flattenAsConnectorDoes("WebcastChatMessage", {
      common: { msgId: "0", createTime: "1750000000000" },
      user: { uniqueId: "someone" },
      content: "既定値のmsgId",
      emotes: [],
    });

    expect(flattened.msgId).toBe("0"); // connectorは "0" をそのまま渡してくる
    expect(resolveMsgId(flattened)).toBeNull();
  });

  it("int64の10進表現でない値はnull扱いにする", () => {
    expect(resolveMsgId({ msgId: "0123" })).toBeNull(); // 先頭ゼロ
    expect(resolveMsgId({ msgId: "-1" })).toBeNull();
    expect(resolveMsgId({ msgId: "1.5" })).toBeNull();
    expect(resolveMsgId({ msgId: "12 34" })).toBeNull();
    expect(resolveMsgId({ msgId: "abc" })).toBeNull();
  });

  it("桁数が異常に多い値はnull扱いにする", () => {
    // int64は最大19桁。unique indexやメモリ上のdedupキャッシュへ
    // 巨大な文字列を流し込ませないための上限。
    expect(resolveMsgId({ msgId: "1".repeat(32) })).toBe("1".repeat(32));
    expect(resolveMsgId({ msgId: "1".repeat(33) })).toBeNull();
  });
});
