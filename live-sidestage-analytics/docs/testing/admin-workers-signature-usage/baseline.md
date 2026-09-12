---
project: live-sidestage-analytics
feature: admin-workers-signature-usage
last_updated: 2026-09-12
last_risk: MEDIUM
last_reviewers: Codex(Code Mode)
---

# テストベースライン: admin-workers-signature-usage

admin/workers画面の監視対象一覧に「署名消費(24時間)」「コラボ署名消費(24時間)」列と、その合計値表示を追加する機能。`fetchAdminRoomList()`（src/lib/worker-status.ts）の`includeSignatureUsage24h`オプション、`GET /api/admin/workers/room-usage`（集計専用。`GET /api/admin/workers`の15秒ポーリングとは分離）、画面上のテーブル・見出し合計値を対象とする。

前提として、コラボ/バトル検知の発見元roomIDを`TiktokRoom.lastCollabSourceRoomId`/`lastCollabSourceAt`へ永続化する変更（`ensureRoomWatchedForCollab()`/`watchDiscoveredRooms()`、src/lib/tiktok-room.ts・src/lib/tiktok-listener.ts）も含む。管理者用デバッグ機能であり、本番のworker監視ループ・署名発行フロー（`connectInstance`/`signedWebSocketProvider`/`recordEulerSignUsage`）には一切触れない設計。

「コラボ署名消費」は近似値である（`lastCollabSourceRoomId`は直近の発見元のみ保持し履歴を持たない、列追加時点より前の消費は対象外、`specialWatch`購読はスナップショット対象外）。この近似はユーザー承認済みの設計判断であり、画面に注記する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-AWS-001 | オプション未指定時はsignatureUsage24hCountがnull | `fetchAdminRoomList` | 正常/negative | `includeSignatureUsage24h`未指定 | `signatureUsage24hCount: null` | `npx dotenv -e .env.local.test -- vitest run src/lib/worker-status.integration.test.ts` | PASS | 「0件」と区別 |
| TC-AWS-002 | 署名消費0件ならnullでなく0 | `fetchAdminRoomList` | 境界 | `includeSignatureUsage24h:true`、対象room署名消費0件 | `signatureUsage24hCount: 0` | 同上 | PASS | |
| TC-AWS-003 | 24時間境界(ちょうど24時間前を含む/25時間前は含めない)の署名消費を成功/失敗問わず集計 | `fetchAdminRoomList` | 境界 | 24時間前ちょうど・25時間前の`EulerSignUsage` | 24時間前ちょうどは含む、25時間前は含めない | 同上 | PASS | |
| TC-AWS-004 | オプション未指定時はcollabSignatureUsage24hCountがnull | `fetchAdminRoomList` | 正常/negative | `includeSignatureUsage24h`未指定 | `collabSignatureUsage24hCount: null` | 同上 | PASS | |
| TC-AWS-005 | コラボ署名消費0件ならnullでなく0 | `fetchAdminRoomList` | 境界 | `includeSignatureUsage24h:true`、対象roomのコラボ署名消費0件 | `collabSignatureUsage24hCount: 0` | 同上 | PASS | |
| TC-AWS-006 | lastCollabSourceRoomIdが記録されたroomの署名消費を発見元room単位で集計する | `fetchAdminRoomList` | 正常 | 発見元room A、発見先room Bで`lastCollabSourceRoomId=A`、Bが非購読状態で署名消費 | Aの`collabSignatureUsage24hCount`にBの消費が計上される | 同上 | PASS | |
| TC-AWS-007 | 記録時点で購読状態(Streamer登録あり)の消費はコラボ署名消費に含めない | `fetchAdminRoomList` | 異常/negative | 発見先roomの`EulerSignUsage.streamerPrincipalIds`が非空 | コラボ署名消費に計上しない | 同上 | PASS | `EulerSignUsage`のスナップショット列で判定、`hasBattleSubscriber()`は呼ばない |
| TC-AWS-008 | 記録時点でイベント監視中(roomMonitorUntilが有効)の消費はコラボ署名消費に含めない | `fetchAdminRoomList` | 異常/negative | `EulerSignUsage.roomMonitorUntil > requestedAt` | コラボ署名消費に計上しない | 同上 | PASS | |
| TC-AWS-009 | 直近24時間以外のコラボ署名消費は含めない | `fetchAdminRoomList` | 境界 | 25時間前の発見先room消費 | コラボ署名消費に計上しない | 同上 | PASS | |
| TC-AWS-009a | AgencyWatch購読状態(agencyIdsが非空)の消費はコラボ署名消費に含めない | `fetchAdminRoomList` | 異常/negative | `EulerSignUsage.agencyIds`が非空 | コラボ署名消費に計上しない | 同上 | PASS | TestCaseレビュー(Codex)反映。streamerPrincipalIds分岐(TC-AWS-007)とは別経路 |
| TC-AWS-009b | `roomMonitorUntil`が`requestedAt`と完全一致する境界は非購読扱いとして計上する | `fetchAdminRoomList` | 境界 | `roomMonitorUntil === requestedAt` | 等号を含む仕様どおり計上する(0でない) | 同上 | PASS | TestCaseレビュー(Codex/DeepSeek)反映 |
| TC-AWS-009c | 発見元roomが上書きされた後は、上書き前の消費も新しい発見元へ遡及して計上される(近似仕様) | `fetchAdminRoomList` | 回帰/近似確認 | 旧発見元での消費記録後、`lastCollabSourceRoomId`を新発見元へ上書き | 旧発見元の集計は0、新発見元の集計に計上される | 同上 | PASS | TestCaseレビュー(Codex)反映。`lastCollabSourceRoomId`は履歴を持たない設計判断(ユーザー承認済み)を明示的に固定する |
| TC-AWS-010 | コラボ発見元roomID永続化: 新規作成roomでlastCollabSourceRoomId/Atがセットされる | `ensureRoomWatchedForCollab` | 正常 | 未登録roomをコラボ検知で新規作成 | `lastCollabSourceRoomId`=発見元roomId、`lastCollabSourceAt`が設定される | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-room.collab.integration.test.ts` | PASS | |
| TC-AWS-010a | recordCollabGroupChange()の実経路で、発見元roomの実IDがlastCollabSourceRoomIdへ伝播する | `tiktok-listener.ts` (recordCollabGroupChange) | 正常/回帰 | linkLayerイベントでコラボ相手roomを新規発見 | 相手roomの`lastCollabSourceRoomId`が発見元(自room)のIDと一致する | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.collab-kick.integration.test.ts` | PASS | TestCaseレビュー(Codex)反映。ヘルパー単体でなく実イベント経路を検証 |
| TC-AWS-011 | 既存room分岐でもlastCollabSourceRoomId/Atは毎回上書きされる | `ensureRoomWatchedForCollab` | 回帰 | 既存roomを別の発見元から再度発見 | `lastCollabSourceRoomId`が新しい発見元に更新される | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-room.collab.integration.test.ts` | PASS | `watchSource`/`watchSourceAt`(最初の発見経路、不変)とは異なるセマンティクス |
| TC-AWS-012 | watchSource/watchSourceAtの既存セマンティクスは変更されない | `ensureRoomWatchedForCollab` | 回帰 | 既存roomを別の発見元から再度発見 | `watchSource`/`watchSourceAt`は初回発見時のまま不変 | 同上 | PASS | 新列だけが上書きされることの対比確認 |
| TC-AWS-013 | 発見先room数・コラボ署名消費集計クエリに防御的な件数上限がある | `fetchAdminRoomList` | 性能/防御 | 実装コード確認 | `COLLAB_DISCOVERED_ROOM_LIMIT`(5000)・`COLLAB_USAGE_QUERY_LIMIT`(20000)をfindManyの`take`に指定 | コード確認(`src/lib/worker-status.ts`) | PASS | code-review(Codex HIGH finding)反映。DB負荷・応答遅延の防止 |
| TC-AWS-013a | 新規room作成時にP2002競合が発生しても、リトライ後の既存room分岐でlastCollabSourceRoomIdが正しく設定される | `ensureRoomWatchedForCollab` | 異常/回帰 | findUniqueが未登録を返した直後に別プロセスが同一hostTiktokUidでroomを作成(P2002を再現) | 例外を投げず、リトライ後の既存room分岐で`lastCollabSourceRoomId`が渡されたsourceRoomIdと一致する | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-room.collab.integration.test.ts` | PASS | TestCaseレビュー(DeepSeek HIGH)反映 |
| TC-AWS-014 | UI: 「署名消費(24時間)」「コラボ署名消費(24時間)」列が一覧に表示される | `/admin/workers` テーブル | UI | dev-loginで管理画面を開く | 両列がヘッダー・各行に表示される | Playwright(headless、実ブラウザ、dev-login) | PASS | |
| TC-AWS-015 | UI: 見出し横に合計値(署名消費(24h)・週間署名消費・コラボ署名消費(24h))が表示される | `/admin/workers` 見出し | UI | 同上 | `署名消費(24h):<数値> 週間署名消費:<数値> コラボ署名消費(24h):<数値>`が見出し内に表示される | Playwright | PASS | 合計は表示中(フィルタ適用後・ADMIN_ROOM_LIST_LIMIT枠内)のroom分。全room厳密合計ではない。TestCaseレビュー(DeepSeek)反映で3つ目の合計を追記 |
| TC-AWS-016 | UI: 「署名消費(24時間)」列のソートボタンが機能する | `/admin/workers` テーブル | UI | 「署名消費(24時間)」列のソートボタンをクリック | 昇順/降順が切り替わり一覧の並びが変わる | Playwright | PASS | |
| TC-AWS-016a | signatureUsage24hCount / collabSignatureUsage24hCount列のソート(0/1/N件・null混在)が正しい順序になる | `sortAssignedRooms` | 境界 | 値0・1・複数・nullが混在する配列 | 昇順・降順ともにnullは末尾固定、数値は正しく順序化される | `npx vitest run "src/app/(dashboard)/admin/workers/sort-rooms.test.ts"` | PASS | TestCaseレビュー(Codex/DeepSeek)反映。既存はweeklyEulerSignUsageCountのみ検証だった |
| TC-AWS-017 | UI: 15秒ポーリングでエラーなく更新される | `/admin/workers` | UI/回帰 | 画面を開いたまま15秒以上待つ | コンソールエラー・ネットワークエラー無く再描画される。`/api/admin/workers`のみ再取得し、`/api/admin/workers/room-usage`は再取得しない | Playwright | PASS | 2026-09-12 性能: ポーリングから署名消費集計を切り離し |
| TC-AWS-018 | API: `GET /api/admin/workers`は署名消費列null、`room-usage`で数値 | `route.ts` / `room-usage/route.ts` | 性能/契約 | adminログイン・workerId割当room | ポーリングAPIはweekly/signature/collab列がnull。room-usageは数値 | `npm run test:integration`（`route.integration.test.ts`・`room-usage/route.integration.test.ts`） | PASS | |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`（ローカルDB必須。`worker-status.integration.test.ts`・`tiktok-room.collab.integration.test.ts`を含む）

## Out of Scope

- `weeklyEulerSignUsageCount`（既存の週間署名消費列）自体の仕様 — 既存実装の複製元であり、本変更による挙動変更なし
- worker本体の監視ループ・署名発行フロー（`connectInstance`/`signedWebSocketProvider`/`recordEulerSignUsage`/`resolveWatchedRoomFilter`） — 本変更では一切変更していない
- `hasBattleSubscriber()`（購読判定の正本）自体の4経路の定義 — 本変更では変更していない。コラボ署名消費の非購読判定は`EulerSignUsage`のスナップショット列のみで独自に行う
- `prisma/migrations/`配下のCREATE INDEX方式（非CONCURRENTLY） — 本番は`db push`運用でmigrationsフォルダを実行しないため本PRでは対象外。プロジェクト全体の既存運用方針
