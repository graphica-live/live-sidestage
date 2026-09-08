---
project: live-sidestage-analytics
feature: listener-comment
last_updated: 2026-09-07
last_risk: HIGH
last_reviewers: DeepSeek+Fable(Codex/Geminiはquota切れのため代理)
---

# テストベースライン: listener-comment

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

TikTok LIVEのリスナーコメント(chat)を`ListenerComment`テーブルへ保存し、
将来のAI傾向分析用途に備える。受信から30日で自動削除される
(`listener-comment-retention.ts`)。保存はsocket.io配信(mobile読み上げ用)を
ブロックしないfire-and-forgetで行い、DB側の事前重複チェックは行わない
(インメモリdedupのみ)。同時実行数はGiftのDB書き込みを圧迫しないよう上限12で制限する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-LC-001 | chat受信でListenerCommentへ保存される | `src/lib/tiktok-listener.ts` `saveListenerComment` | 正常 | roomを購読させconn.on("chat")を発火 | `listener_comments`にroomId/uniqueId/nickname/comment/dayKeyが保存される | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.listener-comment.integration.test.ts` | PASS | |
| TC-LC-002 | エモートのみ(空文字)コメントも保存される | 同上 | 境界 | comment: "" のchatイベント | comment列が空文字のまま保存される(エラーにならない) | 同上 | PASS | |
| TC-LC-003 | DB保存失敗時も例外を伝播させずログのみ | `saveListenerComment` | 異常 | prisma.listenerComment.createが失敗するケース | unhandled rejectionでworkerが落ちない、ログのみ出力 | コードレビューで確認(try/catchで全体を包む構造。fable-expertレビューで確認済み) | PASS | 実行時例外注入テストは無し。構造上reject経路が無いことを確認 |
| TC-LC-004 | 同時実行数の上限を超えた分は破棄されログに残る | `LISTENER_COMMENT_SAVE_CONCURRENCY_LIMIT` | 異常 | 12件同時にsaveListenerCommentが走っている状態で13件目 | 13件目はcreateを呼ばずwarnログのみ、Giftの書き込みを圧迫しない | コードレビューで確認(カウンタ実装) | NOT RUN: 同時実行を確定的に再現する自動テストは未実装。実装はカウンタのインクリメント/デクリメントのみで単体テスト化の価値が低いと判断 | 本番の流量実測後、必要ならカウンタのしきい値を調整 |
| TC-LC-005 | 30日retention: dry-runでは削除せず件数のみ報告 | `runListenerCommentRetentionCycle` | 境界 | 30日より前(45日前)と直近(5日前)のコメントを用意 | dryRun:trueはdeletableRowsのみ返し、行は消えない | `npx dotenv -e .env.local.test -- vitest run src/lib/listener-comment-retention.integration.test.ts` | PASS | |
| TC-LC-006 | 30日retention: 実行時は30日より前の行だけ削除 | 同上 | 正常 | 同上 | dayKey<cutoffの行が削除され、直近の行は残る | 同上 | PASS | |
| TC-LC-007 | retentionのバッチ削除はORDER BYで安定した順序で行う | `deleteInBatches` | 回帰 | LIMIT付きサブクエリDELETE | 新規insertが割り込んでも同じ行を選び続けてループが長引かない | コードレビューで確認(ORDER BY id追加、DeepSeekレビュー指摘の反映) | PASS | |
| TC-LC-008 | advisory lock keyが既存の他ロックと衝突しない | `listener-comment-retention.ts` | negative | key=9_241_665_017n | gift-retention(9_137_442_882n)・tiktok-cleanup(9_137_442_881n)・worker-guardian(8_241_995_113n)等と非衝突 | fable-expertレビューでリポジトリ内の全advisory lock使用箇所を確認済み | PASS | |
| TC-LC-009 | profileImageUrlを保存しない(署名付きURLの失効対策) | `prisma/schema.prisma` `ListenerComment` | negative | - | ListenerCommentにprofileImageUrl列が存在しない | スキーマレビュー(手動) | PASS | ユーザー指摘により削除済み |

## Quality Gate

- `npm run typecheck`
- `npx dotenv -e .env.local.test -- vitest run --exclude "**/*.integration.test.ts"` (test:unit相当、103ファイル1444件)
- `npx dotenv -e .env.local.test -- vitest run integration` (test:integration相当、87ファイル852件、ListenerComment関連含む)
- `npx prisma db push --accept-data-loss`(ローカルDBへのスキーマ反映確認)

全integration一括実行時に`tiktok-listener.collab-kick.integration.test.ts`が1件failしたが、
単体実行では10件全通過。既知の並列実行時cross-file干渉(memory:
`analytics-vitest-cross-file-interference`)で、今回の変更(ListenerComment)とは無関係。

## Out of Scope

- Railway Cronサービスの実際の作成・本番`LISTENER_COMMENT_RETENTION_DRY_RUN=false`切り替えはコード外の運用作業。fable-expertレビュー(F2)で指摘済み、実装完了後にユーザーへ案内する
- 本番のchatピーク流量に基づく`LISTENER_COMMENT_SAVE_CONCURRENCY_LIMIT`の妥当値検証(実測が必要なため今回は不可)
