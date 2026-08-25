import { describe, expect, it } from "vitest";
import { MAX_BREAKDOWN_ENTRIES, parseBreakdown, serializeBreakdown } from "./contribution-breakdown";

describe("serializeBreakdown", () => {
  it("ポイントは 100倍された内部値を Decimal 文字列へ戻す", () => {
    // 倍率 1.5・10ダイヤ = 15.00 ポイント(内部では 1500n)。
    // そのまま文字列にすると公開ページで "1,500" と 100倍の値が出る。
    expect(serializeBreakdown([{ participantId: "p1", diamonds: 10n, points: 1500n }])).toEqual([
      { p: "p1", d: "10", pt: "15.00" },
    ]);
  });

  it("ダイヤは 21億を超えても文字列のまま落ちない", () => {
    expect(
      serializeBreakdown([{ participantId: "p1", diamonds: 9007199254740993n, points: 900719925474099300n }])
    ).toEqual([{ p: "p1", d: "9007199254740993", pt: "9007199254740993.00" }]);
  });

  it("並び順を変えない(呼び出し側がポイント降順に並べている)", () => {
    const rows = [
      { participantId: "p2", diamonds: 10n, points: 1000n },
      { participantId: "p1", diamonds: 3n, points: 300n },
    ];
    expect(serializeBreakdown(rows).map((e) => e.p)).toEqual(["p2", "p1"]);
  });

  it("上限を超えた分は落とす", () => {
    const rows = Array.from({ length: MAX_BREAKDOWN_ENTRIES + 5 }, (_, i) => ({
      participantId: `p${i}`,
      diamonds: 1n,
      points: 100n,
    }));
    expect(serializeBreakdown(rows)).toHaveLength(MAX_BREAKDOWN_ENTRIES);
  });
});

describe("parseBreakdown", () => {
  it("保存した形をそのまま読み戻せる", () => {
    const stored = serializeBreakdown([
      { participantId: "p2", diamonds: 10n, points: 1000n },
      { participantId: "p1", diamonds: 3n, points: 300n },
    ]);

    expect(parseBreakdown(stored)).toEqual([
      { participantId: "p2", diamonds: "10", points: "10.00" },
      { participantId: "p1", diamonds: "3", points: "3.00" },
    ]);
  });

  it("内訳を持たない行(旧行・列なし)は null", () => {
    // null と [] を区別する。null は「従来表示へフォールバックしろ」の意味。
    expect(parseBreakdown(null)).toBeNull();
    expect(parseBreakdown(undefined)).toBeNull();
    expect(parseBreakdown([])).toEqual([]);
  });

  it("配列でない値は null(壊れた行で公開ページを落とさない)", () => {
    expect(parseBreakdown({ p: "p1" })).toBeNull();
    expect(parseBreakdown("[]")).toBeNull();
    expect(parseBreakdown(42)).toBeNull();
  });

  it("形が不正な要素だけを落とす", () => {
    const parsed = parseBreakdown([
      { p: "p1", d: "10", pt: "10.00" },
      null,
      "p2",
      { p: "", d: "1", pt: "1.00" },
      { p: "p3", d: "-5", pt: "1.00" },
      { p: "p4", d: "1e3", pt: "1.00" },
      { p: "p5", d: "10", pt: "abc" },
      { p: "p6", d: 10, pt: "10.00" },
      { p: "p7", d: "10", pt: "10.000" },
      { p: "p8", d: "10", pt: "10" },
    ]);

    expect(parsed?.map((e) => e.participantId)).toEqual(["p1", "p8"]);
  });

  it("participantId の重複は最初の1件だけ採る", () => {
    const parsed = parseBreakdown([
      { p: "p1", d: "10", pt: "10.00" },
      { p: "p1", d: "99", pt: "99.00" },
    ]);

    expect(parsed).toEqual([{ participantId: "p1", diamonds: "10", points: "10.00" }]);
  });

  it("上限を超えた分は読まない", () => {
    const stored = Array.from({ length: MAX_BREAKDOWN_ENTRIES + 5 }, (_, i) => ({
      p: `p${i}`,
      d: "1",
      pt: "1.00",
    }));

    expect(parseBreakdown(stored)).toHaveLength(MAX_BREAKDOWN_ENTRIES);
  });
});
