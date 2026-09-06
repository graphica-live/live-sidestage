---
project: live-sidestage-analytics
feature: tiktok-battle-persistence
last_updated: 2026-09-06
last_risk: MEDIUM
last_reviewers: Code Mode=DeepSeek V4 Flash単独(MEDIUM)。TestCase Mode=DeepSeek V4 Flash単独(finding 3件をTC-TBP-016〜018として反映)
---

# テストベースライン: tiktok-battle-persistence

TikTok LinkMicバトル(linkMicBattle/linkMicArmies)の受信payloadを`TiktokBattle`(`tiktok_battles`)行へ永続化する処理(`src/lib/tiktok-listener.ts`のpersistBattle/recordBattleEvent、`src/lib/tiktok-battle.ts`のパース処理)。生payload(`raw`列)は保存しない — デバッグ・fixture採取専用だったため2026-09-06に列自体を撤去し、`hostUserIds`/`hostDisplayIds`/`hostScores`/`hostProfiles`/`hostTeams`等の解釈済みフィールドのみ永続化する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-TBP-001 | linkMicBattle/linkMicArmies受信でTiktokBattle行がraw列なしで作成・更新される | `src/lib/tiktok-listener.ts` persistBattle | 正常 | linkMicBattle(OPEN)→linkMicArmies(スコア更新)→linkMicBattle(FINISH) | `tiktok_battles`行が1件でaction/hostScores等が最新化される。`raw`列は存在しない(スキーマ上撤去済み) | `npx dotenv -e .env.local.test -- npx vitest run integration src/lib/tiktok-listener.battle-armies-snapshot.integration.test.ts` | PASS | |
| TC-TBP-002 | バトル確定処理(BattleHistory)がTiktokBattleのraw非依存フィールドのみで動作する | `src/lib/battle-history-finalize.ts`, `battle-history.ts` | 回帰 | 終了済みバトルを確定処理 | BattleHistory/Participant/Contributorへの非正規化スナップショットが従来どおり作られる | `npx dotenv -e .env.local.test -- npx vitest run src/lib/battle-history.integration.test.ts src/lib/battle-history-finalize.integration.test.ts` | PASS | |
| TC-TBP-008 | バトル確定処理のトリガ・安定性チェック待機時間が短縮値で動作する | `src/lib/tiktok-listener.ts`(`BATTLE_FINALIZE_DELAY_MS`), `src/lib/battle-history-finalize.ts`(`STABILITY_DELAY_MS`) | 正常 | END検知→10秒後に1回目計算→10秒後に2回目計算、一致すれば確定 | `BATTLE_FINALIZE_DELAY_MS===10_000`・`STABILITY_DELAY_MS===10_000`。END検知から確定までの最短実時間は20秒。1回目/2回目の間に値が変化すれば`unstable`で確定しない(既存回帰ケースで担保) | `npx dotenv -e .env.local.test -- npx vitest run src/lib/battle-history-finalize.integration.test.ts` | PASS | 2026-09-06、ユーザー指示で30秒/60秒から短縮。表示速度優先で遅延Gift取りこぼしリスクが従来より上がるトレードオフ(詳細はbattle-history-finalize.ts冒頭コメント) |
| TC-TBP-003 | TiktokRoom統合(absorb)時のTiktokBattle衝突解決がraw列参照なしで動作する | `src/lib/tiktok-id-migration.ts` | 回帰 | battleId衝突する2行をabsorb | endedAt優先で残存行が更新され、raw列を参照するUPDATE文が存在しない | `npx dotenv -e .env.local.test -- npx vitest run integration src/lib/tiktok-id-migration.integration.test.ts` | PASS | 生SQLに`"raw" = old."raw"`が残っていて削除漏れ→修正済み |
| TC-TBP-004 | イベント機能(デスマッチ/対戦カード)のバトル検知がTiktokBattle raw列なしで動作する | `src/event/battles.integration.test.ts`, `deathmatch.integration.test.ts` | 回帰 | イベント対戦中にバトルをINSERT/UPDATE | 検知・集計が従来どおり動作する | `npx dotenv -e .env.local.test -- npx vitest run integration src/event/battles.integration.test.ts src/event/deathmatch.integration.test.ts` | PASS | 生SQLのINSERT文に`raw`列指定が残っていて削除漏れ→修正済み |
| TC-TBP-005 | デバッグAPI `/api/debug/battle-payloads` が撤去されている | `src/app/api/debug/battle-payloads/route.ts` | negative | 該当パスへアクセス | ルート自体が存在しない(404) | ファイル削除済みをtypecheck/buildで確認 | PASS | tiktok-probe Skillが同用途を代替 |
| TC-TBP-006 | raw依存の使い捨てbackfillスクリプト3本が撤去されている | `scripts/backfill-battle-host-{user-ids,teams,profiles}.ts` | negative | スクリプト実行を試みる | ファイルが存在しない | ファイル削除済みをgit statusで確認 | PASS | 過去の特定バグ修正/列追加向けの一回性スクリプトで実行済み前提。ユーザー承認済み |
| TC-TBP-009 | ボーナスミッション区間が taskStart→taskSettle→rewardSettle で1行を順に埋める | `src/lib/tiktok-listener.ts` saveBattleBonusMission, `src/lib/tiktok-battle.ts` parseBattleTaskEvent | 正常 | linkMicBattleTask を messageType 0→2→3 の順に受信 | `tiktok_battle_bonus_missions` が1行だけ作られ、targetType/progressTarget/rewardMultiple → settledAt/taskResult/rewardStartedAt → rewardEndedAt の順に埋まる(行は増えない) | `npx dotenv -e .env.local.test -- npx vitest run src/lib/tiktok-listener.battle-bonus-mission.integration.test.ts` | PASS | |
| TC-TBP-010 | taskStart を取りこぼした状態の settle は行を作らない | 同上 | 異常 | taskStart 抜きで messageType 2 / 3 を受信 | 行が0件のまま(条件も開始時刻も無い部分行を作らない) | 同上 | PASS | |
| TC-TBP-011 | taskUpdate(進捗、高頻度)は保存しない | 同上 | 境界/負荷 | taskStart 後に messageType 1 を5回受信 | 行数は1件のまま増えない | 同上 | PASS | 保存すると区間1つあたり数十〜数百行になるため |
| TC-TBP-012 | 条件が欠けた taskStart は保存しない | 同上 | 異常 | taskPeriodConfig に targetType しか無い taskStart | 行が0件(「何のミッションか」を表示できない行を作らない) | 同上 | PASS | |
| TC-TBP-013 | ボーナスミッション書込みが失敗しても後続イベントの処理が止まらない | 同上 + `queueBattleWrite` | 異常/回帰 | create を1回だけ失敗させ、その後同じ taskStart を再送 | `battle bonus mission save error` はログに出るが `queued write failed`(キュー自体のreject)は出ず、後続の taskStart は正常に保存される | 同上 | PASS | armies snapshot と同じ「握りつぶす」方針の担保 |
| TC-TBP-014 | ギフトのネスト matchInfo から倍率刻印が Gift 行へ保存される | `src/lib/tiktok-listener.ts` resolveGiftMultiplier / buildGiftRow | 正常 | `gift` イベントに `matchInfo: {multiplierType:1, multiplierValue:"5"}` | `gifts.multiplierType=1` / `multiplierValue=5`。**平坦化されないネスト形で届く**前提を固定する | 同上 | PASS | data-converter.ts が平坦化するのは giftDetails/giftExtra のみ |
| TC-TBP-015 | multiplierType=0(倍率なし)と未観測(null)を区別する | 同上 | 境界 | matchInfo が `{multiplierType:0, multiplierValue:0}` のギフトと、matchInfo 自体が無いギフト | 前者は 0、後者は null で保存される | 同上 | PASS | 0 を null に丸めると「倍率なしと観測できた」情報が失われ、初ギフトx倍の逆算でクリーン候補を選べなくなる |
| TC-TBP-016 | 未確定行が2つ重なった場合、settleは古い方から順(FIFO)に対応づく | `saveBattleBonusMission`(`startedAt: "asc"`) | 境界 | 同一battleIdで taskStart×2 の後に taskSettle(result=2)→taskSettle(result=1) | 先に始まった行(targetType=1)に result=2、後の行(targetType=2)に result=1 が入る | `npx dotenv -e .env.local.test -- npx vitest run src/lib/tiktok-listener.battle-bonus-mission.integration.test.ts` | PASS | payloadに区間の識別子が無いため、ライフサイクルが崩れた場合の対応づけ規則を固定する |
| TC-TBP-017 | rewardSettle が taskSettle より先に届いた場合は捨てる | 同上 | 境界/異常 | taskStart→rewardSettle→taskSettle の順で受信 | 行は settledAt / taskResult まで埋まり、`rewardEndedAt` は null のまま。例外もキューのrejectも起きない | 同上 | PASS | 観測できる劣化として許容(区間終了時刻が欠けるだけ) |
| TC-TBP-018 | matchInfo が無くフラットな倍率フィールドだけでも保存される | `resolveGiftMultiplier` | 境界/回帰 | `gift` イベントに matchInfo 無し・`multiplierType:2` / `multiplierValue:"10"` | `gifts.multiplierType=2` / `multiplierValue=10` | 同上 | PASS | data-converter.ts が将来 matchInfo を平坦化した場合の保険経路 |
| TC-TBP-007 | 全体unit/integrationテストに回帰がない | プロジェクト全体 | 回帰 | - | 既存の全テストが通る | `npx vitest run --exclude "**/*.integration.test.ts"` / `npx dotenv -e .env.local.test -- npx vitest run src/lib/battle-history-finalize.integration.test.ts src/lib/battle-history.integration.test.ts src/lib/gift-retention.integration.test.ts` | PASS(unit 1290件、対象integration 37件) | 2026-09-06はロジック変更なし(定数+コメントのみ)のため対象integrationのみ実行。typecheckも別途PASS |

## Quality Gate

- `npm run typecheck`(`tsc --noEmit`)
- `npm run test:unit`
- `npm run test:integration`(要 `.env.local.test` + ローカルPostgres)

## Out of Scope

- 本番DBへの`prisma db push --accept-data-loss`実行そのもの(デプロイ時に自動実行される運用。今回はmigrationファイル追加のみで実行はしていない)
- `raw`列の過去データが必要になった場合の復旧手段(データはdb push実行時に失われる。ユーザー承認済みでOut of Scope)
- **実payloadでの検証**: `linkMicBattleTask` の生payloadと `WebcastGiftMessage.matchInfo` は実配信のバトルでしか観測できない。上記TC-TBP-009〜015は型定義(tiktok-schema.ts)とBATTLE-EVENTS.mdから組んだ合成payloadで固めたもので、**本番デプロイ後に `SELECT count(*) FROM tiktok_battle_bonus_missions` と `SELECT count(*) FROM gifts WHERE "multiplierType" IS NOT NULL` が0でないことを確認する工程が別途要る**(0件ならフィールド名の想定が誤り)
- `rewardSum`: proto(`WebcastLinkmicBattleTaskMessage_BattleRewardSettle`)に `sum` フィールドが存在せず、実payloadに乗っているかも未確認。乗っていなければ常にnullになる(best-effort)
