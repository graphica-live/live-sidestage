import { describe, it, expect } from "vitest";
import { createAvatarCache } from "./tiktok-avatar";
import type { TiktokProfileResult } from "./tiktok-profile";

const AVATAR = "https://p16-common-sign.tiktokcdn.com/x.webp?x-expires=1";

function ok(url = AVATAR): TiktokProfileResult {
  return { ok: true, profile: { avatarUrl: url, nickname: null } };
}

/** 呼び出し回数を数えつつ、決めた結果を返すフェッチャ。 */
function stub(results: (id: string) => TiktokProfileResult) {
  const calls: string[] = [];
  return {
    calls,
    fetchProfile: async (id: string) => {
      calls.push(id);
      return results(id);
    },
  };
}

describe("createAvatarCache", () => {
  it("取れた URL を返し、TTL の間は取り直さない", async () => {
    let clock = 0;
    const s = stub(() => ok());
    const cache = createAvatarCache({ fetchProfile: s.fetchProfile, now: () => clock });

    expect(await cache.get("alice")).toBe(AVATAR);
    clock += 60 * 60 * 1000; // 1時間後
    expect(await cache.get("alice")).toBe(AVATAR);
    expect(s.calls).toEqual(["alice"]);
  });

  it("TTL を過ぎたら取り直す", async () => {
    let clock = 0;
    const s = stub(() => ok());
    const cache = createAvatarCache({ fetchProfile: s.fetchProfile, now: () => clock });

    await cache.get("alice");
    clock += 7 * 60 * 60 * 1000; // OK_TTL(6時間)より後
    await cache.get("alice");
    expect(s.calls).toHaveLength(2);
  });

  it("同じ配信者への同時アクセスは1回にまとめる", async () => {
    const calls: string[] = [];
    const gate: { release: () => void } = { release: () => {} };
    const cache = createAvatarCache({
      fetchProfile: async (id) => {
        calls.push(id);
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
        return ok();
      },
      now: () => 0,
    });

    const all = Promise.all([cache.get("alice"), cache.get("alice"), cache.get("alice")]);
    await new Promise((r) => setTimeout(r, 0));
    gate.release();

    expect(await all).toEqual([AVATAR, AVATAR, AVATAR]);
    expect(calls).toEqual(["alice"]);
  });

  it("同時に投げる外向きリクエストを上限で抑える", async () => {
    let running = 0;
    let peak = 0;
    const cache = createAvatarCache({
      maxConcurrency: 2,
      now: () => 0,
      fetchProfile: async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 1));
        running--;
        return ok();
      },
    });

    await Promise.all(["a", "b", "c", "d", "e", "f"].map((id) => cache.get(id)));
    expect(peak).toBe(2);
  });

  it("失敗の理由で再試行の間隔を変える", async () => {
    let clock = 0;
    const s = stub((id) =>
      id === "gone" ? { ok: false, reason: "NOT_FOUND" } : { ok: false, reason: "ERROR" }
    );
    const cache = createAvatarCache({ fetchProfile: s.fetchProfile, now: () => clock });

    expect(await cache.get("gone")).toBeNull();
    expect(await cache.get("flaky")).toBeNull();

    clock += 10 * 60 * 1000; // 10分後: ERROR(5分)は明け、NOT_FOUND(6時間)はまだ
    await cache.get("gone");
    await cache.get("flaky");

    expect(s.calls.filter((c) => c === "gone")).toHaveLength(1);
    expect(s.calls.filter((c) => c === "flaky")).toHaveLength(2);
  });

  it("連続で失敗したら外向きの取得を止める", async () => {
    let clock = 0;
    const s = stub(() => ({ ok: false, reason: "ERROR" }) as TiktokProfileResult);
    const cache = createAvatarCache({ fetchProfile: s.fetchProfile, now: () => clock });

    // 8連続で失敗させるとブレーカーが開く。
    for (let i = 0; i < 8; i++) await cache.get(`u${i}`);
    expect(s.calls).toHaveLength(8);

    // 開いている間はキャッシュに無い相手でも外へ出さない。
    expect(await cache.get("fresh")).toBeNull();
    expect(s.calls).toHaveLength(8);

    clock += 6 * 60 * 1000; // 5分の遮断が明ける
    expect(await cache.get("fresh")).toBeNull();
    expect(s.calls).toHaveLength(9);
  });

  it("存在しないハンドルはブレーカーに数えない", async () => {
    const s = stub(() => ({ ok: false, reason: "NOT_FOUND" }) as TiktokProfileResult);
    const cache = createAvatarCache({ fetchProfile: s.fetchProfile, now: () => 0 });

    for (let i = 0; i < 10; i++) await cache.get(`u${i}`);
    expect(s.calls).toHaveLength(10);
  });

  it("保持数の上限を超えたら古いものから捨てる", async () => {
    const s = stub(() => ok());
    const cache = createAvatarCache({ fetchProfile: s.fetchProfile, now: () => 0, maxEntries: 3 });

    for (const id of ["a", "b", "c", "d", "e"]) await cache.get(id);
    expect(cache.size()).toBe(3);

    // 捨てられた "a" は引き直しになる。
    await cache.get("a");
    expect(s.calls.filter((c) => c === "a")).toHaveLength(2);
  });

  it("フェッチャが例外を投げても null を返す", async () => {
    const cache = createAvatarCache({
      now: () => 0,
      fetchProfile: async () => {
        throw new Error("boom");
      },
    });

    expect(await cache.get("alice")).toBeNull();
    // 例外で in-flight が詰まらないこと。
    expect(await cache.get("alice")).toBeNull();
  });
});
