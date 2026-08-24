import { describe, it, expect } from "vitest";
import {
  assignBattles,
  findMissedMatches,
  scoreDivergence,
  type BattleObservation,
  type MatchCandidate,
} from "./match-detect";

const T = (iso: string) => new Date(iso);

// 既定の開催日程: JST 20:00-21:00。**この中で終了したバトルだけ**が候補になる。
const SESSION_START = "2026-09-01T20:00:00+09:00";
const SESSION_END = "2026-09-01T21:00:00+09:00";

function match(
  id: string,
  sideRoomIds: string[][],
  options: {
    sessionStart?: string;
    sessionEnd?: string;
    isBye?: boolean;
    round?: number;
    position?: number;
    feederDecidedAt?: string | null;
    lockedBattleId?: string | null;
  } = {}
): MatchCandidate {
  return {
    id,
    round: options.round ?? 1,
    bracketPosition: options.position ?? 0,
    sessionStart: T(options.sessionStart ?? SESSION_START),
    sessionEnd: T(options.sessionEnd ?? SESSION_END),
    sideRoomIds,
    isBye: options.isBye ?? false,
    feederDecidedAt: options.feederDecidedAt ? T(options.feederDecidedAt) : null,
    lockedBattleId: options.lockedBattleId ?? null,
  };
}

function battle(
  battleId: string,
  rooms: {
    roomId: string;
    startedAt: string;
    startedAtEstimated?: boolean;
    endedAt?: string | null;
    complete?: boolean;
    durationSec?: number | null;
  }[]
): BattleObservation {
  return {
    battleId,
    rooms: rooms.map((r) => ({
      roomId: r.roomId,
      startedAt: T(r.startedAt),
      startedAtEstimated: r.startedAtEstimated ?? false,
      endedAt: r.endedAt ? T(r.endedAt) : null,
      complete: r.complete ?? true,
      durationSec: r.durationSec ?? null,
    })),
  };
}

/** 日程の中で終了した 1vs1 のバトル。 */
function endedBattle(battleId: string, rooms: string[], start: string, end: string) {
  return battle(
    battleId,
    rooms.map((roomId) => ({ roomId, startedAt: start, endedAt: end }))
  );
}

describe("assignBattles", () => {
  it("両サイドのroomが揃っていれば完全一致で割り当てる", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          {
            roomId: "roomA",
            startedAt: "2026-09-01T20:10:00+09:00",
            endedAt: "2026-09-01T20:15:00+09:00",
          },
          {
            roomId: "roomB",
            startedAt: "2026-09-01T20:10:01+09:00",
            endedAt: "2026-09-01T20:15:02+09:00",
          },
        ]),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].matchId).toBe("m1");
    expect(result[0].battleId).toBe("b1");
    expect(result[0].confidence).toBe("exact");
    // 開始は最も早いもの、終了は最も遅いもの
    expect(result[0].startedAt.toISOString()).toBe(T("2026-09-01T20:10:00+09:00").toISOString());
    expect(result[0].endedAt?.toISOString()).toBe(T("2026-09-01T20:15:02+09:00").toISOString());
    expect(result[0].endedAtSource).toBe("observed");
    expect(result[0].autoConfirm).toBe(true);
    expect(result[0].reviewReason).toBeNull();
  });

  it("2vs2でも4つのroomが揃えば完全一致になるが自動確定しない", () => {
    const result = assignBattles({
      matches: [match("m1", [["a1", "a2"], ["b1", "b2"]])],
      battles: [
        endedBattle(
          "b1",
          ["a1", "a2", "b1", "b2"],
          "2026-09-01T20:10:00+09:00",
          "2026-09-01T20:15:00+09:00"
        ),
      ],
    });

    expect(result[0].confidence).toBe("exact");
    // room の和集合が同じでも [a1,b1] 対 [a2,b2] だった可能性を排除できない。
    expect(result[0].autoConfirm).toBe(false);
    expect(result[0].reviewReason).toBe("TEAM_BATTLE");
  });

  it("部分一致は自動確定しない(相手が部外者だった可能性を排除できない)", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        endedBattle("b1", ["roomA"], "2026-09-01T20:10:00+09:00", "2026-09-01T20:15:00+09:00"),
      ],
    });

    expect(result[0].confidence).toBe("partial");
    expect(result[0].autoConfirm).toBe(false);
    expect(result[0].reviewReason).toBe("PARTIAL");
  });

  it("日程の終了時刻ちょうどに終わったバトルは対象にしない(半開区間)", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        endedBattle("b1", ["roomA", "roomB"], "2026-09-01T20:50:00+09:00", SESSION_END),
      ],
    });

    expect(result).toEqual([]);
  });

  it("日程の外で終わったバトルは割り当てない(開始が中でも)", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        endedBattle(
          "b1",
          ["roomA", "roomB"],
          "2026-09-01T20:58:00+09:00",
          "2026-09-01T21:03:00+09:00"
        ),
      ],
    });

    expect(result).toEqual([]);
  });

  it("日程の前に始まっても日程の中で終わったバトルは対象にする", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        endedBattle(
          "b1",
          ["roomA", "roomB"],
          "2026-09-01T19:57:00+09:00",
          "2026-09-01T20:03:00+09:00"
        ),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe("exact");
  });

  it("対戦カードにないroomが混じっていれば割り当てない", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        endedBattle(
          "b1",
          ["roomA", "roomZ"],
          "2026-09-01T20:10:00+09:00",
          "2026-09-01T20:15:00+09:00"
        ),
      ],
    });

    expect(result).toEqual([]);
  });

  it("部分一致の候補が複数あるときは決め打ちせず割り当てない", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]]), match("m2", [["roomA"], ["roomC"]])],
      battles: [
        endedBattle("b1", ["roomA"], "2026-09-01T20:10:00+09:00", "2026-09-01T20:15:00+09:00"),
      ],
    });

    expect(result).toEqual([]);
  });

  it("同じ組み合わせのバトルが日程内に複数あれば付けるが自動確定しない", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        endedBattle(
          "late",
          ["roomA", "roomB"],
          "2026-09-01T20:40:00+09:00",
          "2026-09-01T20:45:00+09:00"
        ),
        endedBattle(
          "early",
          ["roomA", "roomB"],
          "2026-09-01T20:10:00+09:00",
          "2026-09-01T20:15:00+09:00"
        ),
      ],
    });

    expect(result).toHaveLength(1);
    // 決定的に早いほうを採る。ただし主催者の確認へ回す。
    expect(result[0].battleId).toBe("early");
    expect(result[0].autoConfirm).toBe(false);
    expect(result[0].reviewReason).toBe("AMBIGUOUS");
  });

  it("同じバトルを2つのマッチに割り当てない", () => {
    const result = assignBattles({
      matches: [
        match("m1", [["roomA"], ["roomB"]], { position: 0 }),
        match("m2", [["roomA"], ["roomB"]], { position: 1 }),
      ],
      battles: [
        endedBattle(
          "b1",
          ["roomA", "roomB"],
          "2026-09-01T20:10:00+09:00",
          "2026-09-01T20:15:00+09:00"
        ),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].matchId).toBe("m1");
    expect(result[0].reviewReason).toBe("AMBIGUOUS");
  });

  it("終了を観測できていなくても開始を観測していれば duration から終了を出す", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          {
            roomId: "roomA",
            startedAt: "2026-09-01T20:10:00+09:00",
            endedAt: null,
            complete: false,
            durationSec: 300,
          },
          {
            roomId: "roomB",
            startedAt: "2026-09-01T20:10:00+09:00",
            endedAt: null,
            complete: false,
          },
        ]),
      ],
    });

    expect(result[0].endedAtSource).toBe("duration");
    expect(result[0].endedAt?.toISOString()).toBe(T("2026-09-01T20:15:00+09:00").toISOString());
    expect(result[0].autoConfirm).toBe(true);
  });

  it("開始が推定値なら duration から終了を作らない(暫定関連にする)", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          {
            roomId: "roomA",
            startedAt: "2026-09-01T20:10:00+09:00",
            startedAtEstimated: true,
            endedAt: null,
            complete: false,
            durationSec: 300,
          },
          {
            roomId: "roomB",
            startedAt: "2026-09-01T20:10:00+09:00",
            startedAtEstimated: true,
            endedAt: null,
            complete: false,
          },
        ]),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].endedAt).toBeNull();
    expect(result[0].endedAtSource).toBeNull();
    expect(result[0].autoConfirm).toBe(false);
  });

  it("終了が分からないバトルは暫定で関連づける(予定終了時刻を捏造しない)", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          {
            roomId: "roomA",
            startedAt: "2026-09-01T20:10:00+09:00",
            endedAt: null,
            complete: false,
          },
          {
            roomId: "roomB",
            startedAt: "2026-09-01T20:10:00+09:00",
            endedAt: null,
            complete: false,
          },
        ]),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].endedAt).toBeNull();
    expect(result[0].endedAtSource).toBeNull();
    expect(result[0].autoConfirm).toBe(false);
  });

  it("終了未確定でも日程よりずっと前に始まったバトルは暫定にしない", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          {
            roomId: "roomA",
            startedAt: "2026-09-01T12:00:00+09:00",
            endedAt: null,
            complete: false,
          },
          {
            roomId: "roomB",
            startedAt: "2026-09-01T12:00:00+09:00",
            endedAt: null,
            complete: false,
          },
        ]),
      ],
    });

    expect(result).toEqual([]);
  });

  it("上流が決着する前に行われたバトルは候補にしない", () => {
    const result = assignBattles({
      matches: [
        match("final", [["roomA"], ["roomB"]], {
          round: 2,
          feederDecidedAt: "2026-09-01T20:30:00+09:00",
        }),
      ],
      battles: [
        endedBattle(
          "b1",
          ["roomA", "roomB"],
          "2026-09-01T20:05:00+09:00",
          "2026-09-01T20:10:00+09:00"
        ),
      ],
    });

    expect(result).toEqual([]);
  });

  it("上流の決着後に始まったバトルなら候補にする", () => {
    const result = assignBattles({
      matches: [
        match("final", [["roomA"], ["roomB"]], {
          round: 2,
          feederDecidedAt: "2026-09-01T20:30:00+09:00",
        }),
      ],
      battles: [
        endedBattle(
          "b2",
          ["roomA", "roomB"],
          "2026-09-01T20:35:00+09:00",
          "2026-09-01T20:40:00+09:00"
        ),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].battleId).toBe("b2");
  });

  it("確定済みの検知は他のバトルへ付け替えない", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]], { lockedBattleId: "b1" })],
      battles: [
        endedBattle(
          "b1",
          ["roomA", "roomB"],
          "2026-09-01T20:10:00+09:00",
          "2026-09-01T20:15:00+09:00"
        ),
        endedBattle(
          "b2",
          ["roomA", "roomB"],
          "2026-09-01T20:40:00+09:00",
          "2026-09-01T20:45:00+09:00"
        ),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].battleId).toBe("b1");
  });

  it("参加者が未確定のマッチには割り当てない", () => {
    const result = assignBattles({
      matches: [match("m1", [[], []])],
      battles: [
        endedBattle("b1", ["roomA"], "2026-09-01T20:10:00+09:00", "2026-09-01T20:15:00+09:00"),
      ],
    });

    expect(result).toEqual([]);
  });

  it("観測roomが空のバトルは無視する", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [{ battleId: "b1", rooms: [] }],
    });

    expect(result).toEqual([]);
  });

  it("出場者が未確定のサイドを持つ枠には割り当てない", () => {
    // 期待 room の集合は全サイドの和集合なので、[["roomA"], []] は {roomA} になる。
    const result = assignBattles({
      matches: [match("half", [["roomA"], []])],
      battles: [
        endedBattle("b1", ["roomA"], "2026-09-01T20:10:00+09:00", "2026-09-01T20:15:00+09:00"),
      ],
    });

    expect(result).toEqual([]);
  });

  it("不戦勝行には割り当てない", () => {
    const result = assignBattles({
      matches: [match("bye", [["roomA"], ["roomB"]], { isBye: true })],
      battles: [
        endedBattle(
          "b1",
          ["roomA", "roomB"],
          "2026-09-01T20:10:00+09:00",
          "2026-09-01T20:15:00+09:00"
        ),
      ],
    });

    expect(result).toEqual([]);
  });

  it("別の日程のマッチには、その日程で終わったバトルだけを割り当てる", () => {
    const day2Start = "2026-09-02T20:00:00+09:00";
    const day2End = "2026-09-02T21:00:00+09:00";
    const result = assignBattles({
      matches: [
        match("day1", [["roomA"], ["roomB"]]),
        match("day2", [["roomA"], ["roomB"]], {
          round: 2,
          sessionStart: day2Start,
          sessionEnd: day2End,
        }),
      ],
      battles: [
        endedBattle(
          "b1",
          ["roomA", "roomB"],
          "2026-09-01T20:10:00+09:00",
          "2026-09-01T20:15:00+09:00"
        ),
        endedBattle(
          "b2",
          ["roomA", "roomB"],
          "2026-09-02T20:10:00+09:00",
          "2026-09-02T20:15:00+09:00"
        ),
      ],
    });

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.matchId === "day1")?.battleId).toBe("b1");
    expect(result.find((r) => r.matchId === "day2")?.battleId).toBe("b2");
  });
});

describe("findMissedMatches", () => {
  it("日程が終わっても検知できなかったマッチを返す", () => {
    const missed = findMissedMatches({
      matches: [
        match("m1", [["roomA"], ["roomB"]]),
        match("m2", [["roomC"], ["roomD"]], {
          sessionStart: "2026-09-01T22:00:00+09:00",
          sessionEnd: "2026-09-01T23:00:00+09:00",
        }),
      ],
      assigned: new Set<string>(),
      now: T("2026-09-01T21:30:00+09:00"),
    });

    expect(missed).toEqual(["m1"]);
  });

  it("割り当て済みのマッチは含めない", () => {
    const missed = findMissedMatches({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      assigned: new Set(["m1"]),
      now: T("2026-09-01T21:30:00+09:00"),
    });

    expect(missed).toEqual([]);
  });

  it("出場者が未確定のサイドを持つ枠は NO_SHOW にしない", () => {
    const missed = findMissedMatches({
      matches: [
        match("half", [["roomA"], []]),
        match("empty", [[], []]),
        match("ready", [["roomC"], ["roomD"]]),
      ],
      assigned: new Set<string>(),
      now: T("2026-09-01T21:30:00+09:00"),
    });

    expect(missed).toEqual(["ready"]);
  });

  it("不戦勝行は NO_SHOW にしない", () => {
    const missed = findMissedMatches({
      matches: [match("bye", [["roomA"], ["roomB"]], { isBye: true })],
      assigned: new Set<string>(),
      now: T("2026-09-01T21:30:00+09:00"),
    });

    expect(missed).toEqual([]);
  });
});

describe("scoreDivergence", () => {
  it("TikTok側のスコアと大きく食い違えば警告する", () => {
    const result = scoreDivergence(1000n, "5000");
    expect(result.diverged).toBe(true);
  });

  it("誤差が閾値以内なら警告しない", () => {
    const result = scoreDivergence(1000n, "1050");
    expect(result.diverged).toBe(false);
  });

  it("TikTok側のスコアが無ければ判定しない", () => {
    expect(scoreDivergence(1000n, null).diverged).toBe(false);
    expect(scoreDivergence(1000n, "").diverged).toBe(false);
    expect(scoreDivergence(1000n, "0").diverged).toBe(false);
  });
});
