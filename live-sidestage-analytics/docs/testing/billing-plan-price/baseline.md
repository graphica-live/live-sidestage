---
last_updated: 2026-09-08
last_risk: LOW
last_reviewers: DeepSeek (review-auto Code Mode, TestCase Mode)
---

# billing-plan-price（プラン価格表示・購入可否）

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

`/billing` の各プランカードにおける月額表示と、Stripe Price ID 未設定時の購入可否制御。

## Out of Scope

- Stripe Checkout / Portal 遷移そのもの（`src/app/api/billing/checkout/route.ts` 等）は別機能
- モバイルストア価格（`mobile-store-products.ts`）は別系統

## テストケース

| ID | 前提条件 | 操作 | 期待結果 | 実行方法 | 結果 |
| --- | --- | --- | --- | --- | --- |
| TC-BP-000 | - | `WEB_MONTHLY_PRICE_JPY` を参照 | `PRO` は `980`、`ULTRA` は `undefined`（価格未定） | `npx vitest run src/lib/plan/price-map.test.ts` | PASS |
| TC-BP-001 | `STRIPE_PRICE_PRO` 未設定 | `priceIdForPlan("PRO")` を呼ぶ | `undefined` を返し `isPlanPurchasable("PRO")` は `false` | `npx vitest run src/lib/plan/price-map.test.ts` | PASS |
| TC-BP-002 | `STRIPE_PRICE_PRO`/`STRIPE_PRICE_ULTRA` 設定済み | `priceIdForPlan` / `planForPriceId` を相互変換 | Price ID とプランが正しく対応する | `npx vitest run src/lib/plan/price-map.test.ts` | PASS |
| TC-BP-003 | 未知の Price ID | `planForPriceId("price_unknown")` | `undefined` を返す | `npx vitest run src/lib/plan/price-map.test.ts` | PASS |
| TC-BP-004 | `/billing` 表示、FREEプラン | プラン一覧を見る | FREEカードに価格行は表示されない | Playwright（`/billing` スクリーンショット） | PASS |
| TC-BP-005 | `/billing` 表示、PROプラン | プラン一覧を見る | `¥980 /月` が表示される | Playwright（`/billing` スクリーンショット） | PASS |
| TC-BP-006 | `/billing` 表示、ULTRAプラン（価格未定） | プラン一覧を見る | 金額の代わりに「価格未定」と表示される | Playwright（`/billing` スクリーンショット） | PASS |
| TC-BP-007 | ULTRA の Price ID 未設定（購入不可） | ULTRAカードのアクション部を見る | 「準備中」ボタン（disabled）が表示される。価格未定表示とは独立に判定される | Playwright（`/billing` スクリーンショット） | PASS |
