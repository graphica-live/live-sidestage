import { describe, it, expect } from "vitest";
import { getDateRange } from "./gift-analytics";

describe("getDateRange", () => {
  it("day: start/endとも指定日そのまま", () => {
    expect(getDateRange("day", "2026-08-15")).toEqual({ start: "2026-08-15", end: "2026-08-15" });
  });

  it("week: 月曜日を指定した場合その週の月〜日を返す", () => {
    // 2026-08-10 は月曜日
    expect(getDateRange("week", "2026-08-10")).toEqual({ start: "2026-08-10", end: "2026-08-16" });
  });

  it("week: 日曜日を指定した場合、同じ週の月曜まで遡る", () => {
    // 2026-08-16 は日曜日(上と同じ週)
    expect(getDateRange("week", "2026-08-16")).toEqual({ start: "2026-08-10", end: "2026-08-16" });
  });

  it("week: 週の途中(水曜)を指定した場合も同じ週のMon-Sunを返す", () => {
    // 2026-08-12 は水曜日
    expect(getDateRange("week", "2026-08-12")).toEqual({ start: "2026-08-10", end: "2026-08-16" });
  });

  it("month: 月初〜月末を返す", () => {
    // 2026-02-14 は土曜日、2026年はうるう年ではない
    expect(getDateRange("month", "2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("month: 12月は年をまたがず12/31までを返す", () => {
    expect(getDateRange("month", "2026-12-25")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("month: うるう年の2月は29日までを返す", () => {
    expect(getDateRange("month", "2024-02-10")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });
});
