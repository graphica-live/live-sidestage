// アンバサダー招待URL(AmbassadorInvite)の30日retention本体。
//
// listener-comment-retention.tsと同じ考え方(ロールアップ・watermark・保護は無い)。
// expiresAt(発行から30日固定)を過ぎた行を削除するだけ。使用済み・未使用を問わない
// (Ambassador本体は別テーブルに残るため、招待記録自体は消して問題ない)。
// エントリポイントはリポジトリ直下の ambassador-invite-retention.ts(Railway Cron)。
// ここはテスト可能なロジック層。

import { prisma } from "@/lib/prisma";

const TAG = "[ambassador-invite-retention]";

/** 1回の DELETE で消す行数。単一の巨大DELETEにするとロック時間とWALが膨らむ(Gift踏襲)。 */
const DEFAULT_DELETE_BATCH_SIZE = 5000;

export type AmbassadorInviteRetentionOptions = {
  /** true(既定)なら削除しない。件数だけ数えて報告する。 */
  dryRun?: boolean;
  now?: Date;
  deleteBatchSize?: number;
};

export type AmbassadorInviteRetentionResult =
  | { dryRun: true; deletableRows: number }
  | { dryRun: false; deletedRows: number };

async function countDeletable(now: Date): Promise<number> {
  return prisma.ambassadorInvite.count({ where: { expiresAt: { lt: now } } });
}

async function deleteInBatches(now: Date, batchSize: number): Promise<number> {
  let total = 0;
  for (;;) {
    // ORDER BY id: listener-comment-retention.tsと同じ理由(削除ループ中に届く
    // 遅延書き込みが同じ古い行を選び続けないようにする)。
    const affected = await prisma.$executeRawUnsafe(
      `DELETE FROM public."AmbassadorInvite"
        WHERE id IN (
          SELECT id FROM public."AmbassadorInvite"
           WHERE "expiresAt" < $1
           ORDER BY id
           LIMIT $2
        )`,
      now,
      batchSize
    );
    total += affected;
    if (affected < batchSize) break;
  }
  return total;
}

export async function runAmbassadorInviteRetentionCycle(
  options: AmbassadorInviteRetentionOptions = {}
): Promise<AmbassadorInviteRetentionResult> {
  const { dryRun = true, now = new Date(), deleteBatchSize = DEFAULT_DELETE_BATCH_SIZE } = options;

  if (dryRun) {
    const deletableRows = await countDeletable(now);
    console.log(`${TAG} dry-run: deletable=${deletableRows}`);
    return { dryRun: true, deletableRows };
  }

  const deletedRows = await deleteInBatches(now, deleteBatchSize);
  console.log(`${TAG} 削除完了: deleted=${deletedRows}`);
  return { dryRun: false, deletedRows };
}
