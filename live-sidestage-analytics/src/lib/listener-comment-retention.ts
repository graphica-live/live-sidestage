// リスナーコメント(ListenerComment)の30日retention本体。
//
// Gift(gift-retention.ts)と違い、ロールアップ・watermark・イベント保護は行わない。
// コメントは金銭的価値を持たず、AI傾向分析の集計要件も未確定のため、削除前に
// 集計テーブルへ落とす設計は今回採らない(要件が固まった時点で改めて検討する)。
// エントリポイントはリポジトリ直下の listener-comment-retention.ts(Railway Cron)。
// ここはテスト可能なロジック層。

import { prisma } from "@/lib/prisma";
import { dayKeyOf, shiftDayKey } from "@/lib/gift-retention-window";

const TAG = "[listener-comment-retention]";

/** 明細の保持日数。`dayKey < jstDateKey(-30)` の ListenerComment が削除対象。 */
export const LISTENER_COMMENT_RETENTION_DAYS = 30;

/** 1回の DELETE で消す行数。単一の巨大DELETEにするとロック時間とWALが膨らむ(Gift踏襲)。 */
const DEFAULT_DELETE_BATCH_SIZE = 5000;

export type ListenerCommentRetentionOptions = {
  /** true(既定)なら削除しない。件数だけ数えて報告する。 */
  dryRun?: boolean;
  now?: Date;
  deleteBatchSize?: number;
};

// dryRunで分岐するUnion型。実行時の deletedRows を「削除前の該当件数」と取り違えないよう、
// dry-run専用の deletableRows と実行時の deletedRows を同じフィールドに同居させない
// (外部レビューでの指摘: 旧実装は dryRun:false のとき deletableRows に deletedRows を
// そのまま入れており、フィールド名と実際の意味が食い違っていた)。
export type ListenerCommentRetentionResult =
  | { dryRun: true; cutoffDayKey: string; deletableRows: number }
  | { dryRun: false; cutoffDayKey: string; deletedRows: number };

async function countDeletable(cutoffDayKey: string): Promise<number> {
  return prisma.listenerComment.count({ where: { dayKey: { lt: cutoffDayKey } } });
}

async function deleteInBatches(cutoffDayKey: string, batchSize: number): Promise<number> {
  let total = 0;
  for (;;) {
    // ORDER BY id: 順序を固定しないと、削除ループ中に届く新規insert(dayKeyが古い値の
    // 遅延書き込み等)がサブクエリへ紛れ込み、同じ古い行を選び続けて特定行が
    // いつまでも消えない/ループが長引く恐れがある(外部レビュー指摘)。
    const affected = await prisma.$executeRawUnsafe(
      `DELETE FROM public."listener_comments"
        WHERE id IN (
          SELECT id FROM public."listener_comments"
           WHERE "dayKey" < $1
           ORDER BY id
           LIMIT $2
        )`,
      cutoffDayKey,
      batchSize
    );
    total += affected;
    if (affected < batchSize) break;
  }
  return total;
}

export async function runListenerCommentRetentionCycle(
  options: ListenerCommentRetentionOptions = {}
): Promise<ListenerCommentRetentionResult> {
  const { dryRun = true, now = new Date(), deleteBatchSize = DEFAULT_DELETE_BATCH_SIZE } = options;

  const cutoffDayKey = shiftDayKey(dayKeyOf(now), -LISTENER_COMMENT_RETENTION_DAYS);

  if (dryRun) {
    const deletableRows = await countDeletable(cutoffDayKey);
    console.log(`${TAG} dry-run: cutoff=${cutoffDayKey} deletable=${deletableRows}`);
    return { dryRun: true, cutoffDayKey, deletableRows };
  }

  const deletedRows = await deleteInBatches(cutoffDayKey, deleteBatchSize);
  console.log(`${TAG} 削除完了: cutoff=${cutoffDayKey} deleted=${deletedRows}`);
  return { dryRun: false, cutoffDayKey, deletedRows };
}
