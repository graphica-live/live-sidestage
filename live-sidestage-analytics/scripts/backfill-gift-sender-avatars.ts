// アイコン恒久化(avatar-storage.ts)デプロイ後、直近のGiftデータだけを対象に先回りで
// キャッシュを埋めるバックフィル。
//
// **古い行のprofileImageUrlは高確率で既に失効している。** TikTokの署名付きURLは
// 数十時間~で失効するため、対象は直近48〜72時間程度のGiftに限定する(それより古い行を
// 対象に含めても、ダウンロードの大半が失敗するだけで無駄なfetchが増える)。
//
// 恒久化は「これから受信する分」に効く施策であり、このスクリプトは移行期間の救済でしかない。
import { prisma } from "../src/lib/prisma";
import { ensureAvatarCached } from "../src/lib/avatar-storage";

const TAG = "[backfill-gift-sender-avatars]";
const LOOKBACK_HOURS = 60;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const profiles = await prisma.gift.findMany({
    where: { receivedAt: { gte: since }, profileImageUrl: { not: null } },
    orderBy: { receivedAt: "desc" },
    distinct: ["uniqueId"],
    select: { uniqueId: true, profileImageUrl: true },
  });

  console.log(`${TAG} 直近${LOOKBACK_HOURS}時間のdistinct送信者: ${profiles.length}件`);

  if (dryRun) {
    console.log(`${TAG} [ドライラン] ここで終了(実際のダウンロード・アップロードは行わない)`);
    return;
  }

  let done = 0;
  for (const p of profiles) {
    await ensureAvatarCached("gift_sender", p.uniqueId, p.profileImageUrl);
    done++;
    if (done % 50 === 0) console.log(`${TAG} 進捗 ${done}/${profiles.length}`);
  }

  console.log(`${TAG} 完了: ${done}件処理`);
}

main()
  .catch((err) => {
    console.error(`${TAG} 失敗`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
