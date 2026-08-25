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

    expect(result.get("alice")).toMatchObject({ topParticipantId: "p2", participantCount: 2 });
    expect(result.get("bob")).toMatchObject({ topParticipantId: "p2", participantCount: 1 });
  });

  it("ポイントが同点ならダイヤが多い方を採る", () => {
    const byParticipant = new Map([
      ["p1", new Map([["alice", amount(1000n, 20n)]])],
      ["p2", new Map([["alice", amount(1000n, 10n)]])],
    ]);

    expect(resolveListenerAttribution(byParticipant).get("alice")).toMatchObject({
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

    expect(resolveListenerAttribution(byParticipant).get("alice")).toMatchObject({
      topParticipantId: "p1",
      participantCount: 2,
    });
  });

  it("参加者がいなければ空", () => {
    expect(resolveListenerAttribution(new Map()).size).toBe(0);
  });

  describe("枠ごとの内訳", () => {
    it("投げた参加者を全件、ポイント降順で並べる", () => {
      const byParticipant = new Map([
        ["p1", new Map([["alice", amount(300n, 3n)]])],
        ["p2", new Map([["alice", amount(1000n, 10n)]])],
        ["p3", new Map([["alice", amount(500n, 5n)]])],
      ]);

      expect(resolveListenerAttribution(byParticipant).get("alice")?.breakdown).toEqual([
        { participantId: "p2", points: 1000n, diamonds: 10n },
        { participantId: "p3", points: 500n, diamonds: 5n },
        { participantId: "p1", points: 300n, diamonds: 3n },
      ]);
    });

    it("先頭は必ず支援先(topParticipantId)になる", () => {
      const byParticipant = new Map([
        ["p1", new Map([["alice", amount(1000n, 20n)]])],
        ["p2", new Map([["alice", amount(1000n, 10n)]])],
        ["p3", new Map([["alice", amount(1000n, 20n)]])],
      ]);

      const attribution = resolveListenerAttribution(byParticipant).get("alice");
      expect(attribution?.breakdown[0].participantId).toBe(attribution?.topParticipantId);
      // 同点はダイヤ降順 → participantId 昇順
      expect(attribution?.breakdown.map((b) => b.participantId)).toEqual(["p1", "p3", "p2"]);
    });

    it("投げた枠が1つだけなら1件だけ入る", () => {
      const byParticipant = new Map([["p1", new Map([["alice", amount(300n, 3n)]])]]);

      expect(resolveListenerAttribution(byParticipant).get("alice")?.breakdown).toEqual([
        { participantId: "p1", points: 300n, diamonds: 3n },
      ]);
    });

    it("参加者200枠すべてに投げても省略しない", () => {
      const byParticipant = new Map(
        Array.from({ length: 200 }, (_, i) => [
          `p${String(i).padStart(3, "0")}`,
          new Map([["alice", amount(BigInt(i + 1) * 100n, BigInt(i + 1))]]),
        ])
      );

      const attribution = resolveListenerAttribution(byParticipant).get("alice");
      expect(attribution?.participantCount).toBe(200);
      expect(attribution?.breakdown).toHaveLength(200);
      expect(attribution?.breakdown[0].participantId).toBe("p199");
    });
  });
});
