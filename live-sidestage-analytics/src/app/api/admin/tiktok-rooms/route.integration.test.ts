// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// deleteTiktokRoomPermanently / suspendRoomMonitoring 自体のロジックは
// tiktok-room.integration.test.ts で固定済み。ここでは認可・HTTPステータス・レスポンス契約を固定する。
import { describe, it, expect, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ADMIN_EMAIL } from "@/lib/admin";

const auth = vi.hoisted(() => ({ email: null as string | null }));

vi.mock("next-auth", () => ({
  getServerSession: async () => (auth.email ? { user: { email: auth.email } } : null),
}));

// next-auth をモックしてから読む(getAdminSession が import 時に束縛するため)。
const { DELETE, PATCH } = await import("./route");

const roomIds: string[] = [];
const eventIds: string[] = [];

function tiktokId(tag: string) {
  return `itesttrapi${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom(overrides: { monitoringSuspended?: boolean } = {}) {
  const room = await prisma.tiktokRoom.create({
    data: { tiktokId: tiktokId("r"), monitoringSuspended: overrides.monitoringSuspended ?? false },
    select: { id: true },
  });
  roomIds.push(room.id);
  return room;
}

async function makeUnfinalizedEventRoom() {
  const room = await makeRoom();
  const id = tiktokId("evt");
  const event = await prisma.event.create({
    data: {
      slug: `itest-tr-api-event-${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
      title: "itest event",
      ownerUserId: "itest-owner",
      format: "TOURNAMENT",
      entryMode: "SOLO",
      status: "RUNNING",
      startAt: new Date(),
      endAt: new Date(Date.now() + 60 * 60 * 1000),
      finalizedAt: null,
    },
    select: { id: true },
  });
  eventIds.push(event.id);
  await prisma.eventParticipant.create({
    data: { eventId: event.id, tiktokId: id, roomId: room.id, displayName: id },
  });
  return room;
}

afterAll(async () => {
  await prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.tiktokRoomAdminAuditLog.deleteMany({ where: { roomId: { in: roomIds } } });
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("DELETE /api/admin/tiktok-rooms", () => {
  it("未ログインなら401", async () => {
    auth.email = null;
    const room = await makeRoom();
    const res = await DELETE(
      new NextRequest(`http://localhost/api/admin/tiktok-rooms?id=${room.id}`)
    );
    expect(res.status).toBe(401);
  });

  it("管理者以外なら401", async () => {
    auth.email = "not-admin@example.com";
    const room = await makeRoom();
    const res = await DELETE(
      new NextRequest(`http://localhost/api/admin/tiktok-rooms?id=${room.id}`)
    );
    expect(res.status).toBe(401);
  });

  it("管理者が存在するroomIdを削除すると200", async () => {
    auth.email = ADMIN_EMAIL;
    const room = await makeRoom();
    const res = await DELETE(
      new NextRequest(`http://localhost/api/admin/tiktok-rooms?id=${room.id}`)
    );
    expect(res.status).toBe(200);
    expect(await prisma.tiktokRoom.findUnique({ where: { id: room.id } })).toBeNull();
  });

  it("存在しないroomIdなら404", async () => {
    auth.email = ADMIN_EMAIL;
    const res = await DELETE(
      new NextRequest("http://localhost/api/admin/tiktok-rooms?id=itest-nonexistent")
    );
    expect(res.status).toBe(404);
  });

  it("idクエリが無ければ400", async () => {
    auth.email = ADMIN_EMAIL;
    const res = await DELETE(new NextRequest("http://localhost/api/admin/tiktok-rooms"));
    expect(res.status).toBe(400);
  });

  it("未finalizeイベントの参加部屋なら409(event_active)で削除しない", async () => {
    auth.email = ADMIN_EMAIL;
    const room = await makeUnfinalizedEventRoom();
    const res = await DELETE(
      new NextRequest(`http://localhost/api/admin/tiktok-rooms?id=${room.id}`)
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("開催中イベントの参加部屋のため削除できません");
    expect(await prisma.tiktokRoom.findUnique({ where: { id: room.id } })).not.toBeNull();
  });
});

describe("PATCH /api/admin/tiktok-rooms", () => {
  it("未ログインなら401", async () => {
    auth.email = null;
    const room = await makeRoom();
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/tiktok-rooms", {
        method: "PATCH",
        body: JSON.stringify({ id: room.id, action: "suspend" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("管理者が監視解除すると200", async () => {
    auth.email = ADMIN_EMAIL;
    const room = await makeRoom();
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/tiktok-rooms", {
        method: "PATCH",
        body: JSON.stringify({ id: room.id, action: "suspend" }),
      })
    );
    expect(res.status).toBe(200);
    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(true);
  });

  it("既に監視解除済みでも200(already_suspended)", async () => {
    auth.email = ADMIN_EMAIL;
    const room = await makeRoom({ monitoringSuspended: true });
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/tiktok-rooms", {
        method: "PATCH",
        body: JSON.stringify({ id: room.id, action: "suspend" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("already_suspended");
  });

  it("存在しないroomIdなら404", async () => {
    auth.email = ADMIN_EMAIL;
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/tiktok-rooms", {
        method: "PATCH",
        body: JSON.stringify({ id: "itest-nonexistent", action: "suspend" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("actionがsuspend以外なら400", async () => {
    auth.email = ADMIN_EMAIL;
    const room = await makeRoom();
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/tiktok-rooms", {
        method: "PATCH",
        body: JSON.stringify({ id: room.id, action: "delete" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("idが無ければ400", async () => {
    auth.email = ADMIN_EMAIL;
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/tiktok-rooms", {
        method: "PATCH",
        body: JSON.stringify({ action: "suspend" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("bodyがJSONでなければ400", async () => {
    auth.email = ADMIN_EMAIL;
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/tiktok-rooms", {
        method: "PATCH",
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
  });
});
