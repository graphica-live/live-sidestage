import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getAdminSessionMock, loadMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  loadMock: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ getAdminSession: getAdminSessionMock }));
vi.mock("@/lib/gift-ranking-avatars", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gift-ranking-avatars")>("@/lib/gift-ranking-avatars");
  return { ...actual, loadRankingAvatars: loadMock };
});

import { POST } from "./route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/rooms/room1/analytics/gifts/avatars", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/rooms/[roomId]/analytics/gifts/avatars", () => {
  beforeEach(() => {
    getAdminSessionMock.mockReset();
    loadMock.mockReset();
    loadMock.mockResolvedValue([]);
  });

  it("returns 401 without admin session", async () => {
    getAdminSessionMock.mockResolvedValue(null);
    const res = await POST(req({ uids: ["7"] }), { params: { roomId: "room1" } });
    expect(res.status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("loads avatars for the URL roomId", async () => {
    getAdminSessionMock.mockResolvedValue({ email: "admin@test" });
    loadMock.mockResolvedValue([{ tiktokUid: "7", profileImageUrl: "https://img" }]);
    const res = await POST(req({ uids: ["7"] }), { params: { roomId: "room1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatars: [{ tiktokUid: "7", profileImageUrl: "https://img" }] });
    expect(loadMock).toHaveBeenCalledWith("room1", ["7"]);
  });
});
