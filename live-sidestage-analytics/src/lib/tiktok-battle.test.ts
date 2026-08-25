import { describe, it, expect } from "vitest";
import {
  BATTLE_ACTION,
  mergeBattleState,
  parseArmiesEvent,
  parseBattleEvent,
  type BattleRecordState,
} from "./tiktok-battle";

// 実 payload はライブのバトルでしか取れないので、ここは型定義(tiktok-schema.d.ts)から
// 組んだ合成 payload で固めておく。実物が取れたら fixture へ差し替える。
const START_MS = 1_788_000_000_000; // 2026-09-01 ごろ
const END_MS = START_MS + 300_000;

function battlePayload(action: number, overrides: Record<string, unknown> = {}) {
  return {
    battleId: "7300000000000000000",
    action,
    battleSetting: {
      battleId: "7300000000000000000",
      startTimeMs: String(START_MS),
      endTimeMs: String(END_MS),
      duration: 300,
      channelId: "123",
    },
    armies: {
      "111": { anchorIdStr: "111", hostScore: "5000", userArmy: [] },
      "222": { anchorIdStr: "222", hostScore: "4200", userArmy: [] },
    },
    anchorInfo: {
      "111": { user: { userId: "111", nickName: "配信者A", displayId: "hostA" } },
      "222": { user: { userId: "222", nickName: "配信者B", displayId: "hostB" } },
    },
    ...overrides,
  };
}

describe("parseBattleEvent", () => {
  it("OPENを開始として解釈する", () => {
    const parsed = parseBattleEvent(battlePayload(BATTLE_ACTION.OPEN));

    expect(parsed).not.toBeNull();
    expect(parsed?.phase).toBe("START");
    expect(parsed?.battleId).toBe("7300000000000000000");
    expect(parsed?.startTime?.getTime()).toBe(START_MS);
    expect(parsed?.endTime?.getTime()).toBe(END_MS);
    expect(parsed?.durationSec).toBe(300);
  });

  it("FINISHとCUT_SHORTを終了として解釈する", () => {
    expect(parseBattleEvent(battlePayload(BATTLE_ACTION.FINISH))?.phase).toBe("END");
    expect(parseBattleEvent(battlePayload(BATTLE_ACTION.CUT_SHORT))?.phase).toBe("END");
  });

  it("成立していない招待・辞退・キャンセルは記録しない", () => {
    for (const action of [
      BATTLE_ACTION.UNKNOWN,
      BATTLE_ACTION.INVITE,
      BATTLE_ACTION.REJECT,
      BATTLE_ACTION.CANCEL,
      BATTLE_ACTION.ACCEPT,
    ]) {
      expect(parseBattleEvent(battlePayload(action))).toBeNull();
    }
  });

  it("ホストのIDとスコアを集める", () => {
    const parsed = parseBattleEvent(battlePayload(BATTLE_ACTION.OPEN));

    expect(parsed?.hostUserIds).toEqual(["111", "222"]);
    expect(parsed?.hostDisplayIds).toEqual(["hostA", "hostB"]);
    expect(parsed?.hostScores).toEqual({ "111": "5000", "222": "4200" });
  });

  it("armiesやanchorInfoが配列で来ても読める", () => {
    const parsed = parseBattleEvent(
      battlePayload(BATTLE_ACTION.OPEN, {
        armies: [{ anchorIdStr: "111", hostScore: "10" }],
        anchorInfo: [{ user: { userId: "111", displayId: "hostA" } }],
      })
    );

    expect(parsed?.hostUserIds).toEqual(["111"]);
    expect(parsed?.hostScores).toEqual({ "111": "10" });
  });

  it("battleIdが無ければ記録しない", () => {
    const payload = battlePayload(BATTLE_ACTION.OPEN, { battleId: "" });
    // battleSetting 側に残っていれば拾える
    expect(parseBattleEvent(payload)?.battleId).toBe("7300000000000000000");

    const bare = { ...payload, battleId: "", battleSetting: { duration: 300 } };
    expect(parseBattleEvent(bare)).toBeNull();
  });

  it("payloadが想定外でも例外を投げない", () => {
    expect(parseBattleEvent(null)).toBeNull();
    expect(parseBattleEvent(undefined)).toBeNull();
    expect(parseBattleEvent("battle")).toBeNull();
    expect(parseBattleEvent({ battleId: "1" })).toBeNull(); // action が無い
    expect(
      parseBattleEvent({ battleId: "1", action: 4, armies: "x", anchorInfo: 5 })
    ).toMatchObject({ phase: "START", hostUserIds: [] });
  });

  it("時刻が不正なら取れなかったものとして扱う", () => {
    const parsed = parseBattleEvent(
      battlePayload(BATTLE_ACTION.OPEN, {
        battleSetting: { startTimeMs: "0", endTimeMs: "not-a-number", duration: -1 },
      })
    );

    expect(parsed?.startTime).toBeNull();
    expect(parsed?.endTime).toBeNull();
    expect(parsed?.durationSec).toBeNull();
  });

  it("秒で来た時刻もミリ秒として解釈する", () => {
    const parsed = parseBattleEvent(
      battlePayload(BATTLE_ACTION.OPEN, {
        battleSetting: { startTimeMs: String(Math.floor(START_MS / 1000)) },
      })
    );

    expect(parsed?.startTime?.getTime()).toBe(START_MS);
  });
});

describe("parseArmiesEvent", () => {
  it("battleSettings(複数形)とbattleItemsを読む", () => {
    const parsed = parseArmiesEvent({
      battleId: "7300000000000000000",
      battleSettings: { startTimeMs: String(START_MS), duration: 300 },
      battleItems: {
        "111": { anchorIdStr: "111", hostScore: "8000" },
      },
      battleStatus: 1,
    });

    expect(parsed?.phase).toBe("PROGRESS");
    expect(parsed?.action).toBeNull();
    expect(parsed?.startTime?.getTime()).toBe(START_MS);
    expect(parsed?.hostScores).toEqual({ "111": "8000" });
  });

  it("actionが無くても記録対象になる(途中接続の入口)", () => {
    const parsed = parseArmiesEvent({ battleId: "abc" });
    expect(parsed).not.toBeNull();
    expect(parsed?.startTime).toBeNull();
  });
});

describe("mergeBattleState", () => {
  const now = new Date("2026-09-01T20:10:00+09:00");

  it("OPENの受信時刻は確かな開始時刻として扱う", () => {
    const state = mergeBattleState(
      null,
      { ...parseBattleEvent(battlePayload(BATTLE_ACTION.OPEN))!, startTime: null },
      now
    );

    expect(state.startedAt).toEqual(now);
    expect(state.startedAtEstimated).toBe(false);
  });

  it("途中接続でarmiesしか無ければ開始時刻は推定値になる", () => {
    const state = mergeBattleState(null, parseArmiesEvent({ battleId: "abc" })!, now);

    expect(state.startedAt).toEqual(now);
    expect(state.startedAtEstimated).toBe(true);
    expect(state.endedAt).toBeNull();
  });

  it("startTimeMsが取れれば推定を確定値に置き換える", () => {
    const estimated: BattleRecordState = {
      action: 0,
      startedAt: now,
      startedAtEstimated: true,
      endedAt: null,
      durationSec: null,
      hostUserIds: [],
      hostDisplayIds: [],
      hostScores: {},
    };

    const state = mergeBattleState(
      estimated,
      parseArmiesEvent({
        battleId: "abc",
        battleSettings: { startTimeMs: String(START_MS) },
      })!,
      now
    );

    expect(state.startedAt.getTime()).toBe(START_MS);
    expect(state.startedAtEstimated).toBe(false);
  });

  it("確定した開始時刻を後続のイベントで上書きしない", () => {
    const confirmed: BattleRecordState = {
      action: BATTLE_ACTION.OPEN,
      startedAt: new Date(START_MS),
      startedAtEstimated: false,
      endedAt: null,
      durationSec: 300,
      hostUserIds: ["111"],
      hostDisplayIds: [],
      hostScores: { "111": "100" },
    };

    const state = mergeBattleState(confirmed, parseArmiesEvent({ battleId: "abc" })!, now);

    expect(state.startedAt.getTime()).toBe(START_MS);
    expect(state.startedAtEstimated).toBe(false);
    // armies は action を持たないので OPEN のまま
    expect(state.action).toBe(BATTLE_ACTION.OPEN);
  });

  it("FINISHで終了時刻が入る", () => {
    const opened = mergeBattleState(
      null,
      parseBattleEvent(battlePayload(BATTLE_ACTION.OPEN))!,
      now
    );
    const finished = mergeBattleState(
      opened,
      parseBattleEvent(battlePayload(BATTLE_ACTION.FINISH))!,
      new Date(END_MS + 1000)
    );

    expect(finished.action).toBe(BATTLE_ACTION.FINISH);
    expect(finished.endedAt?.getTime()).toBe(END_MS);
    expect(finished.startedAtEstimated).toBe(false);
  });

  it("endTimeMsが無ければ受信時刻を終了とする", () => {
    const parsed = parseBattleEvent(
      battlePayload(BATTLE_ACTION.FINISH, {
        battleSetting: { startTimeMs: String(START_MS), duration: 300 },
      })
    )!;
    const state = mergeBattleState(null, parsed, now);

    expect(state.endedAt).toEqual(now);
  });

  it("スコアは最新で上書きし、ホストIDは増える方向にだけ動かす", () => {
    const first = mergeBattleState(
      null,
      parseBattleEvent(battlePayload(BATTLE_ACTION.OPEN))!,
      now
    );
    const second = mergeBattleState(
      first,
      parseArmiesEvent({
        battleId: "7300000000000000000",
        battleItems: { "111": { anchorIdStr: "111", hostScore: "9999" } },
      })!,
      now
    );

    expect(second.hostScores).toEqual({ "111": "9999", "222": "4200" });
    expect(second.hostUserIds).toEqual(["111", "222"]);
    expect(second.durationSec).toBe(300);
  });

  it("終了を観測した後にOPENが遅れて届いても巻き戻さない", () => {
    const opened = mergeBattleState(
      null,
      parseBattleEvent(battlePayload(BATTLE_ACTION.OPEN))!,
      now
    );
    const finished = mergeBattleState(
      opened,
      parseBattleEvent(battlePayload(BATTLE_ACTION.FINISH))!,
      new Date(END_MS)
    );
    const lateOpen = mergeBattleState(
      finished,
      parseBattleEvent(battlePayload(BATTLE_ACTION.OPEN))!,
      new Date(END_MS + 2000)
    );

    expect(lateOpen.action).toBe(BATTLE_ACTION.FINISH);
    expect(lateOpen.endedAt).not.toBeNull();
  });

  it("CUT_SHORTのあとにFINISHが遅れて届いてもCUT_SHORTのままにする", () => {
    const opened = mergeBattleState(
      null,
      parseBattleEvent(battlePayload(BATTLE_ACTION.OPEN))!,
      now
    );
    const cutShort = mergeBattleState(
      opened,
      parseBattleEvent(battlePayload(BATTLE_ACTION.CUT_SHORT))!,
      new Date(END_MS)
    );
    const lateFinish = mergeBattleState(
      cutShort,
      parseBattleEvent(battlePayload(BATTLE_ACTION.FINISH))!,
      new Date(END_MS + 2000)
    );

    // 途中終了だった事実はイベント機能の勝敗判定の可否そのものなので消さない。
    expect(lateFinish.action).toBe(BATTLE_ACTION.CUT_SHORT);
    expect(lateFinish.endedAt).not.toBeNull();
  });

  it("FINISHのあとにCUT_SHORTが届いたらCUT_SHORTにする", () => {
    const finished = mergeBattleState(
      null,
      parseBattleEvent(battlePayload(BATTLE_ACTION.FINISH))!,
      new Date(END_MS)
    );
    const cutShort = mergeBattleState(
      finished,
      parseBattleEvent(battlePayload(BATTLE_ACTION.CUT_SHORT))!,
      new Date(END_MS + 2000)
    );

    expect(cutShort.action).toBe(BATTLE_ACTION.CUT_SHORT);
  });

  it("同じイベントを2回処理しても結果が変わらない(冪等)", () => {
    const parsed = parseBattleEvent(battlePayload(BATTLE_ACTION.OPEN))!;
    const once = mergeBattleState(null, parsed, now);
    const twice = mergeBattleState(once, parsed, new Date(now.getTime() + 5000));

    expect(twice).toEqual(once);
  });
});
