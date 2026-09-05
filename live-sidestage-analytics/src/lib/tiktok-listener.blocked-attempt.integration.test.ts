// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// recordBlockedAttempt()のWHERE workerId=自worker条件を直接検証する。実装前レビュー
// HIGH指摘: この条件が無いと、再割当直後・旧worker側のteardown待ち(60秒reconcile)の間に
// 届くin-flightのエラーが新worker担当分として誤ってカウントされるレースが起きる。
// .env.local.testはWORKER_INDEX="0"固定なので、workerId=0の部屋は自分の担当として
// increment され、workerId=1(他worker担当)の部屋には一切影響しないことを確認する。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "./prisma";
import { recordBlockedAttempt } from "./tiktok-listener";

const roomIds: string[] = [];

function tiktokId(tag: string) {
  return `itestba${tag}${Math.random().toString(36).slice(2, 8)}`.toLowerCase();
}

async function makeRoom(workerId: number | null) {
  const room = await prisma.tiktokRoom.create({
    data: { tiktokId: tiktokId("r"), monitoringSuspended: true, workerId },
    select: { id: true },
  });
  roomIds.push(room.id);
  return room;
}

afterAll(async () => {
  await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
});

describe("recordBlockedAttempt", () => {
  it("自worker(WORKER_INDEX=0)担当の部屋はconsecutiveBlockedCountがincrementされる", async () => {
    const room = await makeRoom(0);

    await recordBlockedAttempt(room.id);
    await recordBlockedAttempt(room.id);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.consecutiveBlockedCount).toBe(2);
  });

  it("他worker担当(workerId!=自worker)の部屋には一切影響しない", async () => {
    const room = await makeRoom(1);

    await recordBlockedAttempt(room.id);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.consecutiveBlockedCount).toBe(0);
  });

  it("担当worker未割当(workerId:null)の部屋にも影響しない", async () => {
    const room = await makeRoom(null);

    await recordBlockedAttempt(room.id);

    const after = await prisma.tiktokRoom.findUniqueOrThrow({ where: { id: room.id } });
    expect(after.consecutiveBlockedCount).toBe(0);
  });
});
