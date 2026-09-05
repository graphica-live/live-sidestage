---
project: live-sidestage-analytics
feature: admin-worker-manual-reassign
last_updated: 2026-09-05
last_risk: HIGH
last_reviewers: Qwen(単独。Codex quota切れ2026-09-07まで、GeminiもGemini個人quota切れ・残り166h)
---

# テストケース設定表: admin-worker-manual-reassign

管理画面(`/admin/workers`)からworker手動移動を行う機能。`reassignRoomWorker()`
(src/lib/worker-status.ts)がトランザクション内で楽観的排他(`expectedWorkerId`)を取り、
worker-guardianの自動フェイルオーバーとの競合をconflict(409)として検知する。
成功時は`consecutiveBlockedCount`を0リセットし、監査ログ(`ManualReassignAuditEntry`)へ
operator(セッションemail)付きで記録する。API(`POST /api/admin/workers/reassign`)は
`getAdminSession()`で認可。UIは各行に移動先selectと「移動」ボタンを追加、
下部に「手動移動履歴」セクションを追加。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 由来 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-01 | expectedWorkerId一致で移動しconsecutiveBlockedCountを0リセットする | `reassignRoomWorker()` (src/lib/worker-status.ts) | 正常 | workerId:0, consecutiveBlockedCount:5のRoom、reassignRoomWorker(roomId,1,3,0,operator) | `{status:"ok",...,fromWorker:0}`、DB上workerId=1・consecutiveBlockedCount=0 | `npx dotenv -e .env.local.test -- vitest run src/lib/worker-status.reassign.integration.test.ts` | PASS | 2026-09-05 | |
| TC-02 | expectedWorkerId不一致はconflictを返しworkerIdを変更しない(worker-guardianとの競合検知) | 同上 | 異常 | workerId:2のRoomへexpectedWorkerId:0で移動要求 | `{status:"conflict",actualWorkerId:2}`、DB上workerIdは2のまま不変 | 同上 | PASS | 2026-09-05 | |
| TC-03 | 未割当(workerId:null)からexpectedWorkerId:nullで新規割当できる | 同上 | 境界 | workerId:nullのRoom、expectedWorkerId:null | `{status:"ok",...,fromWorker:null}`、DB上workerId=2 | 同上 | PASS | 2026-09-05 | |
| TC-04 | 存在しないroomIdは例外を投げずnot_foundを返す | 同上 | 異常 | roomId="nonexistent-room-id" | `{status:"not_found"}` | 同上 | PASS | 2026-09-05 | |
| TC-05 | toWorkerIndexがworkerCount範囲外なら例外を投げる | 同上 | 境界/異常 | toWorkerIndex:3, workerCount:3 | rejects.toThrow() | 同上 | PASS | 2026-09-05 | |
| TC-06 | 成功時、監査ログにoperator付きで追記される | `fetchManualReassignAuditLog()` | 正常 | reassignRoomWorker成功後 | ログに`{roomId,fromWorker:0,toWorker:1,operator}`のエントリが追加される | 同上 | PASS | 2026-09-05 | |
| TC-07 | 未認可ユーザーはreassign APIを実行できない | `POST /api/admin/workers/reassign` | 異常 | `getAdminSession()`が管理者以外/未ログインを返す状況 | 401/403相当を返しreassignRoomWorkerを呼ばない | コードレビュー(Code Mode: Gemini代理+Qwen)で確認。既存`getAdminSession()`パターンを踏襲 | PASS(レビュー確認) | 2026-09-05 | 専用の未認可integrationテストは無いが、既存の他admin APIと同一の認可ガード実装であることをコードレビューで確認済み |
| TC-08 | typecheck全体が通ること | プロジェクト全体 | 回帰 | 変更後の全コード | エラー0件 | `npx dotenv -e .env.local.test -- npm run typecheck` | PASS | 2026-09-05 | |
| TC-09 | unit test全体が通ること(既存機能への影響なし) | プロジェクト全体 | 回帰 | 変更後の全コード | 86 test files / 1234 tests PASS | `npx dotenv -e .env.local.test -- npm run test:unit` | PASS | 2026-09-05 | |
| TC-10 | integration test全体が通ること | プロジェクト全体 | 回帰 | ローカルDB(docker) | 71 test files / 711 tests PASS | `npx dotenv -e .env.local.test -- npm run test:integration` | PASS | 2026-09-05 | worker-status.reassign.integration.test.ts(6件)追加により70→71ファイル、704→711(実質+7、既存分含む) |
| TC-11 | UI: 各行に移動先select+「移動」ボタンが表示され、実データ(DB上の担当・手動移動履歴)が正しく描画される | `/admin/workers` page.tsx | UI | WORKER_COUNT=3、シードRoom4件+統合テストで作成した監査ログ | 各Roomの行に移動先selectと「移動」ボタンが表示、「DB上の担当」「手動移動履歴」セクションが表示される | Playwright(headless)でdev-login→`/admin/workers`へ遷移しスクリーンショット取得。Artifact: https://claude.ai/code/artifact/1cc5f0a5-eeb1-4505-9bf3-3071909712bc | PASS(表示確認) | 2026-09-05 | |
| TC-12 | UI: 実際に「移動」ボタンをクリックしてworker移動がDBへ反映され、監査ログに実ログインユーザーが記録される | `/admin/workers` page.tsx + `POST /api/admin/workers/reassign` | UI/正常(E2E) | ローカルDB(`.env.local.test`)限定。@local_test_streamer(workerId:0)の行で「移動」クリック(confirm自動accept) | DB上workerIdが0→1へ変化、手動移動履歴の先頭に`@local_test_streamer worker0→worker1 by graphicatestlive@gmail.com`が追加表示される | Playwright(headless)でクリック実行後、Prisma直接クエリでworkerId確認。Artifact同上(2枚目) | PASS | 2026-09-05 | Qwenレビュー指摘(MEDIUM、TC-11がUI描画のみで実クリック未検証)を受けて追加。**本番DATABASE_URLを指す`.env.local`では絶対に実行しないこと**(このテストは`.env.local.test`のローカルDB限定) |

## テストケースレビューと対応

TestCase Mode: リスクHIGHにつき本来Codex+Qwen(Codex不可時Gemini代理)構成だが、
Codexはquota切れ(2026-09-07まで)、Gemini代理も個人quota到達(残り166h52m、exit4)で
両方利用不能。development-workflow.mdの自律実行原則および直前のCode Modeレビューでの
先例(同じ両モデル不可状況、Qwenのみで完了しユーザーへ報告済み)に倣い、Qwen単独レビューで
進行しユーザーへ理由を明記して報告する。

Qwen findings 3件:

| # | severity | 内容 | 判定 | 対応 |
| --- | --- | --- | --- | --- |
| 1 | MEDIUM | TC-11はUI描画のみで実際の移動クリックを検証していない | VALID | TC-12として、ローカルDB限定で実クリック→DB反映→監査ログ記録までのE2E確認を追加した |
| 2 | MEDIUM | 認可(TC-07)がコードレビューのみでexecutableテストが無い | INVALID(この文脈では見送り) | `src/app/api/admin/`配下の既存route.ts群(agencies/euler-api/euler-usage等)は現状1件もroute-levelテストを持たず、認可はコードレビューでの`getAdminSession()`パターン確認が既存慣習。本機能だけ新規テストパターンを導入するのはスコープ逸脱と判断し見送り |
| 3 | LOW | 境界値(負のindex・非整数)の追加テストが無い | INVALID(実装は既に対応済み) | `src/app/api/admin/workers/reassign/route.ts:30-51`で`Number.isInteger`チェックと`toWorkerIndex < 0 \|\| >= workerCount`チェックを既に実施済み(400を返す)。#2と同じ理由でexecutableテスト新設は見送り |

## 変更履歴

### 2026-09-05: worker手動移動機能(管理画面)実装

- diff: working tree(worktree worker-manual-reassign、mainからの未commit差分)
- risk: HIGH(認可・DB書込・worker-guardianとの競合を伴う管理者操作)
- reviewers: Code Mode = Gemini(Codex代理、quota切れ) + Qwen。TestCase Mode = Qwen単独(Codex/Gemini双方quota切れのため)
- review_summary: Code Mode findings=6(Gemini) valid=6 fixed=6(トランザクション化・楽観的排他・consecutiveBlockedCountリセット・操作者記録・UI再設計)。再レビューはQwenのみ完了(新規finding無し)。TestCase Mode findings=3(Qwen) valid=1 fixed=1(TC-12追加)、invalid=2(既存プロジェクト慣習・実装済みのため見送り)
- PASS 11 / FAIL 0 / NOT RUN 0(TC-07はintegrationテストでなくコードレビュー確認)
