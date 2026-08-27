import { describe, it, expect } from "vitest";
import {
  groupByCombinedGroup,
  sortCandidatesDeterministically,
  deriveGroupsFromSelection,
  validateCandidateGroups,
} from "./candidate-groups";

const T = (iso: string) => new Date(iso);

function candidate(
  id: string,
  startedAt: string,
  battleId: string,
  combinedGroupId: string | null = null
) {
  return { id, startedAt: T(startedAt), battleId, combinedGroupId };
}

describe("sortCandidatesDeterministically", () => {
  it("startedAt昇順で並べる", () => {
    const input = [
      candidate("c", "2026-09-01T20:20:00+09:00", "b3"),
      candidate("a", "2026-09-01T20:00:00+09:00", "b1"),
      candidate("b", "2026-09-01T20:10:00+09:00", "b2"),
    ];
    expect(sortCandidatesDeterministically(input).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("startedAtが同時刻ならbattleIdで決める", () => {
    const input = [
      candidate("a", "2026-09-01T20:00:00+09:00", "z"),
      candidate("b", "2026-09-01T20:00:00+09:00", "a"),
    ];
    expect(sortCandidatesDeterministically(input).map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("groupByCombinedGroup", () => {
  it("combinedGroupIdが全部nullなら全部単独グループになる", () => {
    const input = [
      candidate("a", "2026-09-01T20:00:00+09:00", "b1"),
      candidate("b", "2026-09-01T20:10:00+09:00", "b2"),
    ];
    expect(groupByCombinedGroup(input)).toEqual([[input[0]], [input[1]]]);
  });

  it("隣接する同じcombinedGroupIdはまとめる", () => {
    const a = candidate("a", "2026-09-01T20:00:00+09:00", "b1", "g1");
    const b = candidate("b", "2026-09-01T20:10:00+09:00", "b2", "g1");
    const c = candidate("c", "2026-09-01T20:20:00+09:00", "b3");
    expect(groupByCombinedGroup([a, b, c])).toEqual([[a, b], [c]]);
  });

  it("非隣接の同一combinedGroupIdは別グループとして扱う(連続性の保証はしない)", () => {
    const a = candidate("a", "2026-09-01T20:00:00+09:00", "b1", "g1");
    const b = candidate("b", "2026-09-01T20:10:00+09:00", "b2", "g2");
    const c = candidate("c", "2026-09-01T20:20:00+09:00", "b3", "g1");
    expect(groupByCombinedGroup([a, b, c])).toEqual([[a], [b], [c]]);
  });

  it("空配列を渡すと空配列を返す", () => {
    expect(groupByCombinedGroup([])).toEqual([]);
  });
});

describe("deriveGroupsFromSelection", () => {
  const a = candidate("a", "2026-09-01T20:00:00+09:00", "b1");
  const b = candidate("b", "2026-09-01T20:10:00+09:00", "b2");
  const c = candidate("c", "2026-09-01T20:20:00+09:00", "b3");
  const candidates = [a, b, c];

  it("2件チェックして片方を合算すると1グループになる", () => {
    const groups = deriveGroupsFromSelection(
      candidates,
      new Set(["a", "b"]),
      new Set(["b"])
    );
    expect(groups).toEqual([["a", "b"]]);
  });

  it("3件中2件だけ合算し1件独立にできる(部分合算)", () => {
    const groups = deriveGroupsFromSelection(
      candidates,
      new Set(["a", "b", "c"]),
      new Set(["c"])
    );
    expect(groups).toEqual([["a"], ["b", "c"]]);
  });

  it("合算フラグを外すと再び単独グループに分かれる", () => {
    const groups = deriveGroupsFromSelection(candidates, new Set(["a", "b"]), new Set());
    expect(groups).toEqual([["a"], ["b"]]);
  });

  it("チェックしていない候補は結果に含まれない(低ダイヤ非表示で行が隠れても導出結果は変わらない)", () => {
    const groups = deriveGroupsFromSelection(candidates, new Set(["a", "c"]), new Set());
    expect(groups).toEqual([["a"], ["c"]]);
  });
});

describe("validateCandidateGroups", () => {
  const byId = new Map([
    ["a", { startedAt: T("2026-09-01T20:00:00+09:00"), battleId: "b1" }],
    ["b", { startedAt: T("2026-09-01T20:10:00+09:00"), battleId: "b2" }],
    ["c", { startedAt: T("2026-09-01T20:20:00+09:00"), battleId: "b3" }],
  ]);
  const candidateIds = ["a", "b", "c"];

  it("groups省略時は全部単独グループとして扱う(旧クライアント互換)", () => {
    const result = validateCandidateGroups(undefined, candidateIds, byId);
    expect(result).toEqual({ ok: true, groups: [["a"], ["b"], ["c"]] });
  });

  it("正しい分割は通る", () => {
    const result = validateCandidateGroups([["a", "b"], ["c"]], candidateIds, byId);
    expect(result).toEqual({ ok: true, groups: [["a", "b"], ["c"]] });
  });

  it("重複ID(bが2グループに属する)はGROUP_DUPLICATE_ID", () => {
    const result = validateCandidateGroups([["a", "b"], ["b", "c"]], candidateIds, byId);
    expect(result).toEqual({ ok: false, error: { code: "GROUP_DUPLICATE_ID" } });
  });

  it("非配列はINVALID_SHAPE", () => {
    expect(validateCandidateGroups("not-an-array", candidateIds, byId)).toEqual({
      ok: false,
      error: { code: "INVALID_SHAPE" },
    });
  });

  it("グループ内に非文字列が混じるとINVALID_SHAPE", () => {
    const result = validateCandidateGroups([["a", 123]], candidateIds, byId);
    expect(result).toEqual({ ok: false, error: { code: "INVALID_SHAPE" } });
  });

  it("空配列のグループはINVALID_SHAPE", () => {
    const result = validateCandidateGroups([[], ["a", "b", "c"]], candidateIds, byId);
    expect(result).toEqual({ ok: false, error: { code: "INVALID_SHAPE" } });
  });

  it("candidateIdsとの不一致(存在しないIDを含む)はGROUP_ID_MISMATCH", () => {
    const result = validateCandidateGroups([["a", "b", "c", "d"]], candidateIds, byId);
    expect(result).toEqual({ ok: false, error: { code: "GROUP_ID_MISMATCH" } });
  });

  it("candidateIdsとの不一致(一部しか含まない)はGROUP_ID_MISMATCH", () => {
    const result = validateCandidateGroups([["a", "b"]], candidateIds, byId);
    expect(result).toEqual({ ok: false, error: { code: "GROUP_ID_MISMATCH" } });
  });

  it("非連続なグループ(a,cを合算しbを挟む)はGROUP_NOT_CONTIGUOUS", () => {
    const result = validateCandidateGroups([["a", "c"], ["b"]], candidateIds, byId);
    expect(result).toEqual({ ok: false, error: { code: "GROUP_NOT_CONTIGUOUS" } });
  });
});
