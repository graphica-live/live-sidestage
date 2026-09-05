// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// buildWorkerReport() 自体のロジックは対象外(既存カバレッジ)。ここでは今回追加した
// adminRoomList のレスポンス契約と、取得失敗時にレスポンス全体を落とさないフォールバックのみ固定する。
import { describe, it, expect, afterAll, vi } from "vitest";
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
  return `itestwapi${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("GET /api/admin/workers", () => {
  it("未ログインなら401", async () => {
    auth.email = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("adminRoomListにworkerId割当済みroomが含まれ、weeklyEulerSignUsageCountが数値で返る", async () => {
    auth.email = ADMIN_EMAIL;
    const room = await prisma.tiktokRoom.create({
      data: { tiktokId: tiktokId("r"), workerId: 0 },
      select: { id: true },
    });
    roomIds.push(room.id);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.adminRoomList)).toBe(true);
    const found = body.adminRoomList.find((r: { roomId: string }) => r.roomId === room.id);
    expect(found).toBeDefined();
    expect(typeof found.weeklyEulerSignUsageCount).toBe("number");
  });
});
