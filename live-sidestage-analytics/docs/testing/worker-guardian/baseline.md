---
project: live-sidestage-analytics
feature: worker-guardian
last_updated: 2026-09-05
last_risk: LOW
last_reviewers: Fable(TestCase Mode。Qwenはcanary検証で検出失敗のため未実施扱い、Codex/Geminiはquota切れのため代替)
---

# テストベースライン: worker-guardian

`worker-guardian.ts`（+ `src/lib/worker-guardian.ts` / `src/lib/worker-status.ts`）が担う worker1〜3 の死活監視・フェイルオーバー。30秒間隔（`GUARDIAN_POLL_INTERVAL_MS`）で probe し、連続不健全が閾値に達した worker を死亡と判定して担当 room を least-loaded worker へ再割当する。個別に接続できない blocked room の救済、kill switch による無効化、audit log 記録を含む。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-WG-001 | 死亡判定の閾値到達検知 | `updateHealthStreaks` | 正常 | worker が `CONSECUTIVE_BAD_POLLS_REQUIRED`(6)回連続 unhealthy | `deadWorkers` に含まれる | `npx vitest run src/lib/worker-guardian.test.ts` | PASS | サイクル全体(`migrateDeadWorker`の書き込み)を通す自動テストは無い（下記備考） |
| TC-WG-002 | 閾値未満では死亡確定しない | `updateHealthStreaks` | 境界 | 5回連続 unhealthy（閾値未満） | `deadWorkers` に含まれない | `npx vitest run src/lib/worker-guardian.test.ts` | PASS | |
| TC-WG-003 | WORKER_COUNT変更中は判定保留 | `classifyWorkerHealth` | 異常 | `urlCount !== workerCount` | `inconclusive` を返し移送計画を立てない | `npx vitest run src/lib/worker-guardian.test.ts` | PASS | |
| TC-WG-004 | probe失敗時はunhealthy | `classifyWorkerHealth` | 異常 | `probe.ok=false` またはタイムアウト、`lastReconcile` 欠落/エラー、staleな`lastReconcile` | いずれも `unhealthy` を返す | `npx vitest run src/lib/worker-guardian.test.ts` | PASS | |
| TC-WG-005 | 全room stuck判定 | `classifyWorkerHealth` | 境界 | 担当room全件の `watchdogTriggerCount >= WATCHDOG_TRIGGER_DEAD_THRESHOLD`(7) | `unhealthy`。一部roomのみ閾値未満なら`healthy` | `npx vitest run src/lib/worker-guardian.test.ts` | PASS | |
| TC-WG-006 | cooldown中は再migrationしない | `shouldSkipDueToCooldown` / `COOLDOWN_MS`(15分) | negative | 直前migrationからCOOLDOWN_MS未経過 | 新たなmigrationを実行しない | `npx vitest run src/lib/worker-guardian.test.ts` | PASS | cooldownは死活migrationのみに効く。blocked room再割当は別guard(TC-WG-011) |
| TC-WG-007 | least-loaded-firstで再割当 | `planReassignment` | 正常 | 複数roomを複数eligible workerへ再割当 | 各workerの負荷（room数）が最小のworkerへ、同数ならインデックス最小のworkerへ割当てる | `npx vitest run src/lib/worker-guardian.test.ts` | PASS | |
| TC-WG-008 | blocked roomの個別再割当（fromWorkerも試行済みに含む） | `decideBlockedRoomAction` / `runGuardianCycle` | 正常 | `consecutiveBlockedCount >= BLOCKED_REASSIGN_THRESHOLD`(5) | 未試行workerのうちleast-loadedへ`reassign`。移送元(fromWorker)自身も`triedWorkers`へ加わる | `npx vitest run src/lib/worker-guardian.test.ts src/lib/worker-guardian.cycle.test.ts` | PASS | |
| TC-WG-009 | migrateBlockedRoomの書き込み失敗時はstateを更新しない | `runGuardianCycle` | 異常 | advisory lock競合（`queryRaw`が`locked:false`）、またはWHERE不一致（`updateMany`が`count:0`） | いずれも`blockedRoomState`を更新しない（無限リトライの温床にしない） | `npx vitest run src/lib/worker-guardian.cycle.test.ts` | PASS | |
| TC-WG-010 | blocked room再割当のguard | `decideBlockedRoomAction` / `BLOCKED_REASSIGN_GUARD_MS`(3分) | negative | 直前の再割当からguard時間未経過 | `skip` | `npx vitest run src/lib/worker-guardian.test.ts` | PASS | |
| TC-WG-011 | 全worker試行済みはgive up、give up後は再試行しない | `decideBlockedRoomAction` / `runGuardianCycle` | 境界/negative | eligibleTargets全てがtriedWorkersに含まれる。give up成功時は`monitoringSuspended: true`で書き込み、失敗（WHERE不一致）時は`gaveUpAt`を立てない。`gaveUpAt`済みなら以後`updateMany`を一切呼ばない | `give_up`（成功時のみ`gaveUpAt`セット）。以後skipし続ける | `npx vitest run src/lib/worker-guardian.test.ts src/lib/worker-guardian.cycle.test.ts` | PASS | |
| TC-WG-012 | 完全復帰したroomのstateは削除される | `runGuardianCycle` | 回帰 | room が `connected` かつ `consecutiveBlockedCount=0` に復帰 | `blockedRoomState`から該当roomのエントリが削除され、次にblockされたとき新しいepisodeとして再スタートする | `npx vitest run src/lib/worker-guardian.cycle.test.ts` | PASS | |
| TC-WG-013 | blocked専用kill switch | `runGuardianCycle` | negative | `AppSetting` の `workerGuardianBlockedReassignDisabled` が `"true"` | 死活監視(worker死亡判定)とは独立して、blocked room の403処理だけ停止する（`updateMany`を呼ばない） | `npx vitest run src/lib/worker-guardian.cycle.test.ts` | PASS | |
| TC-WG-014 | main kill switchの純粋関数判定 | `isGuardianDisabled` | negative | 設定値 `"true"` / `"false"` / `null` / `""` | `"true"`のときのみ`true` | `npx vitest run src/lib/worker-guardian.test.ts` | PASS | サイクル全体（`isGuardianDisabled`がtrueのときprobe自体を呼ばないか）を通す自動テストは無い |
| TC-WG-015 | audit logの上限 | `appendAuditLog` / `AUDIT_LOG_MAX_ENTRIES`(50) | 回帰 | 50件を超える記録が発生 | 最新50件のみ保持する | 自動テストなし（`appendAuditLog`は非export） | NOT RUN: 自動テストなし | 本採用時はexport化するか、`runGuardianCycle`経由でAppSettingへ書かれるJSONの長さを検証する形にユニット化する |
| TC-WG-016 | worker死亡判定時の担当0件はmigrationしない | `runGuardianCycle` / `migrateDeadWorker` | 境界 | dead判定されたworkerの担当roomが0件 | migrationを実行せず`lastMigrationAt`を据え置く | 自動テストなし | NOT RUN: 自動テストなし（cycleテストにdead worker系のシナリオが無い） |
| TC-WG-017 | eligible workerが0件のときのdead worker migration | `migrateDeadWorker` | 異常 | 全workerがunhealthy/inconclusiveでeligible target無し | migrationを実行せず、`no_eligible_targets`としてaudit logに記録する | 自動テストなし | NOT RUN: 自動テストなし | |
| TC-WG-018 | worker probe収集 — URL解析の異常系 | `parseWorkerInternalUrls` | 異常 | `WORKER_INTERNAL_URLS`が壊れたJSON | 空配列を返し例外を投げない | `npx vitest run src/lib/worker-status.test.ts` | PASS | |
| TC-WG-019 | worker probe収集 — 1台失敗の独立性 | `probeWorkers` | 異常 | 3台中1台がHTTPエラー/例外/タイムアウト | 失敗した1台だけ`ok:false`になり、他2台の結果に影響しない | `npx vitest run src/lib/worker-status.test.ts` | PASS | |
| TC-WG-020 | worker probe収集 — レポートのissue分類 | `buildWorkerReport` | 境界 | `reconcile_stale`(`RECONCILE_STALE_MS`境界)、`assigned_not_running`、`room_out_of_range` 等のissueパターン | 各issueが対応する種別で報告される | `npx vitest run src/lib/worker-status.test.ts` | PASS | |
| TC-WG-021 | worker-status結合確認 | `fetchAssignedRooms` | 異常 | 実DB（Streamer/AgencyWatch/monitorUntilの組み合わせ） | `Streamer`が1人以上いる／`AgencyWatch`が1件以上ある／`monitorUntil`が未来、のいずれかを満たす部屋だけ拾う。いずれも満たさない部屋は拾わない | `npx dotenv -e .env.local.test -- npx vitest run src/lib/worker-status.integration.test.ts` | PASS | |

## Quality Gate

- `npm run typecheck`

## Out of Scope

- `worker.ts` 自体の TikTok 接続維持ロジック（`worker-shard` 機能の baseline 対象）
- Railway API を介した実際のスケール操作・redeploy 手順（運用手順であり、CLAUDE.md / auto-memory 側の管轄）
- `worker-guardian.ts`（エントリポイント自体）の `GET /healthz`（常に200）・`GET /status`（`lastCycleAt`/`streaks`/`lastMigrationAt`等を返す）・必須env検証は自動テスト未整備（`worker-shard`の`/healthz`/`/status`と合わせて本採用時に追加検討）
