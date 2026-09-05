---
project: live-sidestage-analytics
feature: worker-shard
last_updated: 2026-09-05
last_risk: LOW
last_reviewers: Fable(TestCase Mode。Qwenはcanary検証で検出失敗のため未実施扱い、Codex/Geminiはquota切れのため代替)
---

# テストベースライン: worker-shard

`worker.ts` が担う TikTok Webcast 接続 shard プロセス(worker1〜3)の運用面。room 単位のハッシュ分散、`GET /healthz`・`GET /status`、reconcile ループ、スキーマ未反映時の待ち復帰を対象とする。TikTok 接続自体の再接続・切断・イベント処理は `tiktok-listener` 機能側の baseline で扱う。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-WS-001 | 未割当roomのworker決定は決定的で、割当後は固定される | `resolveWorkerForRoom` / `hashToIndex`（roomId基準。src/lib/tiktok-listener.ts） | 正常 | `workerId` が null の room を WORKER_COUNT=3 で解決 | `hashToIndex(roomId, 3)` の値が `TiktokRoom.workerId` へ永続化され、2回目以降は再計算せずDB値をそのまま返す。room が既に消えていれば null を返す（例外を投げない） | 自動テストなし | NOT RUN: 自動テストなし | `resolveWorkerForRoom`はexport済みなのでintegration化候補。分散キーはstreamerIdでなくroomId |
| TC-WS-002 | WORKER_COUNT縮小時は担当外roomとして検知される | `buildWorkerReport` の `room_out_of_range` 判定（src/lib/worker-status.ts） | 境界 | WORKER_COUNT を縮小し、既存roomの`workerId`が新しい範囲外になる | `workerId`は変わらず維持され重複は起きない（`resolveWorkerForRoom`が既存値をそのまま返すため）。縮小後は該当roomが`room_out_of_range`としてレポートされ、`npm run rebalance-workers -- --apply`後に0件になる | `npx vitest run src/lib/worker-status.test.ts` | PASS | 拡大時は既存roomが動かず新規workerへ偏るだけで重複/欠落は起きない |
| TC-WS-003 | UI/正常 GET /healthz | `GET /healthz` | UI | `resumeAllListeners()` 完了前 | 503 を返す | 自動テストなし | NOT RUN: 自動テストなし | Railway ゼロダウンタイム切替に使用 |
| TC-WS-004 | GET /healthz は部分失敗を挟んでも復帰する | `GET /healthz` / `reconcileOnce` | 境界 | 初回`resumeAllListeners()`で`startFailures=1`（一部room起動失敗）。次のreconcileで0件になる | `startFailures>0`の間は503のまま。0件になった時点でreadyになり200を返す（例外なし＝readyではない） | 自動テストなし | NOT RUN: 自動テストなし | |
| TC-WS-005 | GET /status がプロセス間契約を満たす | `GET /status`（`x-internal-secret`保護、`WorkerStatusPayload`型） | UI/回帰 | `x-internal-secret`不一致 / 一致 | 不一致は401。一致時は`workerIndex`/`workerCount`/`ready`/`startedAt`/`uptimeMs`/`reconcileRunning`/`lastReconcile`/`listeners`を含むJSONを返す | 自動テストなし | NOT RUN: 自動テストなし | worker-guardianの`classifyWorkerHealth`はこの形をモックで前提にしている。契約が壊れても双方の単体テストは通ってしまうため、本採用時は`worker.ts`をchild_process起動して実際のpayloadを突き合わせるintegration化を検討 |
| TC-WS-006 | スキーマ待ち(P2021/P2022)の復帰 | `schemaLagMessage()` / `reconcileOnce` | 異常 | DBに未反映の列を worker が読む | readyにならず`UNREADY_RECONCILE_INTERVAL_MS`(5秒)周期で再試行し、スキーマ到着後readyへ自動復帰。専用ログを出し素の例外にしない | 自動テストなし | NOT RUN: 自動テストなし | 2026-09-04 worker3 healthcheck失敗の再発防止。`schemaLagMessage`は非exportのため本採用時はexport化してユニット化を検討 |
| TC-WS-007 | reconcileの多重起動防止 | `reconcileOnce` | 回帰 | 前回reconcile未完了中に次の周期が発火 | `reconcileRunning`の間は新規reconcileを開始しない | 自動テストなし | NOT RUN: 自動テストなし | |
| TC-WS-008 | shutdown後は新規処理を開始しない | `shutdown()` / SIGINT・SIGTERM | negative | `shuttingDown=true` | reconcile・新規処理を開始しない | 自動テストなし | NOT RUN: 自動テストなし | |

## Quality Gate

- `npm run typecheck`

## Out of Scope

- TikTok Webcast 接続自体の再接続・切断・イベント処理ロジック（`tiktok-listener` 機能の baseline 対象）
- Worker → Web のギフト転送（`POST /api/internal/gift-event`）の正当性（ギフト集計機能側）
- `npm run rebalance-workers` 自体の適用手順（運用手順であり、テストケースではない）
