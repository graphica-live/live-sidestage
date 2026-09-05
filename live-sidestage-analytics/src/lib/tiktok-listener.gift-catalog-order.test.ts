// DB不要。orderRoomsLiveFirst()(resolveGiftCatalogSourcesが使う並べ替えロジック)を
// 純粋関数として直接検証する。listeners(module内Map)への依存を切り離すため、
// isLiveはテスト側から任意のブール関数として注入する。
import { describe, it, expect } from "vitest";
import { orderRoomsLiveFirst } from "./tiktok-listener";

describe("orderRoomsLiveFirst()", () => {
  it("ライブ中の要素を先頭に集める", () => {
    const rooms = ["a", "b", "c", "d", "e"];
    const isLive = (r: string) => r === "d";
    expect(orderRoomsLiveFirst(rooms, isLive)).toEqual(["d", "a", "b", "c", "e"]);
  });

  it("ライブ中が複数でも、live/idle各グループ内の相対順序は保つ", () => {
    const rooms = ["a", "b", "c", "d", "e"];
    const isLive = (r: string) => r === "b" || r === "d";
    expect(orderRoomsLiveFirst(rooms, isLive)).toEqual(["b", "d", "a", "c", "e"]);
  });

  it("全てidleなら元の順序のまま", () => {
    const rooms = ["a", "b", "c"];
    expect(orderRoomsLiveFirst(rooms, () => false)).toEqual(["a", "b", "c"]);
  });

  it("全てliveなら元の順序のまま", () => {
    const rooms = ["a", "b", "c"];
    expect(orderRoomsLiveFirst(rooms, () => true)).toEqual(["a", "b", "c"]);
  });

  it("空配列でも例外を投げない", () => {
    expect(orderRoomsLiveFirst<string>([], () => true)).toEqual([]);
  });

  it("並べ替え後にslice(0, N)しても、枠外にいたlive要素が繰り上がる", () => {
    // resolveGiftCatalogSourcesの実際のユースケース: MAX_GIFT_CATALOG_SOURCES=3で
    // 4番目の部屋がライブ中でも取りこぼさないことを固定する。
    const rooms = ["room1", "room2", "room3", "room4-live", "room5"];
    const isLive = (r: string) => r === "room4-live";
    const ordered = orderRoomsLiveFirst(rooms, isLive);
    expect(ordered.slice(0, 3)).toContain("room4-live");
  });
});
