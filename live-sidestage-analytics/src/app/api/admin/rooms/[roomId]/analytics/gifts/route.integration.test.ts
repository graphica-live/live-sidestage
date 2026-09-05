// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// queryGifts自体のロジックは既存カバレッジ対象外。ここではgetAdminSession()による認可と
// レスポンス契約(roomId直接指定・verified固定)のみ固定する。
import { describe, it, expect, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ADMIN_EMAIL } from "@/lib/admin";

const auth = vi.hoisted(() => ({ email: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: async () => (auth.email ? { user: { email: auth.email } } : null),
}));

// next-auth をモックしてから読む(getAdminSession が import 時に束縛するため)。
const { GET } = await import("./route");

const roomIds: string[] = [];

function tiktokId(tag: string) {
  return `itestagapi${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom() {
  const room = await prisma.tiktokRoom.create({
    data: { tiktokId: tiktokId("r") },
    select: { id: true },
  });
  roomIds.push(room.id);
  return room;
}

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("GET /api/admin/rooms/[roomId]/analytics/gifts", () => {
  it("未ログインなら401", async () => {
    auth.email = null;
    const room = await makeRoom();
    const res = await GET(new NextRequest(`http://localhost/api/admin/rooms/${room.id}/analytics/gifts`), {
      params: { roomId: room.id },
    });
    expect(res.status).toBe(401);
  });

  it("管理者が取得すると200・verified固定・roomIdを直接指定できる", async () => {
    auth.email = ADMIN_EMAIL;
    const room = await makeRoom();
    const res = await GET(new NextRequest(`http://localhost/api/admin/rooms/${room.id}/analytics/gifts`), {
      params: { roomId: room.id },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.verified).toBe(true);
  });
});
