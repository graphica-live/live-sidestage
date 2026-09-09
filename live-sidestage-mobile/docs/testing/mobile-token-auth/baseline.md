---
project: live-sidestage-mobile
feature: mobile-token-auth
last_updated: 2026-09-09
last_risk: CRITICAL
last_reviewers: Codex-terra+Gemini(code-reviewで同時実施)+DeepSeek(利用不能)
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
| TC-MTA-118 | socket.io接続はaccess tokenをhandshake.authで送信し、TOKEN_EXPIRED受信で単発フライトのrefresh→再接続を行う | `comment_feed.dart` | 正常 | 接続中にサーバーからTOKEN_EXPIREDイベントを受信 | refreshしてから同一socket接続を再確立する(多重refreshしない) | `flutter test` (comment_feed関連の既存テスト) | PASS | |

## Quality Gate

- `flutter analyze`(No issues found)
- `flutter test`(515 tests)

## Out of Scope

- Google Sign-In自体のOAuthフロー(署名SHA-1登録等)は今回の変更対象外
- Apple Sign-InのCustom Tab/authorizationCode交換フローは今回の変更対象外(access/refresh発行後の扱いのみ変更)
- VOICEVOX読み上げ機能は今回の変更と無関係
