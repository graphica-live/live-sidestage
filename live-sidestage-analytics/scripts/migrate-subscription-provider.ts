// Subscription を「1ユーザー1行・Stripe専用」から「provider別・複数行保持型」へ移行する
// バックフィルスクリプト。schema.prisma のフェーズA(加算のみの nullable 列追加、db push で
// 適用済みであること前提)の後に実行する。
//
// **db push の CMD には組み込まない。** migrate-match-session.ts と違い、対象列は
// フェーズAの時点で全てnullableなので db push 自体は列追加だけで完結する。このスクリプトは
// 既存データへのバックフィル専用で、ローカル→Railway one-off run で手動実行する
// (実行タイミングは「実装順序」節: フェーズAデプロイ直後に1回目、新コードデプロイ完了後に
// 取りこぼし回収として2回目)。
//
// 冪等: provider が既に設定済みの行はスキップする。何度実行しても安全。
import { prisma } from "../src/lib/prisma";

const TAG = "[migrate-subscription-provider]";
const MIGRATION_LOCK_KEY = 728_311_005n;

const RETAINING_STATUSES = new Set(["active", "trialing", "past_due"]);

async function main() {
  console.log(`${TAG} 開始します。`);

  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY}::bigint)`;

      // 1. stripeCustomerId を持つ行を StripeCustomerLink へコピーする(冪等: 既存なら skip)。
      await tx.$executeRawUnsafe(`
        INSERT INTO public."StripeCustomerLink" ("userId", "stripeCustomerId", "createdAt")
        SELECT s."userId", s."stripeCustomerId", NOW()
        FROM public."Subscription" s
        WHERE s."stripeCustomerId" IS NOT NULL
        ON CONFLICT ("userId") DO NOTHING
      `);

      // 2. stripeSubscriptionId を持つ行に provider/providerSubscriptionId/entitlementActive を書く。
      const targets = await tx.subscription.findMany({
        where: { provider: null, stripeSubscriptionId: { not: null } },
        select: { id: true, stripeSubscriptionId: true, status: true },
      });

      for (const row of targets) {
        await tx.subscription.update({
          where: { id: row.id },
          data: {
            provider: "STRIPE",
            providerSubscriptionId: row.stripeSubscriptionId,
            rawStatus: row.status,
            entitlementActive: row.status ? RETAINING_STATUSES.has(row.status) : false,
          },
        });
      }

      console.log(`${TAG} ${targets.length}件のSubscription行をバックフィルしました。`);
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  console.log(`${TAG} 完了しました。`);
}

main()
  .catch((err) => {
    console.error(`${TAG} 失敗しました:`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
