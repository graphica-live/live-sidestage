import { type PlanTier, meetsPlan } from "./types";

// 機能ごとの解放プランをここに1行足すだけで制御できる。
// 例: "event.customBranding": "PRO",
//
// "mobile.entitlementProbe" は実際の機能ではなく、requireFeature()の配管が
// 末端まで機能することを実証するためだけの入口(GET /api/mobile/entitlement/probe)。
// 将来ここへ実際のmobile限定機能を足すときは、この行の下に追加すればよい。
export const FEATURE_REQUIREMENTS = {
  "mobile.entitlementProbe": "PRO",
  "mobile.history.extendedRange": "PRO",
  "mobile.history.listenerFilter": "PRO",
} as const satisfies Record<string, PlanTier>;

// keyofで導出することで、未登録キーでの呼び出しはコンパイルエラーになる
// (Record<string, PlanTier>のままだとtypoが黙って「制限なし」に倒れるfail-openになるため)。
export type FeatureKey = keyof typeof FEATURE_REQUIREMENTS;

export function hasFeature(plan: PlanTier, feature: FeatureKey): boolean {
  // 型的にはFeatureKeyでコンパイル時に保証されるが、実行時にtypoや古いキーが
  // すり抜けて渡された場合はfail-closed(未登録キー=不許可)にする。
  // ここをfail-openにすると「typoしたfeature名は誰でも通る」という事故になる。
  const required = (FEATURE_REQUIREMENTS as Record<string, PlanTier | undefined>)[feature];
  if (required === undefined) return false;
  return meetsPlan(plan, required);
}
