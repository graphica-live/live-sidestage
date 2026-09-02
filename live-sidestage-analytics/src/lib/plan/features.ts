import { type PlanTier, meetsPlan } from "./types";
import type { BetaArea } from "./beta-settings";

interface FeaturePolicy {
  requiredPlan: PlanTier;
  /**
   * このβ領域が有効な間は、requiredPlanを満たさないユーザーにも一時的にこの機能だけを解放する。
   * プラン自体は書き換えない(betaAccessをULTRA昇格に使っていた旧設計の反省点)。
   */
  betaArea?: BetaArea;
}

// 機能ごとの解放プラン・対応するβ領域をここに1行足すだけで制御できる。
// 例: "event.customBranding": { requiredPlan: "PRO", betaArea: "events" },
//
// "mobile.entitlementProbe" は実際の機能ではなく、requireFeature()の配管が
// 末端まで機能することを実証するためだけの入口(GET /api/mobile/entitlement/probe)。
// 将来ここへ実際のmobile限定機能を足すときは、この行の下に追加すればよい。
export const FEATURE_POLICIES = {
  "mobile.entitlementProbe": { requiredPlan: "PRO" },
  "mobile.history.extendedRange": { requiredPlan: "PRO", betaArea: "analytics" },
  "mobile.history.listenerFilter": { requiredPlan: "PRO", betaArea: "analytics" },
} as const satisfies Record<string, FeaturePolicy>;

// keyofで導出することで、未登録キーでの呼び出しはコンパイルエラーになる
// (Record<string, FeaturePolicy>のままだとtypoが黙って「制限なし」に倒れるfail-openになるため)。
export type FeatureKey = keyof typeof FEATURE_POLICIES;

export function getFeaturePolicy(feature: FeatureKey): FeaturePolicy {
  return FEATURE_POLICIES[feature];
}

/** プランのみでの判定(β考慮なし)。表示用途・回帰テスト用。 */
export function hasFeature(plan: PlanTier, feature: FeatureKey): boolean {
  // 型的にはFeatureKeyでコンパイル時に保証されるが、実行時にtypoや古いキーが
  // すり抜けて渡された場合はfail-closed(未登録キー=不許可)にする。
  // ここをfail-openにすると「typoしたfeature名は誰でも通る」という事故になる。
  const policy = (FEATURE_POLICIES as Record<string, FeaturePolicy | undefined>)[feature];
  if (policy === undefined) return false;
  return meetsPlan(plan, policy.requiredPlan);
}

/**
 * プラン + 対応領域のβ状態から判定する同期関数。
 * `/api/mobile/me`のようにfeature一覧をまとめて計算する箇所で使う
 * (DBアクセスを含まないため、機能数ぶんawaitを重ねる必要がない)。
 */
export function hasFeatureAccessSync(
  plan: PlanTier,
  feature: FeatureKey,
  betaStatuses: Partial<Record<BetaArea, boolean>>,
): boolean {
  const policy = (FEATURE_POLICIES as Record<string, FeaturePolicy | undefined>)[feature];
  if (policy === undefined) return false;
  if (meetsPlan(plan, policy.requiredPlan)) return true;
  return policy.betaArea !== undefined && betaStatuses[policy.betaArea] === true;
}
