---
project: live-sidestage-analytics
feature: battle-opponent-watch
last_updated: 2026-09-07
last_risk: MEDIUM
last_reviewers: Design Mode=DeepSeek単独。Code Mode=DeepSeek単独(TestCaseレビューは本Skillで単独実施)
---

# テストベースライン: battle-opponent-watch

対戦相手ライバーの自動監視(TikTokコラボ承諾検知 `linkLayer` messageType:18 / バトル開始補助検知
`linkMicBattle` action:4)と、`/analytics` バトル履歴一覧の全陣営スコア表示。

- `src/lib/tiktok-listener.ts` — `recordCollabGroupChange`(主トリガー)、`watchBattleOpponents`(補助トリガー)、
  共通ヘルパー`watchDiscoveredRooms`、`recordOpponentWatch`
- `src/lib/tiktok-room.ts` — `ensureRoomWatchedForCollab`(`source`引数、`TiktokRoom.watchSource`記録)
- `src/lib/tiktok-battle.ts` — `OpponentWatch`/`OpponentWatchEntry`/`OpponentWatchSource`型
- `src/components/analytics/battle-types.tsx` / `AnalyticsView.tsx` — `BattleScoreLine`(全陣営スコア表示)
- `src/lib/room-connection-log.ts` — `coverageFromIntervals`(接続区間→被覆率+欠落区間`gaps`)、
  `refineCaptureByScore`(欠落区間で実際に失われた公式スコア量による`captureStatus`の格上げ)
- `src/lib/battle-history-finalize.ts` — `refineCaptureWithOfficialScore`(`TiktokBattleArmiesSnapshot`を読んで上記へ渡す)

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-BOW-001 | Streamer登録0件(subscriberIds空)のroomでもコラボ承諾検知で相手roomを発見する | `tiktok-listener.ts` linkLayerハンドラ | 正常 | subscriberIds空でstartListener、linkLayerでREPLY_STATUS_AGREE | 相手roomが作成され`watchSource==="collab"` | `npx dotenv -e .env.local.test -- vitest run integration src/lib/tiktok-listener.collab-kick.integration.test.ts` | PASS | 2026-09にガード撤廃。以前はStreamer登録0件だと先頭でreturnし検知できなかった |
| TC-BOW-002 | 新規発見のコラボ相手roomは自WORKER_INDEXで作成され即接続、再送では二重接続しない | `recordCollabGroupChange` | 回帰 | 同上ファイル既存TC | 相手roomがworkerId=自分で作成、`connectCalls===1`、再送で接続数増えない | 同上 | PASS | ガード撤廃前からの既存保証。回帰なしを確認 |
| TC-BOW-003 | 他workerが既に担当しているroomはコラボ検知しても接続もworkerId上書きもしない | `recordCollabGroupChange` | 回帰 | 同上 | 接続増えず、workerId維持 | 同上 | PASS | |
| TC-BOW-004 | `getWorkerConfig()`失敗(WORKER_INDEX不正)時は新規room作成しても即キックしない | `recordCollabGroupChange` / `tryGetOwnWorkerIndex` | 異常 | `WORKER_INDEX=invalid` | 相手roomは作成されるが`workerId===null`、即キックなし、`console.error`に"getWorkerConfig失敗"を含む | 同上 | PASS | |
| TC-BOW-005 | `linkMicBattle` action:4(OPEN)で相手roomが未監視ならbattle_start経由で作成し、`opponentWatch`へ記録する | `watchBattleOpponents` / `recordOpponentWatch` | 正常 | 相手room未登録の状態でバトル開始payloadを受信 | 相手roomが`watchSource==="battle_start"`で作成され、`TiktokBattle.opponentWatch[anchorId].source==="battle_start"` | 同上 | PASS | コラボ承諾検知(主トリガー)を取りこぼした場合の補助トリガー |
| TC-BOW-006 | 相手roomが既に`collab`経由で監視中なら、バトル開始検知は`watchSource`を上書きせず`opponentWatch`へ`collab`と記録する | `watchBattleOpponents` | 正常/回帰 | 相手room(`watchSource="collab"`)存在下でバトル開始payload受信 | `TiktokRoom.watchSource`は`"collab"`のまま、`opponentWatch[anchorId].source==="collab"` | 同上 | PASS | 最初の発見経路を保持する仕様の確認 |
| TC-BOW-007 | `recordOpponentWatch`の書き込みは同一`${roomId}:${battleId}`キーのwrite queueで`persistBattle`の後に必ず実行される(順序保証) | `watchBattleOpponents` → `queueBattleWrite` | 境界/並行処理 | TC-BOW-005/006と同一シナリオ(バトル検知直後にopponentWatch更新が走る) | `TiktokBattle`行のcreate前にopponentWatch更新が走らない(P2025が発生しない) | 同上 | PASS | 実装時に一度この順序保証漏れで実際にP2025が発生することを確認し修正済み(queueBattleWriteでの直列化を追加) |
| TC-BOW-008 | `ensureRoomWatchedForCollab`の3分岐(新規作成/監視中/休止中)で`watchSource`/`watchSourceAt`が正しく記録・非上書きされる | `tiktok-room.ts` | 正常/境界 | 新規・監視中・休止中(watchSourceあり/なし)の各パターン | 新規作成時は指定`source`を記録、既存監視中は書き換えない、休止中で`watchSource`未設定なら今回の`source`を書く、既に設定済みなら上書きしない | `npx dotenv -e .env.local.test -- vitest run integration src/lib/tiktok-room.collab.integration.test.ts` | PASS | |
| TC-BOW-009 | `battle.teams`がある(2陣営以上)バトル一覧行は、自陣営を含む全陣営のスコアが" / "区切りで表示される | `BattleScoreLine`(`battle-types.tsx`) | 正常 | 1vs1vs1(3陣営、各1名)のpendingバトルをローカルDBへシード(`scripts/seed-local-battle-multiteam.ts`) | モバイルカード・デスクトップテーブルどちらも3陣営分のスコアが表示され、相手陣営が「-」で潰れない | `npm run dev:local` 起動後、Playwrightで`/analytics`のバトル履歴タブを撮影して目視確認(下記スクリーンショット参照) | PASS | 元バグ(相手側が「-」のみ表示)の再発防止ケース |
| TC-BOW-010 | 自陣営が単独最高スコアならbrand色+太字、自陣営より高い陣営があればred色+太字、同点最高(単独でない)は無着色 | `BattleScoreLine` | 正常/境界 | シナリオ3パターン: self-highest([1500,900,700])/self-losing([800,1600,1000])/tie-for-highest([1200,1200,500]) | self-highestは自陣営スコアがbrand色、self-losingはred色、tie-for-highestは無着色 | 同上(Playwright目視) | PASS | ハイライト規則はDesign Modeレビュー(Qwen finding #4)で明記した仕様どおり |
| TC-BOW-011 | `battle.teams`がnull(1v1・チーム未解決)の一覧行は、既存の`selfScore`/`opponentScore` 2値表示にフォールバックする | `BattleScoreLine` | 回帰 | 既存の1v1バトルデータ | 従来どおり自スコア/相手スコアの2値と勝敗色が表示される | 同上(Playwright目視)、および単体テストで既存2値ロジックの分岐に回帰がないことを確認 | PASS | |
| TC-BOW-013 | `battle.teams`にスコア未取得(null)の陣営が混在する場合、自陣営を含め着色しない | `BattleScoreLine` | 境界/回帰防止 | teams中の1陣営以上がscore:null(相手roomが未接続でスコア未取得の場合等) | 自陣営がnull以外の最高値でもbrand/red着色しない(全陣営スコアが揃うまで勝敗を示唆しない) | ソースレビュー(Fable finding、`hasNullScore`フラグの追加を確認) | PASS | Code Modeレビュー(Fable)で「null陣営混在時は無着色」というdocコメントと実装(自陣営が単独非null最高でbrand着色されてしまう)の不一致を指摘され修正。再スクリーンショットは未実施(NOT RUN理由: 撮影済みシナリオはいずれも全陣営スコア確定済みで本ケース非該当のため、コード直読で確認) |
| TC-BOW-014 | 接続区間の欠落(窓頭・区間の合間・窓尾)がすべて`gaps`として返る | `coverageFromIntervals` | 正常/境界 | 窓300秒に対し10-100秒と150-280秒だけ接続していた区間ログ | `gaps`が`[0-10, 100-150, 280-300]`の3区間。`coverage`/`status`の既存の意味は変わらない | `npx vitest run src/lib/room-connection-log.test.ts` | PASS | 窓を完全に覆う場合は`gaps: []` |
| TC-BOW-015 | 相手roomの接続遅れで生じた欠落区間にスコアの動きが無い、または無視できる量なら`captureStatus`が`complete`になる | `refineCaptureByScore` | 正常 | 窓頭10秒のgap、公式スコア時系列で当該区間の増分が0または最終スコアの1%未満かつ絶対値100未満 | `status: "complete"`へ格上げ。`coverage`は実測値のまま書き換えない | 同上 | PASS | 「一部」誤警報の解消が目的。本番60バトルで partial 25件が格上げ、据え置き0件 |
| TC-BOW-016 | 欠落区間で無視できない量のスコアが動いていた場合は`partial`のまま据え置く | `refineCaptureByScore` | 異常/境界 | 欠落区間の増分が絶対値100以上、または最終スコアの1%以上(最終スコアが極小のバトルを含む) | `status: "partial"`。`missedScore`に欠損量が入る | 同上 | PASS | 絶対値と割合のANDで判定。片方だけだと高スコア/極小スコアのどちらかで誤判定する |
| TC-BOW-017 | 判定材料が無い場合・`unavailable`の場合は格上げも格下げもしない | `refineCaptureByScore` | 異常 | スコア観測0件 / 窓尾gapで最終スコアもnull / `status: "unavailable"` / スコアが減少する異常データ | いずれも元の`status`を維持(`missedScore: null`、減少分は負値として足し込まない) | 同上 | PASS | 格上げ専用。coverageが高いのにスコアが欠けているケースはスナップショット側の欠測と区別できないため格下げしない |
| TC-BOW-018 | `battle_history_participants.captureStatus`の確定保存が上記の格上げを反映し、スナップショット読み出しに回帰が無い | `battle-history-finalize.ts` / `battle-history.ts` | 回帰 | 確定処理のintegrationシナリオ一式 | 既存の確定・再確定・陣営別集計の振る舞いが変わらない | `npx dotenv -e .env.local.test -- vitest run src/lib/battle-history-finalize.integration.test.ts src/lib/battle-history.integration.test.ts src/lib/tiktok-listener.battle-armies-snapshot.integration.test.ts` | PASS | スナップショット取得失敗時は`console.error`のうえ元の判定へフォールバックし、確定処理自体は継続する |
| TC-BOW-019 | 確定処理が`TiktokBattleArmiesSnapshot`を実DBから読んで格上げ判定に使う(配線の確認) | `refineCaptureWithOfficialScore` | 正常/境界 | 窓300秒のうち先頭30秒が未接続(coverage 0.9)のroomに対し、当該区間のスコア増分が3(格上げ)/400(据え置き)のsnapshot行を投入して`computeBattleSnapshot`を実行 | 増分3では`captureStatus: "complete"` かつ `captureCoverage: 0.9`(実測値のまま)、増分400では`"partial"`のまま | `npx dotenv -e .env.local.test -- vitest run src/lib/battle-history-finalize.integration.test.ts` | PASS | 純関数のunit(TC-BOW-015/016)とは別に、DBクエリ経由の配線を固定する |
| TC-BOW-012 | プロジェクト全体のunit/integrationテストが今回の変更で壊れていない | プロジェクト全体 | 回帰 | - | 既知の不安定要因([[analytics-vitest-cross-file-interference]])を除き全PASS | `npm run test:unit`、`npm run test:integration -- tiktok-room.collab.integration.test.ts tiktok-listener.collab-kick.integration.test.ts` | PASS | unit: 1311/1311(2026-09-07再実行)。integration(battle系3ファイル): 37/37 PASS |

## Quality Gate

- `npm run typecheck`(`tsc --noEmit`) — PASS
- `npx next build`(型・ルーティングのみ。`db push`を伴う`npm run build`は使わない) — PASS
- `npm run test:unit` — PASS(93 files / 1311 tests、2026-09-07)
- `npm run test:integration -- tiktok-room.collab.integration.test.ts tiktok-listener.collab-kick.integration.test.ts` — PASS
- `npx dotenv -e .env.local.test -- vitest run battle-history-finalize.integration battle-history.integration tiktok-listener.battle-armies-snapshot.integration` — PASS(3 files / 37 tests、2026-09-07)

## Out of Scope

- **接続確立までの数秒間そのものを無くすこと**: バトル開始検知から相手roomへの接続確立まで8〜11秒かかる構造は変わらない。TC-BOW-015 で扱うのは「その区間で実際にスコアが動いていなければ`complete`と判定する」ことだけで、区間自体の短縮(コラボ承諾トリガ`linkLayer` messageType:18 の取りこぼし解消)は別対応
- **`refineCaptureWithOfficialScore`のDBエラー分岐**: `prisma.tiktokBattleArmiesSnapshot.findMany`が例外を投げた場合に元の判定へフォールバックする経路は、`vi.mock`がプロセスをまたいで他ファイルへ漏れる既知の問題([[analytics-vitest-cross-file-interference]])があるためテスト化していない。実装は try-catch で`console.error`後に`base`をそのまま返すだけで、確定処理は継続する
- **確定済み行の再計算**: finalize は1バトル1回しか走らないため、本変更以前に確定した`battle_history_participants`は`partial`のまま残る。遡及的な再計算は行わない
- **`MAX_COLLAB_DISCOVERED_ROOMS`到達時の挙動**: ガード撤廃により連鎖発見の歯止めがこの上限のみになったが、実際に上限へ到達するケースの検証は本番相当の規模でしか再現できないためOut of Scope(到達時はwarnログを出して新規作成をスキップする実装のみ確認済み)
- **`BattleDetailModal`側の`opponentWatch`表示**: DB保持のみが今回のスコープで、UIへ表示する変更は含まない
- **既存の`tiktok-room.ts:238-273`コメント更新・`shared/tiktok-live-connector/BATTLE-EVENTS.md`/`~/.claude/skills/tiktok-probe/KNOWLEDGE.md`のドキュメント訂正**: 本baselineのテスト対象外(ドキュメントのみの変更)
- **`reviveSuspendedMonitoring`経路が`MAX_COLLAB_DISCOVERED_ROOMS`の上限判定を通らない件**(Code Modeレビュー、Fable指摘、MEDIUM): ガード撤廃で監視中の全roomからcollab/battle_start検知が起きるようになった結果、低価値クリーンアップ(`tiktok-low-value-cleanup.ts`)が一時停止(`monitoringSuspended:true`)したroomが、コラボ/バトル検知のたび無条件で`reviveSuspendedMonitoring`により復活しうる(`lastLowValueCheckAt`更新により最短7日は再停止されない)。上限判定はroom新規作成時のみに掛かっており、revive経路には掛かっていない(既存コメント「既存roomの監視再開は総数を増やさないため対象外」は意図的な設計だが、ガード撤廃後の運用への影響は未検証)。本番の監視中room総数(上限500に対する余裕)が分からないと閾値を確定できないため、今回のPRでは対応を見送りOut of Scopeとした。次回、本番の監視中room数と低価値クリーンアップの再停止率を確認したうえで、必要なら別対応する
