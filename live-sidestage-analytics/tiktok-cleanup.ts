// TikTok上に存在しなくなった(削除/改名された)可能性があるRoomの監視を一時停止する
// 日次バッチ。専用エントリポイント。Railway Cron Job(1回実行して終了)として動かす想定。
// データは削除しない(TiktokRoom.monitoringSuspendedを立てるだけ)。
//
// worker-guardian.ts等の常駐サービスと違い、判定周期は「日」単位で十分なため常駐させない。
// Railwayのcronが多重起動防止(前回実行がActive中ならスキップ)を担保する一次防御、
// advisory lockは手動再実行等との重複に備える二次防御という位置づけ。
//
// Webプロセスは Next.js が .env を自動ロードするが、このプロセスは経由しないため明示的に読む。
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runCleanupCycle } from "@/lib/tiktok-room-cleanup";
import { runLowValueCleanupCycle } from "@/lib/tiktok-low-value-cleanup";
import { pruneOldLikeTallies } from "@/lib/overlay/like.server";

// セッションスコープのadvisory lock(pg_try_advisory_xact_lockではない)。トランザクションでは
// なくプロセス全体を通してロックしたいため。Prismaのコネクションプールと相性が悪く、
// finallyのunlockが別コネクションで実行され得る(その場合falseが返るだけで実害はない)ため、
// unlock自体はbest-effortとして扱いエラーにしない。ロックはプロセス終了($disconnect)まで
// 保持される前提で相互排除が成立する(このプロセスは短命で成立する)。
const CLEANUP_LOCK_KEY = 9_137_442_881n;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run tiktok-cleanup.ts`);
  return value;
}
requireEnv("DATABASE_URL");

// 明示的に"false"にしない限りdry-run(デフォルト安全側)。
const dryRun = process.env.TIKTOK_CLEANUP_DRY_RUN !== "false";
// 低価値Room監視停止は判定基準が別物(データ削除はなく監視停止/復活のみ)なので
// dry-runフラグも分離する。
const lowValueDryRun = process.env.TIKTOK_LOW_VALUE_DRY_RUN !== "false";
// LikeTally pruningは実データ削除(誰にも読まれず無期限蓄積するのを防ぐ、7日超過分)。
// 他の2つと判定基準・削除対象が全く別物なのでdry-runフラグも独立させる。
const likeTallyPruneDryRun = process.env.LIKE_TALLY_PRUNE_DRY_RUN !== "false";

async function main() {
  const [{ locked }] = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${CLEANUP_LOCK_KEY}::bigint) AS locked
  `;
  if (!locked) {
    console.warn("[tiktok-cleanup] 別プロセスが実行中のため今回はスキップ");
    return;
  }

  try {
    console.log(`[tiktok-cleanup] 開始 (dryRun=${dryRun})`);
    const result = await runCleanupCycle({ dryRun });
    console.log("[tiktok-cleanup] 完了:", JSON.stringify(result));

    console.log(`[tiktok-low-value-cleanup] 開始 (dryRun=${lowValueDryRun})`);
    const lowValueResult = await runLowValueCleanupCycle({ dryRun: lowValueDryRun });
    console.log("[tiktok-low-value-cleanup] 完了:", JSON.stringify(lowValueResult));

    console.log(`[like-tally-prune] 開始 (dryRun=${likeTallyPruneDryRun})`);
    const prunedCount = await pruneOldLikeTallies({ olderThanDays: 7, dryRun: likeTallyPruneDryRun });
    console.log(`[like-tally-prune] 完了: ${prunedCount}件${likeTallyPruneDryRun ? "(対象、未削除)" : "削除"}`);
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${CLEANUP_LOCK_KEY}::bigint)`.catch(() => {});
  }
}

main()
  .catch((err) => {
    console.error("[tiktok-cleanup] fatal error:", err);
    // ロック未取得時のスキップとは違い、実行中の例外は railway.toml の ON_FAILURE 再試行に
    // 乗せたいので非0で終了する。
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
