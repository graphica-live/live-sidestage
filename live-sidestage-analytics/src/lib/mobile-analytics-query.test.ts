import { describe, it, expect } from "vitest";
import { MAX_RANGE_DAYS } from "@/lib/range-limits";
import { parseRangeQuery } from "./mobile-analytics-query";

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe("parseRangeQuery", () => {
  it("startDatetime/endDatetimeが両方未指定ならparsePeriodQueryへ委譲する", () => {
    const r = parseRangeQuery(params({ period: "week" }), "2026-08-01");
    expect(r).toEqual({ ok: true, value: { mode: "period", period: "week", date: "2026-08-01" } });
  });

  it("period未指定でも委譲し、defaultDateが使われる", () => {
    const r = parseRangeQuery(params({}), "2026-08-01");
    expect(r).toEqual({ ok: true, value: { mode: "period", period: "day", date: "2026-08-01" } });
  });

  it("startDatetime/endDatetimeが両方妥当ならcustomを返す", () => {
    const r = parseRangeQuery(
      params({ startDatetime: "2026-08-01T00:00:00Z", endDatetime: "2026-08-02T00:00:00Z" }),
      "2026-08-01"
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mode).toBe("custom");
    if (r.value.mode !== "custom") return;
    expect(r.value.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(r.value.end.toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });

  it("オフセット付き(Z以外)の日時も受け入れる", () => {
    const r = parseRangeQuery(
      params({ startDatetime: "2026-08-01T09:00:00+09:00", endDatetime: "2026-08-01T10:00:00+09:00" }),
      "2026-08-01"
    );
    expect(r.ok).toBe(true);
  });

  it("片方だけの指定は拒否する", () => {
    expect(parseRangeQuery(params({ startDatetime: "2026-08-01T00:00:00Z" }), "2026-08-01").ok).toBe(
      false
    );
    expect(parseRangeQuery(params({ endDatetime: "2026-08-01T00:00:00Z" }), "2026-08-01").ok).toBe(
      false
    );
  });

  it("start >= end を拒否する(等しい場合も含む)", () => {
    const equal = parseRangeQuery(
      params({ startDatetime: "2026-08-01T00:00:00Z", endDatetime: "2026-08-01T00:00:00Z" }),
      "2026-08-01"
    );
    expect(equal.ok).toBe(false);

    const reversed = parseRangeQuery(
      params({ startDatetime: "2026-08-02T00:00:00Z", endDatetime: "2026-08-01T00:00:00Z" }),
      "2026-08-01"
    );
    expect(reversed.ok).toBe(false);
  });

  it("オフセット無しの文字列を拒否する", () => {
    const r = parseRangeQuery(
      params({ startDatetime: "2026-08-01T00:00:00", endDatetime: "2026-08-02T00:00:00" }),
      "2026-08-01"
    );
    expect(r.ok).toBe(false);
  });

  it("存在しない日付(2026-02-30)を拒否する", () => {
    const r = parseRangeQuery(
      params({ startDatetime: "2026-02-30T00:00:00Z", endDatetime: "2026-03-01T00:00:00Z" }),
      "2026-08-01"
    );
    expect(r.ok).toBe(false);
  });

  it("平年の2/29を拒否する", () => {
    // 2026年は平年
    const r = parseRangeQuery(
      params({ startDatetime: "2026-02-29T00:00:00Z", endDatetime: "2026-03-01T00:00:00Z" }),
      "2026-08-01"
    );
    expect(r.ok).toBe(false);
  });

  it("うるう年の2/29は受け入れる", () => {
    // 2028年はうるう年
    const r = parseRangeQuery(
      params({ startDatetime: "2028-02-29T00:00:00Z", endDatetime: "2028-03-01T00:00:00Z" }),
      "2026-08-01"
    );
    expect(r.ok).toBe(true);
  });

  it("不正な時刻(25:00)を拒否する", () => {
    const r = parseRangeQuery(
      params({ startDatetime: "2026-08-01T25:00:00Z", endDatetime: "2026-08-02T00:00:00Z" }),
      "2026-08-01"
    );
    expect(r.ok).toBe(false);
  });

  it("不正なオフセット(±14:00超過)を拒否する", () => {
    const r = parseRangeQuery(
      params({ startDatetime: "2026-08-01T00:00:00+15:00", endDatetime: "2026-08-02T00:00:00Z" }),
      "2026-08-01"
    );
    expect(r.ok).toBe(false);
  });

  it(`${MAX_RANGE_DAYS}日ちょうどは許可し、超過は拒否する`, () => {
    const start = "2026-01-01T00:00:00Z";
    const maxMs = MAX_RANGE_DAYS * 86_400_000;
    const exactEnd = new Date(Date.parse(start) + maxMs).toISOString();
    const overEnd = new Date(Date.parse(start) + maxMs + 1).toISOString();

    const exact = parseRangeQuery(params({ startDatetime: start, endDatetime: exactEnd }), "2026-08-01");
    expect(exact.ok).toBe(true);

    const over = parseRangeQuery(params({ startDatetime: start, endDatetime: overEnd }), "2026-08-01");
    expect(over.ok).toBe(false);
  });
});
