// 既存 TiktokRoom のうち nickname 未設定のものを一括で埋める一回限りのスクリプト。
// nicknameは表示専用(admin/workers画面併記用)。一致判定には使わない。
//
// 取得は tiktok-existence.ts の existenceChecker を再利用する(署名不要の
// api-live/user/room/ を叩く fetchTiktokProfile 経由)。登録フロー(Streamer登録・
// AgencyWatch追加)と同じ MAX_CONCURRENCY=2 の枠を共有するため、直列 + 間隔を空けて進める
// (cleanup-nonexistent-streamers.ts と同じ考え方)。
//
// 使い方:
//   npx tsx scripts/backfill-room-nicknames.ts           # dry-run(一覧表示のみ)
//   npx tsx scripts/backfill-room-nicknames.ts --apply   # 実際に保存
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { existenceChecker } from "../src/lib/tiktok-existence";

const REQUEST_INTERVAL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  try {
    const rooms = await prisma.tiktokRoom.findMany({
      where: { nickname: null },
      select: { id: true, tiktokId: true },
      orderBy: { tiktokId: "asc" },
    });
    console.log(`nickname未設定のTiktokRoom ${rooms.length}件を照会します(1件あたり最短${REQUEST_INTERVAL_MS}ms間隔)。`);

    const resolved: Array<{ id: string; tiktokId: string; nickname: string }> = [];
    const notFound: string[] = [];
    const inconclusive: Array<{ tiktokId: string; verdict: string }> = [];

    for (const room of rooms) {
      const result = await existenceChecker.check(room.tiktokId);
      if (result.verdict === "EXISTS" && result.nickname) {
        resolved.push({ id: room.id, tiktokId: room.tiktokId, nickname: result.nickname });
      } else if (result.verdict === "MISSING") {
        notFound.push(room.tiktokId);
      } else {
        inconclusive.push({ tiktokId: room.tiktokId, verdict: result.verdict });
      }
      await sleep(REQUEST_INTERVAL_MS);
    }

    console.log(`\n=== 取得できたnickname: ${resolved.length}件 ===`);
    for (const r of resolved) {
      console.log(`  @${r.tiktokId} -> ${r.nickname}`);
    }
    if (notFound.length > 0) {
      console.log(`\n=== TikTok上に存在しない(スキップ): ${notFound.length}件 ===`);
      for (const id of notFound) console.log(`  @${id}`);
    }
    if (inconclusive.length > 0) {
      console.log(`\n=== 判定不能(レート制限/エラー、スキップ): ${inconclusive.length}件 ===`);
      for (const { tiktokId, verdict } of inconclusive) console.log(`  @${tiktokId} (${verdict})`);
    }

    if (!apply) {
      console.log("\ndry-runです。実際に保存するには --apply を付けて実行してください。");
      return;
    }

    console.log(`\n${resolved.length}件を保存します...`);
    let saved = 0;
    for (const r of resolved) {
      try {
        await prisma.tiktokRoom.update({ where: { id: r.id }, data: { nickname: r.nickname } });
        saved++;
      } catch (err) {
        console.error(`  @${r.tiktokId} の保存に失敗:`, err);
      }
    }
    console.log(`${saved}件保存しました。`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
