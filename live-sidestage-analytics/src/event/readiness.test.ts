import { describe, it, expect } from "vitest";
import {
  blockingReadinessTasks,
  evaluateEventReadiness,
  requiredEntrantCount,
  type ReadinessInput,
  type ReadinessTaskKey,
} from "./readiness";

// 既定は「トーナメント・個人戦・準備万端」。各テストで崩す。
const base: ReadinessInput = {
  eventId: "ev1",
  format: "TOURNAMENT",
  entryMode: "SOLO",
  eligibleEntrantCount: 4,
  matchCount: 3,
};

const keys = (input: Partial<ReadinessInput>): ReadinessTaskKey[] =>
  evaluateEventReadiness({ ...base, ...input }).map((t) => t.key);

const blockingKeys = (input: Partial<ReadinessInput>): ReadinessTaskKey[] =>
  blockingReadinessTasks(evaluateEventReadiness({ ...base, ...input })).map((t) => t.key);

describe("requiredEntrantCount", () => {
  it("対戦する種目は2組、獲得ダイヤレースは1組", () => {
    expect(requiredEntrantCount("TOURNAMENT")).toBe(2);
    expect(requiredEntrantCount("DEATHMATCH")).toBe(2);
    expect(requiredEntrantCount("DIAMOND_RACE")).toBe(1);
  });
});

describe("evaluateEventReadiness", () => {
  it("準備が整っていれば残タスクは無い", () => {
    expect(keys({})).toEqual([]);
  });

  it("トーナメント表が無ければ開催を止める", () => {
    expect(blockingKeys({ matchCount: 0 })).toEqual(["BRACKET"]);
  });

  it("出場者が2組未満なら開催を止める", () => {
    expect(blockingKeys({ eligibleEntrantCount: 1 })).toContain("ENTRANTS");
    expect(blockingKeys({ eligibleEntrantCount: 0 })).toContain("ENTRANTS");
    expect(blockingKeys({ eligibleEntrantCount: 2 })).not.toContain("ENTRANTS");
  });

  it("獲得ダイヤレースは出場者1組から開催できる", () => {
    const race = { format: "DIAMOND_RACE", matchCount: 0 } as const;
    expect(blockingKeys({ ...race, eligibleEntrantCount: 1 })).toEqual([]);
    expect(blockingKeys({ ...race, eligibleEntrantCount: 0 })).toEqual(["ENTRANTS"]);
  });

  it("チーム戦の獲得ダイヤレースも1チームから開催できる", () => {
    expect(
      blockingKeys({
        format: "DIAMOND_RACE",
        entryMode: "TEAM",
        eligibleEntrantCount: 1,
        matchCount: 0,
      })
    ).toEqual([]);
  });

  it("獲得ダイヤレースにトーナメント表は要らない", () => {
    expect(keys({ format: "DIAMOND_RACE", matchCount: 0 })).toEqual([]);
  });

  it("デスマッチの対戦カードは未登録でも開催を止めない", () => {
    expect(keys({ format: "DEATHMATCH", matchCount: 0 })).toEqual(["MATCHES"]);
    expect(blockingKeys({ format: "DEATHMATCH", matchCount: 0 })).toEqual([]);
  });

  it("チーム戦では文言をチーム基準にする", () => {
    const [task] = evaluateEventReadiness({
      ...base,
      entryMode: "TEAM",
      eligibleEntrantCount: 1,
    });
    expect(task.key).toBe("ENTRANTS");
    expect(task.label).toContain("チーム");
  });

  it("残タスクは着手する順(出場者 → 表)に並ぶ", () => {
    expect(keys({ eligibleEntrantCount: 0, matchCount: 0 })).toEqual(["ENTRANTS", "BRACKET"]);
  });

  it("遷移先はイベントIDを含む管理画面のパス", () => {
    const tasks = evaluateEventReadiness({
      ...base,
      eventId: "abc",
      eligibleEntrantCount: 0,
      matchCount: 0,
    });
    expect(tasks.map((t) => t.href)).toEqual(["/events/abc/participants", "/events/abc/matches"]);
  });
});
