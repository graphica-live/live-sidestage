## date
2026-09-06

## feature
login-stats

## change summary
ログイン画面「監視中人数」の集計元を`Streamer`(登録ユーザー)行数から`TiktokRoom`(実監視部屋)行数へ変更。
レスポンスキー名`streamerCount`→`roomCount`(呼び出し元は`GoogleLoginPanel.tsx`のみ、grep確認済みで他参照なし)。

## risk
MEDIUM(公開APIの集計クエリ変更のみ。認証・課金・migrationは絡まない)

## reason
コラボ自己申告(`ensureRoomWatchedForCollab`)等でStreamer未登録のままTiktokRoomだけ存在するケースがあり、
Streamer行数だと実際に監視中の部屋数より少なく表示されるバグだった(ユーザー報告: 表示4人、実際は9人程度)。

## affected baseline cases
TC-LGS-001, TC-LGS-002, TC-LGS-003(新規)

## reviewers
- review-auto(Code Mode): Qwen(qwen-review.ps1) → `NO ISSUES`だが応答は`completion_tokens: 4`のみ。
  カナリア検証(既知のSQLi脆弱コードを追記して再実行)で検出できず、**未読と判明**。この回のNO ISSUESは無効。
- test-auto(TestCaseレビュー): 同じくQwenで再実行、同様に`completion_tokens: 4`の`NO ISSUES`(カナリア再検証は省略、
  直前と同一モデル・同種の応答パターンのため信頼性なしと判断)。

## important findings / VALID・INVALIDの重要判断
外部レビューが実質機能しなかったため、Claude自身が以下を実コードで検証して完了とした。
- `prisma.tiktokRoom.count()`はschema.prisma上に実在するモデル(型整合性OK、`npx tsc --noEmit`で確認)
- `streamerCount`という識別子の参照はリポジトリ全体で`GoogleLoginPanel.tsx`のみ(grep確認)、破壊的変更漏れなし
- ローカルDB実測でAPIレスポンス`roomCount:86`とログイン画面表示「86人」の一致をPlaywrightで確認

## verification
- `npx tsc --noEmit`: PASS
- `curl http://localhost:3000/api/public/login-stats`: `roomCount:86`
- Playwright実ブラウザで`/login`表示確認: 「86人の配信者データを集計する」= roomCountと一致

## remaining risks
なし(表示数値の集計元変更のみ、DBスキーマ変更なし、他画面・他プロジェクトからの参照なし)
