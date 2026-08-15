// WORKER_COUNTを変更した際に、既存配信者のworkerId割当を再計算するための手動メンテナンススクリプト。
// Worker数を変えると担当替えで一斉再接続(reconnect storm)が起きるため、
// トラフィックが少ない時間帯に手動実行する運用を前提にしている(自動化はしない)。
//
// 使い方:
//   node scripts/rebalance-workers.js           # dry-run(変更内容の表示のみ)
//   node scripts/rebalance-workers.js --apply   # 実際にDBを更新
//
// WORKER_COUNT は新しい(適用したい)Worker数を環境変数で渡す。
require("dotenv/config");
const { PrismaClient } = require("@prisma/client");

// src/lib/tiktok-listener.ts の hashToIndex と同じアルゴリズム。
// 標準スクリプトとして独立実行できるようにするため、あえて重複させている
// (tsx等の追加ツールなしでnodeだけで動かせるようにするトレードオフ)。
function hashToIndex(value, mod) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash % mod;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const workerCount = Number(process.env.WORKER_COUNT);
  if (!Number.isInteger(workerCount) || workerCount < 1) {
    console.error("WORKER_COUNT must be set to a positive integer (the new target worker count)");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    // 登録者(Streamer)が1人もいない部屋は接続対象外なので除外する。
    const rooms = await prisma.tiktokRoom.findMany({
      where: { streamers: { some: {} } },
      select: { id: true, tiktokId: true, workerId: true },
    });

    const changes = rooms
      .map((r) => ({ ...r, newWorkerId: hashToIndex(r.id, workerCount) }))
      .filter((r) => r.workerId !== r.newWorkerId);

    console.log(`WORKER_COUNT=${workerCount} — ${rooms.length}部屋中${changes.length}部屋の担当が変わります`);
    for (const c of changes) {
      console.log(`  @${c.tiktokId}: worker ${c.workerId ?? "(未割当)"} -> ${c.newWorkerId}`);
    }

    if (!apply) {
      console.log("\ndry-runです。実際に反映するには --apply を付けて実行してください。");
      return;
    }

    for (const c of changes) {
      await prisma.tiktokRoom.update({
        where: { id: c.id },
        data: { workerId: c.newWorkerId },
      });
    }
    console.log(`\n${changes.length}件を更新しました。各Workerプロセスの再起動(またはensure loopの次周回)で反映されます。`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
