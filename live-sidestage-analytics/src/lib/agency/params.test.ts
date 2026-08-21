import { describe, it, expect } from "vitest";
import {
  MAX_RANGE_DAYS,
  isValidNormalizedTiktokId,
  parseDateRange,
  parseTiktokIdsParam,
  selectWatchedRooms,
} from "./params";

describe("parseDateRange", () => {
  it("正しい範囲を受け入れる", () => {
    const r = parseDateRange("2026-08-01", "2026-08-21");
    expect(r).toEqual({ ok: true, value: { from: "2026-08-01", to: "2026-08-21" } });
  });

  it("from/toが同日でも受け入れる", () => {
    const r = parseDateRange("2026-08-01", "2026-08-01");
    expect(r.ok).toBe(true);
  });

  it("from/to未指定は拒否する", () => {
    expect(parseDateRange(null, "2026-08-21").ok).toBe(false);
    expect(parseDateRange("2026-08-01", null).ok).toBe(false);
    expect(parseDateRange("  ", "2026-08-21").ok).toBe(false);
  });

  it("形式違いを拒否する", () => {
    expect(parseDateRange("2026/08/01", "2026-08-21").ok).toBe(false);
    expect(parseDateRange("2026-8-1", "2026-08-21").ok).toBe(false);
  });

  it("存在しない日付を拒否する", () => {
    expect(parseDateRange("2026-02-31", "2026-03-01").ok).toBe(false);
    expect(parseDateRange("2026-13-01", "2026-13-02").ok).toBe(false);
  });

  it("from > to を拒否する", () => {
    const r = parseDateRange("2026-08-22", "2026-08-21");
    expect(r.ok).toBe(false);
  });

  it(`${MAX_RANGE_DAYS}日ちょうどは許可し、1日超過は拒否する`, () => {
    // 2026-01-01 起点。両端を含めてMAX_RANGE_DAYS日になるのは +(MAX_RANGE_DAYS-1)日。
    const start = Date.parse("2026-01-01T00:00:00Z");
    const day = 86_400_000;
    const exact = new Date(start + (MAX_RANGE_DAYS - 1) * day).toISOString().slice(0, 10);
    const over = new Date(start + MAX_RANGE_DAYS * day).toISOString().slice(0, 10);

    expect(parseDateRange("2026-01-01", exact).ok).toBe(true);
    expect(parseDateRange("2026-01-01", over).ok).toBe(false);
  });
});

describe("isValidNormalizedTiktokId", () => {
  it("英数字・アンダースコア・ドットの2〜24文字を受け入れる", () => {
    expect(isValidNormalizedTiktokId("ab")).toBe(true);
    expect(isValidNormalizedTiktokId("some.liver_01")).toBe(true);
    expect(isValidNormalizedTiktokId("a".repeat(24))).toBe(true);
  });

  it("Workerが永久に再接続を試みるようなゴミ入力を弾く", () => {
    expect(isValidNormalizedTiktokId("")).toBe(false); // "@" だけの入力の正規化結果
    expect(isValidNormalizedTiktokId("a")).toBe(false);
    expect(isValidNormalizedTiktokId("a".repeat(25))).toBe(false);
    expect(isValidNormalizedTiktokId("https://tiktok.com/@x")).toBe(false);
    expect(isValidNormalizedTiktokId("some liver")).toBe(false);
    expect(isValidNormalizedTiktokId("ユーザー")).toBe(false);
  });
});

describe("parseTiktokIdsParam", () => {
  it("未指定はnull(=全監視対象)を返す", () => {
    expect(parseTiktokIdsParam(null)).toBeNull();
    expect(parseTiktokIdsParam("")).toBeNull();
    expect(parseTiktokIdsParam("   ")).toBeNull();
  });

  it("正規化して重複を除く", () => {
    expect(parseTiktokIdsParam("@Alice, BOB ,alice")).toEqual(["alice", "bob"]);
  });

  it("空要素を落とす", () => {
    expect(parseTiktokIdsParam("alice,,bob,")).toEqual(["alice", "bob"]);
  });
});

describe("selectWatchedRooms", () => {
  const watched = [
    { roomId: "room-a", normalizedTiktokId: "alice" },
    { roomId: "room-b", normalizedTiktokId: "bob" },
  ];

  it("未指定なら監視対象全件を返す", () => {
    const r = selectWatchedRooms(watched, null);
    expect(r.selected).toEqual(watched);
    expect(r.unknownTiktokIds).toEqual([]);
  });

  it("監視対象に含まれるものだけを選ぶ", () => {
    const r = selectWatchedRooms(watched, ["bob"]);
    expect(r.selected).toEqual([{ roomId: "room-b", normalizedTiktokId: "bob" }]);
    expect(r.unknownTiktokIds).toEqual([]);
  });

  it("監視対象外のIDはunknownへ隔離し、集計対象に含めない", () => {
    const r = selectWatchedRooms(watched, ["alice", "carol"]);
    expect(r.selected).toEqual([{ roomId: "room-a", normalizedTiktokId: "alice" }]);
    expect(r.unknownTiktokIds).toEqual(["carol"]);
  });

  it("監視対象が空なら全てunknownになる", () => {
    const r = selectWatchedRooms([], ["alice"]);
    expect(r.selected).toEqual([]);
    expect(r.unknownTiktokIds).toEqual(["alice"]);
  });
});
