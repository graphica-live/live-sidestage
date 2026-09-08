import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeTikTokUserId,
  recordTikTokUser,
  resetTikTokUserThrottleForTest,
} from "./tiktok-user";

function fakeDb() {
  const upsert = vi.fn().mockResolvedValue(undefined);
  return { db: { tikTokUser: { upsert } } as never, upsert };
}

describe("normalizeTikTokUserId", () => {
  it("protobuf proto3 の既定値 '0' を欠落として扱う", () => {
    expect(normalizeTikTokUserId("0")).toBeNull();
  });

  it("空文字・undefined・非数字を null にする", () => {
    expect(normalizeTikTokUserId("")).toBeNull();
    expect(normalizeTikTokUserId(undefined)).toBeNull();
    expect(normalizeTikTokUserId(null)).toBeNull();
    expect(normalizeTikTokUserId("abc")).toBeNull();
    expect(normalizeTikTokUserId("12a")).toBeNull();
    expect(normalizeTikTokUserId("1".repeat(33))).toBeNull();
  });

  it("数値文字列をそのまま返す(number も受ける)", () => {
    expect(normalizeTikTokUserId("6829876543210987654")).toBe("6829876543210987654");
    expect(normalizeTikTokUserId(123)).toBe("123");
  });
});

describe("recordTikTokUser", () => {
  beforeEach(() => {
    resetTikTokUserThrottleForTest();
  });

  it("uid が正規化できないときは upsert しない", async () => {
    const { db, upsert } = fakeDb();
    await recordTikTokUser(db, { tiktokUid: "0", tiktokHandle: "alice" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("表示名が欠けている観測では既知値を潰さない(非 null だけを update する)", async () => {
    const { db, upsert } = fakeDb();
    await recordTikTokUser(db, { tiktokUid: "42", tiktokHandle: null, nickname: "  " });
    expect(upsert).toHaveBeenCalledWith({
      where: { tiktokUid: "42" },
      create: { tiktokUid: "42", tiktokHandle: null, nickname: null },
      update: {},
    });
  });

  it("観測値を trim して保存する", async () => {
    const { db, upsert } = fakeDb();
    await recordTikTokUser(db, { tiktokUid: "42", tiktokHandle: " alice ", nickname: " アリス " });
    expect(upsert).toHaveBeenCalledWith({
      where: { tiktokUid: "42" },
      create: { tiktokUid: "42", tiktokHandle: "alice", nickname: "アリス" },
      update: { tiktokHandle: "alice", nickname: "アリス" },
    });
  });

  it("スロットルのマーカーは commit 後に呼ぶまで立たない", async () => {
    const { db, upsert } = fakeDb();
    const commit = await recordTikTokUser(db, { tiktokUid: "42", tiktokHandle: "alice" });

    // rollback を模して commit コールバックを呼ばない → 次の観測でも upsert が走る
    await recordTikTokUser(db, { tiktokUid: "42", tiktokHandle: "alice" });
    expect(upsert).toHaveBeenCalledTimes(2);

    commit();
    await recordTikTokUser(db, { tiktokUid: "42", tiktokHandle: "alice" });
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("表示名が変われば同じ uid でもスロットルを跨いで upsert する", async () => {
    const { db, upsert } = fakeDb();
    (await recordTikTokUser(db, { tiktokUid: "42", tiktokHandle: "alice" }))();
    (await recordTikTokUser(db, { tiktokUid: "42", tiktokHandle: "alice2" }))();
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
