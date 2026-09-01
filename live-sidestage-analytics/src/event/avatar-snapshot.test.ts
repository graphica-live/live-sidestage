import { describe, it, expect } from "vitest";
import { snapshotDueEventAvatars, type DueEvent } from "./avatar-snapshot";
import type { TiktokProfileResult } from "@/lib/tiktok-profile";

function ok(): TiktokProfileResult {
  return { ok: true, profile: { avatarUrl: "https://p16.tiktokcdn.com/x.webp", nickname: null, userId: null } };
}

const NOT_FOUND: TiktokProfileResult = { ok: false, reason: "NOT_FOUND" };

function dueEvents(...events: DueEvent[]) {
  return async () => events;
}

const baseDeps = (over: Parameters<typeof snapshotDueEventAvatars>[0] = {}) => ({
  sleep: async () => {},
  concurrency: 2,
  batchDelayMs: 0,
  now: () => new Date("2026-09-01T00:00:00Z"),
  ...over,
});

describe("snapshotDueEventAvatars", () => {
  it("対象イベントの全参加者を保存し、成否に関わらず avatarsSnapshottedAt を立てる", async () => {
    const cached: [string, string, string | null][] = [];
    const marked: string[] = [];

    const result = await snapshotDueEventAvatars(
      baseDeps({
        listDueEvents: dueEvents({ id: "ev1", tiktokIds: ["aiko", "beko"] }),
        fetchProfile: async (tiktokId) => (tiktokId === "aiko" ? ok() : NOT_FOUND),
        cacheAvatar: async (kind, subjectId, sourceUrl) => {
          cached.push([kind, subjectId, sourceUrl]);
        },
        markSnapshotted: async (eventId) => {
          marked.push(eventId);
        },
      })
    );

    expect(cached).toEqual([["event_participant", "aiko", "https://p16.tiktokcdn.com/x.webp"]]);
    expect(marked).toEqual(["ev1"]);
    expect(result).toEqual({ eventsProcessed: 1, succeeded: 1, failed: 1 });
  });

  it("参加者が0人のイベントも avatarsSnapshottedAt を立てる", async () => {
    const marked: string[] = [];

    const result = await snapshotDueEventAvatars(
      baseDeps({
        listDueEvents: dueEvents({ id: "ev-empty", tiktokIds: [] }),
        markSnapshotted: async (eventId) => {
          marked.push(eventId);
        },
      })
    );

    expect(marked).toEqual(["ev-empty"]);
    expect(result).toEqual({ eventsProcessed: 1, succeeded: 0, failed: 0 });
  });

  it("cacheAvatar が例外を投げても他の参加者・イベントの処理を止めない", async () => {
    const cached: string[] = [];
    const marked: string[] = [];

    const result = await snapshotDueEventAvatars(
      baseDeps({
        listDueEvents: dueEvents({ id: "ev1", tiktokIds: ["aiko", "beko"] }),
        fetchProfile: async () => ok(),
        cacheAvatar: async (_kind, subjectId) => {
          if (subjectId === "aiko") throw new Error("bucket down");
          cached.push(subjectId);
        },
        markSnapshotted: async (eventId) => {
          marked.push(eventId);
        },
      })
    );

    expect(cached).toEqual(["beko"]);
    expect(marked).toEqual(["ev1"]);
    expect(result).toEqual({ eventsProcessed: 1, succeeded: 1, failed: 1 });
  });

  it("対象イベントが無ければ何もしない", async () => {
    const result = await snapshotDueEventAvatars(baseDeps({ listDueEvents: dueEvents() }));
    expect(result).toEqual({ eventsProcessed: 0, succeeded: 0, failed: 0 });
  });

  it("maxEvents <= 0 なら listDueEvents すら呼ばない", async () => {
    let called = false;
    await snapshotDueEventAvatars(
      baseDeps({
        maxEvents: 0,
        listDueEvents: async () => {
          called = true;
          return [];
        },
      })
    );
    expect(called).toBe(false);
  });
});
