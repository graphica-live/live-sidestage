---
project: live-sidestage-analytics
feature: admin-worker-manual-reassign
last_updated: 2026-09-06
last_risk: LOW
last_reviewers: Qwen(単独)
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
| TC-13 | `notifyWorkersOfManualReassign()`: toWorkerのみ/from+to両方/from===to重複排除/secret未設定スキップ/urls欠損スキップ/fetch失敗時非同期例外なし の6パターン | `notifyWorkersOfManualReassign()` (src/lib/worker-status.ts) | 正常/境界/異常 | `fetchImpl`をモック差し替え | 各パターンで期待回数・URL・ヘッダーどおりPOSTされる。secret未設定/urls欠損は例外なくスキップ。fetch reject時も同期的にreturnし例外を投げない | `npx vitest run src/lib/worker-status.test.ts -t "notifyWorkersOfManualReassign"` | PASS(6/6) | 2026-09-05 | ダウンタイム短縮機能(手動移動直後の即時reconcile通知)追加に伴い新設 |
| TC-14 | `POST /internal/reconcile-now`: secretなし→401、secret不一致→401、正しいsecret→202即返り+`reconcileOnce()`起動、`/status`のlastReconcile.atが更新される | `worker.ts` healthServer | 正常/異常/境界(実機) | ローカルで`WORKER_COUNT=3 WORKER_INDEX=0 PORT=8091 WEB_INTERNAL_URL=http://localhost:3000 INTERNAL_API_SECRET=<test-secret>`にてworker.ts起動 | 3パターンとも期待ステータスコード。202後、数秒待って`/status`の`lastReconcile.at`が起動直後の値から更新されている | `curl -X POST http://localhost:8091/internal/reconcile-now`(secretなし/誤り/正しい の3回)+`curl http://localhost:8091/status`前後比較 | PASS(401/401/202、lastReconcile.at更新確認) | 2026-09-05 | worker.tsはNode `http`直書きでexport無くunit test化の既存慣習が無いため実機確認で代替。ログ: `.claude/scratch/worker0.log` |
| TC-15 | UI: listener欄とDB上の担当欄を同時に出すと同一部屋が2箇所に見え紛らわしいという指摘を受け、表示モードを3択(listenerのみ/DB上の担当のみ/両方)で切り替えられるようにした。初期選択はlistenerのみ | `/admin/workers` page.tsx (`displayMode` state) | UI/正常/境界(全状態網羅) | WORKER_COUNT=3、workerあたりlistener1件以上・DB上の担当1件以上が存在するシード | 初期表示は「listenerのみ」選択状態で、各workerブロックはlistener一覧のみ表示し「DB上の担当」セクションは非表示。「DB上の担当のみ」選択でlistener一覧が非表示になり「DB上の担当」セクションのみ表示。「両方」選択で両セクションとも表示される | Playwright(headless)でdev-login→`/admin/workers`へ遷移し、初期状態・「DB上の担当のみ」クリック後・「両方」クリック後の3状態でスクリーンショット取得 | PASS | 2026-09-06 | 実装は既存の`w.listeners.length > 0`等の表示条件へ`showListeners`/`showAssigned`をAND追加しただけで、DB取得ロジック・reassign APIには変更なし |

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

### 2026-09-05: worker手動移動の即時反映(ダウンタイム短縮)

手動移動はDB更新のみでWorker側への即時通知が無く、旧worker切断・新worker接続それぞれ
最大30秒(計最大60秒)のギフト受信ダウンタイムが起きる問題への対応。ユーザーとの合意で
対象は手動移動のみ(既存の自動フェイルオーバー`worker-guardian.ts`は変更しない)。

- diff: `worker.ts`(内部エンドポイント`POST /internal/reconcile-now`追加)、
  `src/lib/worker-status.ts`(`notifyWorkersOfManualReassign()`新設)、
  `src/app/api/admin/workers/reassign/route.ts`(commit後にfire-and-forget呼び出し追加)
- risk: HIGH(認可付き新規HTTPエンドポイント追加・DB書込後の外部通知)
- reviewers: Design Mode = Qwen単独(Codex quota切れ2026-09-07まで、Gemini代理もquota切れ残り161h)。
  Code Mode = Qwen単独、同理由。**大コンテキスト(PRODUCT.md全文込み・約12000字)で
  `suspect_no_review: true`検出→カナリア検証不通過→コンテキストをdiffのみ(約4600字)に
  圧縮して再実行しカナリア通過を確認してから採用**(review-auto Skillのカナリア手順どおり)
- review_summary: Design Mode findings=3 valid=0(いずれも現行アーキテクチャに該当しない
  仮定/既存パターンと同一の前提を新規リスクと誤認)。Code Mode findings=4 valid=1
  fixed=1(secret未設定時のログ欠如→console.warn追加)、invalid=3(2件は既存ガードで
  対応済み、1件はコードコメントをprompt injectionと誤検知)
- 追加テスト: TC-13(unit 6件)・TC-14(実機確認)
- TestCase Modeレビュー: NOT RUN。Codex/Gemini quota切れ(継続)のためQwen単独で実施を
  試みたが、圧縮コンテキスト(diff+表抜粋のみ、3456〜7219トークン)でも`suspect_no_review: true`
  が一貫して発生。カナリア(1: 既知SQLi混入コード追加、2: TC-14自体を意図的に欠落させた
  カバレッジ欠損)のいずれも検出できず不通過(計4回試行)。今回は前回Code Modeレビューで
  奏功した「diffのみへの圧縮」では解消しないケースと判明したため、これ以上の圧縮による
  再試行を打ち切り、レビュー未実施として記録する。TC-13/TC-14自体はunit test・実機curl
  確認により実行・PASS済みで、レビュー未実施は「表の十分性への外部意見が無い」に留まる
- PASS 13 / FAIL 0 / NOT RUN 0(TestCase Modeレビューはテスト実行行ではないため上記集計に含めない)
