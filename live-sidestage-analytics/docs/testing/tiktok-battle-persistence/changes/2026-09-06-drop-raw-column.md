---
date: 2026-09-06
feature: tiktok-battle-persistence
risk: HIGH
reviewers: Qwen(未読疑い、無効扱い)。Codex/Geminiはquota切れで利用不可
---

# TiktokBattle.raw列とデバッグ用途の撤去

- change summary: `TiktokBattle.raw`(Json NOT NULL、受信payload恒久保存)列を削除。読み出し専用だった`/api/debug/battle-payloads` API、rawを参照する使い捨てbackfillスクリプト3本(`backfill-battle-host-user-ids/teams/profiles.ts`)も削除。DROP COLUMN migrationを追加(本番は`prisma db push --accept-data-loss`運用のためmigrationファイル自体は実行されず、web起動時のdb pushでカラム削除・既存データロスが発生する)。
- reason: デバッグ・fixture採取専用の生JSON列が本番テーブルへ無期限蓄積していた。バトル確定後は`BattleHistory`系の非正規化スナップショットが本体になるためraw依存は不要。生payloadの調査は現在`tiktok-probe` Skillが代替する。3本のbackfillスクリプトは過去の特定バグ修正/列追加(hostUserIds汚染修正、hostTeams/hostProfiles列追加)向けの一回性ツールで実行済み前提、ユーザー承認の上で削除。
- affected baseline cases: TC-TBP-001〜007(新規baseline、全て今回追加)
- important findings / VALID・INVALID の重要判断:
  - VALID(自己検出): grepでは検出できなかった生SQL($executeRaw/$executeRawUnsafe)内の`raw`カラム参照が3箇所(`src/lib/tiktok-id-migration.ts`のUPDATE文、`src/event/deathmatch.integration.test.ts`と`src/event/battles.integration.test.ts`と`scripts/bench-aggregate.ts`のINSERT文)に残存していた。integration testを実データ相当のworktree専用DBに対して実行して初めて`column "raw" does not exist`で発覚。修正して全707件integration testがPASSすることを確認した
  - Qwenレビュー(review-auto Code Mode、MEDIUM→migration絡みでHIGH再判定): 2回ともコンテキスト11,700〜11,814トークンに対し`NO ISSUES`のみを返却。カナリア(既知の脆弱コード片を末尾に追加)を検出できず、SKILL既定の判定基準により「レビュー未実施」と判断し不採用
  - Codex: quota切れ(2026-09-07 19:54復帰予定)。Gemini(Codex代理): quota切れ(151h46m後復帰予定、~9/13頃)。両方利用不可のためユーザーへ確認し、外部レビューなしで続行する承認を得た
- verification: カナリア検証(既知バグ混入→再検出失敗でQwen出力を棄却)。手動grep+実SQL実行によるintegration test(worktree専用DB, 72ファイル707件)で生SQL削除漏れを検出・修正・再検証済み
- remaining risks: 本番デプロイ時、既存`TiktokBattle.raw`データはdb push実行と同時に失われる(ユーザー承認済み、復旧不可)。外部レビュー(Codex/Gemini)が復旧後に見つける可能性のある指摘は未反映
- rollback / migration note: 本番ロールバックは`raw`列復活が必要な場合、過去データはdb push実行時点で失われているため復元不可。schema.prismaへ`raw Json?`を戻し再度db pushすればカラム自体は復活するがデータは空になる
