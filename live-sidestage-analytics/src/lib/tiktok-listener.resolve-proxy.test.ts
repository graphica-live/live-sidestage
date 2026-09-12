// DB不要。resolveProxyForRoom()のTOCTOU(findUnique後・updateMany前にroomが削除される)経路を
// 直接検証する。統合テスト(tiktok-listener.reconnect-backoff.integration.test.ts)のTC-TLC-011は
// getOrCreateDeviceId()が先に呼ばれて失敗するため、resolveProxyForRoom()側のTOCTOUには到達しない
// (code-review Codex指摘)。
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const findUnique = vi.fn();
const updateMany = vi.fn();
vi.mock("./prisma", () => ({
  prisma: {
    tiktokRoom: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
    },
  },
}));

import { resolveProxyForRoom } from "./tiktok-listener";

const ORIGINAL_POOL = process.env.TIKTOK_PROXY_POOL;

describe("resolveProxyForRoom()", () => {
  beforeEach(() => {
    findUnique.mockClear();
    updateMany.mockClear();
    process.env.TIKTOK_PROXY_POOL = JSON.stringify(["proxy-a", "proxy-b", "proxy-c"]);
  });

  afterAll(() => {
    if (ORIGINAL_POOL === undefined) delete process.env.TIKTOK_PROXY_POOL;
    else process.env.TIKTOK_PROXY_POOL = ORIGINAL_POOL;
  });

  it("proxyKey未設定のroomにはハッシュ由来のindexを新規割当して保存する", async () => {
    findUnique.mockResolvedValueOnce({ proxyKey: null });
    updateMany.mockResolvedValueOnce({ count: 1 });

    const proxy = await resolveProxyForRoom("room-1");

    expect(["proxy-a", "proxy-b", "proxy-c"]).toContain(proxy);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("findUniqueとupdateManyの間にroomが削除されても例外を投げない(TOCTOU/P2025回避)", async () => {
    findUnique.mockResolvedValueOnce({ proxyKey: null });
    // updateManyは対象0件でも例外を投げない
    updateMany.mockResolvedValueOnce({ count: 0 });

    const proxy = await resolveProxyForRoom("room-deleted");

    expect(["proxy-a", "proxy-b", "proxy-c"]).toContain(proxy);
  });

  it("room自体が最初から存在しない場合は例外を投げる(TOCTOU回避と区別する)", async () => {
    findUnique.mockResolvedValueOnce(null);

    await expect(resolveProxyForRoom("room-missing")).rejects.toThrow("TiktokRoom not found");
    expect(updateMany).not.toHaveBeenCalled();
  });
});
