import { describe, expect, it } from "vitest";
import {
  BATTLE_REPLAY_VERSION,
  REPLAY_BAR_LIFETIME_MS,
  type BattleReplayPayload,
} from "@/lib/battle-replay-contract";
import {
  formatClock,
  formatShortAmount,
  initialOf,
  replayTitleOf,
  rippleScaleForCoins,
} from "./replay-format";
import { buildStageLayout } from "./replay-layout";
import {
  buildCards,
  cardSizeOf,
  cardsAt,
  cardsByAnchor,
  isBandSegment,
  comboCountAt,
  contributorsAt,
  isQuietAt,
  quietRangesOf,
  scoresAt,
  segmentAt,
  selfAnchorIndexes,
  teamTotalsOf,
  bigGiftsByAnchor,
  BIG_GIFT_DURATION_MS,
  BIG_GIFT_MIN_DIAMONDS,
  bigGiftTierOf,
  MID_GIFT_MIN_DIAMONDS,
  QUIET_LEAD_MS,
  QUIET_MIN_GAP_MS,
} from "./replay-select";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";

function payload(overrides: Partial<BattleReplayPayload> = {}): BattleReplayPayload {
  return {
    version: BATTLE_REPLAY_VERSION,
    battleId: "b1",
    startedAt: "2026-09-06T12:00:00.000Z",
    durationMs: 300_000,
    status: "finished",
    teams: [
      {
        index: 0,
        isSelf: true,
        officialScore: "100",
        participants: [
          { tiktokUid: "self", isSelf: true, displayName: "自分", tiktokHandle: "self", avatarUrl: null },
        ],
      },
      {
        index: 1,
        isSelf: false,
        officialScore: "80",
        participants: [
          { tiktokUid: "rival", isSelf: false, displayName: "相手", tiktokHandle: "rival", avatarUrl: null },
        ],
      },
    ],
    anchors: ["self", "rival"],
    senders: [
      { uid: makeTiktokUid("fan_a"), u: "fan_a", n: "ファンA", a: null },
      { uid: makeTiktokUid("fan_b"), u: "fan_b", n: "ファンB", a: null },
    ],
    gifts: [{ id: 5655, n: "バラ", img: null }],
    scorePoints: [
      { t: 0, a: 0, s: "0" },
      { t: 10_000, a: 0, s: "500" },
      { t: 20_000, a: 1, s: "300" },
    ],
    giftEvents: [],
    segments: [],
    opponentGiftsMissing: false,
    truncated: false,
    ...overrides,
  };
}

describe("formatShortAmount", () => {
  it("1000未満はそのまま、それ以上は切り捨てで省略する", () => {
    expect(formatShortAmount(0)).toBe("0");
    expect(formatShortAmount(999)).toBe("999");
    expect(formatShortAmount(1299)).toBe("1.2k");
    expect(formatShortAmount(9999)).toBe("9.9k");
    expect(formatShortAmount(31_999)).toBe("31k");
    expect(formatShortAmount(1_899_999)).toBe("1.8M");
    expect(formatShortAmount(12_999_999)).toBe("12M");
  });

  it("表記が切り替わる境界ちょうどで桁を取り違えない", () => {
    expect(formatShortAmount(1000)).toBe("1.0k");
    expect(formatShortAmount(10_000)).toBe("10k");
    expect(formatShortAmount(999_999)).toBe("999k");
    expect(formatShortAmount(1_000_000)).toBe("1.0M");
    expect(formatShortAmount(10_000_000)).toBe("10M");
  });
});

describe("formatClock", () => {
  it("負値とNaNは00:00へ丸める", () => {
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(Number.NaN)).toBe("00:00");
    expect(formatClock(172_000)).toBe("02:52");
  });
});

describe("buildCards", () => {
  it("同じ k のイベントは1枚へ畳み、連打数とダイヤを足し込む", () => {
    const cards = buildCards(
      payload({
        giftEvents: [
          { t: 1000, a: 0, s: 0, g: 0, c: 1, d: 10, k: 0, m: null },
          { t: 1400, a: 0, s: 0, g: 0, c: 2, d: 20, k: 0, m: 5 },
          { t: 5000, a: 1, s: 1, g: 0, c: 1, d: 10, k: null, m: null },
        ],
      })
    );
    expect(cards).toHaveLength(2);
    expect(cards[0]!.count).toBe(3);
    expect(cards[0]!.diamonds).toBe(30);
    expect(cards[0]!.comboSpanMs).toBe(400);
    expect(cards[0]!.multiplierValue).toBe(5);
    expect(cards[0]!.endMs).toBe(1400 + REPLAY_BAR_LIFETIME_MS);
    expect(cards[1]!.comboSpanMs).toBe(0);
  });
});

describe("bigGiftsByAnchor", () => {
  const cards = buildCards(
    payload({
      giftEvents: [
        // 閾値ちょうど未満 / ちょうど
        { t: 1000, a: 0, s: 0, g: 0, c: 1, d: MID_GIFT_MIN_DIAMONDS - 1, k: null, m: null },
        { t: 2000, a: 0, s: 0, g: 0, c: 1, d: BIG_GIFT_MIN_DIAMONDS, k: null, m: null },
        { t: 2500, a: 1, s: 1, g: 0, c: 1, d: 34_999, k: null, m: null },
        // 同じ枠で重なる2発。新しい方を採る
        { t: 3000, a: 0, s: 1, g: 0, c: 1, d: 20_000, k: null, m: null },
      ],
    })
  );

  it("閾値未満のギフトでは演出を出さない", () => {
    expect(bigGiftsByAnchor(cards, 1200, 2)).toEqual([null, null]);
  });

  it("閾値ちょうどから演出を出し、尺を過ぎたら消す", () => {
    expect(bigGiftsByAnchor(cards, 2000, 2)[0]?.diamonds).toBe(BIG_GIFT_MIN_DIAMONDS);
    expect(bigGiftsByAnchor(cards, 2000, 2)[1]).toBeNull();
    // anchor 1 のギフトは 2500ms 開始。尺の終端(排他)で消える
    expect(bigGiftsByAnchor(cards, 2500 + BIG_GIFT_DURATION_MS - 1, 2)[1]?.diamonds).toBe(34_999);
    expect(bigGiftsByAnchor(cards, 2500 + BIG_GIFT_DURATION_MS, 2)[1]).toBeNull();
  });

  it("同じ枠で重なったら新しい方を採る", () => {
    expect(bigGiftsByAnchor(cards, 3100, 2)[0]?.diamonds).toBe(20_000);
  });

  it("カードの表示上限で押し出されても演出は出る(全カードから選ぶ)", () => {
    const many = buildCards(
      payload({
        giftEvents: [
          { t: 1000, a: 0, s: 0, g: 0, c: 1, d: 50_000, k: null, m: null },
          ...Array.from({ length: 8 }, (_, i) => ({
            t: 1100 + i * 10,
            a: 0,
            s: 1,
            g: 0,
            c: 1,
            d: 1,
            k: null,
            m: null,
          })),
        ],
      })
    );
    const visible = cardsByAnchor(cardsAt(many, 1200), 2);
    expect(visible[0]!.some((card) => card.diamonds === 50_000)).toBe(false);
    expect(bigGiftsByAnchor(many, 1200, 2)[0]?.diamonds).toBe(50_000);
  });

  it("1000〜9999コインは mid 段として演出を出す", () => {
    expect(bigGiftTierOf(MID_GIFT_MIN_DIAMONDS - 1)).toBeNull();
    expect(bigGiftTierOf(MID_GIFT_MIN_DIAMONDS)).toBe("mid");
    expect(bigGiftTierOf(BIG_GIFT_MIN_DIAMONDS - 1)).toBe("mid");
    expect(bigGiftTierOf(BIG_GIFT_MIN_DIAMONDS)).toBe("big");

    const mid = buildCards(
      payload({
        giftEvents: [{ t: 1000, a: 0, s: 0, g: 0, c: 1, d: MID_GIFT_MIN_DIAMONDS, k: null, m: null }],
      })
    );
    expect(bigGiftsByAnchor(mid, 1000, 2)[0]?.diamonds).toBe(MID_GIFT_MIN_DIAMONDS);
  });

  it("同じ枠で段が違うときは big を優先し、mid では上書きしない", () => {
    const mixed = buildCards(
      payload({
        giftEvents: [
          { t: 1000, a: 0, s: 0, g: 0, c: 1, d: 20_000, k: null, m: null },
          { t: 1500, a: 0, s: 1, g: 0, c: 1, d: 5_000, k: null, m: null },
          { t: 2000, a: 1, s: 0, g: 0, c: 1, d: 5_000, k: null, m: null },
          { t: 2500, a: 1, s: 1, g: 0, c: 1, d: 20_000, k: null, m: null },
        ],
      })
    );
    // 後から来た mid は、演出中の big を押しのけない
    expect(bigGiftsByAnchor(mixed, 1600, 2)[0]?.diamonds).toBe(20_000);
    // 逆に mid の最中に来た big は差し替わる
    expect(bigGiftsByAnchor(mixed, 2500, 2)[1]?.diamonds).toBe(20_000);
  });
});

describe("comboCountAt", () => {
  it("単発は常に最終値、コンボは1から刻んで上がる", () => {
    const [combo, single] = buildCards(
      payload({
        giftEvents: [
          { t: 0, a: 0, s: 0, g: 0, c: 1, d: 10, k: 0, m: null },
          { t: 1000, a: 0, s: 0, g: 0, c: 3, d: 30, k: 0, m: null },
          { t: 0, a: 1, s: 1, g: 0, c: 5, d: 50, k: null, m: null },
        ],
      })
    );
    expect(comboCountAt(combo!, 0)).toBe(1);
    expect(comboCountAt(combo!, 600)).toBe(3);
    expect(comboCountAt(combo!, 5000)).toBe(4);
    expect(comboCountAt(single!, 0)).toBe(5);
  });
});

describe("cardsAt", () => {
  it("表示時間を過ぎたカードは落とす", () => {
    const cards = buildCards(
      payload({ giftEvents: [{ t: 1000, a: 0, s: 0, g: 0, c: 1, d: 10, k: null, m: null }] })
    );
    expect(cardsAt(cards, 999)).toHaveLength(0);
    expect(cardsAt(cards, 1000)).toHaveLength(1);
    expect(cardsAt(cards, 1000 + REPLAY_BAR_LIFETIME_MS)).toHaveLength(0);
  });
});

describe("scoresAt", () => {
  it("補間せず、t <= elapsedMs の最後の点をそのまま採る", () => {
    const p = payload();
    expect(scoresAt(p, 0)).toEqual(["0", "0"]);
    expect(scoresAt(p, 9_999)).toEqual(["0", "0"]);
    expect(scoresAt(p, 15_000)).toEqual(["500", "0"]);
    expect(scoresAt(p, 300_000)).toEqual(["500", "300"]);
  });
});

describe("contributorsAt", () => {
  it("金額降順で並べ、コンボの未到達分は加算しない", () => {
    const p = payload({
      giftEvents: [
        { t: 0, a: 0, s: 0, g: 0, c: 1, d: 100, k: 0, m: null },
        { t: 1000, a: 0, s: 0, g: 0, c: 1, d: 100, k: 0, m: null },
        { t: 0, a: 0, s: 1, g: 0, c: 1, d: 150, k: null, m: null },
      ],
    });
    const cards = buildCards(p);
    const early = contributorsAt(p, cards, 0);
    expect(early[0]!.senderIndex).toBe(1);
    expect(early[1]!.coins).toBe(100);
    const late = contributorsAt(p, cards, 2000);
    expect(late[0]!.senderIndex).toBe(0);
    expect(late[0]!.coins).toBe(200);
  });
});

describe("cardsByAnchor", () => {
  it("同じ枠に6枚以上たまったら古い方から落とし、新しい5枚を残す", () => {
    const cards = buildCards(
      payload({
        giftEvents: [0, 1, 2, 3, 4, 5].map((i) => ({
          t: i * 100,
          a: 0,
          s: 0,
          g: 0,
          c: 1,
          d: 10,
          k: null,
          m: null,
        })),
      })
    );
    const five = cardsByAnchor(cardsAt(cards, 400), 2);
    expect(five[0]).toHaveLength(5);
    const six = cardsByAnchor(cardsAt(cards, 500), 2);
    expect(six[0]).toHaveLength(5);
    expect(six[0]!.map((c) => c.startMs)).toEqual([100, 200, 300, 400, 500]);
    expect(six[1]).toHaveLength(0);
  });
});

describe("contributorsAt の集計対象", () => {
  it("相手 anchor 宛のギフトは集計しない(下段は自分への貢献者一覧)", () => {
    const p = payload({
      giftEvents: [
        { t: 1000, a: 0, s: 0, g: 0, c: 1, d: 100, k: null, m: null },
        // 相手陣営へ、額の大きいギフト。全 anchor を合算すると相手の送信者が1位になる
        { t: 1000, a: 1, s: 1, g: 0, c: 1, d: 9999, k: null, m: null },
      ],
    });
    const list = contributorsAt(p, buildCards(p), 1500);
    expect(list.map((c) => c.senderIndex)).toEqual([0]);
  });

  it("個人の isSelf が1件も無い古い行では自陣営全員へフォールバックする", () => {
    const base = payload();
    const p = payload({
      teams: base.teams.map((team) => ({
        ...team,
        participants: team.participants.map((participant) => ({ ...participant, isSelf: false })),
      })),
      giftEvents: [
        { t: 1000, a: 0, s: 0, g: 0, c: 1, d: 100, k: null, m: null },
        { t: 1000, a: 1, s: 1, g: 0, c: 1, d: 9999, k: null, m: null },
      ],
    });
    // 空集合を返すとボードが無言で空になる。自陣営(team.isSelf)の anchor で拾う
    expect(selfAnchorIndexes(p)).toEqual(new Set([0]));
    expect(contributorsAt(p, buildCards(p), 1500).map((c) => c.senderIndex)).toEqual([0]);
  });
});

describe("selfAnchorIndexes", () => {
  it("participant.isSelf を優先し、anchors の添字で返す", () => {
    // 自陣営の participant が2人目にいるケース(anchors の添字は teams をまたいで通し番号)
    const p = payload({
      teams: [
        {
          index: 0,
          isSelf: false,
          officialScore: "80",
          participants: [
            { tiktokUid: "rival", isSelf: false, displayName: "相手", tiktokHandle: "rival", avatarUrl: null },
          ],
        },
        {
          index: 1,
          isSelf: true,
          officialScore: "100",
          participants: [
            { tiktokUid: "self", isSelf: true, displayName: "自分", tiktokHandle: "self", avatarUrl: null },
          ],
        },
      ],
      anchors: ["rival", "self"],
    });
    expect(selfAnchorIndexes(p)).toEqual(new Set([1]));
  });
});

describe("contributorsAt の人数上限", () => {
  it("7人が投げても上位6人までしか並べない", () => {
    const p = payload({
      senders: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
        uid: makeTiktokUid(`fan_${i}`),
        u: `fan_${i}`,
        n: `ファン${i}`,
        a: null,
      })),
      giftEvents: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
        t: i * 10,
        a: 0,
        s: i,
        g: 0,
        c: 1,
        d: (i + 1) * 100,
        k: null,
        m: null,
      })),
    });
    const list = contributorsAt(p, buildCards(p), 1000);
    expect(list).toHaveLength(6);
    expect(list.map((c) => c.senderIndex)).toEqual([6, 5, 4, 3, 2, 1]);
  });
});

describe("cardSizeOf", () => {
  it("ダイヤ額の境界ちょうどで太さが切り替わる", () => {
    expect(cardSizeOf(99)).toBe("sm");
    expect(cardSizeOf(100)).toBe("md");
    expect(cardSizeOf(999)).toBe("md");
    expect(cardSizeOf(1000)).toBe("lg");
  });
});

describe("isBandSegment", () => {
  it("初ギフト倍率は実測(measured)のときだけ帯にする", () => {
    const opening = (confidence: "measured" | "inferred") => ({
      kind: "opening" as const,
      startMs: 0,
      endMs: 48_000,
      multiplier: 2,
      label: "初めてのギフト ×2倍",
      showCountdown: true,
      confidence,
    });
    expect(isBandSegment(opening("measured"))).toBe(true);
    expect(isBandSegment(opening("inferred"))).toBe(false);
    expect(
      isBandSegment({
        kind: "bonus_mission",
        startMs: 0,
        endMs: 1000,
        multiplier: 3,
        label: "ボーナス",
        showCountdown: false,
      })
    ).toBe(true);
  });
});

describe("rippleScaleForCoins / initialOf", () => {
  it("リップル倍率はコイン額で 1.5〜2.8 に収まる", () => {
    expect(rippleScaleForCoins(0)).toBe(1.5);
    expect(rippleScaleForCoins(1)).toBe(1.5);
    expect(rippleScaleForCoins(1_000_000)).toBe(2.8);
    expect(rippleScaleForCoins(100_000_000)).toBe(2.8);
    const mid = rippleScaleForCoins(1000);
    expect(mid).toBeGreaterThan(1.5);
    expect(mid).toBeLessThan(2.8);
  });

  it("イニシャルは絵文字・サロゲートペアで割らない", () => {
    expect(initialOf("ファンA")).toBe("フ");
    expect(initialOf("🎁gift")).toBe("🎁");
    expect(initialOf("   ")).toBe("?");
  });
});

describe("segmentAt", () => {
  it("重なったら opening を優先する", () => {
    const p = payload({
      segments: [
        {
          kind: "bonus_mission",
          startMs: 0,
          endMs: 60_000,
          multiplier: 3,
          label: "ボーナス",
          showCountdown: false,
        },
        {
          kind: "opening",
          startMs: 0,
          endMs: 48_000,
          multiplier: 2,
          label: "初めてのギフト ×2倍",
          showCountdown: true,
          confidence: "measured",
        },
      ],
    });
    expect(segmentAt(p, 10_000)?.kind).toBe("opening");
    expect(segmentAt(p, 50_000)?.kind).toBe("bonus_mission");
    expect(segmentAt(p, 90_000)).toBeNull();
  });

  it("opening が無く区間だけが重なったら先に並んでいる方を出す", () => {
    const p = payload({
      segments: [
        { kind: "bonus_mission", startMs: 0, endMs: 60_000, multiplier: 3, label: "ミッション", showCountdown: false },
        { kind: "bonus_reward", startMs: 0, endMs: 30_000, multiplier: 2, label: "報酬", showCountdown: false },
      ],
    });
    expect(segmentAt(p, 10_000)?.kind).toBe("bonus_mission");
  });
});

describe("ギフトが1件も無いバトル", () => {
  it("カードは0枚で、貢献者も0人(例外を投げない)", () => {
    const p = payload({ giftEvents: [] });
    const cards = buildCards(p);
    expect(cards).toEqual([]);
    expect(cardsAt(cards, 150_000)).toEqual([]);
    expect(cardsByAnchor([], 2)).toEqual([[], []]);
    expect(contributorsAt(p, cards, 150_000)).toEqual([]);
    // スコアバーと帯は giftEvents に依存しない
    expect(scoresAt(p, 15_000)).toEqual(["500", "0"]);
  });
});

describe("buildStageLayout", () => {
  it("1vs1 はステージ全幅レーン、4コラボは枠ごとのレーン", () => {
    const duo = buildStageLayout(payload());
    expect(duo.variant).toBe("duo");
    expect(duo.fullWidthLanes).toBe(true);
    expect(duo.cells[1]!.right).toBe(true);

    const quadPayload = payload({
      teams: [0, 1, 2, 3].map((index) => ({
        index,
        isSelf: index === 0,
        officialScore: "10",
        participants: [
          {
            tiktokUid: `a${index}`,
            isSelf: index === 0,
            displayName: `a${index}`,
            tiktokHandle: null,
            avatarUrl: null,
          },
        ],
      })),
      anchors: ["a0", "a1", "a2", "a3"],
    });
    const quad = buildStageLayout(quadPayload);
    expect(quad.variant).toBe("quad");
    expect(quad.fullWidthLanes).toBe(false);
    expect(quad.cells.map((c) => c.right)).toEqual([false, true, false, true]);
  });

  it("3コラボ・2vs2・1vs3 をそれぞれ別のバリアントとして割る", () => {
    const solo = (index: number, isSelf: boolean) => ({
      index,
      isSelf,
      officialScore: "10",
      participants: [
        { tiktokUid: `a${index}`, isSelf, displayName: `a${index}`, tiktokHandle: null, avatarUrl: null },
      ],
    });
    const pair = (index: number, isSelf: boolean) => ({
      index,
      isSelf,
      officialScore: "10",
      participants: [0, 1].map((n) => ({
        tiktokUid: `t${index}_${n}`,
        isSelf: isSelf && n === 0,
        displayName: `t${index}_${n}`,
        tiktokHandle: null,
        avatarUrl: null,
      })),
    });

    const trio = buildStageLayout(
      payload({
        teams: [solo(0, true), solo(1, false), solo(2, false)],
        anchors: ["a0", "a1", "a2"],
      })
    );
    expect(trio.variant).toBe("trio");
    expect(trio.cells.map((c) => c.right)).toEqual([false, true, true]);
    expect(trio.cells[0]!.largeAvatar).toBe(true);

    const team22 = buildStageLayout(
      payload({
        teams: [pair(0, true), pair(1, false)],
        anchors: ["t0_0", "t0_1", "t1_0", "t1_1"],
      })
    );
    expect(team22.variant).toBe("team22");
    expect(team22.cells.map((c) => c.right)).toEqual([false, true, false, true]);
    expect(team22.cells.map((c) => c.isSelf)).toEqual([true, false, true, false]);

    const one3 = buildStageLayout(
      payload({
        teams: [
          solo(0, true),
          {
            index: 1,
            isSelf: false,
            officialScore: "10",
            participants: [0, 1, 2].map((n) => ({
              tiktokUid: `o${n}`,
              isSelf: false,
              displayName: `o${n}`,
              tiktokHandle: null,
              avatarUrl: null,
            })),
          },
        ],
        anchors: ["a0", "o0", "o1", "o2"],
      })
    );
    expect(one3.variant).toBe("one3");
    expect(one3.cells.map((c) => c.right)).toEqual([false, true, true, true]);
    expect(one3.cells[0]!.largeAvatar).toBe(true);
    expect(one3.cells.slice(1).every((c) => c.opponentCard && c.inline)).toBe(true);
  });

  it("自陣が teams の先頭でなくても自分が左・大アイコンになる", () => {
    const duo = buildStageLayout(
      payload({
        teams: [
          {
            index: 0,
            isSelf: false,
            officialScore: "80",
            participants: [
              { tiktokUid: "rival", isSelf: false, displayName: "相手", tiktokHandle: null, avatarUrl: null },
            ],
          },
          {
            index: 1,
            isSelf: true,
            officialScore: "100",
            participants: [
              { tiktokUid: "self", isSelf: true, displayName: "自分", tiktokHandle: null, avatarUrl: null },
            ],
          },
        ],
        anchors: ["rival", "self"],
      })
    );
    expect(duo.cells[0]!.anchorIndex).toBe(1);
    expect(duo.cells[0]!.isSelf).toBe(true);
    expect(duo.cells[0]!.right).toBe(false);
    expect(duo.cells[1]!.right).toBe(true);
    // 1vs1 は左右等寸。相手枠も大アイコンにする
    expect(duo.cells.map((c) => c.largeAvatar)).toEqual([true, true]);
  });
});

describe("replayTitleOf", () => {
  const team = (isSelf: boolean, ...labels: string[]) => ({
    isSelf,
    participants: labels.map((label) => ({ label })),
  });

  it("1vs1 は「自分 vs 相手」、3人以上は「自分 × N人バトル」", () => {
    expect(replayTitleOf([team(true, "わや"), team(false, "さら")])).toBe("わや vs さら");
    expect(replayTitleOf([team(true, "わや"), team(false, "さら"), team(false, "森岡")])).toBe(
      "わや × 2人バトル"
    );
    // チーム戦は陣営数ではなく自分以外の人数で数える
    expect(replayTitleOf([team(true, "わや", "たら"), team(false, "さら", "森岡")])).toBe(
      "わや × 2人バトル"
    );
  });

  it("陣営が解決できないバトルでも例外を出さない", () => {
    expect(replayTitleOf([])).toBe("自分");
    expect(replayTitleOf([team(true, "わや")])).toBe("わや");
  });
});

describe("quietRangesOf / isQuietAt", () => {
  const gift = (t: number) => ({ t, a: 0, s: 0, g: 0, c: 1, d: 10, k: null, m: null });

  it("ギフトが8秒以上途切れた区間を無風として返し、次のカードの1秒前で終える", () => {
    const p = payload({ durationMs: 120_000, giftEvents: [gift(60_000)] });
    const ranges = quietRangesOf(p, buildCards(p), p.durationMs);
    expect(ranges[0]).toEqual({ startMs: 0, endMs: 60_000 - QUIET_LEAD_MS });
    expect(isQuietAt(ranges, 30_000)).toBe(true);
    // カードが出ている間は無風ではない
    expect(isQuietAt(ranges, 60_000)).toBe(false);
    // カードが消えたあとは末尾の無風区間
    expect(isQuietAt(ranges, 110_000)).toBe(true);
  });

  it("赤帯が出ている区間は飛ばさない(初めてのギフト×N の帯を見逃さないため)", () => {
    const p = payload({
      durationMs: 120_000,
      giftEvents: [gift(60_000)],
      segments: [
        {
          kind: "opening",
          startMs: 10_000,
          endMs: 30_000,
          multiplier: 2,
          label: "初めてのギフト×2倍",
          showCountdown: false,
          confidence: "measured",
        },
      ],
    });
    const ranges = quietRangesOf(p, buildCards(p), p.durationMs);
    expect(isQuietAt(ranges, 20_000)).toBe(false);
    expect(isQuietAt(ranges, 5_000)).toBe(true);
    expect(isQuietAt(ranges, 45_000)).toBe(true);
  });

  it("QUIET_MIN_GAP_MS 未満の切れ目は無風にしない", () => {
    const p = payload({
      durationMs: 120_000,
      giftEvents: [gift(1_000), gift(1_000 + REPLAY_BAR_LIFETIME_MS + QUIET_MIN_GAP_MS - 1)],
    });
    const ranges = quietRangesOf(p, buildCards(p), p.durationMs);
    expect(isQuietAt(ranges, 1_000 + REPLAY_BAR_LIFETIME_MS + 100)).toBe(false);
  });
});

describe("teamTotalsOf", () => {
  it("陣営ごとにギフトを合算し、金額降順で並べる", () => {
    const p = payload({
      giftEvents: [
        { t: 1_000, a: 0, s: 0, g: 0, c: 1, d: 100, k: null, m: null },
        { t: 2_000, a: 0, s: 1, g: 0, c: 3, d: 900, k: null, m: null },
        { t: 3_000, a: 1, s: 0, g: 0, c: 1, d: 400, k: null, m: null },
      ],
    });
    const totals = teamTotalsOf(p);

    expect(totals.map((t) => t.teamIndex)).toEqual([0, 1]);
    expect(totals[0]!.observedCoins).toBe(1000);
    expect(totals[0]!.contributors).toEqual([
      { senderIndex: 1, coins: 900, giftCount: 3 },
      { senderIndex: 0, coins: 100, giftCount: 1 },
    ]);
    // **自陣営に限定しない。** シェアページは第三者が対戦を俯瞰する画面のため。
    expect(totals[1]!.contributors).toEqual([{ senderIndex: 0, coins: 400, giftCount: 1 }]);
  });

  it("ギフト明細が無い陣営も行として残す(注記を出す判断に使う)", () => {
    const totals = teamTotalsOf(payload({ giftEvents: [] }));
    expect(totals).toHaveLength(2);
    expect(totals.every((t) => t.contributors.length === 0 && t.observedCoins === 0)).toBe(true);
  });

  it("複数人コラボの陣営名は参加者を連結する", () => {
    const p = payload();
    p.teams[1]!.participants.push({
      tiktokUid: "rival2",
      isSelf: false,
      displayName: "相手2",
      tiktokHandle: null,
      avatarUrl: null,
    });
    expect(teamTotalsOf(p)[1]!.displayName).toBe("相手 / 相手2");
  });
});
