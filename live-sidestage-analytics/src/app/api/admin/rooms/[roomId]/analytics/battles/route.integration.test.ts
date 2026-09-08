// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// queryBattles自体のロジックは既存カバレッジ対象外。ここではgetAdminSession()による認可・
// room未存在時の404・レスポンス契約のみ固定する。
import { describe, it, expect, afterAll, vi } from "vitest";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
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

function tiktokHandle(tag: string) {
  return `itestagapib${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom() {
  // hostTiktokUid は @unique。room ごとに別の値でないと2部屋目の作成が落ちる。
  const handle = tiktokHandle("r");
  const room = await prisma.tiktokRoom.create({
    data: { tiktokHandle: handle, hostTiktokUid: makeTiktokUid(handle) },
    select: { id: true },
  });
  roomIds.push(room.id);
  return room;
}

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("GET /api/admin/rooms/[roomId]/analytics/battles", () => {
  it("未ログインなら401", async () => {
    auth.email = null;
    const room = await makeRoom();
    const res = await GET(new NextRequest(`http://localhost/api/admin/rooms/${room.id}/analytics/battles`), {
      params: { roomId: room.id },
    });
    expect(res.status).toBe(401);
  });

  it("存在しないroomIdなら404", async () => {
    auth.email = ADMIN_EMAIL;
    const res = await GET(
      new NextRequest("http://localhost/api/admin/rooms/itest-nonexistent/analytics/battles"),
      { params: { roomId: "itest-nonexistent" } }
    );
    expect(res.status).toBe(404);
  });

  it("管理者が取得すると200・verified固定", async () => {
    auth.email = ADMIN_EMAIL;
    const room = await makeRoom();
    const res = await GET(new NextRequest(`http://localhost/api/admin/rooms/${room.id}/analytics/battles`), {
      params: { roomId: room.id },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.battles)).toBe(true);
    expect(body.verified).toBe(true);
  });
});
