---
date: 2026-09-10
feature: mobile-token-auth
---

# socket TOKEN_EXPIRED のrefresh失敗分類・再試行導入

## change summary

配信中モバイルで「ログインの有効期限が切れています」が通信断・5xx等の一時的失敗でも誤表示される
バグを修正。`SessionController`/`background_task_handler`のrefresh処理を`TokenRefreshResult`
(`TokenRefreshed`/`TokenRefreshRejected`/`TokenRefreshFailed`)で型分類し、`CommentFeed`は
恒久失効(`TokenRefreshRejected`)のみエラー表示、一時的失敗(`TokenRefreshFailed`)は指数バックオフ
(5秒→倍々→最大60秒)で再試行する。

## risk / reason

risk=HIGH（session管理・WebSocket/realtime通信）。既存のrefresh token rotation・reuse検知・
Isolate間伝播の経路自体は変更せず、失敗分類と再試行契機のみを追加。

## reviewers

- design-review: DeepSeek + Gemini（Codex-terraはOmniRoute admission 503で3回失敗、利用不能。
  risk-classification.mdのHIGH代理規定を適用しGeminiで構成）
- code-review: DeepSeek + Codex-luna（Codex-terraはOmniRoute admission 503で再度利用不能。
  ユーザー指示でcodex-luna(reasoning effort medium固定)へ切替、1回目も503、2回目で成功）

## important findings / VALID・INVALID判定

1. **HIGH（DeepSeek、比較評価で候補のGemini-3.8-flashも独立検出）**: `connect(token)`内の
   `_tokenRefreshAttempted`リセット条件が、refresh成功後の再接続(`_refreshAndReconnect`の
   `TokenRefreshed`ケース)でも発火し、サーバーが取り直したtokenも拒否し続ける異常時に
   無限refreshループ(refresh token乱発)になる。**VALID** — `connect(token)`呼び出し直後に
   `_tokenRefreshAttempted = true`を明示再設定して修正。自動再現は実socket依存のため
   baseline(TC-MTA-124)はNOT RUN(手動コードレビュー確認)で記録。
2. **HIGH（Codex-luna）**: `_scheduleRetry()`が`_tokenRefreshAttempted`を即座にfalseへ戻すため、
   socket.io-clientの自動再接続(reconnectionはデフォルト有効)がバックオフ待機中にも
   `TOKEN_EXPIRED`を投げると、タイマーを無視して即時refreshしてしまい指数バックオフが
   無意味化する。**VALID** — `_retryTimer?.isActive`を待機中ガードとして`handleConnectError`に
   追加し、`_scheduleRetry`内の即時false化を削除。自動テスト追加(TC-MTA-125)。
3. **MEDIUM（Codex-luna）**: `connect_error`ハンドラが接続世代に紐付いておらず、
   `disconnect()`/`dispose()`後に古いsocketの遅延イベントが配送されると新規refreshを
   開始しうる。確証は中程度（socket_io_client(dart)の`dispose()`実装詳細は未確認）だが
   修正コストが低く安全側のため採用。**VALID(低確証採用)** — `connect()`内の
   `socket.onConnectError`登録を世代キャプチャ付きクロージャでラップ。自動再現は
   イベント配送タイミング依存のため手動コードレビュー確認(TC-MTA-126、NOT RUN)。

## verification

- `flutter analyze`: No issues found
- `flutter test`: 525 tests, all passed
- 新規テスト: `test/comment_feed_token_refresh_test.dart`(6件)、
  `test/session_refresh_test.dart`への追加(3件)

## remaining risks

- TC-MTA-124/126は実socket接続が絡むため自動回帰テストが無い。将来`connect()`を
  socket生成部と純粋ロジック部へ分離できれば自動化可能だが、今回は最小修正方針のため
  見送った。
