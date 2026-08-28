import { type PlanTier, meetsPlan } from "./types";

// 機能ごとの解放プランをここに1行足すだけで制御できる。**今は空 = 全機能FREEで開放**。
// 例: "event.customBranding": "PRO",
export const FEATURE_REQUIREMENTS = {} as const satisfies Record<string, PlanTier>;

// keyofで導出することで、未登録キーでの呼び出しはコンパイルエラーになる
// (Record<string, PlanTier>のままだとtypoが黙って「制限なし」に倒れるfail-openになるため)。
export type FeatureKey = keyof typeof FEATURE_REQUIREMENTS;

export function hasFeature(plan: PlanTier, feature: FeatureKey): boolean {
  return meetsPlan(plan, FEATURE_REQUIREMENTS[feature]);
}
