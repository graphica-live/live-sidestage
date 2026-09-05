// ギフト明細(Gift)の90日retention。日次バッチ。専用エントリポイント。
// Railway Cron Job(1回実行して終了)として動かす想定で、tiktok-cleanup.ts と同じ構成。
//
// 1周回の中身:
//   1. Gift → GiftDailyListenerStat の日次ロールアップ(watermark方式)
//   2. GiftDailyListenerStat → GiftLifetimeStat の再集計 + watermark前進(同一トランザクション)
//   3. 削除対象期間に残った未確定バトルの確定(確定処理がGiftを読むので削除より先)
//   4. dayKey < 90日前 の Gift を5000件ずつ削除(未確定イベントの参加roomは保護)
//
// 設計上の不変条件は src/lib/gift-retention.ts の冒頭コメントを正本とする。
//
// **初回有効化手順**: watermark 未設定のまま dry-run で1回流すと、既存 Gift 全期間の
// バックフィルだけが走る(削除は件数カウントのみ)。watermark が「昨日」に到達したのを
// 確認してから GIFT_RETENTION_DRY_RUN=false にする。
//
// Webプロセスは Next.js が .env を自動ロードするが、このプロセスは経由しないため明示的に読む。
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runGiftRetentionCycle } from "@/lib/gift-retention";

// セッションスコープのadvisory lock。tiktok-cleanup.ts と同じ考え方(プロセス全体を通して
// ロックしたいのでトランザクションスコープにしない。unlock は best-effort)。
const GIFT_RETENTION_LOCK_KEY = 9_137_442_882n;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run gift-retention.ts`);
  return value;
}
requireEnv("DATABASE_URL");

// 明示的に"false"にしない限りdry-run(デフォルト安全側)。削除は不可逆。
const dryRun = process.env.GIFT_RETENTION_DRY_RUN !== "false";
// 全期間バックフィル。watermark 未設定なら指定しなくても同じ動きになる。
const backfill = process.env.GIFT_RETENTION_BACKFILL === "true" || process.argv.includes("--backfill");
const skipDelete = process.env.GIFT_RETENTION_SKIP_DELETE === "true";

async function main() {
  const [{ locked }] = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${GIFT_RETENTION_LOCK_KEY}::bigint) AS locked
  `;
  if (!locked) {
    console.warn("[gift-retention] 別プロセスが実行中のため今回はスキップ");
    return;
  }

  try {
    console.log(`[gift-retention] 開始 (dryRun=${dryRun} backfill=${backfill} skipDelete=${skipDelete})`);
    const result = await runGiftRetentionCycle({ dryRun, backfill, skipDelete });
    console.log("[gift-retention] 完了:", JSON.stringify(result));

    // cron停滞の可視化。watermark が「昨日」から遅れているとロールアップに穴が空き、
    // 読み出し側(gift-analytics.ts)がその期間をGiftへフォールバックし続ける。
    if (result.rollup.watermarkLagDays > 1) {
      console.warn(
        `[gift-retention] watermarkが${result.rollup.watermarkLagDays}日遅れていました ` +
          `(before=${result.rollup.watermarkBefore})`
      );
    }
    if (result.deletion.skippedReason) {
      console.warn(`[gift-retention] 削除をスキップ: ${result.deletion.skippedReason}`);
    }
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${GIFT_RETENTION_LOCK_KEY}::bigint)`.catch(() => {});
  }
}

main()
  .catch((err) => {
    console.error("[gift-retention] fatal error:", err);
    // railway.toml の ON_FAILURE 再試行に乗せるため非0で終了する。
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
