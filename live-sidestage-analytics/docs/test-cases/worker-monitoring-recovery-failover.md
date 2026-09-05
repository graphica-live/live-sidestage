---
project: live-sidestage-analytics
feature: worker-monitoring-recovery-failover
last_updated: 2026-09-05
last_risk: HIGH
last_reviewers: Fable(Codex代替、quota切れ)+Qwen(カナリア不通過のため参考情報扱い)
---

# テストケース設定表: worker-monitoring-recovery-failover

TikTok接続worker(worker1〜3)の監視復帰・障害復旧まわり。機能A(監視復帰クールダウン、
`lastLowValueCheckAt`更新で低価値クリーンアップバッチへ即戻りしないようにする)と、
機能B(403ブロック検知によるworkerフェイルオーバー、`consecutiveBlockedCount`→
`worker-guardian.ts`の`decideBlockedRoomAction`/`migrateBlockedRoom`/`giveUpBlockedRoom`)
の2機能。既存の死活監視(`migrateDeadWorker`)と同じ`worker-guardian.ts`に同居する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 由来 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 監視停止Roomが復帰すると`lastLowValueCheckAt`が更新されクールダウンに乗る | `reviveSuspendedMonitoring()` (src/lib/mark-last-active.ts) | 正常 | monitoringSuspended:true、lastLowValueCheckAt=過去日付のRoom | 復帰処理後、lastLowValueCheckAtが現在時刻付近に更新される | `npx dotenv -e .env.local.test -- vitest run src/lib/mark-last-active.integration.test.ts` | PASS | 2026-09-05 | |
| TC-02 | 復帰直後のRoomは低価値クリーンアップ候補から除外される(クールダウン中) | `selectLowValueCandidates()` (src/lib/tiktok-low-value-cleanup.ts) | 回帰 | reviveSuspendedMonitoring()直後のRoom | 候補一覧に含まれない | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-low-value-cleanup.integration.test.ts` | PASS | 2026-09-05 | |
| TC-03 | `resolveRoomForStreamer()`で新規登録時、監視停止Roomが`reviveSuspendedMonitoring()`経由で復帰しクールダウンにも乗る | `resolveRoomForStreamer()` (src/lib/tiktok-room.ts) | 正常 | monitoringSuspended:true、notFoundStreak:3、consecutiveBlockedCount:5のRoomへ新規Streamer登録 | monitoringSuspended:false、notFoundStreak:0、consecutiveBlockedCount:0、lastLowValueCheckAtが現在時刻付近 | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-room.integration.test.ts` | PASS | 2026-09-05 | |
| TC-04 | 既に監視中のRoomへの新規登録は無害(no-op) | `resolveRoomForStreamer()` | 境界 | monitoringSuspended:falseのRoomへ新規Streamer登録 | monitoringSuspended:falseのまま変化なし | 同上(tiktok-room.integration.test.ts) | PASS | 2026-09-05 | |
| TC-05 | 直接AxiosError(403)を`isBlockedError()`が検知する | `isBlockedError()` (src/lib/tiktok-listener.ts) | 正常 | `{isAxiosError:true, response:{status:403}}` | true | `npm run test:unit -- tiktok-listener.blocked-error.test.ts`(vitest run経由) | PASS | 2026-09-05 | |
| TC-06 | `FetchIsLiveError`内の403(配列走査)を検知する | 同上 | 正常 | `FetchIsLiveError`.errorsに403のAxiosErrorを含む | true | 同上 | PASS | 2026-09-05 | |
| TC-07 | `error.exception`にラップされた403も検知する(TLCのconn.on("error")形式) | 同上 | 境界 | `{exception:{isAxiosError:true, response:{status:403}}}` | true | 同上 | PASS | 2026-09-05 | fable-expert MEDIUM指摘への対応(HIGH-2ではなくMEDIUM-2a)。テスト追加要 |
| TC-08 | SIGI_STATE抽出失敗等の文言ベースエラーは対象外(誤検知しない) | 同上 | 異常 | Error("Failed to extract the SIGI_STATE...") | false | 同上 | PASS | 2026-09-05 | |
| TC-09 | 403以外のステータス・無関係エラー・UserOfflineErrorはfalse(排他確認) | 同上 | 異常/回帰 | 各種エラー | false | 同上 | PASS | 2026-09-05 | |
| TC-10 | `recordBlockedAttempt()`は自worker(WORKER_INDEX一致)担当のRoomのみincrementする | `recordBlockedAttempt()` | 正常 | WORKER_INDEX=0、workerId=0のRoom | consecutiveBlockedCountが+1 | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.blocked-attempt.integration.test.ts` | PASS | 2026-09-05 | |
| TC-11 | 他worker担当(workerId不一致)のRoomには影響しない(再割当直後のin-flightレース対策) | 同上 | 異常/境界 | workerId=1のRoom(自worker=0) | consecutiveBlockedCountは0のまま | 同上 | PASS | 2026-09-05 | |
| TC-12 | 担当worker未割当(workerId:null)のRoomにも影響しない | 同上 | 境界 | workerId:nullのRoom | consecutiveBlockedCountは0のまま | 同上 | PASS | 2026-09-05 | |
| TC-13 | `persistState()`が"connected"到達でconsecutiveBlockedCountを0リセットする | `persistState()` (src/lib/tiktok-listener.ts) | 回帰 | consecutiveBlockedCount:4のRoomへ"connected"遷移 | consecutiveBlockedCountが0になる(unhealthySince等も同時クリア) | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.unhealthy.integration.test.ts` | PASS | 2026-09-05 | |
| TC-14 | "retrying"遷移ではconsecutiveBlockedCountに触れない | 同上 | 回帰 | consecutiveBlockedCount:3のRoomへ"retrying"遷移 | consecutiveBlockedCountは3のまま不変 | 同上 | PASS | 2026-09-05 | |
| TC-15 | reason='user_offline'到達でもconsecutiveBlockedCountが0リセットされる(散発403の誤蓄積防止) | `persistState()` | 境界 | consecutiveBlockedCount:4のRoomへstatus="retrying", reason="user_offline"で遷移 | consecutiveBlockedCountが0になる | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.unhealthy.integration.test.ts` | PASS | 2026-09-05 | |
| TC-16 | `decideBlockedRoomAction()`: 未試行workerがあれば最小負荷を選ぶ | `decideBlockedRoomAction()` (src/lib/worker-guardian.ts) | 正常 | eligibleTargets=[1,2,3]、負荷[5,1,3] | `{action:"reassign", toWorker:2}` | `npx vitest run src/lib/worker-guardian.test.ts` | PASS | 2026-09-05 | |
| TC-17 | ガード期間内(3分以内)はskip(振動防止) | 同上 | 境界 | lastReassignedAt=60秒前 | `{action:"skip"}` | 同上 | PASS | 2026-09-05 | |
| TC-18 | ガード期間経過後は未試行workerへ再割当する | 同上 | 正常 | lastReassignedAt=ガード期間超過 | `{action:"reassign"}` | 同上 | PASS | 2026-09-05 | |
| TC-19 | 全healthy workerを試し終えたらgive_up | 同上 | 異常 | triedWorkers=全healthy worker | `{action:"give_up"}` | 同上 | PASS | 2026-09-05 | |
| TC-20 | healthy worker自体が0件ならskip | 同上 | 境界 | eligibleTargets=[] | `{action:"skip"}` | 同上 | PASS | 2026-09-05 | |
| TC-21 | gaveUpAtが立っている部屋は未試行workerがあっても永久にskip(無限再割当ループ防止) | 同上 | 異常/回帰 | state.gaveUpAt=直前、eligibleTargets=[1,2,3]全未試行 | `{action:"skip"}` | 同上 | PASS | 2026-09-05 | review-auto HIGH-1修正の回帰固定 |
| TC-22 | AgencyWatch/イベントmonitorUntil有効な部屋はgive-up後もwatchedRoomFilterにより監視対象のままだが、gaveUpAtにより再割当ループへ入らない | `runGuardianCycle()` 403処理セクション(prisma/worker-statusをモック) | 異常/回帰 | give_up済み(gaveUpAt有)のRoomが再度consecutiveBlockedCount閾値超過 | migrateBlockedRoom/giveUpBlockedRoom(updateManyMock)が呼ばれない、gaveUpAtは維持 | `npx vitest run src/lib/worker-guardian.cycle.test.ts` | PASS | 2026-09-05 | 当初はintegration化困難としてNOT RUN予定だったが、fable-expertのテストケースレビューで「runGuardianCycleの外部依存4つ(getSetting/fetchAssignedRooms/probeWorkers/prisma)は全てモジュールimportでvi.mockできる」と指摘されunit化。DBは不要 |
| TC-23 | `migrateBlockedRoom()`失敗時(advisory lock競合/WHERE不一致)はtriedWorkersを進めない | 同上 | 異常 | `$queryRaw`→`{locked:false}` および `updateMany`→`{count:0}` の2ケース | いずれもblockedRoomStateにroomのエントリが作られない(次サイクル同じuntried workerへ再試行) | 同上 | PASS | 2026-09-05 | TC-22と同じ理由でunit化 |
| TC-24 | `giveUpBlockedRoom()`失敗時はgaveUpAtを立てない | 同上 | 異常 | give_up経路で`updateMany`→`{count:0}` | gaveUpAtがnullのまま | 同上 | PASS | 2026-09-05 | TC-22と同じ理由でunit化 |
| TC-29 | 再割当成功時、fromWorker自身もtriedWorkersへ加わる(元workerへの無駄な逆戻りを防ぐ) | `runGuardianCycle()` 403処理セクション | 正常 | workerId:0のRoomが閾値超過、healthy worker[0,1,2] | 移送先(1 or 2)に加えfromWorker(0)もtriedWorkersに入る | `npx vitest run src/lib/worker-guardian.cycle.test.ts` | PASS | 2026-09-05 | fable-expert指摘(設定表レビュー)。HIGH-2修正の一部だが決定的関数のみのTC-16〜21ではカバーできていなかった |
| TC-30 | 完全復帰(listenerStatus="connected"かつconsecutiveBlockedCount=0)した部屋のstateエントリは削除され、新episodeとして再スタートできる | `runGuardianCycle()` 冒頭のpurge処理 | 境界/回帰 | gaveUpAt有のRoomがconnected&count=0で観測される | blockedRoomStateからエントリが消える | 同上 | PASS | 2026-09-05 | HIGH-1修正のpurgeロジック本体 |
| TC-31 | blocked kill switch(workerGuardianBlockedReassignDisabled)が403処理だけを止め、既存の死活監視とは独立していること | `runGuardianCycle()` | 異常/回帰 | kill switch=true | migrateBlockedRoom等が呼ばれない | 同上 | PASS | 2026-09-05 | fable-expert指摘(設定表レビュー) |
| TC-32 | server.jsのJS複製(`reviveSuspendedMonitoringForRoom`)が機能A用フィールドをTS版と同じセット持つこと | server.js | 回帰 | ソース比較 | 目視: `lastLowValueCheckAt: new Date()`がserver.js側にも存在する(mark-last-active.tsとの手動diff確認) | 目視確認(vitestからserver.js/Next起動を含むためrequire不可) | PASS(目視) | 2026-09-05 | fable-expert指摘。自動drift-guard化は将来課題として見送り(今回はserver.js:150行目付近を目視確認し一致を確認済み) |
| TC-25 | typecheck全体が通ること | プロジェクト全体 | 回帰 | schema.prisma変更(consecutiveBlockedCount追加)を含む | エラー0件 | `npm run typecheck` | PASS | 2026-09-05 | |
| TC-26 | unit test全体が通ること(既存機能への影響なし) | プロジェクト全体 | 回帰 | 変更後の全コード | 86 test files / 1234 tests PASS | `npm run test:unit` | PASS | 2026-09-05 | worker-guardian.cycle.test.ts追加(8件)により85→86ファイル、1226→1234件 |
| TC-27 | integration test全体が通ること | プロジェクト全体 | 回帰 | ローカルDB(docker) | 70 test files / 704 tests PASS | `npm run test:integration` | PASS | 2026-09-05 | 初回実行時tiktok-listener.connection-log.integration.test.tsが1件failしたが単独実行・再実行で通過(既知のcross-file干渉、本変更と無関係) |
| TC-28 | UI変更 | 該当なし | UI | - | 該当なし: 本機能はworker/guardianのバックエンドロジックのみでUI変更を含まない | - | 該当なし | 2026-09-05 | |

## 変更履歴

### 2026-09-05: 機能A(監視復帰クールダウン)+機能B(403ブロックworkerフェイルオーバー)実装

- diff: working tree(HEAD=4da6979からの未commit差分、worktree blocked-failover)
- risk: HIGH / reviewers: 実装後レビューはCodex(quota切れ、2026-09-07まで)代替のfable-expert + Qwen(カナリア不通過につき参考情報)。テストケースレビューも同構成
- review_summary: findings=5(fable-expert、review-auto) + findings=3(fable-expert、test-auto設定表レビュー) valid=8 fixed=5、テスト追加3(TC-22/23/24をunit化、TC-29〜32を新規追加)
- 追加したケース: TC-01〜TC-32
- 更新したケース: TC-15(NOT RUN→PASS、integrationテスト追加)、TC-22/TC-23/TC-24(NOT RUN→PASS、runGuardianCycleの外部依存をvi.mockしunit化。fable-expertの指摘で「advisory lock意味論ではなく呼び出し側の分岐ロジックの検証」と整理し直し実現)
- レビュー指摘と対応:

  | # | reviewer | severity | 指摘 | 分類 | 対応 |
  | --- | --- | --- | --- | --- | --- |
  | 1 | fable-expert(review-auto) | HIGH | give-up後もAgencyWatch/イベント監視対象の部屋は接続が止まらず403→worker一巡→give_upの無限ループが起きる | VALID | worker-guardian.tsを修正。gaveUpAtマーカー追加、decideBlockedRoomActionで永久skip、runGuardianCycle冒頭でconnected&&count=0の部屋のみpurge。TC-21(unit,純粋関数)+TC-22(unit,runGuardianCycle)で固定 |
  | 2 | fable-expert(review-auto) | HIGH | migrateBlockedRoomがvoid返却で失敗時もtriedWorkersが進み早期give_upにつながる。fromWorker自身もtriedWorkers未登録 | VALID | migrateBlockedRoom/giveUpBlockedRoomをPromise<boolean>化、成功時のみstate更新。fromWorkerもtriedWorkersに追加。TC-23/TC-24/TC-29で固定 |
  | 3 | fable-expert(review-auto) | MEDIUM | consecutiveBlockedCountが"connected"到達でしかリセットされず、長期オフライン配信者の散発403が誤って蓄積する | VALID | persistState()のCASE式にreason='user_offline'を追加。TC-15で回帰固定 |
  | 4 | fable-expert(review-auto) | MEDIUM | isBlockedErrorがerror.exception/error.causeを見ておらず、TLCラップ形式のpost-connect 403を見逃す | VALID | isBlockedErrorのcandidatesにexception/causeを追加。TC-07で回帰固定 |
  | 5 | fable-expert(review-auto再レビュー) | LOW | giveUpBlockedRoom失敗時もgaveUpAtが立ち、以後give-upを二度と試みなくなる | VALID | giveUpBlockedRoomをboolean化し呼び出し側で成功時のみgaveUpAtセット。TC-24で固定 |
  | 6 | Qwen(review-auto初回・再レビュー) | - | NO ISSUES(カナリア不通過、両run共に信頼性なし) | INVALID(判定不能) | 参考にせず、fable-expertの指摘のみ採用 |
  | 7 | fable-expert(test-auto設定表レビュー) | 指摘 | TC-22〜24はNOT RUN不要。runGuardianCycleの4外部依存(getSetting/fetchAssignedRooms/probeWorkers/prisma)は全てモジュールimportでvi.mock可能、DB不要でunit化できる | VALID | `worker-guardian.cycle.test.ts`新規作成(8テスト)。TC-22/23/24をPASSへ更新、TC-29(fromWorkerのtriedWorkers化)/TC-30(purgeロジック)/TC-31(kill switch独立性)を追加 |
  | 8 | fable-expert(test-auto設定表レビュー) | 指摘 | server.jsのJS複製(reviveSuspendedMonitoringForRoom)が設定表でカバーされていない。今回追加した2フィールドがTS側テストでしか検出できない | VALID | server.js:155-168を目視確認、TS版mark-last-active.tsと同じ`lastLowValueCheckAt`/`consecutiveBlockedCount`を持つことを確認。TC-32として追加(目視確認、自動drift-guard化は将来課題として見送り) |

- 実行結果サマリ: PASS 31 / FAIL 0 / NOT RUN 0 / 該当なし 1(TC-28: UI変更なし)
