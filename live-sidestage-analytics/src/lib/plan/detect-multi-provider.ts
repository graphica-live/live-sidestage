import { prisma } from "@/lib/prisma";

// 同一userIdで複数providerが同時にentitlementActive:trueな状態を事後検知する。
// 実際の防止策はcheckout route側とmobile billing initルート側のcross-provider 409ガードが
// 担う。この関数はガードをすり抜けたケース(モバイルストア側の解約猶予中にWebで別途契約、等)
// を事後検知するための保険で、専用テーブルは持たずログ出力のみ行う。
export async function detectMultiProvider(userId: string): Promise<void> {
  const rows = await prisma.subscription.findMany({
    where: { userId, entitlementActive: true },
    select: { provider: true },
  });
  const providers = new Set(rows.map((r) => r.provider).filter((p): p is NonNullable<typeof p> => p !== null));
  if (providers.size > 1) {
    console.warn(
      `[detect-multi-provider] userId=${userId} has ${providers.size} concurrent active providers: ${[...providers].join(", ")}`,
    );
  }
}
