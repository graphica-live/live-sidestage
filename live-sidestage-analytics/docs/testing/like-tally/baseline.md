---
project: live-sidestage-analytics
feature: like-tally
last_updated: 2026-09-05
last_risk: HIGH
last_reviewers: Qwen+fable-expert(Codex/Gemini quota切れのためユーザー承認のうえ代理)
---

# テストベースライン: like-tally

いいね(Like)の日次累計。OBS「Like貢献通知」「Like数一覧(タップリスト)」オーバーレイの集計元。
`src/lib/overlay/like-tally-store.ts`(プロセス内インメモリ、roomId軸で複数Streamer共有)が実体で、
`like.server.ts`(recordLike/crossedMilestones)・`tap-list.server.ts`(buildTapListSnapshot)・
`tap-list/reset` APIがこれを読み書きする。当日分のみ保持し、日付が変わった後の最初のアクセスで
前日以前のエントリを自動的に一括削除する(旧Postgres `LikeTally`テーブル・pruning cronは撤去済み)。
TikTok ID自動合流(`absorbRooms`)では、候補room側の当日分は引き継がず破棄する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-LT-001 | 同一uniqueIdの複数回incrementで累計が正しく積み上がる | `like-tally-store.ts` incrementLike | 正常 | 同一room/uniqueIdへ5→3回連続 | previousTotal/newTotalが累積値で返る | `npx vitest run src/lib/overlay/like-tally-store.test.ts` | PASS | |
| TC-LT-002 | getTopEntriesがtotalLikes降順・maxEntries件に絞る | `like-tally-store.ts` getTopEntries | 境界 | 3人分の異なる累計値、maxEntries=2 | 上位2件が降順で返る | 同上 | PASS | |
| TC-LT-003 | totalLikesが0以下のエントリは一覧に出ない | `like-tally-store.ts` getTopEntries | negative | likeCount=0および負値でincrement | getTopEntriesが空配列 | 同上 | PASS | |
| TC-LT-004 | roomIdが異なれば集計は独立する | `like-tally-store.ts` incrementLike/getTopEntries | 正常 | 同じuniqueIdで別room2件 | 各roomの合計が互いに影響しない | 同上 | PASS | |
| TC-LT-005 | resetRoomTodayは当日分のみ削除し、以後の集計は通常どおり動く | `like-tally-store.ts` resetRoomToday | 正常 | 累計後にreset→再度increment | reset後は0件、再incrementで新規カウント開始 | 同上 | PASS | |
| TC-LT-006 | 日付が変わると前日分は0扱いになり、二度と来ないリスナーのエントリは次アクセスでMapの実体から物理的に削除される | `like-tally-store.ts` getRoomState(lazy prune) | 回帰/境界 | Day1に2人分累計、Day2にDay1参加者の1人だけ再訪 | previousTotalが0から再開/再訪しなかった1人は`__getEntryCountForTest`で数えた実件数からも消える(getTopEntriesのフィルタに隠れているだけでないことを確認、メモリリーク対策の固定) | 同上 | PASS | |
| TC-LT-007 | nickname/profileImageUrlが空文字・nullのイベントは既存の良い値を上書きしない | `like-tally-store.ts` incrementLike | 異常/境界 | 1回目は正常値、2回目は空文字/null | 表示名・画像URLは1回目の値が保持される | 同上 | PASS | |
| TC-LT-008 | TikTok ID自動合流時、候補room側の当日分いいね集計は引き継がず破棄される(設計上の既定動作) | `tiktok-id-migration.ts` absorbRooms | 回帰 | 合流実行(Gift/Battle等は移動、LikeTallyは対象外) | absorbRoomsが正常完了し、旧LikeTally関連のstats/raw SQLが存在しない | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-id-migration.integration.test.ts` | PASS | absorbRoomsは`event-worker.ts`から呼ばれるためインメモリMapへ実質アクセスできない設計(ユーザー承認済み) |

## Quality Gate

このプロジェクトで回すコマンド(TC番号を振らない)。

- `npm run typecheck`
- `npm run test:unit`(85→86 files、1221→1228 tests)
- `npm run test:integration`(70 files、695 tests)

## Out of Scope

- Like貢献通知オーバーレイのUI表示・マイルストーン通知の実際のsocket.io配信(`emit.ts`側、今回は集計元の差し替えのみで通知ロジック自体は無変更)
- `tiktok-cleanup.ts`のroom cleanup/low-value cleanup自体の挙動(今回はLikeTally pruning呼び出しの削除のみ)
- 単一プロセス前提(Railway `numReplicas:1`)。複数レプリカに増やすと集計が分裂する制約はストアの設計上の既知事項であり、unit testでは再現しない
- `globalThis`経由のバンドル間共有(Next.jsルートハンドラとsocket経路で別モジュールインスタンスになる可能性)はunit testで再現不能。実ブラウザでの`tap-list/reset`→タップリストオーバーレイ表示確認で代替する
