---
project: live-sidestage-analytics
feature: event-worker-scheduler
last_updated: 2026-09-05
last_risk: LOW
last_reviewers: Fable(TestCase Mode。Qwenはcanary検証で検出失敗のため未実施扱い、Codex/Geminiはquota切れのため代替)
---

# テストベースライン: event-worker-scheduler

`event-worker.ts` が担うイベント集計プロセスの実行制御。tick の起動・多重起動防止・周期・シャットダウンを対象とする。**集計ロジック自体（`aggregateDueEvents`・advisory lock・`finalizedAt`判定）は `src/event/aggregate.ts` が担い、この機能の対象外**（下記 Out of Scope）。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-EWS-001 | 定期実行 | `scheduleTick` / `INTERVAL_MS`(10秒) | 正常 | プロセス起動中 | 約10秒間隔で tick が実行される | 自動テストなし | NOT RUN: 自動テストなし | |
| TC-EWS-002 | 多重起動防止 | `tick` / `inFlight` | negative | 前回 tick(`aggregateDueEvents`呼び出し中)が未完了 | 次の周期発火時に新規 tick を開始しない（advisory lock競合による無駄な往復を避けるためのguard） | 自動テストなし | NOT RUN: 自動テストなし | |
| TC-EWS-003 | 集計に時間がかかった場合のSLO警告 | `tick` / `SLO_WARN_MS` | 境界 | `aggregateDueEvents`の`totalMs`が`SLO_WARN_MS`を超過、かつ`processed>0` | warnログを出す（`processed=0`なら出さない） | 自動テストなし | NOT RUN: 自動テストなし | |
| TC-EWS-004 | 自動終了tickの多重起動防止 | `autoFinishTick` / `autoFinishInFlight` | negative | 前回`autoFinishOverdueEvents`呼び出しが未完了 | 次の周期発火時に新規実行しない | 自動テストなし | NOT RUN: 自動テストなし | `autoFinishOverdueEvents`自体の判定（endAt超過からの猶予期間等）は`src/event/auto-finish.integration.test.ts`が対象 |
| TC-EWS-005 | shutdown中は新規tickを開始しない | `shutdown()` / `stopping` | negative | `stopping=true` | `tick`/`autoFinishTick`/`avatarSnapshotTick`/`hostIdTick`/`renewTick`/`streamerHostIdTick` いずれも新規実行しない | 自動テストなし | NOT RUN: 自動テストなし | 各tickは独立timer・独立inFlightで管理。shutdownは`currentTick`/`mergeTickCurrent`の完了のみ待ち、他のtickは実行中でも待たずに`prisma.$disconnect()`へ進む（SIGTERM時に稀にDBエラーログが出うるが、各tickはcatch済みでデータ破壊はしない） |

## Quality Gate

- `npm run typecheck`

## Out of Scope

- `aggregateDueEvents`の集計計算そのもの、`pg_try_advisory_xact_lock`によるロック意味論、`Event.finalizedAt`の判定・リセット（`src/event/aggregate.ts`。既存自動テスト: `src/event/aggregate.integration.test.ts`）
- `autoFinishOverdueEvents`の終了判定ロジック自体（`src/event/auto-finish.ts`。既存自動テスト: `src/event/auto-finish.integration.test.ts`）
- `mergeTick`/`avatarSnapshotTick`/`hostIdTick`/`renewTick`/`streamerHostIdTick`各々が呼ぶ集計・同期ロジックの中身（event機能側のbaseline対象）
