---
project: live-sidestage-analytics
feature: admin-workers-watch
last_updated: 2026-09-06
last_risk: MEDIUM
last_reviewers: Qwen(Code Mode)、Qwen(TestCase Mode)
---

# テストベースライン: admin-workers-watch

admin/workers画面から監視対象TikTok IDを手動追加する機能。`addWatchedRoom()`（src/lib/worker-status.ts）、`POST /api/admin/workers/watch`、画面上の `AddWatchForm` を対象とする。Streamer登録・AgencyWatch追加と同じfail-closedな実在確認を通し、「情報プール方針」(`TiktokRoom.monitoringSuspended: false`)に乗せるだけの設計。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-AWW-001 | 実在するIDで新規roomが監視対象になる | `addWatchedRoom` | 正常 | 未登録のtiktokId、実在確認EXISTS | 新規`TiktokRoom`を作成し`monitoringSuspended: false` | `npx vitest run src/lib/worker-status.watch.integration.test.ts` | PASS | |
| TC-AWW-002 | 休止中roomは復帰する(新規作成しない) | `addWatchedRoom` | 回帰 | 既存room(`monitoringSuspended: true`) | 同じroomIdのまま`monitoringSuspended: false`に復帰、`created: false` | 同上 | PASS | `reviveSuspendedMonitoring`経由 |
| TC-AWW-003 | 監視中roomへの再追加は冪等 | `addWatchedRoom` | 境界 | 既存room(`monitoringSuspended: false`, `workerId`割当済み) | 既存の`workerId`を上書きしない | 同上 | PASS | |
| TC-AWW-004 | 存在しないTikTok IDはfail-closedで拒否 | `addWatchedRoom` | 異常 | 実在確認MISSING | `{status: "not_found"}`、roomを作らない | 同上 | PASS | |
| TC-AWW-005 | 実在確認できない場合もfail-closedで拒否 | `addWatchedRoom` | 異常 | 実在確認UNVERIFIED | `{status: "unverified"}`、roomを作らない | 同上 | PASS | TikTok側障害・サーキットブレーカ開放時と同じ扱い |
| TC-AWW-006 | 不正な形式のIDは実在確認を呼ばず拒否 | `addWatchedRoom` | 異常/境界 | 1文字("a")の入力 | `{status: "invalid"}`、外部への実在確認を呼ばない | 同上 | PASS | `isValidNormalizedTiktokId`(2〜24文字) |
| TC-AWW-007 | @付き・大文字混じり入力の正規化 | `addWatchedRoom` | 境界 | `@ItestAW_Norm_xxx` | 小文字化・先頭@除去した`tiktokId`で登録される | 同上 | PASS | |
| TC-AWW-007b | 25文字(上限超過)は実在確認を呼ばず拒否 | `addWatchedRoom` | 境界 | 25文字の入力 | `{status: "invalid"}`、外部への実在確認を呼ばない | 同上 | PASS | |
| TC-AWW-007c | 許可されない記号を含む入力は拒否 | `addWatchedRoom` | 異常 | `invalid@id#` | `{status: "invalid"}` | 同上 | PASS | |
| TC-AWW-007d | 下限(2文字)ちょうどは形式として有効 | `addWatchedRoom` | 境界 | 2文字の入力、実在確認MISSING | invalidにはならず`not_found`まで進む(形式検証は通過) | 同上 | PASS | |
| TC-AWW-007e | 上限(24文字)ちょうどは形式として有効 | `addWatchedRoom` | 境界 | 正規化後24文字ちょうどの入力、実在確認EXISTS | `{status: "ok"}` | 同上 | PASS | |
| TC-AWW-008 | 未認証は401 | `POST /api/admin/workers/watch` | 異常 | admin session無し | 401、`addWatchedRoom`を呼ばない | 手動確認(コード読解: `getAdminSession()`チェックが最初) | PASS | 既存の`/api/admin/workers/reassign`と同じガード |
| TC-AWW-009 | UI/正常: 画面から追加できる | `AddWatchForm`（/admin/workers） | UI | 実在するTikTok IDを入力して追加ボタン | 成功メッセージ表示、一覧が更新される(`onAdded`→再fetch) | Playwright（headless、実ブラウザ） | PASS | ログイン画面へリダイレクトされない管理者セッションが必要 — 未ログイン状態のリダイレクト確認で代替 |
| TC-AWW-010 | UI/異常: 空欄では追加ボタンが無効 | `AddWatchForm` | 境界 | 入力欄が空 | 追加ボタンが`disabled` | Playwright | PASS | |

## Quality Gate

- `npm run typecheck`
- `npx vitest run src/lib/worker-status.watch.integration.test.ts`（ローカルDB必須）

## Out of Scope

- 既存の手動reassign機能（`reassignRoomWorker`）自体の仕様 — `src/lib/worker-status.reassign.integration.test.ts`で別途カバー済み、baseline化は本変更の対象外
- 追加後の実際のTikTok接続確立（workerのreconcile・接続処理は`worker-shard`機能のbaseline対象）
- 監視対象の削除・停止UI（今回は追加のみ。停止は既存のクリーンアップ判定に委ねる設計）
