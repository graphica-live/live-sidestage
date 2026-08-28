import { describe, it, expect } from "vitest";
import { normalizeChatCommentEmotes } from "./chat-feed";

/**
 * connector の simplifyObject がどこまで平坦化するかはバージョンとイベント種別で
 * 変わるため、入れ子の形を複数受けられることをここで固定する。1つの形しか見ない
 * 実装に戻ると、**例外もログも出ないまま静かに全件落ちる**。
 */
describe("normalizeChatCommentEmotes", () => {
  it("入れ子(emote.emoteId / emote.image.imageUrl)から取り出せる", () => {
    expect(
      normalizeChatCommentEmotes({
        emotes: [{ placeInComment: 3, emote: { emoteId: "abc", image: { imageUrl: "https://cdn/a.png" } } }],
      })
    ).toEqual([{ emoteId: "abc", imageUrl: "https://cdn/a.png", placeInComment: 3 }]);
  });

  it("平坦化済み(emoteId / image.imageUrl)からも取り出せる", () => {
    expect(
      normalizeChatCommentEmotes({ emotes: [{ emoteId: "abc", image: { imageUrl: "https://cdn/a.png" } }] })
    ).toEqual([{ emoteId: "abc", imageUrl: "https://cdn/a.png", placeInComment: null }]);
  });

  it("urlList形からも取り出せる", () => {
    expect(
      normalizeChatCommentEmotes({ emotes: [{ emoteId: "abc", image: { urlList: ["https://cdn/a.png"] } }] })
    ).toEqual([{ emoteId: "abc", imageUrl: "https://cdn/a.png", placeInComment: null }]);
  });

  it("emoteIdが取れない要素だけを捨て、残りは活かす", () => {
    const result = normalizeChatCommentEmotes({
      emotes: [{ image: { imageUrl: "https://cdn/a.png" } }, { emoteId: "b" }],
    });
    expect(result).toEqual([{ emoteId: "b", imageUrl: null, placeInComment: null }]);
  });

  it("imageUrlが無くても捨てない(idさえあれば「エモート」と表示できる)", () => {
    expect(normalizeChatCommentEmotes({ emotes: [{ emoteId: "abc" }] })).toEqual([
      { emoteId: "abc", imageUrl: null, placeInComment: null },
    ]);
  });

  it("https以外のURLはnullへ落とす(将来クライアントが実際に取りに行くため)", () => {
    const result = normalizeChatCommentEmotes({
      emotes: [{ emoteId: "abc", image: { imageUrl: "http://cdn/a.png" } }],
    });
    expect(result[0].imageUrl).toBeNull();
  });

  it("placeInCommentは非負整数のみ採用する", () => {
    const raw = [
      { emoteId: "a", placeInComment: -1 },
      { emoteId: "b", placeInComment: 1.5 },
      { emoteId: "c", placeInComment: "2" },
      { emoteId: "d", placeInComment: 0 },
    ];
    expect(normalizeChatCommentEmotes({ emotes: raw }).map((e) => e.placeInComment)).toEqual([null, null, null, 0]);
  });

  it("11件目以降は切り捨てる", () => {
    const raw = Array.from({ length: 15 }, (_, i) => ({ emoteId: `e${i}` }));
    expect(normalizeChatCommentEmotes({ emotes: raw })).toHaveLength(10);
  });

  it("長すぎるidとURLは切り詰める", () => {
    const long = `https://cdn/${"a".repeat(600)}`;
    const result = normalizeChatCommentEmotes({
      emotes: [{ emoteId: "x".repeat(600), image: { imageUrl: long } }],
    });
    expect(result[0].emoteId).toHaveLength(500);
    expect(result[0].imageUrl).toHaveLength(500);
  });

  it("emotesが無い・配列でないときは空配列", () => {
    expect(normalizeChatCommentEmotes({})).toEqual([]);
    expect(normalizeChatCommentEmotes({ emotes: "nope" })).toEqual([]);
    expect(normalizeChatCommentEmotes({ emotes: [null, 1, "x"] })).toEqual([]);
  });
});
