import { describe, it, expect } from "vitest";
import {
  mergeMaxScores,
  resolveBattleScore,
  resolveBattleWindow,
  jstDateRangeToUtc,
  sumDiamondsPerWindow,
  giftMatchesListenerQuery,
  battleIdsWithGiftInWindow,
  type BattleRow,
} from "./battle-history";
import { BATTLE_ACTION } from "@/lib/tiktok-battle";

function row(hosts: string[], scores: Record<string, string>): BattleRow {
  return { battleId: "b1", hostUserIds: hosts, hostScores: scores };
}

describe("mergeMaxScores", () => {
  it("同じanchorIdは大きいほうの値を採る", () => {
    const merged = mergeMaxScores([row(["A", "B"], { A: "100", B: "50" }), row(["A", "B"], { A: "80", B: "90" })]);
    expect(merged.get("A")?.toString()).toBe("100");
    expect(merged.get("B")?.toString()).toBe("90");
  });

  it("不正な値(整数文字列でない)は無視する", () => {
    const merged = mergeMaxScores([row(["A"], { A: "12.5" }), row(["A"], { A: "1e+21" })]);
    expect(merged.has("A")).toBe(false);
  });
});

describe("resolveBattleScore", () => {
  it("自分のhostUserIdが未解決ならunknownを返す", () => {
    const resolved = resolveBattleScore({
      rows: [row(["A", "B"], { A: "10", B: "20" })],
      selfHostUserId: null,
      selfHostTeams: {},
    });
    expect(resolved.kind).toBe("unknown");
  });

  it("1vs1は消去法で相手のanchorIdとスコアを特定する(相手roomが未登録でも解決できる)", () => {
    const resolved = resolveBattleScore({
      rows: [row(["A", "B"], { A: "10", B: "20" })],
      selfHostUserId: "A",
      selfHostTeams: {},
    });
    expect(resolved).toMatchObject({ kind: "1v1", selfScore: "10", opponentAnchorId: "B", opponentScore: "20" });
  });

  it("自分しか観測できていない場合はsoloを返す(自分のスコアは正しいので出す)", () => {
    const resolved = resolveBattleScore({ rows: [row(["A"], { A: "10" })], selfHostUserId: "A", selfHostTeams: {} });
    expect(resolved).toMatchObject({ kind: "solo", selfScore: "10" });
  });

  it("3人以上(2vs2等)でhostTeamsが無ければ自分のスコアのみ返す(敵味方を区別できないため)", () => {
    const resolved = resolveBattleScore({
      rows: [row(["A", "B", "C"], { A: "10", B: "20", C: "30" })],
      selfHostUserId: "A",
      selfHostTeams: {},
    });
    expect(resolved).toMatchObject({ kind: "multi", participantCount: 3, anchorIds: ["A", "B", "C"], selfScore: "10" });
  });

  it("観測したバトルに自分のhostUserIdが含まれていなければunknownを返す(別人のroom)", () => {
    const resolved = resolveBattleScore({
      rows: [row(["X", "Y"], { X: "10", Y: "20" })],
      selfHostUserId: "A",
      selfHostTeams: {},
    });
    expect(resolved.kind).toBe("unknown");
  });

  it("4人の2vs2バトルで実userId(大きな数字)がキーでもselfScoreが正しく解決される", () => {
    // 実データ由来: TikTok userId は 15〜19桁の数字
    // collectHosts() 修正前はキーが「チーム番号("1"/"2")」のため selfScore が常に null になっていた
    const resolved = resolveBattleScore({
      rows: [
        row(
          ["6813783089135895553", "6958337949008692226", "7418071357873701889", "6969117324289164290"],
          {
            "6813783089135895553": "253255",
            "6958337949008692226": "22846",
            "7418071357873701889": "100000",
            "6969117324289164290": "50000",
          }
        ),
      ],
      selfHostUserId: "6813783089135895553",
      selfHostTeams: {},
    });
    expect(resolved).toMatchObject({
      kind: "multi",
      participantCount: 4,
      selfScore: "253255", // 修正後は selfScore が正しく取得される
    });
  });

  it("hostTeamsで全員のチームが割当済み(distinct 2種類)なら自チーム/相手チームに分割したteamsを返す", () => {
    const resolved = resolveBattleScore({
      rows: [
        row(
          ["6813783089135895553", "6958337949008692226", "7418071357873701889", "6969117324289164290"],
          {
            "6813783089135895553": "253255",
            "6958337949008692226": "22846",
            "7418071357873701889": "100000",
            "6969117324289164290": "50000",
          }
        ),
      ],
      selfHostUserId: "6813783089135895553",
      selfHostTeams: {
        "6813783089135895553": "1",
        "6958337949008692226": "1",
        "7418071357873701889": "2",
        "6969117324289164290": "2",
      },
    });
    expect(resolved).toMatchObject({
      kind: "teams",
      selfScore: "253255",
      selfTeamAnchorIds: ["6813783089135895553", "6958337949008692226"],
      opponentTeamAnchorIds: ["7418071357873701889", "6969117324289164290"],
    });
  });

  it("hostTeamsが一部の参加者にしか無ければmultiにフォールバックする(バックフィル前の旧データ等)", () => {
    const resolved = resolveBattleScore({
      rows: [row(["A", "B", "C"], { A: "10", B: "20", C: "30" })],
      selfHostUserId: "A",
      selfHostTeams: { A: "1", B: "2" }, // CのteamId欠損
    });
    expect(resolved).toMatchObject({ kind: "multi", participantCount: 3, anchorIds: ["A", "B", "C"], selfScore: "10" });
  });

  it("hostTeamsのdistinctなteamIdが3種類以上(1vs1vs1等)ならmultiにフォールバックする", () => {
    const resolved = resolveBattleScore({
      rows: [row(["A", "B", "C"], { A: "10", B: "20", C: "30" })],
      selfHostUserId: "A",
      selfHostTeams: { A: "1", B: "2", C: "3" },
    });
    expect(resolved).toMatchObject({ kind: "multi", participantCount: 3, anchorIds: ["A", "B", "C"], selfScore: "10" });
  });
});

const START = new Date("2026-08-20T10:00:00Z");

describe("resolveBattleWindow", () => {
  it("CUT_SHORTは中断として扱い勝敗を出さない", () => {
    const result = resolveBattleWindow(
      {
        action: BATTLE_ACTION.CUT_SHORT,
        startedAt: START,
        startedAtEstimated: false,
        endedAt: new Date("2026-08-20T10:02:00Z"),
        durationSec: 300,
      },
      new Date("2026-08-20T10:10:00Z")
    );
    expect(result.status).toBe("cut_short");
  });

  it("endedAtが観測できていればそれを終端に使う", () => {
    const result = resolveBattleWindow(
      {
        action: BATTLE_ACTION.FINISH,
        startedAt: START,
        startedAtEstimated: false,
        endedAt: new Date("2026-08-20T10:05:00Z"),
        durationSec: 300,
      },
      new Date("2026-08-20T10:10:00Z")
    );
    expect(result).toMatchObject({
      status: "finished",
      endedAtSource: "observed",
      window: { start: START, end: new Date("2026-08-20T10:05:00Z") },
    });
  });

  it("endedAt未観測でもdurationSec経過済みならduration推定で終了扱いにする", () => {
    const result = resolveBattleWindow(
      { action: BATTLE_ACTION.OPEN, startedAt: START, startedAtEstimated: false, endedAt: null, durationSec: 300 },
      new Date("2026-08-20T10:06:00Z")
    );
    expect(result).toMatchObject({ status: "finished", endedAtSource: "duration" });
  });

  it("duration未経過ならライブ扱いにする", () => {
    const result = resolveBattleWindow(
      { action: BATTLE_ACTION.OPEN, startedAt: START, startedAtEstimated: false, endedAt: null, durationSec: 300 },
      new Date("2026-08-20T10:02:00Z")
    );
    expect(result.status).toBe("live");
  });

  it("startedAtが推定値でdurationも無ければ判定不能とし、3週間前でも現在時刻まで集計しない", () => {
    const result = resolveBattleWindow(
      { action: BATTLE_ACTION.OPEN, startedAt: START, startedAtEstimated: true, endedAt: null, durationSec: null },
      new Date("2026-09-10T00:00:00Z")
    );
    expect(result).toEqual({ status: "unknown", window: null });
  });

  it("開始直後(猶予内)ならstartedAtEstimatedでもライブ扱いにする", () => {
    const result = resolveBattleWindow(
      { action: BATTLE_ACTION.OPEN, startedAt: START, startedAtEstimated: true, endedAt: null, durationSec: null },
      new Date("2026-08-20T10:01:00Z")
    );
    expect(result.status).toBe("live");
  });
});

describe("sumDiamondsPerWindow", () => {
  function gift(receivedAt: string, totalDiamonds: number) {
    return { receivedAt: new Date(receivedAt), totalDiamonds };
  }

  it("windowの範囲内のgiftだけを合計する", () => {
    const gifts = [
      gift("2026-08-20T09:59:00Z", 999), // window外(前)
      gift("2026-08-20T10:00:00Z", 10), // 境界(start、含む)
      gift("2026-08-20T10:02:00Z", 20),
      gift("2026-08-20T10:05:00Z", 30), // 境界(end、含む)
      gift("2026-08-20T10:05:01Z", 999), // window外(後)
    ];
    const windows = [{ battleId: "b1", start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T10:05:00Z") }];

    const result = sumDiamondsPerWindow(gifts, windows);

    expect(result.get("b1")).toBe(60);
  });

  it("複数windowへ正しく振り分ける", () => {
    const gifts = [
      gift("2026-08-20T10:01:00Z", 10), // b1
      gift("2026-08-20T11:01:00Z", 20), // b2
      gift("2026-08-20T12:00:00Z", 999), // どちらのwindowにも属さない
    ];
    const windows = [
      { battleId: "b1", start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T10:05:00Z") },
      { battleId: "b2", start: new Date("2026-08-20T11:00:00Z"), end: new Date("2026-08-20T11:05:00Z") },
    ];

    const result = sumDiamondsPerWindow(gifts, windows);

    expect(result.get("b1")).toBe(10);
    expect(result.get("b2")).toBe(20);
  });

  it("該当するgiftが無いwindowは0", () => {
    const result = sumDiamondsPerWindow([], [
      { battleId: "b1", start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T10:05:00Z") },
    ]);

    expect(result.get("b1")).toBe(0);
  });
});

describe("giftMatchesListenerQuery", () => {
  it("uniqueIdの部分一致でマッチする(大小文字無視)", () => {
    expect(giftMatchesListenerQuery({ uniqueId: "Taro_Tiktok", nickname: "たろう" }, "taro")).toBe(true);
  });

  it("nicknameの部分一致でマッチする", () => {
    expect(giftMatchesListenerQuery({ uniqueId: "xyz", nickname: "たろう推し" }, "たろう")).toBe(true);
  });

  it("どちらにも含まれなければマッチしない", () => {
    expect(giftMatchesListenerQuery({ uniqueId: "hanako", nickname: "花子" }, "taro")).toBe(false);
  });
});

describe("battleIdsWithGiftInWindow", () => {
  const windows = [
    { battleId: "b1", start: new Date("2026-08-20T10:00:00Z"), end: new Date("2026-08-20T10:05:00Z") },
    { battleId: "b2", start: new Date("2026-08-20T11:00:00Z"), end: new Date("2026-08-20T11:05:00Z") },
  ];

  it("window内のgiftがあればそのbattleIdを含める", () => {
    const ms = [new Date("2026-08-20T10:02:00Z").getTime()];
    expect(battleIdsWithGiftInWindow(ms, windows)).toEqual(new Set(["b1"]));
  });

  it("window外のgiftは無視する", () => {
    const ms = [new Date("2026-08-20T09:00:00Z").getTime(), new Date("2026-08-20T12:00:00Z").getTime()];
    expect(battleIdsWithGiftInWindow(ms, windows)).toEqual(new Set());
  });

  it("複数windowにそれぞれ一致があれば両方含める", () => {
    const ms = [new Date("2026-08-20T10:01:00Z").getTime(), new Date("2026-08-20T11:01:00Z").getTime()];
    expect(battleIdsWithGiftInWindow(ms, windows)).toEqual(new Set(["b1", "b2"]));
  });

  it("gift配列が空なら空集合を返す", () => {
    expect(battleIdsWithGiftInWindow([], windows)).toEqual(new Set());
  });

  it("windowの境界(start/end含む)はマッチする", () => {
    const startMs = [new Date("2026-08-20T10:00:00Z").getTime()];
    const endMs = [new Date("2026-08-20T10:05:00Z").getTime()];
    expect(battleIdsWithGiftInWindow(startMs, windows)).toEqual(new Set(["b1"]));
    expect(battleIdsWithGiftInWindow(endMs, windows)).toEqual(new Set(["b1"]));
  });
});

describe("jstDateRangeToUtc", () => {
  it("JST 00:00始まりのUTC範囲を返す(dayは終端翌日00:00 exclusive)", () => {
    const { start, end } = jstDateRangeToUtc("day", "2026-08-20");
    expect(start.toISOString()).toBe("2026-08-19T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-20T15:00:00.000Z");
  });

  it("JST 00:00〜09:00のバトルを前日に落とさない", () => {
    const { start, end } = jstDateRangeToUtc("day", "2026-08-20");
    const earlyMorningJst = new Date("2026-08-20T05:00:00+09:00");
    expect(earlyMorningJst.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(earlyMorningJst.getTime()).toBeLessThan(end.getTime());
  });
});
