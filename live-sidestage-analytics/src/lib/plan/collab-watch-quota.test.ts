import { describe, expect, it } from "vitest";
import {
  FREE_COLLAB_OPPONENTS_PER_SESSION,
  applyCollabWatchQuotaToSubjects,
  type CollabWatchQuotaState,
} from "./collab-watch-quota";

function quota(partial: Partial<CollabWatchQuotaState>): CollabWatchQuotaState {
  return {
    unlimited: false,
    remainingNewOpponents: 0,
    sessionExhaustedToday: false,
    activeLinkCount: 0,
    sessionOpponentCount: 0,
    ...partial,
  };
}

describe("applyCollabWatchQuotaToSubjects", () => {
  const subjects = [
    { tiktokUid: "1", tiktokHandle: "a", nickname: null },
    { tiktokUid: "2", tiktokHandle: "b", nickname: null },
    { tiktokUid: "3", tiktokHandle: "c", nickname: null },
    { tiktokUid: "4", tiktokHandle: "d", nickname: null },
  ];

  it("unlimitedは全件通す", () => {
    expect(applyCollabWatchQuotaToSubjects(subjects, quota({ unlimited: true }), new Set())).toHaveLength(4);
  });

  it("新規枠3まで", () => {
    const result = applyCollabWatchQuotaToSubjects(
      subjects,
      quota({ remainingNewOpponents: FREE_COLLAB_OPPONENTS_PER_SESSION }),
      new Set()
    );
    expect(result.map((s) => s.tiktokUid)).toEqual(["1", "2", "3"]);
  });

  it("本日既に監視した相手は枠を消費しない", () => {
    const result = applyCollabWatchQuotaToSubjects(
      subjects,
      quota({ remainingNewOpponents: 0 }),
      new Set(["1"])
    );
    expect(result.map((s) => s.tiktokUid)).toEqual(["1"]);
  });
});
