import { describe, expect, it } from "vitest";
import { resolveListenerAttribution, type ContributionAmount } from "./top-participant";

function amount(points: bigint, diamonds: bigint): ContributionAmount {
  return { points, diamonds };
}

describe("resolveListenerAttribution", () => {
  it("リスナーごとに最もポイントを入れた参加者と、投げた参加者の人数を出す", () => {
    const byParticipant = new Map([
      ["p1", new Map([["alice", amount(300n, 3n)]])],
      ["p2", new Map([["alice", amount(1000n, 10n)], ["bob", amount(500n, 5n)]])],
    ]);

    const result = resolveListenerAttribution(byParticipant);

    expect(result.get("alice")).toEqual({ topParticipantId: "p2", participantCount: 2 });
    expect(result.get("bob")).toEqual({ topParticipantId: "p2", participantCount: 1 });
  });

  it("ポイントが同点ならダイヤが多い方を採る", () => {
    const byParticipant = new Map([
      ["p1", new Map([["alice", amount(1000n, 20n)]])],
      ["p2", new Map([["alice", amount(1000n, 10n)]])],
    ]);

    expect(resolveListenerAttribution(byParticipant).get("alice")).toEqual({
      topParticipantId: "p1",
      participantCount: 2,
    });
  });

  it("完全に同点なら participantId の昇順で決める(集計のたびに入れ替わらないように)", () => {
    const same = () => amount(1000n, 10n);
    const ascending = new Map([
      ["p1", new Map([["alice", same()]])],
      ["p2", new Map([["alice", same()]])],
    ]);
    const descending = new Map([
      ["p2", new Map([["alice", same()]])],
      ["p1", new Map([["alice", same()]])],
    ]);

    expect(resolveListenerAttribution(ascending).get("alice")?.topParticipantId).toBe("p1");
    expect(resolveListenerAttribution(descending).get("alice")?.topParticipantId).toBe("p1");
  });

  it("ポイントが 0 の参加者しかいなくても支援先は決まる(人数には数える)", () => {
    const byParticipant = new Map([
      ["p1", new Map([["alice", amount(0n, 0n)]])],
      ["p2", new Map([["alice", amount(0n, 0n)]])],
    ]);

    expect(resolveListenerAttribution(byParticipant).get("alice")).toEqual({
      topParticipantId: "p1",
      participantCount: 2,
    });
  });

  it("参加者がいなければ空", () => {
    expect(resolveListenerAttribution(new Map()).size).toBe(0);
  });
});
