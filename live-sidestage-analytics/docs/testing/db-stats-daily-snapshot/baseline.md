---
project: live-sidestage-analytics
feature: db-stats-daily-snapshot
last_updated: 2026-09-06
last_risk: MEDIUM
last_reviewers: Qwen(Code Mode)
---

# テストベースライン: db-stats-daily-snapshot

毎朝JST6:00に全テーブル(`public`/`event`両スキーマ)の件数・サイズを`DbStatsSnapshot`へ記録し、
前日比+閾値%超の増分があればResend API経由でメール通知する機能。スケジューリング(いつ・何回
呼ぶか)は`event-worker-scheduler`baselineの対象で、ここでは集計・比較・通知の中身を対象とする。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-DBS-001 | 実テーブルの件数・サイズを記録する | `collectDbStats` | 正常 | 実DB(public/event) | 実在するテーブルごとに`rowCount`/`totalBytes`が非負値で記録される | `npm run test:integration`(`src/lib/db-stats/db-stats.integration.test.ts`) | PASS | 個々のテーブルの厳密な件数一致は他の並行integrationテストとの共有DB競合でflakyになるため検証しない(analytics-vitest-cross-file-interferenceと同型) |
| TC-DBS-002 | 自己参照を記録しない | `collectDbStats` / `EXCLUDED_TABLES` | 境界 | `DbStatsSnapshot`自身・`_prisma_migrations` | これらのテーブルは記録対象に含まれない | `npm run test:integration` | PASS | |
| TC-DBS-003 | 前回記録が無ければ異常なしで返す | `compareToPrevious` | 正常 | 対象runDateより前に記録が無い | `anomalies`が空配列 | `npm run test:integration` | PASS | |
| TC-DBS-004 | 前日比が閾値未満は異常扱いしない | `compareToPrevious` / `DB_STATS_ALERT_THRESHOLD_PERCENT`(既定25) | 境界 | 前回100件→今回120件(+20%) | 異常として検出されない | `npm run test:integration` | PASS | |
| TC-DBS-005 | 前日比が閾値以上は異常として検出する | `compareToPrevious` | 正常 | 前回120件→今回151件(+25.8%) | `anomalies`に該当テーブルが載り、`prevCount`/`todayCount`/`pctChange`が正しい | `npm run test:integration` | PASS | |
| TC-DBS-006 | 前回0件からの増加はpctChange=nullで異常検出する | `compareToPrevious` | 境界 | 前回0件→今回3件 | `anomalies`に該当テーブルが載り`pctChange`が`null` | `npm run test:integration` | PASS | ゼロ除算を避ける分岐 |
| TC-DBS-007 | 異常なしのときの件名・本文整形 | `formatDbStatsMessage` | 正常 | `anomalies`が空 | 件名に「異常なし」、本文に「異常な増分はありません。」を含み、テーブル数・件数合計・サイズ合計を出す | `npm run test:unit`(`src/lib/db-stats/message.test.ts`) | PASS | |
| TC-DBS-008 | 異常ありのときの件名・本文整形 | `formatDbStatsMessage` | 正常 | `anomalies`に1件(pctChange=0.26) | 件名に「異常増分1件」、本文に「⚠️」と`schema.table: prev → today (+26%)`形式の行を含む | `npm run test:unit` | PASS | |
| TC-DBS-009 | prevCount=0の増分は「新規データ」と表示する | `formatDbStatsMessage` | 境界 | `anomalies`に1件(pctChange=null) | 「新規データ」と表示される(`+Infinity%`等にならない) | `npm run test:unit` | PASS | |
| TC-DBS-010 | メール認証情報未設定時は送信をスキップする | `sendAlertEmail` | negative | `RESEND_API_KEY`/`DB_STATS_ALERT_EMAIL_FROM`/`DB_STATS_ALERT_EMAIL_TO`のいずれか未設定 | 例外を投げず、warnログを出して終了する(呼び出し元のtickを止めない) | 自動テストなし | NOT RUN: 自動テストなし(外部API呼び出しのため) | 2026-09-06、`DB_STATS_FORCE_RUN=1`でevent-worker.tsを実際に起動し、未設定時の警告ログ出力を実機確認済み(当時はLINE実装。メール実装への切替後の再確認は未実施) |
| TC-DBS-011 | メール送信失敗時もエラーを投げない | `sendAlertEmail` | negative | Resend APIが非2xxを返す、またはfetch自体が例外を投げる | 例外を投げず、errorログを出して終了する | 自動テストなし | NOT RUN: 自動テストなし(外部API呼び出しのため。実装はtry/catchで両経路とも握りつぶす) | |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`

## Out of Scope

- tickの起動タイミング・多重起動防止・JST6時ゲート・当日実行済み判定(`event-worker.ts`の`dbStatsTick`。`event-worker-scheduler`baseline対象)
- Resend APIの実送信結果そのもの(実APIキー・実送信先が無いと検証できないため、ユーザーがRailway側に認証情報を設定した後の本番疎通確認に委ねる)
