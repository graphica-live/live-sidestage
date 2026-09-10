---
project: live-sidestage-mobile
feature: mobile-token-auth
last_updated: 2026-09-10
last_risk: HIGH
last_reviewers: DeepSeek+Codex-luna(Codex-terraはOmniRoute admission 503で利用不能)
---

# テストベースライン: mobile-token-auth

Google/Apple/メール全ログイン経路で access token(短命JWT) + refresh token(rotation付き)を
発行・保持する。旧`apiKey`方式は撤去済み。`SessionController`が401検知時に自動でrefreshし、
メイン/背景(Foreground Service)両Isolate間でrotation結果を同期する。`withTokenRefresh`が
全API呼び出しをラップし、`performLogout()`がログアウト処理を一元化する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-MTA-101 | 同時に複数箇所からrefreshを呼んでも交換は1回だけ(single-flight) | `SessionController._doRefresh` | 正常 | 複数箇所から同時にrefreshをトリガ | サーバーへのrefreshリクエストは1回のみ発行される | `flutter test test/session_refresh_test.dart --plain-name "同時に呼んでも refresh token の交換は1回だけ"` | PASS | |
| TC-MTA-102 | rotationではaccess/refresh tokenを対で差し替える | `SessionController._doRefresh` | 正常 | refresh成功 | セッションのaccess token・refresh token両方が新しい値に更新される | `flutter test test/session_refresh_test.dart --plain-name "rotation では access token と refresh token を対で差し替える"` | PASS | |
| TC-MTA-103 | プロバイダに依らず同じ経路で再発行できる(Apple/メールも) | `SessionController._doRefresh` | 正常 | Google以外のprovider(Apple/email)でログイン中 | 同じrefresh機構で再発行できる(Google専属ロジックへ分岐しない) | `flutter test test/session_refresh_test.dart --plain-name "プロバイダに依らず再発行できる"` | PASS | Batch07で旧Google専用ロジックから全面置換した箇所 |
| TC-MTA-104 | refreshに失敗しても再度リフレッシュを試せる(進行中Futureを持ち越さない) | `SessionController._doRefresh` | 異常 | 直前のrefresh試行が失敗 | 次の呼び出しで新しい試行が行われる(前回の失敗Futureを再利用しない) | `flutter test test/session_refresh_test.dart --plain-name "失敗したあとでも再度リフレッシュを試せる"` | PASS | |
| TC-MTA-105 | refresh tokenがサーバーに拒否されてもセッションを壊さない | `SessionController._doRefresh` | 異常 | サーバーがINVALID_REFRESH_TOKEN/TOKEN_REUSE_DETECTEDを返す | ローカルセッション状態が不正な中間状態にならない | `flutter test test/session_refresh_test.dart --plain-name "refresh token が拒否されてもセッションは壊さない"` | PASS | |
| TC-MTA-106 | オフラインでrefresh失敗してもセッションを壊さない | `SessionController._doRefresh` | 異常 | ネットワーク不通 | セッション状態を保持したまま失敗を返す | `flutter test test/session_refresh_test.dart --plain-name "オフラインで再発行が失敗してもセッションを壊さない"` | PASS | |
| TC-MTA-107 | refresh待機中にログアウトされていたらセッションを復活させない | `SessionController._doRefresh` | 異常 | refresh進行中に別経路でログアウト完了 | refresh結果が返ってきてもセッションを復活させない | `flutter test test/session_refresh_test.dart --plain-name "待っている間にログアウトされていたらセッションを復活させない"` | PASS | |
| TC-MTA-108 | 背景Isolateがrotationした新ペアをメイン側が取り込める | `SessionController` cross-isolate adopt | 正常 | 背景Isolate側でrotation発生 | メイン側のセッション状態が新しいaccess/refresh tokenへ更新される | `flutter test test/session_refresh_test.dart --plain-name "背景Isolateが rotation したペアを取り込める"` | PASS | |
| TC-MTA-109 | メイン⇄背景Isolate間でaccess/refresh両方が一致する場合のみ伝播をスキップする | `HomeScreen._onSessionChanged` | 境界 | 同一秒`iat`で同一payloadのJWTが再発行され、access tokenの文字列が偶然一致するがrefresh tokenは変わっているケース | refresh tokenの変更を検知して背景Isolateへ伝播する(access token一致だけでスキップしない) | 手動コードレビュー確認(race再現の自動テストは未整備) | NOT RUN: 発生確率が極めて低いrace conditionのため、決定的な再現テストは追加していない。修正自体はCodex-terra finding是正で反映済み | 2026-09-09追加。Codex-terra finding是正 |
| TC-MTA-110 | 401ならトークンを取り直してAPI呼び出しをやり直す | `withTokenRefresh` | 正常 | API呼び出しが401を返す | refreshしてから同じ呼び出しを1回だけリトライする | `flutter test test/session_refresh_test.dart --plain-name "401ならトークンを取り直してギフト候補を取得し直す"` | PASS | |
| TC-MTA-111 | refreshできなければ401をそのまま投げる(再ログイン導線へ) | `withTokenRefresh` | 異常 | refresh自体が失敗する | 元の401をそのまま呼び出し元へ伝える | `flutter test test/session_refresh_test.dart --plain-name "リフレッシュできなければ401をそのまま投げる"` | PASS | |
| TC-MTA-112 | 401以外のエラーではrefreshを試みない | `withTokenRefresh` | negative | 401以外のエラーコード(403,500等) | refresh処理を呼ばずそのままエラーを投げる | `flutter test test/session_refresh_test.dart --plain-name "401以外はリフレッシュせずそのまま投げる"` | PASS | |
| TC-MTA-113 | ログアウトはサーバー側family失効を呼んでからローカルを消す | `performLogout` | 正常 | 通常のログアウト操作 | サーバーへのrevoke呼び出し完了後にローカルストレージを削除する順序を守る | `flutter test test/session_refresh_test.dart --plain-name "サーバー側の family 失効を呼んでからローカルを消す"` | PASS | |
| TC-MTA-114 | アカウント削除がサーバー側で失敗したらセッションを壊さない(fail-closed) | `deleteAccount` | 異常 | サーバー側削除APIが失敗 | ローカルセッションを保持したまま`false`を返す | `flutter test test/session_refresh_test.dart --plain-name "サーバー側が失敗(fail-closed)ならセッションを壊さずfalseを返す"` | PASS | |
| TC-MTA-115 | アカウント削除失敗後も通常どおりtoken refreshできる | `deleteAccount` | 回帰 | 削除失敗直後にrefreshが必要な操作 | 削除中フラグを引きずらずrefreshが動く | `flutter test test/session_refresh_test.dart --plain-name "失敗後は通常どおりtoken refreshできる"` | PASS | |
| TC-MTA-116 | 削除処理中に割り込んだtoken refreshは再発行を試みない | `deleteAccount` | negative | 削除処理進行中にrefreshがトリガされる | refreshを実行せず削除完了を待つ | `flutter test test/session_refresh_test.dart --plain-name "削除中に割り込んだtoken refreshは再発行を試みない"` | PASS | |
| TC-MTA-117 | `AuthSession`は`apiKey`を持たず`refreshToken`を必須とする。`refreshToken`欠落の保存データ(旧バージョンからの引き継ぎ含む)は読み込まない | `auth_session.dart`(`AuthSession.fromStorageMap`) | negative/境界 | セッションのシリアライズ/デシリアライズ、`refreshToken`キーを除いた保存データ(旧セッション相当) | JSON表現に`apiKey`キーが存在しない。`refreshToken`欠落時は`TypeError`を投げ、セッション不成立(未ログイン)として扱う | `flutter test test/auth_provider_test.dart --plain-name "欠けている保存データは読み込まない"` | PASS | 2026-09-09、実行方法をDeepSeek TestCaseレビュー指摘(旧セッション後方互換の具体的検証根拠が不明瞭)を受けて具体化 |
| TC-MTA-118 | socket.io接続はaccess tokenをhandshake.authで送信し、TOKEN_EXPIRED受信でrefresh→再接続を行う | `comment_feed.dart` | 正常 | 接続中にサーバーからTOKEN_EXPIREDイベントを受信、refresh token自体は有効 | refreshしてから同一socket接続を再確立する | `flutter test` (comment_feed関連の既存テスト) | PASS | |
| TC-MTA-119 | refresh token失効(TokenRefreshRejected)のみ「ログインの有効期限が切れています」を表示し、再試行しない | `comment_feed.dart`(`handleConnectError`) | 異常 | TOKEN_EXPIRED受信→refresh結果がTokenRefreshRejected(サーバーがINVALID_REFRESH_TOKEN/TOKEN_REUSE_DETECTED相当) | エラー文言「ログインの有効期限が切れています」表示、以後タイマー再試行しない(恒久失効として確定) | `flutter test test/comment_feed_token_refresh_test.dart --plain-name "refresh token 失効"` | PASS | 2026-09-10追加。バグ修正: 誤表示の主因(通信断を失効と誤判定)を型で分離 |
| TC-MTA-120 | 通信断・5xx等の一時的refresh失敗(TokenRefreshFailed)ではログイン切れ文言を出さず、指数バックオフで再試行する | `comment_feed.dart`(`handleConnectError`/`_scheduleRetry`) | 異常 | TOKEN_EXPIRED受信→refresh結果がTokenRefreshFailed(通信断/5xx/タイムアウト等) | 「ログインの有効期限が切れています」を出さず、5秒→倍々→最大60秒のバックオフで`onTokenExpired`を再試行する | `flutter test test/comment_feed_token_refresh_test.dart --plain-name "一時的失敗"` | PASS | 2026-09-10追加 |
| TC-MTA-121 | refresh進行中(in-flight)に重複してTOKEN_EXPIREDを受けても多重refreshしない | `comment_feed.dart`(`handleConnectError`) | 境界 | refresh実行中に同一接続でTOKEN_EXPIREDが再度届く | 2回目は新たなrefreshを呼ばずconnecting状態を維持する | `flutter test test/comment_feed_token_refresh_test.dart --plain-name "再発行が進行中"` | PASS | 2026-09-10追加 |
| TC-MTA-122 | `disconnect()`でバックオフ再試行タイマーが確実に停止する | `comment_feed.dart`(`disconnect`) | 異常 | 一時的失敗でバックオフタイマー起動中に`disconnect()`を呼ぶ | タイマーがキャンセルされ、以後`onTokenExpired`が呼ばれない | `flutter test test/comment_feed_token_refresh_test.dart --plain-name "disconnect すると再試行タイマーが止まる"` | PASS | 2026-09-10追加 |
| TC-MTA-123 | `SessionController.refreshTokenDetailed()`はrefresh成否を型で区別する(`TokenRefreshed`/`TokenRefreshRejected`/`TokenRefreshFailed`) | `SessionController.refreshTokenDetailed` | 正常/異常 | 成功/refresh token失効/通信断・5xx の3パターン | 失効のみ`TokenRefreshRejected`、通信断・5xxは`TokenRefreshFailed`を返す(再ログイン扱いにしない) | `flutter test test/session_refresh_test.dart --plain-name "refreshTokenDetailed"` | PASS | 2026-09-10追加。background_task_handler側の既存`isRefreshTokenRejected`分岐とメインIsolate側を対称化 |
| TC-MTA-124 | refresh成功で取り直した新token でも連続でTOKEN_EXPIREDになる場合、無限にrefreshを繰り返さない | `comment_feed.dart`(`_refreshAndReconnect`/`connect`) | 異常/境界 | `_refreshAndReconnect`がTokenRefreshedでconnect(newToken)した直後、newTokenでもTOKEN_EXPIREDを受信 | 2回目は通常のTOKEN_EXPIREDエラー表示へ落ち、再度refreshを呼ばない(refresh token乱発・無限ループにならない) | 手動コードレビュー確認(実socket接続が絡むため単体テスト環境では`connect()`を直接駆動できない。[[comment_feed_token_refresh_test.dart]]のコメント方針どおり) | NOT RUN: code-review(DeepSeek+Gemini併用評価)指摘をコードで検証しVALID、`_refreshAndReconnect`のTokenRefreshedケースで`connect(token)`直後に`_tokenRefreshAttempted = true`を明示設定し修正済み。自動再現テストは実socket依存のため未整備 | 2026-09-10追加。code-review finding是正 |
| TC-MTA-125 | バックオフ待機中にsocket.io自動再接続からTOKEN_EXPIREDが重複して届いても、タイマーを無視して即時refreshしない | `comment_feed.dart`(`handleConnectError`/`_scheduleRetry`) | 異常/境界 | 一時的失敗でバックオフタイマー起動中に、自動再接続由来のTOKEN_EXPIREDが再度届く | `_retryTimer.isActive`中は即時refreshせずconnecting維持、タイマー発火時のみ1回refreshする(指数バックオフが無効化されない) | `flutter test test/comment_feed_token_refresh_test.dart --plain-name "バックオフ待機中に再度"` | PASS | 2026-09-10追加。code-review(Codex-luna) HIGH finding是正 |
| TC-MTA-126 | disconnect/dispose後、登録解除前に配送された古いsocketのconnect_errorで新規refreshを開始しない | `comment_feed.dart`(`connect`内`onConnectError`登録) | 異常/境界 | 古いsocketのconnect_errorイベントが、disconnect済み(世代が進んだ)後に遅延配送される | 登録時点の世代と現在世代が不一致なら処理しない(古いsocketからの遅延イベントでrefresh/タイマーを開始しない) | 手動コードレビュー確認(イベント配送タイミング依存の競合で、実socketのタイミング制御が必要なため単体テスト環境では再現困難) | NOT RUN: code-review(Codex-luna) MEDIUM finding是正。`socket.onConnectError`登録を世代キャプチャ付きクロージャへ変更し対応済み | 2026-09-10追加 |

## Quality Gate

- `flutter analyze`(No issues found)
- `flutter test`(525 tests)

## Out of Scope

- Google Sign-In自体のOAuthフロー(署名SHA-1登録等)は今回の変更対象外
- Apple Sign-InのCustom Tab/authorizationCode交換フローは今回の変更対象外(access/refresh発行後の扱いのみ変更)
- VOICEVOX読み上げ機能は今回の変更と無関係
