import { describe, it, expect } from "vitest";
import {
  buildSlotRows,
  MAX_MATCH_LISTENER_ROWS,
  type Bucket,
  type SlotInput,
} from "./match-contributions";
import type { ListenerProfile } from "./analytics-db";

/** ダイヤ d を等倍(x1.00)で積んだバケツ。 */
const bucket = (d: bigint, giftCount = 1): Bucket => ({
  diamonds: d,
  points: d * 100n,
  giftCount,
});

const slot = (participantId: string, sideIndex: number): SlotInput => ({
  participantId,
  displayName: `${participantId} の名前`,
  tiktokId: participantId,
  sideIndex,
});

const NO_PROFILES = new Map<string, ListenerProfile>();

describe("buildSlotRows", () => {
  it("リスナーを枠ごとに分ける", () => {
    const rows = buildSlotRows(
      [slot("p1", 0), slot("p2", 1)],
      new Map([
        ["p1", new Map([["alice", bucket(500n)]])],
        ["p2", new Map([["bob", bucket(300n)]])],
      ]),
      NO_PROFILES
    );

    expect(rows.map((r) => r.participantId)).toEqual(["p1", "p2"]);
    expect(rows[0].listeners.map((l) => l.uniqueId)).toEqual(["alice"]);
    expect(rows[1].listeners.map((l) => l.uniqueId)).toEqual(["bob"]);
    expect(rows[0].diamonds).toBe("500");
  });

  it("ポイント降順 → ダイヤ降順 → uniqueId 昇順で並べる", () => {
    const rows = buildSlotRows(
      [slot("p1", 0)],
      new Map([
        [
          "p1",
          new Map([
            ["low", bucket(100n)],
            // ポイントが同じでダイヤが違う(倍率の違う区間で稼いだ場合)
            ["samePointsLessDiamonds", { diamonds: 200n, points: 60000n, giftCount: 1 }],
            ["samePointsMoreDiamonds", { diamonds: 400n, points: 60000n, giftCount: 1 }],
            ["top", bucket(900n)],
          ]),
        ],
      ]),
      NO_PROFILES
    );

    expect(rows[0].listeners.map((l) => l.uniqueId)).toEqual([
      "top",
      "samePointsMoreDiamonds",
      "samePointsLessDiamonds",
      "low",
    ]);
  });

  it("完全に同点なら uniqueId の昇順で安定させる", () => {
    const rows = buildSlotRows(
      [slot("p1", 0)],
      new Map([
        [
          "p1",
          new Map([
            ["zoe", bucket(100n)],
            ["adam", bucket(100n)],
          ]),
        ],
      ]),
      NO_PROFILES
    );
    expect(rows[0].listeners.map((l) => l.uniqueId)).toEqual(["adam", "zoe"]);
  });

  it("上位で打ち切っても枠の合計は全量から出す", () => {
    const listeners = new Map<string, Bucket>();
    for (let i = 0; i < MAX_MATCH_LISTENER_ROWS + 5; i++) {
      // 100, 200, ... と増やして、打ち切られるのが下位になるようにする。
      listeners.set(`u${String(i).padStart(2, "0")}`, bucket(BigInt((i + 1) * 100), 2));
    }
    const total = [...listeners.values()].reduce((sum, b) => sum + b.diamonds, 0n);

    const rows = buildSlotRows([slot("p1", 0)], new Map([["p1", listeners]]), NO_PROFILES);

    expect(rows[0].listeners).toHaveLength(MAX_MATCH_LISTENER_ROWS);
    expect(rows[0].truncated).toBe(true);
    expect(rows[0].diamonds).toBe(total.toString());
    expect(rows[0].giftCount).toBe((MAX_MATCH_LISTENER_ROWS + 5) * 2);
  });

  it("打ち切りが起きなければ truncated は false", () => {
    const rows = buildSlotRows(
      [slot("p1", 0)],
      new Map([["p1", new Map([["alice", bucket(100n)]])]]),
      NO_PROFILES
    );
    expect(rows[0].truncated).toBe(false);
  });

  it("ギフトが1件も無い枠も0で載せる（横並びの列が消えない）", () => {
    const rows = buildSlotRows(
      [slot("p1", 0), slot("p2", 1)],
      new Map([["p1", new Map([["alice", bucket(500n)]])]]),
      NO_PROFILES
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      participantId: "p2",
      diamonds: "0",
      points: "0.00",
      giftCount: 0,
      truncated: false,
    });
    expect(rows[1].listeners).toEqual([]);
  });

  it("sideIndex 昇順に並べ、同じサイド内は渡された順を保つ（2vs2 で4列）", () => {
    const rows = buildSlotRows(
      // わざと sideIndex を混ぜて渡す
      [slot("b1", 1), slot("a1", 0), slot("b2", 1), slot("a2", 0)],
      new Map(),
      NO_PROFILES
    );
    expect(rows.map((r) => r.participantId)).toEqual(["a1", "a2", "b1", "b2"]);
    expect(rows.map((r) => r.sideIndex)).toEqual([0, 0, 1, 1]);
  });

  it("同じ参加者が両サイドに入っていても1列にする（二重計上させない）", () => {
    const rows = buildSlotRows(
      [slot("p1", 0), slot("p1", 1)],
      new Map([["p1", new Map([["alice", bucket(500n)]])]]),
      NO_PROFILES
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sideIndex).toBe(0);
    expect(rows[0].diamonds).toBe("500");
  });

  it("倍率がかかったポイントを Decimal 文字列で返す", () => {
    const rows = buildSlotRows(
      [slot("p1", 0)],
      // 100 ダイヤ × 2.5倍 = 250 ポイント(内部では 25000n)
      new Map([["p1", new Map([["alice", { diamonds: 100n, points: 25000n, giftCount: 1 }]])]]),
      NO_PROFILES
    );
    expect(rows[0].points).toBe("250.00");
    expect(rows[0].listeners[0].points).toBe("250.00");
  });

  it("プロフィールを引けたら表示名とアイコンを載せる", () => {
    const rows = buildSlotRows(
      [slot("p1", 0)],
      new Map([["p1", new Map([["alice", bucket(500n)]])]]),
      new Map([["alice", { nickname: "アリス", profileImageUrl: "https://cdn/a.jpg" }]])
    );
    expect(rows[0].listeners[0]).toMatchObject({
      nickname: "アリス",
      profileImageUrl: "https://cdn/a.jpg",
    });
  });

  it("プロフィールを引けないリスナーは uniqueId をそのまま表示名にする", () => {
    const rows = buildSlotRows(
      [slot("p1", 0)],
      new Map([["p1", new Map([["alice", bucket(500n)]])]]),
      NO_PROFILES
    );
    expect(rows[0].listeners[0]).toMatchObject({
      nickname: "alice",
      profileImageUrl: null,
    });
  });
});
