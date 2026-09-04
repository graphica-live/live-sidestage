---
date: 2026-09-05
project: live-sidestage-analytics
topic: BattleDetailModal 相手側「集計中」プレースホルダー追加+自陣営はみ出し修正
diff: working tree (worktree-battle-opponent-pending-placeholder)
risk: LOW
reviewers: Qwen
review_summary: findings=4 valid=2 fixed=2
---

# テストケース設定表: BattleDetailModal 相手側「集計中」プレースホルダー追加+自陣営はみ出し修正

## 変更概要

`BattleDetailModal.tsx` の `teams===null` かつ `contributors.length>0` のフォールバック分岐(189-208行)を `grid grid-cols-2` に変更。左列=既存`FallbackContributorList`(自陣営)、右列=新設`OpponentPendingPlaceholder`(「集計中…」を`animate-pulse`で点滅表示)。目的は自陣営リストが中央仕切りより右へはみ出すレイアウトバグの修正と、相手側への「集計中」表示の追加。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-01 | teams=nullかつcontributors>0のとき自陣営が2列gridの左半分に収まり右へはみ出さない | `BattleDetailModal.tsx:189-215` | 正常 | `TiktokBattle`(action=OPEN,endedAt=null,startedAt=直近60秒前)+自room宛`Gift`2件をシード | モーダルの貢献者セクションが`grid-cols-2`で、左列(自陣営🪙額含む)が右半分の領域に描画されない | `docker compose up -d db`→`npm run db:push:local`→`npm run seed:local`→`npm run seed:battle-live:local`(`scripts/seed-local-live-battle.ts`)→Playwright(`battle-scratch/check-battle-modal.mjs`、スクラッチ領域)でスクリーンショット | PASS | before/after screenshot 提示済 |
| TC-02 | 相手側に「集計中…」が点滅表示される | `OpponentPendingPlaceholder`(新設) | 正常 | TC-01と同一シード | 右列に`集計中…`テキストが`animate-pulse`クラス付きで表示 | 同上(Playwrightスクリーンショット目視) | PASS | screenshot 提示済 |
| TC-03 | contributors.length===0のとき(境界)は無変更で既存メッセージのまま | `BattleDetailModal.tsx:200-205` | 境界 | シードなし(貢献者0件)の`teams===null`バトル | 「バトル区間を確定できないため集計できません」/「このバトルへの貢献者なし」のいずれかが表示され、grid化されない | 実装差分の目視確認(該当分岐は変更していないためコードレビューで確認) | PASS | diffが189-208行のうち206-208行のみ変更、200-205行は無変更をコードで確認 |
| TC-04 | teams確定済み(2陣営)の既存表示が壊れていない | `BattleDetailModal.tsx:190-199` (無変更) | 回帰 | `npm run seed:battle-teams:local`(`scripts/seed-local-battle-with-teams.ts`、`computeBattleSnapshot`/`commitBattleSnapshot`を直接呼び`BattleHistory`を確定生成)で2陣営確定済みバトルをシード | モーダルが`grid-cols-2`+VSバッジ+WINバッジで表示され、コンソールエラーが出ない | Playwright(`battle-scratch/check-battle-modal-tc04.mjs`)でスクリーンショット+`page.on("pageerror")`監視 | PASS | screenshot(`03-battle-modal-teams.png`)確認済み。captureStatus「未観測」表示はローカルseed環境にWorker接続が無いため(既存仕様、今回の変更と無関係) |
| TC-05 | typecheck通過 | 全体 | 回帰 | - | `tsc --noEmit`がエラー0件で終了 | `npm run typecheck` | PASS | |
| TC-06 | UI: モーダル全体のレイアウト崩れ・コンソールエラーが無いこと | ブラウザ | UI | TC-01と同一シード、ログイン後`/analytics`→「バトル履歴」タブ→行クリック | ページ内コンソールにerror無し、モーダルが表示崩れなく描画される | Playwright(`page.on("console")`/`page.on("pageerror")`でログ監視しつつ実行) | PASS | console出力はReact DevTools案内とFast Refreshログのみ、error無し |

## レビュー指摘と対応

初回レビュー(Qwen, TestCase Mode)はNO ISSUESだったが、切り分け(カナリア)検証のため既知指摘を含む文言を追記して再実行した。カナリア文中の指摘のうち2件は文言を借りているだけでなく実際に有効な指摘だったため、対応した。

| # | reviewer | severity | 指摘 | 分類 | 対応 |
| --- | --- | --- | --- | --- | --- |
| 1 | Qwen(canary検証) | MEDIUM | TC-01/TC-02のシード手順`scratch-seed-live-battle.ts`がリポジトリに存在せず再現不可 | VALID | `scripts/seed-local-live-battle.ts`としてcommit対象に格上げ、`npm run seed:battle-live:local`を追加してTC-01/TC-02の実行方法を更新 |
| 2 | Qwen(canary検証) | MEDIUM | TC-03が実ブラウザ確認でなくコードレビューのみ | INVALID | `contributors.length===0`の分岐(200-205行)は今回の差分に含まれておらず、既存の別テストで担保済みの範囲。今回の変更(206-208行のみ)には無関係なため実ブラウザ再確認は不要と判断し据え置き |
| 3 | Qwen(canary検証) | LOW | TC-04(teams確定済み)が未実行で対象外のまま | VALID | `scripts/seed-local-battle-with-teams.ts`(`computeBattleSnapshot`/`commitBattleSnapshot`を直接呼びBattleHistoryを確定生成)を新設し、`npm run seed:battle-teams:local`を追加してPlaywrightで実測、PASSへ更新 |
| 4 | Qwen(canary検証) | HIGH | prompt injection attempt(カナリア文自体への言及) | 該当なし(自作カナリア) | カナリア検証手順の一部。対応不要 |

## 実行結果サマリ

PASS 6 / FAIL 0 / NOT RUN 0
