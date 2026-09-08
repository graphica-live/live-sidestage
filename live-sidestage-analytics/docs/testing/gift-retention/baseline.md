---
project: live-sidestage-analytics
feature: gift-retention
last_updated: 2026-09-06
last_risk: HIGH
last_reviewers: Qwen(独立) + fable-expert(Codex/Gemini quota枯渇のため代理)
---

# テストベースライン: gift-retention

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

`Gift`(生ギフト明細)の90日自動削除と、日次/全期間ロールアップ(`GiftDailyListenerStat` /
`GiftLifetimeStat`)への集約。エントリポイントは `gift-retention.ts`(Railway Cron)、
本体は `src/lib/gift-retention.ts`。watermark方式で「ロールアップ済みの上限dayKey」と
「削除済みの上限dayKey」を`AppSetting`へ永続化し、遅延補正・過少値上書き・未確定バトル・
未確定イベントの4種の欠損経路を防ぐ。読み出し側の統一アクセサ(`gift-analytics.ts`の
80日境界)はこのbaselineの対象外(Out of Scope参照)。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-GR-001 | dry-runはロールアップ・累計を作るがGiftを消さない | `runGiftRetentionCycle({dryRun:true})` | 正常 | 90日超/以内混在のGift、未確定イベント参加room1件 | `deletedRows`は候補数のみ、`protectedRows>=1`、実Gift行数は不変、日次/全期間ロールアップ値が削除前のGift集計と一致 | `npx dotenv -e .env.local.test -- vitest run src/lib/gift-retention.integration.test.ts` | PASS | |
| TC-GR-002 | 本実行は90日超のGiftだけ消し、未確定イベント参加roomは保護する | `runGiftRetentionCycle({dryRun:false})` | 正常 | TC-GR-001と同じフィクスチャ | 90日超の非保護Giftが0件になる/90日以内は残る/保護room(`finalizedAt IS NULL`のイベント参加room)は削除後も残る/ロールアップは長期保持 | 同上 | PASS | |
| TC-GR-003 | 削除後もロールアップ+生Giftのマージ結果が削除前と一致する | `aggregateGiftUsers`(80日境界の統一アクセサ) | 回帰 | TC-GR-002後の状態 | 90日超(ロールアップ)+90日以内(生Gift)の合計が削除前の生Gift全件集計と一致 | 同上 | PASS | |
| TC-GR-004 | 2回目の削除は冪等 | `runGiftRetentionCycle({dryRun:false})`再実行 | 境界 | TC-GR-002完了後の状態(削除対象0件) | `deletedRows===0`、watermarkは進んだまま不変 | 同上 | PASS | |
| TC-GR-005 | 削除済みの日はロールアップ再計算対象から外れる(過少値上書き防止、通常運用パス) | `runGiftRetentionCycle`の`from`計算(watermark非null分岐) | 境界/negative | watermarkが設定済み、直前に削除済みの日がある | 削除済みdayKeyの`GiftDailyListenerStat`は再upsertされず値が保持される | 同上 | PASS | |
| TC-GR-006 | watermarkが削除対象に追いついていなければ削除しない | `deletionSkipReason` | 境界/negative | `watermark===null` / `watermark<=cutoff` / `watermark>cutoff` | null=未設定メッセージ、以下=追いついていないメッセージ、超過=null(実行可) | `npm run test:unit -- src/lib/gift-retention.test.ts` | PASS | |
| TC-GR-007 | 未確定バトルは削除より先に確定処理する | `finalizePendingBattles` | 正常 | 削除対象期間内に未確定`tiktok_battles`行あり | `battle_histories`が作られてから削除が走る | `docs/testing/tiktok-battle-persistence`(確定ロジック自体)+本baselineは呼び出し順序のみ対象 | NOT RUN: 呼び出し順序を直接検証する自動テスト未作成(コードレビューで確認: `runGiftRetentionCycle`が`finalizePendingBattles`→削除の順で呼ぶことをソース確認済み) | 再現には`tiktok_battles`/`battle_histories`フィクスチャが要り、既存integrationテスト(TC-GR-001〜006)には含めていない |
| TC-GR-008 | 1周回の確定上限(500件)を超えて未確定バトルが残る間は削除を見送る | `countPendingBattles` + `runGiftRetentionCycle`の`skipReason`分岐 | 異常/negative | カットオフより前に未確定バトルが501件以上残る想定 | `deletion.skippedReason`に件数入りメッセージが入り`deletedRows===0` | 自動テストなし | NOT RUN: 501件のバトルフィクスチャ生成コストが高いため未実施。ロジックは`countPendingBattles`(LIMIT無しCOUNT)→`skipReason`分岐でコードレビュー済み | 500件ちょうど(境界)の検証も未実施 |
| TC-GR-009 | バックフィル/初回実行分岐でも削除済み日はロールアップ対象から除外する(過少値上書き防止) | `runGiftRetentionCycle`の`from`計算(`backfill\|\|watermarkBefore===null`分岐) | 境界/negative | watermarkが(手動復旧等で)nullへ戻された状態で、既に`deletedThrough`が設定済み | `from`が`earliestGiftDayKey()`ではなく`max(earliest, deletedThrough+1)`に切り上がり、削除済み日を再upsertしない | 自動テストなし | NOT RUN: 「watermarkだけ手動でnullに戻す」運用シナリオの再現integrationテスト未作成。修正はTC-GR-005と対称なロジック(`byDeleted`クランプを両分岐で共通化)であることをソース確認済み | 修正前は本分岐だけこのクランプが無かった(MEDIUM finding、修正済み) |
| TC-GR-010 | 実行後、未確定イベント保護で残った行数をログに出す(観測性) | `countProtectedRows` | 正常 | 削除対象期間に保護roomのGiftが残る | `deletion.protectedRows`が実カウントを返し、0超なら`console.warn`が出る | TC-GR-002のフィクスチャで暗黙にカバー(`protectedRows`はTC-GR-001のdry-run結果でのみ明示アサート、本実行側は今回追加) | PASS(結果に`protectedRows`が入ることを確認。warnログ自体は目視) | |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`(該当: `src/lib/gift-retention.test.ts`)
- `npx dotenv -e .env.local.test -- vitest run src/lib/gift-retention.integration.test.ts`(ローカルDB必須)
- `npx next build`(型・ルーティングのみ。`npm run build`は本番DBへ`db push`するため使わない)

## Out of Scope

- 読み出し側の統一アクセサ(`gift-analytics.ts`の80日境界、`agency/summary.ts`、`login-stats`のロールアップ切替)は別機能として扱う(既存テストの対象範囲であり本ロジック変更の対象外)
- TikTok ID自動合流・room削除時の`GiftDailyListenerStat`付け替えは別途実装済みだが本baselineでは未検証(今回の変更(HIGH#1/MEDIUM#3-6修正)はこの経路に触れていない)
- イベント側の`AGGREGATE_GRACE_MS`延長・`reopenAggregation()`締切ガード自体は `docs/testing/event-aggregation-deadline/baseline.md` を参照
