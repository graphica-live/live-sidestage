// 開発確認専用: 事後通知バナーのテストデータを1件挿入する。
// 使い方: npx dotenv -e .env.local.test -- tsx scripts/seed-recent-merge-local.ts [merged|blocked]
import { prisma } from "../src/lib/prisma";

async function main() {
  const kind = process.argv[2] === "blocked" ? "blocked" : "merged";
  const streamerId = process.argv[3] || "cmtl1m1870003lpay123aedry";

  await prisma.tiktokIdMergeLog.create({
    data: {
      streamerId,
      userId: "6812345678901234567",
      outcome: kind === "merged" ? "MERGED" : "BLOCKED_OLD_HANDLE_ALIVE",
      oldTiktokId: "alice",
      newTiktokId: "alice2",
      stats: kind === "merged" ? { giftsMoved: 120 } : undefined,
    },
  });

  console.log(`seeded: outcome=${kind === "merged" ? "MERGED" : "BLOCKED_OLD_HANDLE_ALIVE"} streamerId=${streamerId}`);
  await prisma.$disconnect();
}

main();
