// 2026-08-15マージ(TiktokRoom共有化)を安全に適用するための一度きりの移行スクリプト。
//
// `prisma db push`は「既存データがある非NULL列の追加」を実行できず、そのまま本番へ
// デプロイするとコンテナ起動のたびにdb pushが失敗し、node server.jsに到達できずに
// クラッシュループ(502)する。このスクリプトをdb pushの直前に走らせ、
//   1) nullable列の追加(TiktokRoom新設・Streamer/gifts/gift_editsへのnullable列追加)
//   2) 既存データからのバックフィル(旧streamerIdからTiktokRoomを起こし、各行に紐付け)
//   3) NOT NULL化・旧列/旧制約の削除・新制約の追加
// を1トランザクションで完結させ、その後のdb pushが差分なしで通る状態を作る。
//
// 冪等: 既に移行済み(gifts.streamerId列が存在しない)なら何もせず終了するので、
// コンテナ起動のたびに実行しても安全(Dockerfile CMDから毎回呼ばれる想定)。
import { prisma } from "../src/lib/prisma";
import { randomUUID } from "crypto";

async function alreadyMigrated(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'gifts' AND column_name = 'streamerId'
     ) AS exists`
  );
  return !rows[0]?.exists;
}

function normalizeTiktokId(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

async function main() {
  if (await alreadyMigrated()) {
    console.log("[migrate-shared-tiktok-room] 既に移行済みです。スキップします。");
    return;
  }

  console.log("[migrate-shared-tiktok-room] 旧スキーマを検出しました。移行を開始します。");

  await prisma.$transaction(
    async (tx) => {
      // --- Phase 1: 新しい入れ物(TiktokRoom)とnullable列を用意する ---
      await tx.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "TiktokRoom" (
          "id" TEXT NOT NULL,
          "tiktokId" TEXT NOT NULL,
          "deviceId" TEXT,
          "workerId" INTEGER,
          "proxyKey" TEXT,
          "listenerStatus" TEXT,
          "listenerMessage" TEXT,
          "listenerUpdatedAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "TiktokRoom_pkey" PRIMARY KEY ("id")
        )
      `);
      await tx.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "TiktokRoom_tiktokId_key" ON "TiktokRoom"("tiktokId")`
      );

      await tx.$executeRawUnsafe(`ALTER TABLE "Streamer" ADD COLUMN IF NOT EXISTS "roomId" TEXT`);
      await tx.$executeRawUnsafe(`ALTER TABLE "gifts" ADD COLUMN IF NOT EXISTS "roomId" TEXT`);
      await tx.$executeRawUnsafe(`ALTER TABLE "gift_edits" ADD COLUMN IF NOT EXISTS "streamerId" TEXT`);
      await tx.$executeRawUnsafe(
        `ALTER TABLE "gift_edits" ADD COLUMN IF NOT EXISTS "hidden" BOOLEAN NOT NULL DEFAULT false`
      );

      // --- Phase 2: 既存データからTiktokRoomを起こし、各行のroomId/streamerIdを埋める ---
      const streamers = await tx.$queryRawUnsafe<{ id: string; tiktokId: string }[]>(
        `SELECT "id", "tiktokId" FROM "Streamer"`
      );

      const roomIdByNormalizedTiktokId = new Map<string, string>();
      for (const s of streamers) {
        const normalized = normalizeTiktokId(s.tiktokId);

        let roomId = roomIdByNormalizedTiktokId.get(normalized);
        if (!roomId) {
          const existing = await tx.$queryRawUnsafe<{ id: string }[]>(
            `SELECT "id" FROM "TiktokRoom" WHERE "tiktokId" = $1`,
            normalized
          );
          roomId = existing[0]?.id ?? randomUUID();
          if (!existing[0]) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "TiktokRoom" ("id", "tiktokId") VALUES ($1, $2)`,
              roomId,
              normalized
            );
          }
          roomIdByNormalizedTiktokId.set(normalized, roomId);
        }

        await tx.$executeRawUnsafe(`UPDATE "Streamer" SET "roomId" = $1 WHERE "id" = $2`, roomId, s.id);
      }

      await tx.$executeRawUnsafe(`
        UPDATE "gifts" g SET "roomId" = s."roomId"
        FROM "Streamer" s
        WHERE g."streamerId" = s."id" AND g."roomId" IS NULL
      `);

      await tx.$executeRawUnsafe(`
        UPDATE "gift_edits" ge SET "streamerId" = g."streamerId"
        FROM "gifts" g
        WHERE ge."giftId" = g."id" AND ge."streamerId" IS NULL
      `);

      // 孤児行(対応するStreamer/Giftが既に存在しない等)が残っていないか確認する。
      // 残っていた場合はエラーで止め、トランザクション全体をロールバックする
      // (半端な状態でコミットするより、今まで通り旧スキーマのまま失敗し続ける方が安全)。
      const orphanGifts = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM "gifts" WHERE "roomId" IS NULL`
      );
      const orphanEdits = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM "gift_edits" WHERE "streamerId" IS NULL`
      );
      if (Number(orphanGifts[0]?.count ?? 0) > 0 || Number(orphanEdits[0]?.count ?? 0) > 0) {
        throw new Error(
          `移行できない孤児行が残っています: gifts.roomId IS NULL ${orphanGifts[0]?.count}件, ` +
            `gift_edits.streamerId IS NULL ${orphanEdits[0]?.count}件`
        );
      }

      // --- Phase 3: NOT NULL化・旧列/旧制約の削除・新制約の追加 ---
      await tx.$executeRawUnsafe(`ALTER TABLE "gifts" ALTER COLUMN "roomId" SET NOT NULL`);
      await tx.$executeRawUnsafe(`ALTER TABLE "gift_edits" ALTER COLUMN "streamerId" SET NOT NULL`);

      await tx.$executeRawUnsafe(`ALTER TABLE "gifts" DROP CONSTRAINT IF EXISTS "gifts_streamerId_fkey"`);
      await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "gifts_streamerId_dayKey_idx"`);
      await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "gifts_streamerId_receivedAt_idx"`);
      await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "gifts_streamerId_uniqueId_idx"`);
      await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "gifts_streamerId_groupId_idx"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "gifts" DROP COLUMN "streamerId"`);

      await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "gifts_orderId_key"`);
      await tx.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "gifts_roomId_orderId_key" ON "gifts"("roomId", "orderId")`
      );
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "gifts_roomId_dayKey_idx" ON "gifts"("roomId", "dayKey")`);
      await tx.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "gifts_roomId_receivedAt_idx" ON "gifts"("roomId", "receivedAt")`
      );
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "gifts_roomId_uniqueId_idx" ON "gifts"("roomId", "uniqueId")`);
      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "gifts_roomId_groupId_idx" ON "gifts"("roomId", "groupId")`);
      await tx.$executeRawUnsafe(
        `ALTER TABLE "gifts" ADD CONSTRAINT "gifts_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE`
      );

      await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "gift_edits_giftId_key"`);
      await tx.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "gift_edits_giftId_streamerId_key" ON "gift_edits"("giftId", "streamerId")`
      );
      await tx.$executeRawUnsafe(
        `ALTER TABLE "gift_edits" ADD CONSTRAINT "gift_edits_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer"("id") ON DELETE CASCADE ON UPDATE CASCADE`
      );

      await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Streamer_roomId_idx" ON "Streamer"("roomId")`);
      await tx.$executeRawUnsafe(
        `ALTER TABLE "Streamer" ADD CONSTRAINT "Streamer_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "TiktokRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE`
      );

      await tx.$executeRawUnsafe(`ALTER TABLE "Streamer" DROP COLUMN IF EXISTS "deviceId"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "Streamer" DROP COLUMN IF EXISTS "workerId"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "Streamer" DROP COLUMN IF EXISTS "proxyKey"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "Streamer" DROP COLUMN IF EXISTS "listenerStatus"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "Streamer" DROP COLUMN IF EXISTS "listenerMessage"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "Streamer" DROP COLUMN IF EXISTS "listenerUpdatedAt"`);
    },
    { timeout: 60_000, maxWait: 10_000 }
  );

  console.log("[migrate-shared-tiktok-room] 移行が完了しました。");
}

main()
  .catch((err) => {
    console.error("[migrate-shared-tiktok-room] 移行に失敗しました:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
