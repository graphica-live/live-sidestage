// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// **このテストはグローバルに効く処理を実行する。** runListenerCommentRetentionCycle() は
// room を絞らず「dayKey < 30日前」の ListenerComment を全て消す。他の integration
// テストが30日より古い dayKey のフィクスチャを使う場合は同時に走らせないこと
// (2026-09時点で該当フィクスチャなし、gift-retention.integration.test.tsと同じ注意)。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { runListenerCommentRetentionCycle } from "./listener-comment-retention";
import { dayKeyOf, shiftDayKey } from "./gift-retention-window";

const PREFIX = "itest_lc_retention";
let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const NOW = new Date();
const TODAY = dayKeyOf(NOW);
/** 削除対象(30日より前)。 */
const OLD_DAY = shiftDayKey(TODAY, -45);
/** 保持対象。 */
const RECENT_DAY = shiftDayKey(TODAY, -5);

const roomIds: string[] = [];

async function createRoom(): Promise<string> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO public."TiktokRoom" (id, "tiktokId", "createdAt", "monitoringSuspended")
    VALUES (gen_random_uuid()::text, ${`${PREFIX}${uniqueSuffix()}`.toLowerCase()}, NOW(), true)
    RETURNING id
  `;
  roomIds.push(rows[0].id);
  return rows[0].id;
}

async function insertComment(params: { roomId: string; uniqueId: string; dayKey: string }) {
  const receivedAt = new Date(`${params.dayKey}T12:00:00+09:00`);
  await prisma.$executeRaw`
    INSERT INTO public.listener_comments
      (id, "roomId", "uniqueId", nickname, comment, "receivedAt", "dayKey")
    VALUES
      (gen_random_uuid()::text, ${params.roomId}, ${params.uniqueId},
       ${params.uniqueId}, 'retentionテスト', ${receivedAt}, ${params.dayKey})
  `;
}

let roomId = "";
const listener = `${PREFIX}_u1_${uniqueSuffix()}`;

beforeAll(async () => {
  roomId = await createRoom();
  await insertComment({ roomId, uniqueId: listener, dayKey: OLD_DAY });
  await insertComment({ roomId, uniqueId: listener, dayKey: RECENT_DAY });
});

afterAll(async () => {
  if (roomIds.length > 0) {
    await prisma.listenerComment.deleteMany({ where: { roomId: { in: roomIds } } });
    await prisma.tiktokRoom.deleteMany({ where: { id: { in: roomIds } } });
  }
});

describe("runListenerCommentRetentionCycle", () => {
  it("dry-runでは何も削除せず、30日より前の件数だけ報告する", async () => {
    const result = await runListenerCommentRetentionCycle({ dryRun: true, now: NOW });
    expect(result.dryRun).toBe(true);
    if (result.dryRun) expect(result.deletableRows).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.listenerComment.count({ where: { roomId } });
    expect(remaining).toBe(2);
  });

  it("dryRun:falseで30日より前の行だけ削除する", async () => {
    const result = await runListenerCommentRetentionCycle({ dryRun: false, now: NOW });
    expect(result.dryRun).toBe(false);
    if (!result.dryRun) expect(result.deletedRows).toBeGreaterThanOrEqual(1);

    const old = await prisma.listenerComment.findFirst({ where: { roomId, dayKey: OLD_DAY } });
    expect(old).toBeNull();

    const recent = await prisma.listenerComment.findFirst({ where: { roomId, dayKey: RECENT_DAY } });
    expect(recent).not.toBeNull();
  });
});
