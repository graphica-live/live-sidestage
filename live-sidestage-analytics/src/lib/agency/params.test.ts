import { describe, it, expect } from "vitest";
import {
  MAX_RANGE_DAYS,
  isValidNormalizedTiktokHandle,
  parseDateRange,
  parseTiktokHandlesParam,
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

describe("isValidNormalizedTiktokHandle", () => {
  it("英数字・アンダースコア・ドットの2〜24文字を受け入れる", () => {
    expect(isValidNormalizedTiktokHandle("ab")).toBe(true);
    expect(isValidNormalizedTiktokHandle("some.liver_01")).toBe(true);
    expect(isValidNormalizedTiktokHandle("a".repeat(24))).toBe(true);
  });

  it("Workerが永久に再接続を試みるようなゴミ入力を弾く", () => {
    expect(isValidNormalizedTiktokHandle("")).toBe(false); // "@" だけの入力の正規化結果
    expect(isValidNormalizedTiktokHandle("a")).toBe(false);
    expect(isValidNormalizedTiktokHandle("a".repeat(25))).toBe(false);
    expect(isValidNormalizedTiktokHandle("https://tiktok.com/@x")).toBe(false);
    expect(isValidNormalizedTiktokHandle("some liver")).toBe(false);
    expect(isValidNormalizedTiktokHandle("ユーザー")).toBe(false);
  });
});

describe("parseTiktokHandlesParam", () => {
  it("パラメータ自体が無い場合だけnull(=全監視対象)を返す", () => {
    expect(parseTiktokHandlesParam(null)).toEqual({ ok: true, value: null });
  });

  it("明示された空値は拒否する(全監視対象へすり替わらない)", () => {
    expect(parseTiktokHandlesParam("").ok).toBe(false);
    expect(parseTiktokHandlesParam("   ").ok).toBe(false);
    expect(parseTiktokHandlesParam(",,").ok).toBe(false);
  });

  it("正規化して重複を除く", () => {
    expect(parseTiktokHandlesParam("@Alice, BOB ,alice")).toEqual({
      ok: true,
      value: ["alice", "bob"],
    });
  });

  it("空要素を落とす", () => {
    expect(parseTiktokHandlesParam("alice,,bob,")).toEqual({ ok: true, value: ["alice", "bob"] });
  });
});

describe("selectWatchedRooms", () => {
  const watched = [
    { roomId: "room-a", normalizedTiktokHandle: "alice" },
    { roomId: "room-b", normalizedTiktokHandle: "bob" },
  ];

  it("未指定なら監視対象全件を返す", () => {
    const r = selectWatchedRooms(watched, null);
    expect(r.selected).toEqual(watched);
    expect(r.unknownTiktokHandles).toEqual([]);
  });

  it("監視対象に含まれるものだけを選ぶ", () => {
    const r = selectWatchedRooms(watched, ["bob"]);
    expect(r.selected).toEqual([{ roomId: "room-b", normalizedTiktokHandle: "bob" }]);
    expect(r.unknownTiktokHandles).toEqual([]);
  });

  it("監視対象外のIDはunknownへ隔離し、集計対象に含めない", () => {
    const r = selectWatchedRooms(watched, ["alice", "carol"]);
    expect(r.selected).toEqual([{ roomId: "room-a", normalizedTiktokHandle: "alice" }]);
    expect(r.unknownTiktokHandles).toEqual(["carol"]);
  });

  it("監視対象が空なら全てunknownになる", () => {
    const r = selectWatchedRooms([], ["alice"]);
    expect(r.selected).toEqual([]);
    expect(r.unknownTiktokHandles).toEqual(["alice"]);
  });
});
