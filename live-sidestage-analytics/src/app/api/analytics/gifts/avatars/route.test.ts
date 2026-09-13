import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getServerSessionMock, findUniqueMock, loadMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  findUniqueMock: vi.fn(),
  loadMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { streamer: { findUnique: findUniqueMock } } }));
vi.mock("@/lib/gift-ranking-avatars", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gift-ranking-avatars")>("@/lib/gift-ranking-avatars");
  return { ...actual, loadRankingAvatars: loadMock };
});

import { POST } from "./route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/analytics/gifts/avatars", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/analytics/gifts/avatars", () => {
  beforeEach(() => {
    getServerSessionMock.mockReset();
    findUniqueMock.mockReset();
    loadMock.mockReset();
    loadMock.mockResolvedValue([]);
  });

  it("returns 401 without session", async () => {
    getServerSessionMock.mockResolvedValue(null);
    const res = await POST(req({ uids: [] }));
    expect(res.status).toBe(401);
  });

  it("room-less streamer gets empty avatars", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: null });
    const res = await POST(req({ uids: ["1"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatars: [] });
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("rejects malformed uids", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: "room1" });
    expect((await POST(req({ uids: [""] }))).status).toBe(400);
  });

  it("loads avatars for the streamer room", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "u1" } });
    findUniqueMock.mockResolvedValue({ roomId: "room1" });
    loadMock.mockResolvedValue([{ tiktokUid: "7", profileImageUrl: "https://img" }]);
    const res = await POST(req({ uids: ["7"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatars: [{ tiktokUid: "7", profileImageUrl: "https://img" }] });
    expect(loadMock).toHaveBeenCalledWith("room1", ["7"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
