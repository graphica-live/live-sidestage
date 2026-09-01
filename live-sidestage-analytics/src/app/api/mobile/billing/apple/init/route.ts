import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveActiveMobileUser } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { isEntitlementRowValid } from "@/lib/plan/effective-entitlement";

export const dynamic = "force-dynamic";

const PENDING_INTENT_TTL_MS = 60 * 60 * 1000; // 1時間

export async function POST(req: NextRequest) {
  const auth = await resolveActiveMobileUser(req);
  if (!auth) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  // entitlementActive:trueだけに絞ると、バックフィル未実行の旧Stripe行(provider未設定)を
  // isEntitlementRowValidのレガシーフォールバックで拾えない(checkout routeと同じ理由、
  // 実装後レビュー指摘)ため、userId一致の全行を読んでからフィルタする。
  const activeRows = await prisma.subscription.findMany({
    where: { userId: auth.userId },
    select: { entitlementActive: true, currentPeriodEnd: true, provider: true, status: true },
  });
  if (activeRows.some((r) => isEntitlementRowValid(r))) {
    return NextResponse.json(
      { error: "既に有効なプランをご利用中です" },
      { status: 409 },
    );
  }

  const appAccountToken = randomUUID();
  await prisma.pendingPurchaseIntent.create({
    data: {
      userId: auth.userId,
      provider: "APPLE",
      token: appAccountToken,
      expiresAt: new Date(Date.now() + PENDING_INTENT_TTL_MS),
    },
  });

  return NextResponse.json({ appAccountToken });
}
