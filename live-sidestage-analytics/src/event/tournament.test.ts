import { describe, it, expect } from "vitest";
import { planRoundStarts } from "./tournament";
import type { EventWindow } from "./sessions";

const at = (iso: string) => new Date(iso);

// JST 22:00-23:00 を2日ぶん(1日目 予選 / 2日目 決勝)。
const DAY1: EventWindow = {
  start: at("2026-09-01T13:00:00.000Z"),
  end: at("2026-09-01T14:00:00.000Z"),
  name: "予選",
};
const DAY2: EventWindow = {
  start: at("2026-09-02T13:00:00.000Z"),
  end: at("2026-09-02T14:00:00.000Z"),
  name: "決勝",
};

describe("planRoundStarts", () => {
  it("1日程に収まるならそのまま間隔ぶん進める", () => {
    const starts = planRoundStarts({
      windows: [{ start: at("2026-09-01T13:00:00.000Z"), end: at("2026-09-01T17:00:00.000Z"), name: null }],
      firstRoundStartAt: at("2026-09-01T13:00:00.000Z"),
      roundCount: 3,
      matchWindowMin: 30,
      roundIntervalMin: 45,
    });
    expect(starts?.map((d) => d.toISOString())).toEqual([
      "2026-09-01T13:00:00.000Z",
      "2026-09-01T13:45:00.000Z",
      "2026-09-01T14:30:00.000Z",
    ]);
  });

  it("枠が日程からはみ出すラウンドは次の日程の先頭へ送る", () => {
    const starts = planRoundStarts({
      windows: [DAY1, DAY2],
      firstRoundStartAt: DAY1.start,
      roundCount: 2,
      matchWindowMin: 30,
      roundIntervalMin: 45,
    });
    // 1回戦 22:00-22:30。2回戦は 22:45 開始だと 23:15 まで要り1日目に収まらない → 2日目の22:00へ。
    expect(starts?.map((d) => d.toISOString())).toEqual([
      "2026-09-01T13:00:00.000Z",
      "2026-09-02T13:00:00.000Z",
    ]);
  });

  it("1回戦が日程の外なら黙って動かさずnullを返す", () => {
    // 日程の隙間(1日目の終了〜2日目の開始)を指定した場合。
    expect(
      planRoundStarts({
        windows: [DAY1, DAY2],
        firstRoundStartAt: at("2026-09-02T02:00:00.000Z"),
        roundCount: 1,
        matchWindowMin: 30,
        roundIntervalMin: 45,
      })
    ).toBeNull();
  });

  it("1回戦の枠が日程の終わりからはみ出す場合もnull", () => {
    expect(
      planRoundStarts({
        windows: [DAY1],
        firstRoundStartAt: at("2026-09-01T13:45:00.000Z"),
        roundCount: 1,
        matchWindowMin: 30,
        roundIntervalMin: 45,
      })
    ).toBeNull();
  });

  it("日程を使い切っても全ラウンドを置けなければnull", () => {
    expect(
      planRoundStarts({
        windows: [DAY1, DAY2],
        firstRoundStartAt: DAY1.start,
        roundCount: 3,
        matchWindowMin: 30,
        roundIntervalMin: 45,
      })
    ).toBeNull();
  });

  it("1つの日程に複数ラウンドを詰めてから次の日程へ移る", () => {
    const starts = planRoundStarts({
      windows: [
        { start: at("2026-09-01T13:00:00.000Z"), end: at("2026-09-01T15:00:00.000Z"), name: null },
        DAY2,
      ],
      firstRoundStartAt: at("2026-09-01T13:00:00.000Z"),
      roundCount: 4,
      matchWindowMin: 30,
      roundIntervalMin: 45,
    });
    expect(starts?.map((d) => d.toISOString())).toEqual([
      "2026-09-01T13:00:00.000Z",
      "2026-09-01T13:45:00.000Z",
      "2026-09-01T14:30:00.000Z",
      "2026-09-02T13:00:00.000Z",
    ]);
  });
});
