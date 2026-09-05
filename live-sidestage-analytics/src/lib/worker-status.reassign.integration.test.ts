// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// reassignRoomWorker() — 管理画面からの手動 worker 移動。review-auto(Gemini代理)で出た
// 指摘のうち実装で対応した3点をここで固定する。
//   1. expectedWorkerId による楽観的排他(worker-guardianの自動フェイルオーバーとの競合検知)
//   2. consecutiveBlockedCount のリセット(リセットしないと直後のguardianサイクルが
//      「まだ403連続超過」とみなし続けてしまう)
//   3. 部屋が存在しない場合は例外を投げず not_found を返す
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./prisma";
import { reassignRoomWorker, fetchManualReassignAuditLog } from "./worker-status";

const roomIds: string[] = [];

function tiktokId(tag: string) {
  return `itestrw${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom(workerId: number | null, consecutiveBlockedCount = 0) {
  const room = await prisma.tiktokRoom.create({
    data: { tiktokId: tiktokId("r"), monitoringSuspended: true, workerId, consecutiveBlockedCount },
    select: { id: true, tiktokId: true },
  });
  roomIds.push(room.id);
  return room;
}

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("reassignRoomWorker", () => {
  it("expectedWorkerId が現在値と一致すれば移動しconsecutiveBlockedCountを0にリセットする", async () => {
    const room = await makeRoom(0, 5);

    const result = await reassignRoomWorker(room.id, 1, 3, 0, "admin@example.com");

    expect(result).toEqual({ status: "ok", roomId: room.id, tiktokId: room.tiktokId, fromWorker: 0 });
    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.workerId).toBe(1);
    expect(after.consecutiveBlockedCount).toBe(0);
  });

  it("expectedWorkerId が現在値と食い違えばconflictを返しworkerIdを変更しない(worker-guardianとの競合検知)", async () => {
    const room = await makeRoom(2);

    const result = await reassignRoomWorker(room.id, 1, 3, 0, "admin@example.com");

    expect(result).toEqual({ status: "conflict", actualWorkerId: 2 });
    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.workerId).toBe(2);
  });

  it("未割当(workerId:null)からexpectedWorkerId:nullで割当できる", async () => {
    const room = await makeRoom(null);

    const result = await reassignRoomWorker(room.id, 2, 3, null, "admin@example.com");

    expect(result).toEqual({ status: "ok", roomId: room.id, tiktokId: room.tiktokId, fromWorker: null });
    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.workerId).toBe(2);
  });

  it("存在しないroomIdはnot_foundを返す(例外を投げない)", async () => {
    const result = await reassignRoomWorker("nonexistent-room-id", 1, 3, 0, "admin@example.com");
    expect(result).toEqual({ status: "not_found" });
  });

  it("toWorkerIndexがworkerCount範囲外なら例外を投げる", async () => {
    const room = await makeRoom(0);
    await expect(reassignRoomWorker(room.id, 3, 3, 0, "admin@example.com")).rejects.toThrow();
  });

  it("成功時、監査ログにoperator付きで追記される", async () => {
    const room = await makeRoom(0);

    await reassignRoomWorker(room.id, 1, 3, 0, "admin@example.com");

    const log = await fetchManualReassignAuditLog();
    const entry = [...log].reverse().find((e) => e.roomId === room.id);
    expect(entry).toMatchObject({ roomId: room.id, fromWorker: 0, toWorker: 1, operator: "admin@example.com" });
  });
});
