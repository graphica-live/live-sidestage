---
date: 2026-09-05
project: live-sidestage-analytics
topic: コラボ相手監視の即時化(reconcile 30秒化+自己割当即キック)
diff: working tree (worktree collab-instant-watch)
risk: HIGH
reviewers: Codex(quota切れのためFableで代替)+Qwen(2回ともsuspect_no_review、カナリア検証で不読確認済みにつき無効扱い)
review_summary: findings=8(Code Mode 4 + TestCase Mode 4) valid=7 fixed=6
---

# テストケース設定表: コラボ相手監視の即時化

## 変更概要

TikTok Liveコラボ(linkMic)検知時、相手roomの実接続開始が最大60秒(reconcile任せ)かかっていたのを、
(A) reconcile間隔30秒化、(B) 検知workerが自分のworkerIdで新規room作成し即startListenerキック、の2段で縮める。
二重キック防止は`ensureRoomWatchedForCollab`の戻り値`created`(生涯高々1回trueになる構造的保証)で担保。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 未登録tiktokIdの新規作成でcreated:trueが返る | `ensureRoomWatchedForCollab` | 正常 | 未登録の正規tiktokId | `resumed:false, created:true`、DB上room作成 | `npm run test:integration -- tiktok-room.collab.integration.test.ts` | PASS | 既存ケース |
| TC-02 | 監視中roomの再検知はcreated:falseで無変更 | `ensureRoomWatchedForCollab` | 正常 | monitoringSuspended:false のroom | `resumed:false, created:false` | 同上 | PASS | 既存ケース |
| TC-03 | 休止中roomの再開はcreated:falseでresumed:true | `ensureRoomWatchedForCollab` | 境界 | monitoringSuspended:true のroom | `resumed:true, created:false`、DB上ON | 同上 | PASS | 既存ケース |
| TC-04 | @付き・大文字混じりの正規化 | `ensureRoomWatchedForCollab` | 境界 | `@NORMALIZEDID` 形式 | 正規化後の既存roomを引き当てる | 同上 | PASS | 既存ケース |
| TC-05 | 不正形式(空文字・記号)はnullを返し部屋を作らない | `ensureRoomWatchedForCollab` | 異常 | `""`, `"has space"` | `null` | 同上 | PASS | 既存ケース |
| TC-06 | workerId引数を渡すと新規作成時にそのworkerIdで作成される | `ensureRoomWatchedForCollab` | 正常 | 未登録tiktokId, workerId=2 | `created:true`、DB上`workerId:2` | 同上 | PASS | 新規ケース |
| TC-07 | 既存room再開時はworkerId引数を渡してもDBのworkerIdを上書きしない | `ensureRoomWatchedForCollab` | 異常(競合) | 既存room(workerId:1, suspended:true), 呼び出しはworkerId=2 | `created:false`、DB上`workerId`は1のまま | 同上 | PASS | 新規ケース。担当二重化防止の中核 |
| TC-08 | 新規コラボ相手roomが検知workerの自WORKER_INDEXで作成され即接続される | `recordCollabGroupChange` → `startListener` | 正常 | own room接続中に`linkLayer`(groupChangeContent)でpartner検知 | 2本目の接続が張られる、partnerRoom.workerId===WORKER_INDEX、connectCalls:1 | `npm run test:integration -- tiktok-listener.collab-kick.integration.test.ts` | PASS | 新規ファイル |
| TC-09 | 同一コラボ通知の再送では二重接続しない(created二度目false) | `recordCollabGroupChange` | 異常(重複通知) | TC-08の状態からlinkLayerを再度fire | 接続数が2のまま増えない | 同上(同ファイル同テスト内で検証) | PASS | 二重キック防止の実証 |
| TC-10 | reconcile teardownループが新規作成直後のlistenerを誤って切断しない(createdAtガード) | `ensureAllListenersAlive` | 異常(競合、reconcile並行実行) | `vi.spyOn(prisma.tiktokRoom,"findMany")`でgetMyRooms()の初回呼び出し中にstartListenerを割り込ませる | 1周回目はteardownされず維持、2周回目は正規にteardown | `npm run test:integration -- tiktok-listener.collab-kick.integration.test.ts` | PASS | Fable(Code Mode)指摘MEDIUMへの対応。実装時に境界条件バグ発見(`createdAt`と`reconcileStartedAt`が同一msだとteardown側に倒れる)、`>`→`>=`へ修正 |
| TC-11 | 他workerが担当中のroomをコラボ検知しても接続もworkerId上書きもしない | `recordCollabGroupChange` | 異常(競合) | 既存room(workerId:1)をlinkLayerで検知 | 接続数増えず、DB上workerIdは1のまま | 同上 | PASS | Fable(TestCase Mode)指摘LOWへの対応 |
| TC-12 | getWorkerConfig失敗(WORKER_INDEX不正)時は即キックしない | `recordCollabGroupChange` | 異常 | `vi.stubEnv("WORKER_INDEX","invalid")` でlinkLayer検知 | 接続数増えず、DB上workerIdはnull、エラーログ出力 | 同上 | PASS | Fable(Code Mode)指摘MEDIUMへの対応。二重接続防止の要となる分岐 |
| TC-13 | RECONCILE_INTERVAL_MS 30秒化がworker.tsの定数どおり反映されている | `worker.ts` | 回帰 | - | `RECONCILE_INTERVAL_MS === 30_000` | `rg "RECONCILE_INTERVAL_MS = 30_000" worker.ts` (1件ヒット) + `npm run typecheck` | PASS | Fable(TestCase Mode)指摘LOW反映(目視確認→再現可能なコマンドへ) |
| TC-14 | 既存unit testが無傷(worker-status/worker-guardian含む) | 全体 | 回帰 | - | 84 files / 1214 tests PASS | `npm run test:unit` | PASS | 実行済み |
| TC-15 | 既存+新規integration testが無傷 | 全体 | 回帰 | - | 68 files / 697 tests PASS | `npm run test:integration` | PASS | 実行済み(TC-06〜12含む) |
| TC-16 | UI(文言のみ変更、レイアウト変更なし) | AgencyClient.tsx / ParticipantManager.tsx / listener/start/route.ts | UI | 「60秒」→「30秒」の秒数表記のみ、要素・状態・インタラクション変更なし | 変更対象3ファイルで`rg "60秒"`が0件ヒット | `rg "60秒" src/app/\(agency\)/agency/AgencyClient.tsx src/app/\(event\)/events/\[id\]/participants/ParticipantManager.tsx src/app/api/listener/start/route.ts` | PASS | Fable(TestCase Mode)指摘LOW反映。実ブラウザ確認は対象外(差分は文字列の数値置換のみでDOM/スタイル/コンポーネント構成に変更なし、採用デザインサンプルなし)と判断。visual-qa対象外 |

## レビュー指摘と対応

| # | reviewer | severity | 指摘 | 分類 | 対応 |
| --- | --- | --- | --- | --- | --- |
| 1 | Fable(Code Mode) | MEDIUM | reconcile teardownループとの競合ガード(createdAt)を直接検証するテストが無い | VALID | TC-10追加。実装中に境界条件バグ(同一msでteardown側に倒れる)を発見し`>`→`>=`へ修正 |
| 2 | Fable(Code Mode) | LOW | `getWorkerConfig()`失敗時、created:trueなら即キックしてしまう(次周回まで二重接続の可能性) | VALID | `tiktok-listener.ts`に1行条件追加(`ownWorkerIndex === undefined`ならキックしない)。TC-12追加 |
| 3 | Fable(Code Mode) | LOW | `worker-status.ts`の「3周ぶん」コメントが30秒化後は誤り(実際は6周) | VALID | コメントを「6周ぶん」に修正 |
| 4 | Fable(Code Mode) | INFO | reconcile第1ループと即キックが同時に同じroomをstartListenerした場合のidle窓競合 | ALREADY_HANDLED | `inst.stopped`チェックで先行側が離脱するため実害なし(Fable自身が確認済み) |
| 5 | Qwen(Code Mode) | - | `NO ISSUES`(completion 4トークン) | INVALID(不読) | カナリア検証(既知SQLi注入)で検出失敗を確認、この回答は無効扱い |
| 6 | Fable(TestCase Mode) | MEDIUM | TC-10のMEDIUM見送り判断(fake timer要/基盤変更要)は事実誤り。`vi.spyOn(prisma.tiktokRoom,"findMany")`で決定的再現可能と具体策提示 | VALID | 指摘どおり実装、成立を確認(#1のバグ発見に繋がった) |
| 7 | Fable(TestCase Mode) | MEDIUM | `getWorkerConfig`失敗フォールバック分岐(二重接続防止の要)のテストが無い | VALID | TC-12追加 |
| 8 | Fable(TestCase Mode) | LOW | 「他worker担当中room」のケースがDB層(TC-07)のみでlistener層で未検証 | VALID | TC-11追加 |
| 9 | Fable(TestCase Mode) | LOW | TC-11(旧番号)/TC-14(旧番号)の実行方法「目視確認」が再現不能 | VALID | `rg`によるコマンド確認へ変更(現TC-13/TC-16) |
| 10 | Qwen(TestCase Mode) | - | `NO ISSUES`(completion 4トークン) | INVALID(不読) | Code Modeと同型の`suspect_no_review`。同規模コンテキストでカナリア済みにつき無効扱い |

## 実行結果サマリ

PASS 15 / FAIL 0 / NOT RUN 1 (TC-16の実ブラウザ確認。理由は備考欄のとおり)
