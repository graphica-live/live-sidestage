// リスナーコメント(ListenerComment)の30日retention。日次バッチ。専用エントリポイント。
// Railway Cron Job(1回実行して終了)として動かす想定で、gift-retention.ts と同じ構成。
//
// 1周回の中身: dayKey < 30日前 の ListenerComment を5000件ずつ削除するだけ。
// Giftと違いロールアップ・watermark・イベント保護は無い(理由は src/lib/listener-comment-retention.ts
// 冒頭コメント)。
//
// Webプロセスは Next.js が .env を自動ロードするが、このプロセスは経由しないため明示的に読む。
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runListenerCommentRetentionCycle } from "@/lib/listener-comment-retention";

// セッションスコープのadvisory lock。gift-retention.ts(9_137_442_882n)と衝突しない値。
const LISTENER_COMMENT_RETENTION_LOCK_KEY = 9_241_665_017n;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run listener-comment-retention.ts`);
  return value;
}
requireEnv("DATABASE_URL");

// 明示的に"false"にしない限りdry-run(デフォルト安全側)。削除は不可逆。
const dryRun = process.env.LISTENER_COMMENT_RETENTION_DRY_RUN !== "false";

async function main() {
  const [{ locked }] = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${LISTENER_COMMENT_RETENTION_LOCK_KEY}::bigint) AS locked
  `;
  if (!locked) {
    console.warn("[listener-comment-retention] 別プロセスが実行中のため今回はスキップ");
    return;
  }

  try {
    console.log(`[listener-comment-retention] 開始 (dryRun=${dryRun})`);
    const result = await runListenerCommentRetentionCycle({ dryRun });
    console.log("[listener-comment-retention] 完了:", JSON.stringify(result));
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LISTENER_COMMENT_RETENTION_LOCK_KEY}::bigint)`.catch(
      () => {}
    );
  }
}

main()
  .catch((err) => {
    console.error("[listener-comment-retention] fatal error:", err);
    // railway.toml の ON_FAILURE 再試行に乗せるため非0で終了する。
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
