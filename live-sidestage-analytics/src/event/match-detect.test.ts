import { describe, it, expect } from "vitest";
import {
  assignBattles,
  findMissedMatches,
  scoreDivergence,
  type BattleObservation,
  type MatchCandidate,
} from "./match-detect";

const T = (iso: string) => new Date(iso);

function match(
  id: string,
  sideRoomIds: string[][],
  start = "2026-09-01T20:00:00+09:00",
  end = "2026-09-01T21:00:00+09:00",
  isBye = false
): MatchCandidate {
  return {
    id,
    scheduledStartAt: T(start),
    scheduledEndAt: T(end),
    sideRoomIds,
    isBye,
  };
}

function battle(
  battleId: string,
  rooms: {
    roomId: string;
    startedAt: string;
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
      endedAt: r.endedAt ? T(r.endedAt) : null,
      complete: r.complete ?? true,
      durationSec: r.durationSec ?? null,
    })),
  };
}

describe("assignBattles", () => {
  it("両サイドのroomが揃っていれば完全一致で割り当てる", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          { roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00", endedAt: "2026-09-01T20:15:00+09:00" },
          { roomId: "roomB", startedAt: "2026-09-01T20:10:01+09:00", endedAt: "2026-09-01T20:15:02+09:00" },
        ]),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].matchId).toBe("m1");
    expect(result[0].battleId).toBe("b1");
    expect(result[0].confidence).toBe("exact");
    // 開始は最も早いもの、終了は最も遅いもの
    expect(result[0].startedAt.toISOString()).toBe(T("2026-09-01T20:10:00+09:00").toISOString());
    expect(result[0].endedAt.toISOString()).toBe(T("2026-09-01T20:15:02+09:00").toISOString());
    expect(result[0].endedAtSource).toBe("observed");
  });

  it("2vs2でも4つのroomが揃えば完全一致になる", () => {
    const result = assignBattles({
      matches: [match("m1", [["a1", "a2"], ["b1", "b2"]])],
      battles: [
        battle("b1", [
          { roomId: "a1", startedAt: "2026-09-01T20:10:00+09:00" },
          { roomId: "a2", startedAt: "2026-09-01T20:10:00+09:00" },
          { roomId: "b1", startedAt: "2026-09-01T20:10:00+09:00" },
          { roomId: "b2", startedAt: "2026-09-01T20:10:00+09:00" },
        ]),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe("exact");
    // room の和集合が同じでも [a1,b1] 対 [a2,b2] だった可能性を排除できないので、
    // 2vs2 は完全一致でも自動確定しない。
    expect(result[0].autoConfirm).toBe(false);
  });

  it("1vs1の完全一致だけを自動確定の対象にする", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          { roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" },
          { roomId: "roomB", startedAt: "2026-09-01T20:10:00+09:00" },
        ]),
      ],
    });

    expect(result[0].autoConfirm).toBe(true);
  });

  it("部分一致は自動確定しない(相手が部外者だった可能性を排除できない)", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [battle("b1", [{ roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" }])],
    });

    expect(result[0].confidence).toBe("partial");
    expect(result[0].autoConfirm).toBe(false);
  });

  it("予定終了時刻ちょうどに始まったバトルは次の枠のものとして扱う", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          { roomId: "roomA", startedAt: "2026-09-01T21:00:00+09:00" },
          { roomId: "roomB", startedAt: "2026-09-01T21:00:00+09:00" },
        ]),
      ],
    });

    expect(result).toEqual([]);
  });

  it("時間枠の外で始まったバトルは割り当てない", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          { roomId: "roomA", startedAt: "2026-09-01T22:00:00+09:00" },
          { roomId: "roomB", startedAt: "2026-09-01T22:00:00+09:00" },
        ]),
      ],
    });

    expect(result).toEqual([]);
  });

  it("対戦カードにないroomが混じっていれば割り当てない", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          { roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" },
          { roomId: "roomZ", startedAt: "2026-09-01T20:10:00+09:00" },
        ]),
      ],
    });

    expect(result).toEqual([]);
  });

  it("片側しか観測できなくても候補が1つだけなら部分一致で割り当てる", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [battle("b1", [{ roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" }])],
    });

    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe("partial");
  });

  it("部分一致の候補が複数あるときは決め打ちせず割り当てない", () => {
    // roomA が2つのマッチに出ていて、片側しか観測できていない
    const result = assignBattles({
      matches: [
        match("m1", [["roomA"], ["roomB"]]),
        match("m2", [["roomA"], ["roomC"]]),
      ],
      battles: [battle("b1", [{ roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" }])],
    });

    expect(result).toEqual([]);
  });

  it("1つのマッチに部分一致のバトルが複数あるときも割り当てない", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [{ roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" }]),
        battle("b2", [{ roomId: "roomB", startedAt: "2026-09-01T20:30:00+09:00" }]),
      ],
    });

    expect(result).toEqual([]);
  });

  it("完全一致を先に確定させ、残りだけを部分一致で見る", () => {
    // b1 は m1 と完全一致。b2 は roomA だけだが、m1 が埋まるので m2 の候補として唯一になる
    const result = assignBattles({
      matches: [
        match("m1", [["roomA"], ["roomB"]]),
        match("m2", [["roomA"], ["roomC"]], "2026-09-01T21:00:00+09:00", "2026-09-01T22:00:00+09:00"),
      ],
      battles: [
        battle("b1", [
          { roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" },
          { roomId: "roomB", startedAt: "2026-09-01T20:10:00+09:00" },
        ]),
        battle("b2", [{ roomId: "roomA", startedAt: "2026-09-01T21:10:00+09:00" }]),
      ],
    });

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.matchId === "m1")?.confidence).toBe("exact");
    expect(result.find((r) => r.matchId === "m2")?.confidence).toBe("partial");
  });

  it("同じバトルを2つのマッチに割り当てない", () => {
    // 同じ組み合わせのマッチを同じ時間枠に2つ置いた場合
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]]), match("m2", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          { roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" },
          { roomId: "roomB", startedAt: "2026-09-01T20:10:00+09:00" },
        ]),
      ],
    });

    expect(result).toHaveLength(1);
  });

  it("候補が複数なら予定開始時刻に近いほうを採る", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("late", [
          { roomId: "roomA", startedAt: "2026-09-01T20:50:00+09:00" },
          { roomId: "roomB", startedAt: "2026-09-01T20:50:00+09:00" },
        ]),
        battle("early", [
          { roomId: "roomA", startedAt: "2026-09-01T20:02:00+09:00" },
          { roomId: "roomB", startedAt: "2026-09-01T20:02:00+09:00" },
        ]),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].battleId).toBe("early");
  });

  it("終了を観測できていなければ duration から終了時刻を出す", () => {
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
          { roomId: "roomB", startedAt: "2026-09-01T20:10:00+09:00", endedAt: null, complete: false },
        ]),
      ],
    });

    expect(result[0].endedAtSource).toBe("duration");
    expect(result[0].endedAt.toISOString()).toBe(T("2026-09-01T20:15:00+09:00").toISOString());
  });

  it("duration も無ければ予定終了時刻にフォールバックする", () => {
    const result = assignBattles({
      matches: [match("m1", [["roomA"], ["roomB"]])],
      battles: [
        battle("b1", [
          { roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00", endedAt: null, complete: false },
          { roomId: "roomB", startedAt: "2026-09-01T20:10:00+09:00", endedAt: null, complete: false },
        ]),
      ],
    });

    expect(result[0].endedAtSource).toBe("scheduled");
    expect(result[0].endedAt.toISOString()).toBe(T("2026-09-01T21:00:00+09:00").toISOString());
  });

  it("参加者が未確定のマッチには割り当てない", () => {
    const result = assignBattles({
      matches: [match("m1", [[], []])],
      battles: [battle("b1", [{ roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" }])],
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
    // roomA が部外者と戦ったバトルが「完全一致」として載るのを防ぐ。
    const result = assignBattles({
      matches: [match("half", [["roomA"], []])],
      battles: [
        battle("b1", [{ roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" }]),
      ],
    });

    expect(result).toEqual([]);
  });

  it("不戦勝行には割り当てない", () => {
    const result = assignBattles({
      matches: [
        match("bye", [["roomA"], ["roomB"]], "2026-09-01T20:00:00+09:00", "2026-09-01T21:00:00+09:00", true),
      ],
      battles: [
        battle("b1", [
          { roomId: "roomA", startedAt: "2026-09-01T20:10:00+09:00" },
          { roomId: "roomB", startedAt: "2026-09-01T20:10:00+09:00" },
        ]),
      ],
    });

    expect(result).toEqual([]);
  });
});

describe("findMissedMatches", () => {
  it("時間枠を過ぎても検知できなかったマッチを返す", () => {
    const missed = findMissedMatches({
      matches: [
        match("m1", [["roomA"], ["roomB"]]),
        match("m2", [["roomC"], ["roomD"]], "2026-09-01T22:00:00+09:00", "2026-09-01T23:00:00+09:00"),
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
    // 上流の勝者がまだ決まっていないだけで、実施されなかったわけではない。
    // ここを NO_SHOW にすると、1回戦の開始が過去の表は作った直後に全滅する。
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
      matches: [
        match("bye", [["roomA"], ["roomB"]], "2026-09-01T20:00:00+09:00", "2026-09-01T21:00:00+09:00", true),
      ],
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

  it("誤差の範囲なら警告しない", () => {
    const result = scoreDivergence(1000n, "1050");
    expect(result.diverged).toBe(false);
    expect(result.ratio).toBeCloseTo(0.0476, 3);
  });

  it("TikTok側のスコアが無ければ判定しない", () => {
    expect(scoreDivergence(1000n, null)).toEqual({ diverged: false, ratio: null });
    expect(scoreDivergence(1000n, "")).toEqual({ diverged: false, ratio: null });
    expect(scoreDivergence(1000n, "0")).toEqual({ diverged: false, ratio: null });
    expect(scoreDivergence(1000n, "abc")).toEqual({ diverged: false, ratio: null });
  });
});
