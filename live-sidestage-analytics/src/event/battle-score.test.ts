import { describe, it, expect } from "vitest";
import { canShowTiktokScore, resolveSideTiktokScores } from "./battle-score";

// hostUserId は TikTok の数値 userId。テストでは短い値で表す。
const A = "1001";
const B = "1002";
const C = "1003";
const D = "1004";

function rows(...entries: { hosts: string[]; scores: Record<string, unknown> }[]) {
  return entries.map((e) => ({ hostUserIds: e.hosts, hostScores: e.scores }));
}

describe("resolveSideTiktokScores", () => {
  it("1vs1 は両サイドのスコアを返す", () => {
    const resolved = resolveSideTiktokScores({
      rows: rows({ hosts: [A, B], scores: { [A]: "5000", [B]: "4200" } }),
      sides: [
        { sideId: "s0", roomIds: ["r0"] },
        { sideId: "s1", roomIds: ["r1"] },
      ],
      hostUserIdByRoomId: new Map([
        ["r0", A],
        ["r1", B],
      ]),
    });

    expect(resolved.get("s0")).toBe("5000");
    expect(resolved.get("s1")).toBe("4200");
  });

  it("2vs2 は出場メンバーのスコアを合計する", () => {
    const resolved = resolveSideTiktokScores({
      rows: rows({
        hosts: [A, B, C, D],
        scores: { [A]: "100", [B]: "200", [C]: "30", [D]: "4" },
      }),
      sides: [
        { sideId: "s0", roomIds: ["r0", "r1"] },
        { sideId: "s1", roomIds: ["r2", "r3"] },
      ],
      hostUserIdByRoomId: new Map([
        ["r0", A],
        ["r1", B],
        ["r2", C],
        ["r3", D],
      ]),
    });

    expect(resolved.get("s0")).toBe("300");
    expect(resolved.get("s1")).toBe("34");
  });

  it("room ごとの行で値が食い違ったら大きいほうを採る", () => {
    // 片方の room の接続が落ちると、その行のスコアだけ古い値で凍る。
    const resolved = resolveSideTiktokScores({
      rows: rows(
        { hosts: [A, B], scores: { [A]: "5000", [B]: "4200" } },
        { hosts: [A, B], scores: { [A]: "1200", [B]: "9999" } }
      ),
      sides: [
        { sideId: "s0", roomIds: ["r0"] },
        { sideId: "s1", roomIds: ["r1"] },
      ],
      hostUserIdByRoomId: new Map([
        ["r0", A],
        ["r1", B],
      ]),
    });

    expect(resolved.get("s0")).toBe("5000");
    expect(resolved.get("s1")).toBe("9999");
  });

  it("hostUserId が未取得のサイドは出さない(相手側は出す)", () => {
    const resolved = resolveSideTiktokScores({
      rows: rows({ hosts: [A, B], scores: { [A]: "5000", [B]: "4200" } }),
      sides: [
        { sideId: "s0", roomIds: ["r0"] },
        { sideId: "s1", roomIds: ["r1"] },
      ],
      hostUserIdByRoomId: new Map([["r0", A]]),
    });

    expect(resolved.get("s0")).toBe("5000");
    expect(resolved.has("s1")).toBe(false);
  });

  it("2vs2 で片方のメンバーだけ解決できないサイドは、部分和にせず出さない", () => {
    const resolved = resolveSideTiktokScores({
      rows: rows({ hosts: [A, B, C], scores: { [A]: "100", [B]: "200", [C]: "30" } }),
      sides: [
        { sideId: "s0", roomIds: ["r0", "r1"] },
        { sideId: "s1", roomIds: ["r2", "r3"] },
      ],
      hostUserIdByRoomId: new Map([
        ["r0", A],
        ["r1", B],
        ["r2", C],
        // r3 の hostUserId が未取得
      ]),
    });

    expect(resolved.get("s0")).toBe("300");
    expect(resolved.has("s1")).toBe(false);
  });

  it("そのバトルに出ていない hostUserId は採らない", () => {
    // hostUserId は取れているが、観測したバトルの参加者に含まれていない(別人の room)。
    const resolved = resolveSideTiktokScores({
      rows: rows({ hosts: [A], scores: { [A]: "5000", [B]: "4200" } }),
      sides: [{ sideId: "s1", roomIds: ["r1"] }],
      hostUserIdByRoomId: new Map([["r1", B]]),
    });

    expect(resolved.size).toBe(0);
  });

  it("スコアが観測できていない出場者のサイドは出さない", () => {
    const resolved = resolveSideTiktokScores({
      rows: rows({ hosts: [A, B], scores: { [A]: "5000" } }),
      sides: [
        { sideId: "s0", roomIds: ["r0"] },
        { sideId: "s1", roomIds: ["r1"] },
      ],
      hostUserIdByRoomId: new Map([
        ["r0", A],
        ["r1", B],
      ]),
    });

    expect(resolved.get("s0")).toBe("5000");
    expect(resolved.has("s1")).toBe(false);
  });

  it("整数でないスコアは捨てる(BigIntで落ちない)", () => {
    const resolved = resolveSideTiktokScores({
      rows: rows({ hosts: [A, B], scores: { [A]: "12.5", [B]: "1e+21" } }),
      sides: [
        { sideId: "s0", roomIds: ["r0"] },
        { sideId: "s1", roomIds: ["r1"] },
      ],
      hostUserIdByRoomId: new Map([
        ["r0", A],
        ["r1", B],
      ]),
    });

    expect(resolved.size).toBe(0);
  });

  it("同じ hostUserId が複数の room から解決されたらマッチごと出さない", () => {
    // 改名で旧 room と新 room が同じ配信者を指しているケース。二重加算・誤帰属になる。
    const resolved = resolveSideTiktokScores({
      rows: rows({ hosts: [A, B], scores: { [A]: "5000", [B]: "4200" } }),
      sides: [
        { sideId: "s0", roomIds: ["r0"] },
        { sideId: "s1", roomIds: ["r1"] },
      ],
      hostUserIdByRoomId: new Map([
        ["r0", A],
        ["r1", A],
      ]),
    });

    expect(resolved.size).toBe(0);
  });

  it("未確定のサイド(出場者なし)は何も返さない", () => {
    const resolved = resolveSideTiktokScores({
      rows: rows({ hosts: [A], scores: { [A]: "5000" } }),
      sides: [
        { sideId: "s0", roomIds: ["r0"] },
        { sideId: "s1", roomIds: [] },
      ],
      hostUserIdByRoomId: new Map([["r0", A]]),
    });

    expect(resolved.get("s0")).toBe("5000");
    expect(resolved.has("s1")).toBe(false);
  });

  it("行が1件もなければ何も返さない", () => {
    const resolved = resolveSideTiktokScores({
      rows: [],
      sides: [{ sideId: "s0", roomIds: ["r0"] }],
      hostUserIdByRoomId: new Map([["r0", A]]),
    });

    expect(resolved.size).toBe(0);
  });

  it("hostScores が壊れていても落ちない", () => {
    for (const broken of [null, undefined, "x", 1, []]) {
      const resolved = resolveSideTiktokScores({
        rows: [{ hostUserIds: [A], hostScores: broken }],
        sides: [{ sideId: "s0", roomIds: ["r0"] }],
        hostUserIdByRoomId: new Map([["r0", A]]),
      });
      expect(resolved.size).toBe(0);
    }
  });
});

describe("canShowTiktokScore", () => {
  it("公開側は exact 検知の LIVE / DETECTED / FINISHED だけ", () => {
    for (const status of ["LIVE", "DETECTED", "FINISHED"]) {
      expect(canShowTiktokScore({ status, detectionConfidence: "exact" }, "public")).toBe(true);
    }
  });

  it("公開側は partial を出さない(相手が部外者のバトルを掴んでいる可能性がある)", () => {
    expect(
      canShowTiktokScore({ status: "FINISHED", detectionConfidence: "partial" }, "public")
    ).toBe(false);
  });

  it("管理側は partial でも出す", () => {
    expect(
      canShowTiktokScore({ status: "FINISHED", detectionConfidence: "partial" }, "admin")
    ).toBe(true);
  });

  it("VOID / NO_SHOW / SCHEDULED / NEEDS_REVIEW は両方とも出さない", () => {
    for (const status of ["VOID", "NO_SHOW", "SCHEDULED", "NEEDS_REVIEW"]) {
      expect(canShowTiktokScore({ status, detectionConfidence: "exact" }, "public")).toBe(false);
      expect(canShowTiktokScore({ status, detectionConfidence: "exact" }, "admin")).toBe(false);
    }
  });
});
