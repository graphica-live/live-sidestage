// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
// ensureRoomWatchedForCollab() の3分岐(未登録→新規作成/監視中→無変更/休止中→ON書き換え)を実DBで検証する。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ensureRoomWatchedForCollab } from "./tiktok-room";

const roomIds: string[] = [];

function tiktokId(tag: string) {
  return `itestcollab${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("ensureRoomWatchedForCollab", () => {
  it("未登録のtiktokIdは新規作成し、監視中(resumed: false)として返す", async () => {
    const id = tiktokId("new");
    const result = await ensureRoomWatchedForCollab(id);
    expect(result).not.toBeNull();
    roomIds.push(result!.roomId);

    expect(result!.tiktokId).toBe(id);
    expect(result!.resumed).toBe(false);
    expect(result!.created).toBe(true);

    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: result!.roomId } });
    expect(room.monitoringSuspended).toBe(false);
  });

  it("既に監視中(monitoringSuspended: false)の部屋はそのまま(resumed: false)", async () => {
    const id = tiktokId("active");
    const room = await prisma.tiktokRoom.create({
      data: { tiktokId: id, monitoringSuspended: false },
    });
    roomIds.push(room.id);

    const result = await ensureRoomWatchedForCollab(id);
    expect(result).toEqual({ roomId: room.id, tiktokId: id, resumed: false, created: false });

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
  });

  it("休止中(monitoringSuspended: true)の部屋はONへ書き換える(resumed: true)", async () => {
    const id = tiktokId("suspended");
    const room = await prisma.tiktokRoom.create({
      data: { tiktokId: id, monitoringSuspended: true },
    });
    roomIds.push(room.id);

    const result = await ensureRoomWatchedForCollab(id);
    expect(result).toEqual({ roomId: room.id, tiktokId: id, resumed: true, created: false });

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.monitoringSuspended).toBe(false);
  });

  it("@付き・大文字混じりのtiktokIdは正規化してから既存部屋を引き当てる", async () => {
    const normalized = tiktokId("norm");
    const room = await prisma.tiktokRoom.create({
      data: { tiktokId: normalized, monitoringSuspended: true },
    });
    roomIds.push(room.id);

    const result = await ensureRoomWatchedForCollab(`@${normalized.toUpperCase()}`);
    expect(result).toEqual({ roomId: room.id, tiktokId: normalized, resumed: true, created: false });
  });

  it("不正な形式(記号・空文字)はnullを返し、部屋を作らない", async () => {
    expect(await ensureRoomWatchedForCollab("")).toBeNull();
    expect(await ensureRoomWatchedForCollab("has space")).toBeNull();
  });

  it("workerIdを渡すと新規作成時にそのworkerIdで作成する", async () => {
    const id = tiktokId("worker");
    const result = await ensureRoomWatchedForCollab(id, 2);
    expect(result).not.toBeNull();
    roomIds.push(result!.roomId);
    expect(result!.created).toBe(true);

    const room = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: result!.roomId } });
    expect(room.workerId).toBe(2);
  });

  it("既存roomの再開時はworkerIdを渡してもDBのworkerIdを上書きしない", async () => {
    const id = tiktokId("keepworker");
    const room = await prisma.tiktokRoom.create({
      data: { tiktokId: id, monitoringSuspended: true, workerId: 1 },
    });
    roomIds.push(room.id);

    const result = await ensureRoomWatchedForCollab(id, 2); // 別workerが検知した想定
    expect(result!.created).toBe(false);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.workerId).toBe(1); // 上書きされていない
  });
});
