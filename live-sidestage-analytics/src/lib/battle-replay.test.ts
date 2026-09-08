import { describe, it, expect } from "vitest";
import { isReplayable, buildPayload, type ReplayRow } from "./battle-replay";
import { MAX_REPLAY_EVENTS } from "./battle-replay-contract";

const WINDOW_START = new Date("2026-09-07T20:00:00.000Z");
const WINDOW_END = new Date("2026-09-07T20:05:00.000Z");

function eligibility(overrides: Partial<Parameters<typeof isReplayable>[0]> = {}) {
  return {
    finalized: true,
    scorePointCount: 10,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    participantCount: 2,
    hasSelfParticipant: true,
    ...overrides,
  };
}

describe("isReplayable", () => {
  it("確定済み・スコア点あり・窓が妥当・自陣営ありなら再生できる", () => {
    expect(isReplayable(eligibility())).toEqual({ available: true, reason: null });
  });

  it("未確定は他の値によらず not_finalized", () => {
    expect(isReplayable(eligibility({ finalized: false, scorePointCount: 0, windowStart: null }))).toEqual({
      available: false,
      reason: "not_finalized",
    });
  });

  it("スコア点が2点未満なら no_score_points", () => {
    expect(isReplayable(eligibility({ scorePointCount: 1 })).reason).toBe("no_score_points");
    expect(isReplayable(eligibility({ scorePointCount: 0 })).reason).toBe("no_score_points");
  });

  it("スコア点ちょうど2点は再生できる(境界)", () => {
    expect(isReplayable(eligibility({ scorePointCount: 2 })).available).toBe(true);
  });

  it("窓が欠けていれば window_invalid", () => {
    expect(isReplayable(eligibility({ windowStart: null })).reason).toBe("window_invalid");
    expect(isReplayable(eligibility({ windowEnd: null })).reason).toBe("window_invalid");
  });

  it("窓が30秒未満・30分超なら window_invalid、境界ちょうどは可", () => {
    const at = (ms: number) => new Date(WINDOW_START.getTime() + ms);
    expect(isReplayable(eligibility({ windowEnd: at(29_999) })).reason).toBe("window_invalid");
    expect(isReplayable(eligibility({ windowEnd: at(30_000) })).available).toBe(true);
    expect(isReplayable(eligibility({ windowEnd: at(1_800_000) })).available).toBe(true);
    expect(isReplayable(eligibility({ windowEnd: at(1_800_001) })).reason).toBe("window_invalid");
  });

  it("参加者が2人未満・自陣営なしなら participants_invalid", () => {
    expect(isReplayable(eligibility({ participantCount: 1 })).reason).toBe("participants_invalid");
    expect(isReplayable(eligibility({ hasSelfParticipant: false })).reason).toBe("participants_invalid");
  });
});

function participant(
  overrides: Partial<ReplayRow["participants"][number]> = {}
): ReplayRow["participants"][number] {
  return {
    id: "p1",
    anchorId: "anchor_self",
    teamIndex: 0,
    position: 0,
    side: "self",
    isSelf: true,
    nickName: "自分",
    displayId: "self_id",
    tiktokId: "self_id",
    score: "100",
    officialScore: "100",
    battleTeamId: null,
    giftEvents: [],
    ...overrides,
  };
}

function giftEvent(
  overrides: Partial<ReplayRow["participants"][number]["giftEvents"][number]> = {}
): ReplayRow["participants"][number]["giftEvents"][number] {
  return {
    senderUniqueIdSnapshot: "fan_a",
    senderNicknameSnapshot: "ファンA",
    repeatCount: 1,
    totalDiamonds: 100,
    occurredAt: new Date(WINDOW_START.getTime() + 10_000),
    giftId: 5655,
    giftNameSnapshot: "Rose",
    senderGroupId: null,
    multiplierValue: null,
    ...overrides,
  };
}

function row(overrides: Partial<ReplayRow> = {}): ReplayRow {
  return {
    id: "bh1",
    battleId: "b1",
    status: "finished",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    replayScorePointCount: 2,
    openingMultiplier: null,
    openingMultiplierConfidence: null,
    openingWindowStartedAt: null,
    openingWindowEndedAt: null,
    participants: [
      participant(),
      participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1, side: "opponent", nickName: "相手", displayId: "opp_id", tiktokId: "opp_id", score: "50", officialScore: "50" }),
    ],
    scorePoints: [
      { anchorId: "anchor_self", offsetMs: 0, score: "0" },
      { anchorId: "anchor_opp", offsetMs: 0, score: "0" },
    ],
    bonusMissions: [],
    teams: [],
    ...overrides,
  };
}

const NO_AVATARS = new Map<string, string>();
const NO_CATALOG = new Map<number, { labelJa: string | null; imageUrl: string | null }>();

describe("buildPayload", () => {
  it("anchors は陣営順・位置順の平坦化で、scorePoints はその添字を指す", () => {
    const payload = buildPayload(row(), "private", NO_AVATARS, NO_AVATARS, NO_CATALOG);
    expect(payload.anchors).toEqual(["anchor_self", "anchor_opp"]);
    expect(payload.scorePoints).toEqual([
      { t: 0, a: 0, s: "0" },
      { t: 0, a: 1, s: "0" },
    ]);
  });

  it("コンボの束ね鍵 k は送信者・ギフト・groupId が揃ったときだけ一致する", () => {
    const payload = buildPayload(
      row({
        participants: [
          participant({
            giftEvents: [
              giftEvent({ senderGroupId: "g1" }),
              giftEvent({ senderGroupId: "g1", occurredAt: new Date(WINDOW_START.getTime() + 11_000) }),
              // 同じ groupId でも別ギフトなら別カード(groupId の再利用で畳み込まれない)
              giftEvent({ senderGroupId: "g1", giftId: 5269, giftNameSnapshot: "Galaxy", occurredAt: new Date(WINDOW_START.getTime() + 12_000) }),
              // 別の送信者も別カード
              giftEvent({ senderGroupId: "g1", senderUniqueIdSnapshot: "fan_b", occurredAt: new Date(WINDOW_START.getTime() + 13_000) }),
              // "0" は combo 判定に使えないので単発扱い
              giftEvent({ senderGroupId: "0", occurredAt: new Date(WINDOW_START.getTime() + 14_000) }),
              giftEvent({ senderGroupId: "0", occurredAt: new Date(WINDOW_START.getTime() + 15_000) }),
            ],
          }),
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    const keys = payload.giftEvents.map((e) => e.k);
    expect(keys[0]).not.toBeNull();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
    expect(keys[4]).toBeNull();
    expect(keys[5]).toBeNull();
  });

  it("倍率刻印 m は確定行の値をそのまま載せる(未観測は null のまま)", () => {
    const payload = buildPayload(
      row({
        participants: [
          participant({
            giftEvents: [
              giftEvent({ multiplierValue: 2 }),
              // P2デプロイ前のギフトは未観測。0(倍率なしと明示的に観測)と混同しない。
              giftEvent({ multiplierValue: null, occurredAt: new Date(WINDOW_START.getTime() + 11_000) }),
              giftEvent({ multiplierValue: 0, occurredAt: new Date(WINDOW_START.getTime() + 12_000) }),
            ],
          }),
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.giftEvents.map((e) => e.m)).toEqual([2, null, 0]);
  });

  it("participant として存在しない anchorId のスコア点は落とす", () => {
    const payload = buildPayload(
      row({ scorePoints: [{ anchorId: "anchor_ghost", offsetMs: 0, score: "1" }] }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.scorePoints).toEqual([]);
  });

  it("同じ送信者・同じギフトは辞書へ1件だけ入り、イベントは添字で参照する", () => {
    const payload = buildPayload(
      row({
        participants: [
          participant({
            giftEvents: [giftEvent(), giftEvent({ occurredAt: new Date(WINDOW_START.getTime() + 20_000) })],
          }),
          participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1, side: "opponent", giftEvents: [] }),
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.senders).toHaveLength(1);
    expect(payload.gifts).toHaveLength(1);
    expect(payload.giftEvents.map((e) => [e.t, e.a, e.s, e.g])).toEqual([
      [10_000, 0, 0, 0],
      [20_000, 0, 0, 0],
    ]);
  });

  it("ギフト表示名は labelJa を優先し、無ければ確定時のスナップショット名へ落ちる", () => {
    const catalog = new Map([[5655, { labelJa: "バラ", imageUrl: "https://example.test/rose.png" }]]);
    const withJa = buildPayload(
      row({ participants: [participant({ giftEvents: [giftEvent()] }), participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1 })] }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      catalog
    );
    expect(withJa.gifts[0]).toEqual({ id: 5655, n: "バラ", img: "https://example.test/rose.png" });

    const withoutJa = buildPayload(
      row({ participants: [participant({ giftEvents: [giftEvent()] }), participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1 })] }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(withoutJa.gifts[0]).toEqual({ id: 5655, n: "Rose", img: null });
  });

  it("窓の外へはみ出したギフトは 0 と窓長へクランプする", () => {
    const payload = buildPayload(
      row({
        participants: [
          participant({
            giftEvents: [
              giftEvent({ occurredAt: new Date(WINDOW_START.getTime() - 5_000), senderUniqueIdSnapshot: "early", senderNicknameSnapshot: "早" }),
              giftEvent({ occurredAt: new Date(WINDOW_END.getTime() + 5_000), senderUniqueIdSnapshot: "late", senderNicknameSnapshot: "遅" }),
            ],
          }),
          participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1 }),
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.giftEvents.map((e) => e.t)).toEqual([0, 300_000]);
  });

  it("上限を超えたギフトイベントは時系列の先頭から残して truncated を立てる", () => {
    const events = Array.from({ length: MAX_REPLAY_EVENTS + 5 }, (_, i) =>
      giftEvent({ occurredAt: new Date(WINDOW_START.getTime() + i * 10) })
    );
    const payload = buildPayload(
      row({ participants: [participant({ giftEvents: events }), participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1 })] }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.truncated).toBe(true);
    expect(payload.giftEvents).toHaveLength(MAX_REPLAY_EVENTS);
    expect(payload.giftEvents[0].t).toBe(0);
    expect(payload.giftEvents[MAX_REPLAY_EVENTS - 1].t).toBe((MAX_REPLAY_EVENTS - 1) * 10);
  });

  it("上限以内なら truncated は立たない(境界)", () => {
    const events = Array.from({ length: MAX_REPLAY_EVENTS }, (_, i) =>
      giftEvent({ occurredAt: new Date(WINDOW_START.getTime() + i * 10) })
    );
    const payload = buildPayload(
      row({ participants: [participant({ giftEvents: events }), participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1 })] }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.truncated).toBe(false);
    expect(payload.giftEvents).toHaveLength(MAX_REPLAY_EVENTS);
  });

  it("公開バリアントは配信者・リスナー双方の TikTokハンドルを載せない", () => {
    const input = row({
      participants: [
        participant({ giftEvents: [giftEvent()] }),
        participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1, side: "opponent" }),
      ],
    });
    const priv = buildPayload(input, "private", NO_AVATARS, NO_AVATARS, NO_CATALOG);
    expect(priv.teams[0].participants[0].uniqueId).toBe("self_id");
    expect(priv.senders[0].u).toBe("fan_a");

    const pub = buildPayload(input, "public", NO_AVATARS, NO_AVATARS, NO_CATALOG);
    expect(pub.teams.every((t) => t.participants.every((p) => p.uniqueId === null))).toBe(true);
    expect(pub.senders.every((s) => s.u === null)).toBe(true);
    // ニックネームとアイコンは公開でも残す(再生UIに必要)。
    expect(pub.senders[0].n).toBe("ファンA");
    expect(JSON.stringify(pub)).not.toContain("fan_a");
  });

  it("公開バリアントは nickName が無くても TikTokハンドルへフォールバックしない", () => {
    const input = row({
      participants: [
        participant({ nickName: null, displayId: "leaked_handle", tiktokId: "leaked_handle" }),
        participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1, nickName: null, displayId: "leaked_opp", tiktokId: "leaked_opp" }),
      ],
    });
    const pub = buildPayload(input, "public", NO_AVATARS, NO_AVATARS, NO_CATALOG);
    expect(pub.teams[0].participants[0].displayName).toBe("配信者");
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("leaked_handle");
    expect(serialized).not.toContain("leaked_opp");

    // 私的バリアントは従来どおりハンドルへフォールバックしてよい。
    const priv = buildPayload(input, "private", NO_AVATARS, NO_AVATARS, NO_CATALOG);
    expect(priv.teams[0].participants[0].displayName).toBe("@leaked_handle");
  });

  it("truncate で落としたイベントからしか参照されない送信者・ギフトは辞書に載せない", () => {
    const events = [
      ...Array.from({ length: MAX_REPLAY_EVENTS }, (_, i) =>
        giftEvent({ occurredAt: new Date(WINDOW_START.getTime() + i * 10) })
      ),
      giftEvent({
        occurredAt: new Date(WINDOW_START.getTime() + 299_000),
        senderUniqueIdSnapshot: "dropped_fan",
        senderNicknameSnapshot: "落とされる人",
        giftId: 9999,
        giftNameSnapshot: "DroppedGift",
      }),
    ];
    const payload = buildPayload(
      row({ participants: [participant({ giftEvents: events }), participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1 })] }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.truncated).toBe(true);
    expect(payload.senders.map((s) => s.u)).toEqual(["fan_a"]);
    expect(payload.gifts.map((g) => g.id)).toEqual([5655]);
  });

  it("陣営スコアは BattleTeam の公式スコアを使い、メンバー1人分で代用しない", () => {
    const payload = buildPayload(
      row({
        teams: [
          { id: "team_self", officialScore: "5000" },
          { id: "team_opp", officialScore: "4000" },
        ],
        participants: [
          participant({ battleTeamId: "team_self", officialScore: "3000", score: "3000" }),
          participant({ id: "p1b", anchorId: "anchor_self2", position: 1, battleTeamId: "team_self", officialScore: "2000", score: "2000" }),
          participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1, side: "opponent", battleTeamId: "team_opp", officialScore: "4000", score: "4000" }),
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.teams.map((t) => t.officialScore)).toEqual(["5000", "4000"]);
  });

  it("BattleTeam を持たない旧データはメンバーのスコア合計へ落とす", () => {
    const payload = buildPayload(
      row({
        teams: [],
        participants: [
          participant({ officialScore: "3000", score: "3000" }),
          participant({ id: "p1b", anchorId: "anchor_self2", position: 1, officialScore: "2000", score: "2000" }),
          participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1, side: "opponent", officialScore: null, score: null }),
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.teams.map((t) => t.officialScore)).toEqual(["5000", null]);
  });

  it("相手陣営のギフト明細が1件も無ければ opponentGiftsMissing を立てる", () => {
    const missing = buildPayload(
      row({ participants: [participant({ giftEvents: [giftEvent()] }), participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1 })] }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(missing.opponentGiftsMissing).toBe(true);

    const present = buildPayload(
      row({
        participants: [
          participant({ giftEvents: [giftEvent()] }),
          participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1, giftEvents: [giftEvent({ senderUniqueIdSnapshot: "fan_b", senderNicknameSnapshot: "ファンB" })] }),
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(present.opponentGiftsMissing).toBe(false);
  });

  it("公開バリアントもリスナーのアバターURLを載せる(2026-09-08、配信者の明示判断で解禁。uniqueIdは引き続き落とす)", () => {
    const senderAvatars = new Map([
      ["fan_a", "https://bucket.test/avatars/gift-sender/fan_a.webp?X-Amz-Signature=deadbeef"],
    ]);
    const anchorAvatars = new Map([
      ["anchor_self", "https://bucket.test/avatars/battle-host/anchor_self.webp?X-Amz-Signature=cafe"],
    ]);
    const input = row({
      participants: [
        participant({ giftEvents: [giftEvent()] }),
        participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1, side: "opponent" }),
      ],
    });

    const pub = buildPayload(input, "public", anchorAvatars, senderAvatars, NO_CATALOG);
    expect(pub.senders[0].a).toBe(senderAvatars.get("fan_a"));
    expect(pub.senders[0].u).toBeNull();
    // 配信者側は anchorId(TikTokの数値userId)で、ペイロードの anchors に載せている値そのもの。
    expect(pub.teams[0].participants[0].avatarUrl).toBe(anchorAvatars.get("anchor_self"));

    const priv = buildPayload(input, "private", anchorAvatars, senderAvatars, NO_CATALOG);
    expect(priv.senders[0].a).toBe(senderAvatars.get("fan_a"));
  });

  it("battleTeamId があっても BattleTeam 行が無ければメンバー合計へ落とす", () => {
    const payload = buildPayload(
      row({
        teams: [],
        participants: [
          participant({ battleTeamId: "team_gone", officialScore: "3000", score: "3000" }),
          participant({ id: "p1b", anchorId: "anchor_self2", position: 1, battleTeamId: "team_gone", officialScore: "2000", score: "2000" }),
          participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1, side: "opponent", battleTeamId: "team_gone_opp", officialScore: null, score: null }),
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.teams.map((t) => t.officialScore)).toEqual(["5000", null]);
  });

  it("数字以外のスコアは例外を投げずに飛ばす(異常データ1行でバトルが恒久500にならない)", () => {
    const payload = buildPayload(
      row({
        teams: [],
        participants: [
          participant({ officialScore: "1,200", score: "1,200" }),
          participant({ id: "p1b", anchorId: "anchor_self2", position: 1, officialScore: "800", score: "800" }),
          participant({ id: "p2", anchorId: "anchor_opp", teamIndex: 1, side: "opponent", officialScore: "abc", score: "abc" }),
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    // 不正な行を除いた合計。相手は全員不正なので null。
    expect(payload.teams.map((t) => t.officialScore)).toEqual(["800", null]);
  });

  it("両陣営のギフトを時刻順に併合し、相手側イベントは添字1を指す", () => {
    const payload = buildPayload(
      row({
        participants: [
          participant({
            giftEvents: [
              giftEvent({ occurredAt: new Date(WINDOW_START.getTime() + 10_000) }),
              giftEvent({ occurredAt: new Date(WINDOW_START.getTime() + 30_000) }),
            ],
          }),
          participant({
            id: "p2",
            anchorId: "anchor_opp",
            teamIndex: 1,
            side: "opponent",
            giftEvents: [
              giftEvent({ occurredAt: new Date(WINDOW_START.getTime() + 20_000), senderUniqueIdSnapshot: "fan_b", senderNicknameSnapshot: "ファンB" }),
              giftEvent({ occurredAt: new Date(WINDOW_START.getTime() + 40_000), senderUniqueIdSnapshot: "fan_b", senderNicknameSnapshot: "ファンB" }),
            ],
          }),
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.giftEvents.map((e) => [e.t, e.a])).toEqual([
      [10_000, 0],
      [20_000, 1],
      [30_000, 0],
      [40_000, 1],
    ]);
    expect(payload.senders.map((s) => s.u)).toEqual(["fan_a", "fan_b"]);
  });
});

describe("buildPayload の区間(segments)", () => {
  it("openingWindow が実測できていなければ opening 帯を作らない", () => {
    const payload = buildPayload(
      row({ openingMultiplier: 2, openingMultiplierConfidence: "measured" }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.segments).toEqual([]);
  });

  it("openingWindow が実測できていれば帯を作り、カウントダウンを許可する", () => {
    const payload = buildPayload(
      row({
        openingMultiplier: 2,
        openingMultiplierConfidence: "measured",
        openingWindowStartedAt: WINDOW_START,
        openingWindowEndedAt: new Date(WINDOW_START.getTime() + 48_000),
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.segments).toEqual([
      {
        kind: "opening",
        startMs: 0,
        endMs: 48_000,
        multiplier: 2,
        label: "初めてのギフト×2倍",
        showCountdown: true,
        confidence: "measured",
      },
    ]);
  });

  it("倍率が unknown なら openingWindow が埋まっていても帯を作らない", () => {
    const payload = buildPayload(
      row({
        openingMultiplier: null,
        openingMultiplierConfidence: "unknown",
        openingWindowStartedAt: WINDOW_START,
        openingWindowEndedAt: new Date(WINDOW_START.getTime() + 48_000),
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.segments).toEqual([]);
  });

  it("ボーナス区間は報酬の開始・終了が揃ったものだけ帯にし、実測の終了時刻なのでカウントダウンを許可する", () => {
    const payload = buildPayload(
      row({
        bonusMissions: [
          { rewardMultiple: 3, startedAt: WINDOW_START, rewardStartedAt: null, rewardEndedAt: null },
          {
            rewardMultiple: 3,
            startedAt: WINDOW_START,
            rewardStartedAt: new Date(WINDOW_START.getTime() + 150_000),
            rewardEndedAt: new Date(WINDOW_START.getTime() + 180_000),
          },
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.segments).toEqual([
      {
        kind: "bonus_reward",
        startMs: 150_000,
        endMs: 180_000,
        multiplier: 3,
        label: "ボーナス×3倍",
        showCountdown: true,
      },
    ]);
  });

  it("inferred でも区間が実測できていれば帯を作り confidence をそのまま載せる", () => {
    const payload = buildPayload(
      row({
        openingMultiplier: 2,
        openingMultiplierConfidence: "inferred",
        openingWindowStartedAt: WINDOW_START,
        openingWindowEndedAt: new Date(WINDOW_START.getTime() + 48_000),
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.segments.map((s) => [s.kind, s.confidence])).toEqual([["opening", "inferred"]]);
  });

  it("measured でも倍率が null なら帯を作らない", () => {
    const payload = buildPayload(
      row({
        openingMultiplier: null,
        openingMultiplierConfidence: "measured",
        openingWindowStartedAt: WINDOW_START,
        openingWindowEndedAt: new Date(WINDOW_START.getTime() + 48_000),
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.segments).toEqual([]);
  });

  it("opening とボーナスが両方あれば開始時刻の昇順で並べる", () => {
    const payload = buildPayload(
      row({
        openingMultiplier: 2,
        openingMultiplierConfidence: "measured",
        openingWindowStartedAt: WINDOW_START,
        openingWindowEndedAt: new Date(WINDOW_START.getTime() + 48_000),
        bonusMissions: [
          {
            rewardMultiple: 3,
            startedAt: WINDOW_START,
            rewardStartedAt: new Date(WINDOW_START.getTime() + 150_000),
            rewardEndedAt: new Date(WINDOW_START.getTime() + 180_000),
          },
        ],
      }),
      "private",
      NO_AVATARS,
      NO_AVATARS,
      NO_CATALOG
    );
    expect(payload.segments.map((s) => [s.kind, s.startMs])).toEqual([
      ["opening", 0],
      ["bonus_reward", 150_000],
    ]);
  });
});
