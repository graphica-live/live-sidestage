import { describe, it, expect } from "vitest";
import {
  mergeMaxScores,
  resolveBattleScore,
  resolveBattleWindow,
  jstDateRangeToUtc,
  type BattleRow,
} from "./battle-history";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";

function row(hosts: string[], scores: Record<string, string>): BattleRow {
  return { battleId: "b1", hostUserIds: hosts, hostScores: scores };
}

describe("mergeMaxScores", () => {
  it("同じanchorIdは大きいほうの値を採る", () => {
    const merged = mergeMaxScores([row(["A", "B"], { A: "100", B: "50" }), row(["A", "B"], { A: "80", B: "90" })]);
    expect(merged.get("A")?.toString()).toBe("100");
    expect(merged.get("B")?.toString()).toBe("90");
  });

  it("不正な値(整数文字列でない)は無視する", () => {
    const merged = mergeMaxScores([row(["A"], { A: "12.5" }), row(["A"], { A: "1e+21" })]);
    expect(merged.has("A")).toBe(false);
  });
});

describe("resolveBattleScore", () => {
  it("自分のhostUserIdが未解決ならunknownを返す", () => {
    const resolved = resolveBattleScore({ rows: [row(["A", "B"], { A: "10", B: "20" })], selfHostUserId: null });
    expect(resolved.kind).toBe("unknown");
  });

  it("1vs1は消去法で相手のanchorIdとスコアを特定する(相手roomが未登録でも解決できる)", () => {
    const resolved = resolveBattleScore({
      rows: [row(["A", "B"], { A: "10", B: "20" })],
      selfHostUserId: "A",
    });
    expect(resolved).toMatchObject({ kind: "1v1", selfScore: "10", opponentAnchorId: "B", opponentScore: "20" });
  });

  it("自分しか観測できていない場合はsoloを返す(自分のスコアは正しいので出す)", () => {
    const resolved = resolveBattleScore({ rows: [row(["A"], { A: "10" })], selfHostUserId: "A" });
    expect(resolved).toMatchObject({ kind: "solo", selfScore: "10" });
  });

  it("3人以上(2vs2等)は自分のスコアのみ返す(敵味方を区別できないため)", () => {
    const resolved = resolveBattleScore({
      rows: [row(["A", "B", "C"], { A: "10", B: "20", C: "30" })],
      selfHostUserId: "A",
    });
    expect(resolved).toMatchObject({ kind: "multi", participantCount: 3, selfScore: "10" });
  });

  it("観測したバトルに自分のhostUserIdが含まれていなければunknownを返す(別人のroom)", () => {
    const resolved = resolveBattleScore({ rows: [row(["X", "Y"], { X: "10", Y: "20" })], selfHostUserId: "A" });
    expect(resolved.kind).toBe("unknown");
  });
});

const START = new Date("2026-08-20T10:00:00Z");

describe("resolveBattleWindow", () => {
  it("CUT_SHORTは中断として扱い勝敗を出さない", () => {
    const result = resolveBattleWindow(
      {
        action: BATTLE_ACTION.CUT_SHORT,
        startedAt: START,
        startedAtEstimated: false,
        endedAt: new Date("2026-08-20T10:02:00Z"),
        durationSec: 300,
      },
      new Date("2026-08-20T10:10:00Z")
    );
    expect(result.status).toBe("cut_short");
  });

  it("endedAtが観測できていればそれを終端に使う", () => {
    const result = resolveBattleWindow(
      {
        action: BATTLE_ACTION.FINISH,
        startedAt: START,
        startedAtEstimated: false,
        endedAt: new Date("2026-08-20T10:05:00Z"),
        durationSec: 300,
      },
      new Date("2026-08-20T10:10:00Z")
    );
    expect(result).toMatchObject({
      status: "finished",
      endedAtSource: "observed",
      window: { start: START, end: new Date("2026-08-20T10:05:00Z") },
    });
  });

  it("endedAt未観測でもdurationSec経過済みならduration推定で終了扱いにする", () => {
    const result = resolveBattleWindow(
      { action: BATTLE_ACTION.OPEN, startedAt: START, startedAtEstimated: false, endedAt: null, durationSec: 300 },
      new Date("2026-08-20T10:06:00Z")
    );
    expect(result).toMatchObject({ status: "finished", endedAtSource: "duration" });
  });

  it("duration未経過ならライブ扱いにする", () => {
    const result = resolveBattleWindow(
      { action: BATTLE_ACTION.OPEN, startedAt: START, startedAtEstimated: false, endedAt: null, durationSec: 300 },
      new Date("2026-08-20T10:02:00Z")
    );
    expect(result.status).toBe("live");
  });

  it("startedAtが推定値でdurationも無ければ判定不能とし、3週間前でも現在時刻まで集計しない", () => {
    const result = resolveBattleWindow(
      { action: BATTLE_ACTION.OPEN, startedAt: START, startedAtEstimated: true, endedAt: null, durationSec: null },
      new Date("2026-09-10T00:00:00Z")
    );
    expect(result).toEqual({ status: "unknown", window: null });
  });

  it("開始直後(猶予内)ならstartedAtEstimatedでもライブ扱いにする", () => {
    const result = resolveBattleWindow(
      { action: BATTLE_ACTION.OPEN, startedAt: START, startedAtEstimated: true, endedAt: null, durationSec: null },
      new Date("2026-08-20T10:01:00Z")
    );
    expect(result.status).toBe("live");
  });
});

describe("jstDateRangeToUtc", () => {
  it("JST 00:00始まりのUTC範囲を返す(dayは終端翌日00:00 exclusive)", () => {
    const { start, end } = jstDateRangeToUtc("day", "2026-08-20");
    expect(start.toISOString()).toBe("2026-08-19T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-20T15:00:00.000Z");
  });

  it("JST 00:00〜09:00のバトルを前日に落とさない", () => {
    const { start, end } = jstDateRangeToUtc("day", "2026-08-20");
    const earlyMorningJst = new Date("2026-08-20T05:00:00+09:00");
    expect(earlyMorningJst.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(earlyMorningJst.getTime()).toBeLessThan(end.getTime());
  });
});
