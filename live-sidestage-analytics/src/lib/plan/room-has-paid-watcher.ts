import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isEntitlementRowValid } from "./effective-entitlement";

// TiktokRoom自動削除(tiktok-room-cleanup.ts / tiktok-low-value-cleanup.ts)が
// 「課金ユーザーが監視しているRoomは削除しない」ガードに使う共通判定。
// get-user-plan.ts と同じ列構成でSubscriptionを読み、同じisEntitlementRowValidで
// 判定する。entitlementActive列だけのWHERE絞り込みは、フェーズA(バックフィル未実行)の
// 旧Stripe行を取りこぼし課金者を無課金誤判定するため使わない(get-user-plan.tsのコメント参照)。
//
// plan!=="FREE"も併せて見る(実装後レビューで指摘)。isEntitlementRowValidは
// 「有効なentitlement行か」だけを判定し、planの値までは見ないため、理論上
// plan=FREEのままentitlementActive:trueな行があると誤って課金ユーザー扱いしてしまう
// (get-user-plan.tsのhighestPlanはplanを見て判定するため、この関数だけの穴になる)。
//
// clientは呼び出し元が$transaction内のtxを渡せるようにするための引数(省略時はグローバル
// prisma)。tiktok-room-cleanup.tsのNOT_FOUND削除はtxトランザクション内で呼ぶため、
// 課金判定も同じtxのスナップショットで行い、削除確定までの間に外部で課金状態が
// 変わる余地を減らす。
export async function roomHasPaidWatcher(
  userIds: string[],
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  if (userIds.length === 0) return false;

  const subscriptions = await client.subscription.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, plan: true, entitlementActive: true, currentPeriodEnd: true, provider: true, status: true },
  });

  const now = new Date();
  return subscriptions.some((s) => s.plan !== "FREE" && isEntitlementRowValid(s, now));
}
