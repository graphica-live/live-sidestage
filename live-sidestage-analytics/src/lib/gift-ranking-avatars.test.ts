import { describe, it, expect } from "vitest";
import { parseRankingAvatarUids, RANKING_AVATAR_MAX_UIDS } from "./gift-ranking-avatars";

describe("parseRankingAvatarUids", () => {
  it("accepts unique string uids", () => {
    expect(parseRankingAvatarUids({ uids: ["a", "b"] })).toEqual({ ok: true, uids: ["a", "b"] });
  });

  it("rejects missing/malformed uids", () => {
    expect(parseRankingAvatarUids(null).ok).toBe(false);
    expect(parseRankingAvatarUids({}).ok).toBe(false);
    expect(parseRankingAvatarUids({ uids: "nope" }).ok).toBe(false);
    expect(parseRankingAvatarUids({ uids: [""] }).ok).toBe(false);
    expect(parseRankingAvatarUids({ uids: [1] }).ok).toBe(false);
  });

  it("rejects more than RANKING_AVATAR_MAX_UIDS", () => {
    const uids = Array.from({ length: RANKING_AVATAR_MAX_UIDS + 1 }, (_, i) => String(i));
    expect(parseRankingAvatarUids({ uids }).ok).toBe(false);
  });
});
