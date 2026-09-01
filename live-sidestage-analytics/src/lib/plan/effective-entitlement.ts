// entitlementActive判定を1箇所に集約する。missed webhook対策として、
// currentPeriodEndが猶予期間(3日、Stripeのpast_due維持ロジックと合わせた目安)を
// 超えて更新が来ない行は無効扱いに倒す。get-user-plan.ts・checkout routeの409判定・
// billing/page.tsxのisActivePaid・mobile account routeの削除ガードなど、
// entitlementの有無を判定する箇所は必ずここを経由する(判定基準が箇所ごとに
// ズレるのを防ぐため)。
const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

// フェーズA(拡張のみ)デプロイ直後、scripts/migrate-subscription-provider.tsの
// バックフィル実行前は既存Stripe行のprovider/entitlementActiveがまだnull/falseのまま。
// この窓の間、新コードがentitlementActiveだけを見ると既存有料ユーザーが一律FREE扱いに
// 落ち、二重課金防止ガードも素通りしてしまう(実装後レビューで判明)。
// providerが未設定(バックフィル未実行)の行は、旧status列でも判定するフォールバックを
// 用意する。バックフィル完了後はprovider/entitlementActiveが設定されるため、この分岐は
// 通らなくなる。フェーズB(旧列削除)で不要になったら削除すること。
const LEGACY_RETAINING_STATUSES = new Set(["active", "trialing", "past_due"]);

export function isEntitlementRowValid(
  row: {
    entitlementActive: boolean;
    currentPeriodEnd: Date | null;
    provider?: string | null;
    status?: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (row.entitlementActive) {
    if (row.currentPeriodEnd === null) return true;
    return row.currentPeriodEnd.getTime() > now.getTime() - GRACE_PERIOD_MS;
  }
  if (!row.provider && row.status) {
    return LEGACY_RETAINING_STATUSES.has(row.status);
  }
  return false;
}
