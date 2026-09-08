---
project: live-sidestage-analytics
feature: gift-history-range
last_updated: 2026-09-06
last_risk: HIGH
last_reviewers: Qwen(独立、2回目でdiff込みcontextにより有効化) + Gemini 3.8 flash(OpenRouter経由、Codex/Gemini(agy)quota枯渇のため代理) — テストケース専用レビューは未実施(コスト・時間の都合でユーザー判断により省略)
---

# テストベースライン: gift-history-range

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

ギフト履歴(明細)ダッシュボード(`/components/analytics/AnalyticsView.tsx`)の期間選択を、
明細(`Gift`)の保持期間90日(`gift-retention-window.ts`のGIFT_RETENTION_DAYS、
`range-limits.ts`のGIFT_HISTORY_MAX_RANGE_DAYS)に合わせて制限する。ランキング/バトル履歴タブ
(ロールアップで長期保持、366日まで)は対象外で、ギフト履歴タブのみが対象。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-GHR-001 | ギフト履歴タブでは期間タブに「年」が出ない | `AnalyticsView`の期間タブ描画 | 正常 | `viewMode==="history"` | 表示される期間タブが日/週/月のみ(年が無い) | コードレビュー(条件分岐 `viewMode === "history" ? [...year無し] : [...year有り]` を確認) + Playwright実ブラウザ確認 | NOT RUN: Playwright確認はコスト・時間の都合でユーザー判断により今回省略。条件分岐は実装・typecheckで確認済み | ランキング/バトル履歴タブでは従来どおり年タブが出ることも同条件分岐で保証 |
| TC-GHR-002 | ランキング/バトル履歴タブから「年」選択のままギフト履歴タブへ切替えると自動的に「月」へ落ちる | `AnalyticsView`のviewMode切替useEffect | 境界/回帰 | ランキングタブでperiod="year"→ギフト履歴タブへ切替 | periodが"month"、currentDateが今日にリセットされる | コードレビュー(useEffect実装確認) | NOT RUN: 同上(Playwright省略)。ロジックはユニットテスト化していないReactコンポーネント内state遷移のため自動テスト対象外 | |
| TC-GHR-003 | ランキング/バトル履歴タブで90日超のカスタム期間を選んだ状態でギフト履歴タブへ切替えると「月」へ落ちる | 同上useEffectのcustom分岐 | 境界/回帰 | period="custom"、customEnd-customStart > 90日、の状態でhistoryタブへ切替 | periodが"month"へリセットされる(90日を超えるcustom範囲がギフト履歴へそのまま渡らない) | コードレビュー(review-auto/Gemini指摘を受けて追加した分岐を確認) | NOT RUN: 同上(Playwright省略) | 元々未対応だったギャップをreview-autoで検出し実装した経路。回帰しやすい箇所なので次回変更時は要注意 |
| TC-GHR-004 | ギフト履歴タブのカスタム期間ピッカーで開始日時が終了日時基準90日より前を選べない | `historyRangeMinStart`計算 + `<input type="datetime-local" min=...>` | 境界 | viewMode==="history"、pendingEndを固定 | `historyRangeMinStart` === `pendingEnd - GIFT_HISTORY_MAX_RANGE_DAYS日`(サーバー側`clampGiftHistoryDatetimeRange`と同じ式、-1補正なし) | コードレビュー + 手計算での式照合(サーバー実装`gift-history-range.ts`と1対1で比較確認済み) | PASS(式の一致を確認。review-autoでオフバイワン誤り(90→89日)を検出し修正済み) | 初回実装では日キー版の-1補正を誤って流用しており、review-autoで検出・修正した |
| TC-GHR-005 | ランキング/バトル履歴タブの期間選択(年タブ・366日カスタム)は本変更で変わらない | 同コンポーネントの他viewMode分岐 | 回帰 | viewMode==="ranking" または "battles" | 年タブが表示され、カスタム期間のmin制約が付かない(historyRangeMinStartがundefined) | コードレビュー(`viewMode !== "history"`ガードを確認) | PASS(既存の`npm run test:unit`93ファイル/1290件が全通過、typecheckも通過。この変更が他viewModeの分岐に影響しないことをソースレベルで確認) | |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`

## Out of Scope

- サーバー側API(`/api/analytics/gifts/history`)の90日クランプ自体(`clampGiftHistoryDatetimeRange`/`clampGiftHistoryDayRange`)は既存実装で変更していないため対象外。関連する既存integrationテストは `src/lib/gift-history.integration.test.ts`
- モバイル(Flutter)側の同等制限は `live-sidestage-mobile/docs/testing/gift-history/baseline.md` を参照
- Playwrightによる実ブラウザ確認は、今回コスト・時間の都合でユーザー判断により省略した(タブ削除・入力欄min属性という機械的に検証可能な変更であり、視覚デザイン変更を伴わないため実害は低いと判断)
