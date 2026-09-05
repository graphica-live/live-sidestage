---
project: live-sidestage-analytics
feature: tiktok-battle-persistence
last_updated: 2026-09-06
last_risk: HIGH
last_reviewers: Qwen(未読疑いにつき無効)。Codex/Geminiはquota切れで利用不可、ユーザー承認の上でレビューなしで実施
---

# テストベースライン: tiktok-battle-persistence

TikTok LinkMicバトル(linkMicBattle/linkMicArmies)の受信payloadを`TiktokBattle`(`tiktok_battles`)行へ永続化する処理(`src/lib/tiktok-listener.ts`のpersistBattle/recordBattleEvent、`src/lib/tiktok-battle.ts`のパース処理)。生payload(`raw`列)は保存しない — デバッグ・fixture採取専用だったため2026-09-06に列自体を撤去し、`hostUserIds`/`hostDisplayIds`/`hostScores`/`hostProfiles`/`hostTeams`等の解釈済みフィールドのみ永続化する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-TBP-001 | linkMicBattle/linkMicArmies受信でTiktokBattle行がraw列なしで作成・更新される | `src/lib/tiktok-listener.ts` persistBattle | 正常 | linkMicBattle(OPEN)→linkMicArmies(スコア更新)→linkMicBattle(FINISH) | `tiktok_battles`行が1件でaction/hostScores等が最新化される。`raw`列は存在しない(スキーマ上撤去済み) | `npx dotenv -e .env.local.test -- npx vitest run integration src/lib/tiktok-listener.battle-armies-snapshot.integration.test.ts` | PASS | |
| TC-TBP-002 | バトル確定処理(BattleHistory)がTiktokBattleのraw非依存フィールドのみで動作する | `src/lib/battle-history-finalize.ts`, `battle-history.ts` | 回帰 | 終了済みバトルを確定処理 | BattleHistory/Participant/Contributorへの非正規化スナップショットが従来どおり作られる | `npx dotenv -e .env.local.test -- npx vitest run integration src/lib/battle-history.integration.test.ts src/lib/battle-history-finalize.integration.test.ts` | PASS | |
| TC-TBP-003 | TiktokRoom統合(absorb)時のTiktokBattle衝突解決がraw列参照なしで動作する | `src/lib/tiktok-id-migration.ts` | 回帰 | battleId衝突する2行をabsorb | endedAt優先で残存行が更新され、raw列を参照するUPDATE文が存在しない | `npx dotenv -e .env.local.test -- npx vitest run integration src/lib/tiktok-id-migration.integration.test.ts` | PASS | 生SQLに`"raw" = old."raw"`が残っていて削除漏れ→修正済み |
| TC-TBP-004 | イベント機能(デスマッチ/対戦カード)のバトル検知がTiktokBattle raw列なしで動作する | `src/event/battles.integration.test.ts`, `deathmatch.integration.test.ts` | 回帰 | イベント対戦中にバトルをINSERT/UPDATE | 検知・集計が従来どおり動作する | `npx dotenv -e .env.local.test -- npx vitest run integration src/event/battles.integration.test.ts src/event/deathmatch.integration.test.ts` | PASS | 生SQLのINSERT文に`raw`列指定が残っていて削除漏れ→修正済み |
| TC-TBP-005 | デバッグAPI `/api/debug/battle-payloads` が撤去されている | `src/app/api/debug/battle-payloads/route.ts` | negative | 該当パスへアクセス | ルート自体が存在しない(404) | ファイル削除済みをtypecheck/buildで確認 | PASS | tiktok-probe Skillが同用途を代替 |
| TC-TBP-006 | raw依存の使い捨てbackfillスクリプト3本が撤去されている | `scripts/backfill-battle-host-{user-ids,teams,profiles}.ts` | negative | スクリプト実行を試みる | ファイルが存在しない | ファイル削除済みをgit statusで確認 | PASS | 過去の特定バグ修正/列追加向けの一回性スクリプトで実行済み前提。ユーザー承認済み |
| TC-TBP-007 | 全体unit/integrationテストに回帰がない | プロジェクト全体 | 回帰 | - | 既存の全テストが通る | `npx vitest run --exclude "**/*.integration.test.ts"` / `npx dotenv -e .env.local.test -- npx vitest run integration` | PASS(unit 1234件, integration 707件/72ファイル) | |

## Quality Gate

- `npm run typecheck`(`tsc --noEmit`)
- `npm run test:unit`
- `npm run test:integration`(要 `.env.local.test` + ローカルPostgres)

## Out of Scope

- 本番DBへの`prisma db push --accept-data-loss`実行そのもの(デプロイ時に自動実行される運用。今回はmigrationファイル追加のみで実行はしていない)
- `raw`列の過去データが必要になった場合の復旧手段(データはdb push実行時に失われる。ユーザー承認済みでOut of Scope)
