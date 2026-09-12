// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterAll, vi } from "vitest";
import { makeTiktokUid } from "@/lib/__fixtures__/gift";
import { prisma } from "@/lib/prisma";
import { ADMIN_EMAIL } from "@/lib/admin";

const auth = vi.hoisted(() => ({ email: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: async () => (auth.email ? { user: { email: auth.email } } : null),
}));

const { GET } = await import("./route");

const roomIds: string[] = [];

function tiktokHandle(tag: string) {
  return `itestwusage${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("GET /api/admin/workers/room-usage", () => {
  it("未ログインなら401", async () => {
    auth.email = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("workerId割当済みroomの署名消費が数値で返る", async () => {
    auth.email = ADMIN_EMAIL;
    const handle = tiktokHandle("r");
    const room = await prisma.tiktokRoom.create({
      data: { tiktokHandle: handle, hostTiktokUid: makeTiktokUid(handle), workerId: 0 },
      select: { id: true },
    });
    roomIds.push(room.id);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.generatedAt).toBe("string");
    const found = body.rooms.find((r: { roomId: string }) => r.roomId === room.id);
    expect(found).toBeDefined();
    expect(typeof found.weeklyEulerSignUsageCount).toBe("number");
    expect(typeof found.signatureUsage24hCount).toBe("number");
    expect(typeof found.collabSignatureUsage24hCount).toBe("number");
  });
});
