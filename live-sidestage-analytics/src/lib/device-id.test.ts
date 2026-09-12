import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { getOrCreateDeviceId } from "./device-id";

describe("getOrCreateDeviceId", () => {
  beforeEach(() => {
    findUnique.mockClear();
    updateMany.mockClear();
  });

  it("既存のdeviceIdがあればそれを返し、DBへ書き込まない", async () => {
    findUnique.mockResolvedValueOnce({ deviceId: "1234567890123456789" });

    const result = await getOrCreateDeviceId("room-1");

    expect(result).toBe("1234567890123456789");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("deviceId未設定のroomには新規生成して保存する", async () => {
    findUnique.mockResolvedValueOnce({ deviceId: null });
    updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await getOrCreateDeviceId("room-2");

    expect(result).toMatch(/^\d{19}$/);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "room-2" },
      data: { deviceId: result },
    });
  });

  it("findUniqueとupdateManyの間にroomが削除されても例外を投げない", async () => {
    findUnique.mockResolvedValueOnce({ deviceId: null });
    // updateManyは対象0件でも例外を投げない(P2025を回避するための挙動)
    updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await getOrCreateDeviceId("room-deleted");

    expect(result).toMatch(/^\d{19}$/);
  });

  it("room自体が最初から存在しない場合は例外を投げる(TOCTOU回避と区別する)", async () => {
    findUnique.mockResolvedValueOnce(null);

    await expect(getOrCreateDeviceId("room-missing")).rejects.toThrow("TiktokRoom not found");
    expect(updateMany).not.toHaveBeenCalled();
  });
});
