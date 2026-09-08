import { describe, it, expect } from "vitest";
import { buildSlotRows, type Bucket, type SlotInput } from "./match-contributions";
import type { ListenerProfile } from "./analytics-db";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";

/** ダイヤ d を等倍(x1.00)で積んだバケツ。 */
const bucket = (d: bigint, giftCount = 1): Bucket => ({
  diamonds: d,
  points: d * 100n,
  giftCount,
});

const slot = (participantId: string, sideIndex: number): SlotInput => ({
  participantId,
  displayName: `${participantId} の名前`,
  tiktokHandle: participantId,
  sideIndex,
});

// リスナーの同一性キーは tiktokUid(不変の数値文字列)。makeTiktokUid は seed の昇順で
// 辞書順も昇順になる(先頭 "7" + 18桁ゼロ埋め)ので、同点時のタイブレークの検証に使える。
const ALICE = makeTiktokUid(1);
const BOB = makeTiktokUid(2);
/** 同点タイブレーク用。ADAM < ZOE(辞書順)。 */
const ADAM = makeTiktokUid(21);
const ZOE = makeTiktokUid(22);

const NO_PROFILES = new Map<string, ListenerProfile>();

describe("buildSlotRows", () => {
  it("リスナーを枠ごとに分ける", () => {
    const rows = buildSlotRows(
      [slot("p1", 0), slot("p2", 1)],
      new Map([
        ["p1", new Map([[ALICE, bucket(500n)]])],
        ["p2", new Map([[BOB, bucket(300n)]])],
      ]),
      NO_PROFILES
    );

    expect(rows.map((r) => r.participantId)).toEqual(["p1", "p2"]);
    expect(rows[0].listeners.map((l) => l.tiktokUid)).toEqual([ALICE]);
    expect(rows[1].listeners.map((l) => l.tiktokUid)).toEqual([BOB]);
    expect(rows[0].diamonds).toBe("500");
  });

  it("ポイント降順 → ダイヤ降順 → tiktokUid 昇順で並べる", () => {
    const low = makeTiktokUid(11);
    const samePointsLessDiamonds = makeTiktokUid(12);
    const samePointsMoreDiamonds = makeTiktokUid(13);
    const top = makeTiktokUid(14);
    const rows = buildSlotRows(
      [slot("p1", 0)],
      new Map([
        [
          "p1",
          new Map([
            [low, bucket(100n)],
            // ポイントが同じでダイヤが違う(倍率の違う区間で稼いだ場合)
            [samePointsLessDiamonds, { diamonds: 200n, points: 60000n, giftCount: 1 }],
            [samePointsMoreDiamonds, { diamonds: 400n, points: 60000n, giftCount: 1 }],
            [top, bucket(900n)],
          ]),
        ],
      ]),
      NO_PROFILES
    );

    expect(rows[0].listeners.map((l) => l.tiktokUid)).toEqual([
      top,
      samePointsMoreDiamonds,
      samePointsLessDiamonds,
      low,
    ]);
  });

  it("完全に同点なら tiktokUid の昇順で安定させる", () => {
    const rows = buildSlotRows(
      [slot("p1", 0)],
      new Map([
        [
          "p1",
          new Map([
            [ZOE, bucket(100n)],
            [ADAM, bucket(100n)],
          ]),
        ],
      ]),
      NO_PROFILES
    );
    expect(rows[0].listeners.map((l) => l.tiktokUid)).toEqual([ADAM, ZOE]);
  });

  it("リスナーが多くても打ち切らず全件返す", () => {
    const listenerCount = 25;
    const listeners = new Map<string, Bucket>();
    for (let i = 0; i < listenerCount; i++) {
      listeners.set(makeTiktokUid(100 + i), bucket(BigInt((i + 1) * 100), 2));
    }
    const total = [...listeners.values()].reduce((sum, b) => sum + b.diamonds, 0n);

    const rows = buildSlotRows([slot("p1", 0)], new Map([["p1", listeners]]), NO_PROFILES);

    expect(rows[0].listeners).toHaveLength(listenerCount);
    expect(rows[0].diamonds).toBe(total.toString());
    expect(rows[0].giftCount).toBe(listenerCount * 2);
  });

  it("ギフトが1件も無い枠も0で載せる（横並びの列が消えない）", () => {
    const rows = buildSlotRows(
      [slot("p1", 0), slot("p2", 1)],
      new Map([["p1", new Map([[ALICE, bucket(500n)]])]]),
      NO_PROFILES
    );

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      participantId: "p2",
      diamonds: "0",
      points: "0.00",
      giftCount: 0,
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
      new Map([["p1", new Map([[ALICE, bucket(500n)]])]]),
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
      new Map([["p1", new Map([[ALICE, { diamonds: 100n, points: 25000n, giftCount: 1 }]])]]),
      NO_PROFILES
    );
    expect(rows[0].points).toBe("250.00");
    expect(rows[0].listeners[0].points).toBe("250.00");
  });

  it("プロフィールを引けたら表示名を載せ、アイコンは別で解決した URL を載せる", () => {
    const rows = buildSlotRows(
      [slot("p1", 0)],
      new Map([["p1", new Map([[ALICE, bucket(500n)]])]]),
      // 表示名は TikTokUser(tiktokUid 主キー)から順引きする。
      new Map([[ALICE, { tiktokHandle: "alice", nickname: "アリス" }]]),
      // アイコンは TiktokAvatarAsset(resolveAvatarUrls)が正本なので別 Map で渡す。
      new Map([[ALICE, "https://cdn/a.jpg"]])
    );
    expect(rows[0].listeners[0]).toMatchObject({
      tiktokUid: ALICE,
      tiktokHandle: "alice",
      nickname: "アリス",
      profileImageUrl: "https://cdn/a.jpg",
    });
  });

  it("プロフィールを引けないリスナーは tiktokUid だけを返し、表示名は null にする", () => {
    // 表示名を tiktokHandle で埋める旧挙動は取りやめた(ハンドルは可変なので
    // 未解決のときに焼き付けない)。ガードは表示側の責務。
    const rows = buildSlotRows(
      [slot("p1", 0)],
      new Map([["p1", new Map([[ALICE, bucket(500n)]])]]),
      NO_PROFILES
    );
    expect(rows[0].listeners[0]).toMatchObject({
      tiktokUid: ALICE,
      tiktokHandle: null,
      nickname: null,
      profileImageUrl: null,
    });
  });
});
