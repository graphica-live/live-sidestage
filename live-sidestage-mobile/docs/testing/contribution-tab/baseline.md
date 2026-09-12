---
project: live-sidestage-mobile
feature: 貢献タブ(ContributionTab)
last_updated: 2026-09-12
last_risk: MEDIUM
last_reviewers: Gemini(agy、Code Mode、medium)。日付切替UX/CPU改善(_usersキャッシュ・silent load)。Gemini TestCase Mode(high) baseline照合
---

# テストベースライン: 貢献タブ(ContributionTab)

期間別(day/week/month/year/カスタム)のユーザー別コイン数ランキング。行のアバターアイコンのタップのみ
TikTokプロフィールへ遷移し、行のそれ以外(順位メダル・名前・コイン数)のタップはアコーディオン展開して
ギフト名別内訳(Web版 AnalyticsView.tsx と同じ `src/lib/gift-breakdown.ts` を参照)を表示する。
展開・内訳取得は貢献タブの `RankingListTile`(`fetchBreakdown` 指定)のみの挙動で、バトル履歴タブの
2箇所(`fetchBreakdown` 未指定)は行全体タップでプロフィール遷移する従来動作のまま変わらない。

**2026-09-12(Batch01/02)**: ランキング行の描画方式を`ListView`+`ListPanel`(全件即時Widget構築)から
`CustomScrollView`+`ListPanelSliver`(`DecoratedSliver`+`SliverList.builder`による遅延構築)へ変更した。
大規模room(約1900人)で画面外の行・画像リクエストが即座に発生し操作不能になる不具合の修正。
視覚(白カード+角丸18+シャドウ+行間区切り線)・pull-to-refresh・期間切替時のkey設計は維持する設計。

**2026-09-12(perf follow-up)**: 日付◀/▶・期間切替時に`_load(silent:)`で期間UIを無効化しない。
一覧は`_users`キャッシュのみ描画(build毎の全件tryParseを廃止)。push snapshotは「今日」を含む期間のみ`_users`へ反映。
再取得中は`LinearProgressIndicator`(2dp)のみ(初回以外)。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CT-001 | アバターアイコンのタップはプロフィール遷移のみで展開しない | `RankingListTile`(貢献タブ) | UI | `fetchBreakdown` 指定、アバターをタップ | `fetchBreakdown` は呼ばれない、内訳パネルは表示されない | `flutter test test/ranking_list_tile_test.dart -t "アバター"` | PASS | |
| TC-CT-002 | 名前・コイン数部分のタップでアコーディオン展開し内訳を取得・表示する | `RankingListTile`(貢献タブ) | 正常 | `fetchBreakdown` 指定、名前部分をタップ | 展開してギフト名・数量・pt が表示される | `flutter test test/ranking_list_tile_test.dart -t "名前部分"` | PASS | |
| TC-CT-003 | 順位メダル部分のタップでも展開する(Web版 `<tr onClick>` の行全体トグルに合わせる、1〜3位のグラデーションメダル・4位以下の数字表示どちらも) | `RankingListTile`(貢献タブ) | UI | `fetchBreakdown` 指定、順位メダル(1位グラデーション/4位数字表示)をタップ | 展開して内訳が表示される | `flutter test test/ranking_list_tile_test.dart --plain-name "順位メダル"` / `--plain-name "グラデーションメダル"` | PASS | |
| TC-CT-004 | 展開状態は再タップでキャッシュされ、再取得しない | `RankingListTile`(貢献タブ) | 回帰 | 展開→閉じる→再展開 | 2回目の展開で `fetchBreakdown` が再度呼ばれない | `flutter test test/ranking_list_tile_test.dart --plain-name "名前部分"` | PASS | |
| TC-CT-005 | ギフト明細が保持期間(90日)を過ぎている期間は「内訳は残っていません」を表示する | `RankingListTile`(貢献タブ) | 境界 | `coverage.detailAvailable: false` | 「この期間の内訳は残っていません(ギフト明細は90日で削除されます)」の文言を表示 | `flutter test test/ranking_list_tile_test.dart --plain-name "明細が残っていない"` | PASS | |
| TC-CT-006 | 期間切替(day/week/month/カスタム範囲)で行が再マウントされ、前の期間の展開・キャッシュを残さない | `ContributionTab._rangeSignature` + `RankingListTile` の `key` | 回帰 | 貢献タブで1位行を展開(エラー状態)後、期間セレクタを「日」→「週」に切替 | 切替後は展開状態が閉じており、順位・行内容も新しい期間のものに入れ替わる | 実機確認(手動、下記備考) | PASS | 2026-09-09 Pixel 7a(`33071JEHN14416`)、実データ(`@zunda5884`)で確認。`ListPanelSliver`化後も`key`生成ロジック(`_rangeSignature()`込み)は無変更のため、2026-09-12(Batch02)実機で再確認 |
| TC-CT-012 | 複数のギフト種別をtotalDiamonds降順で表示する(サーバー返却順をそのまま尊重) | `RankingListTile`(貢献タブ) | 正常 | `fetchBreakdown` が2種別(500pt/300pt)を降順で返す | 両方表示され、500pt側が先に描画される | `flutter test test/ranking_list_tile_test.dart --plain-name "totalDiamonds降順"` | PASS | |
| TC-CT-013 | 内訳取得が通信断・5xx等の一時的失敗の場合はエラー表示、再試行タップで再取得し成功時は表示が切り替わる | `RankingListTile`(貢献タブ) | 異常/回帰 | `fetchBreakdown` が1回目のみ`ApiException`(refresh token失効系以外)を投げる | 「内訳を取得できませんでした」+「再試行」ボタン表示→再試行タップで再取得、成功後はエラー表示が消え内訳が出る | `flutter test test/ranking_list_tile_test.dart --plain-name "取得失敗"` | PASS | |
| TC-CT-022 | 内訳取得がrefresh token失効(`TOKEN_REUSE_DETECTED`/`INVALID_REFRESH_TOKEN`)で失敗した場合は再ログイン導線を表示する | `RankingListTile`(貢献タブ) | 異常/回帰 | `fetchBreakdown` が`ApiException(statusCode: 401, code: 'TOKEN_REUSE_DETECTED')`または`'INVALID_REFRESH_TOKEN'`を投げる | 「ログインの有効期限が切れました。再ログインしてください」+「ログアウト」ボタン(`performLogout`呼び出し)を表示する。「再試行」ボタンは出さない | `flutter test test/ranking_list_tile_test.dart --plain-name "TOKEN_REUSE_DETECTED"` / `--plain-name "INVALID_REFRESH_TOKEN"` | PASS | 貢献タブbreakdown「内容を取得できませんでした」頻発調査(2026-09-12)を受け追加。原因種別を区別しないエラー表示の診断改善(Batch01、`worktree-mobile-contribution-breakdown-error`)。本worktree(large-room-freeze)は別対応のため`RankingListTile`自体は無変更 |
| TC-CT-007 | 未認証(トークン無し)は401 | `GET /api/mobile/analytics/gifts/breakdown` | 異常 | Authorization ヘッダ無し | ステータス401 | `analytics: npx dotenv -e .env.local.test -- npx vitest run src/app/api/mobile/analytics/gifts/breakdown/route.integration.test.ts` | PASS | |
| TC-CT-008 | `tiktokUid` 未指定は400 | 同上 | 異常 | トークンあり、`tiktokUid` パラメータ無し | ステータス400 | 同上 | PASS | |
| TC-CT-009 | Streamer は存在するが room 未接続の場合、内訳なしで200 | 同上 | 境界 | room未接続のstreamerトークン | `gifts: []`、`coverage.detailAvailable: false` | 同上 | PASS | |
| TC-CT-010 | FREEプランは month/year/カスタム範囲の内訳取得を拒否される | 同上 + `requireHistoryPlan` | 異常/権限差 | FREEプラントークン、`period=month` | ステータス403 | 同上 | PASS | |
| TC-CT-011 | day期間内のギフトをギフト名別に集計して返す(明細が残っている期間、他ユーザー分は混ざらない) | 同上 + `queryGiftBreakdown` | 正常 | 同一room内 `fan_a`(2ギフト種別)・`fan_b`(別ユーザー) | `fan_a` のみ集計、`total`・`gifts` が totalDiamonds 降順で一致 | 同上 | PASS | |
| TC-CT-014 | `fetchBreakdown` 未指定時(バトル履歴タブ)、順位メダル部分にもタップ領域が残る(退行防止) | `RankingListTile`(バトル履歴タブ) | 回帰 | `fetchBreakdown` 未指定 | 順位メダル部分に `InkWell` が存在する(プロフィール遷移の呼び出し自体はurl_launcherのモック手段が無いため対象外) | `flutter test test/ranking_list_tile_test.dart --plain-name "順位メダル部分にもタップ領域"` | PASS | |
| TC-CT-015 | `tiktokHandle` が null(TikTokUser 行が無い送信者)の行はプロフィール遷移のタップを受け付けない | `RankingListTile`(バトル履歴タブ) | 異常/データ欠損 | `tiktokHandle: null`、`fetchBreakdown` 未指定 | 行内の `InkWell`・アバターの `GestureDetector` の `onTap` が全て null(`https://www.tiktok.com/@` を組み立てられないため導線を出さない) | `flutter test test/ranking_list_tile_test.dart --plain-name "タップを受け付けない"` | PASS | |
| TC-CT-016 | `tiktokHandle` が null でも内訳アコーディオンは `tiktokUid` をキーに動作する | `RankingListTile`(貢献タブ) | 境界 | `tiktokHandle: null`、`fetchBreakdown` 指定、名前をタップ | `fetchBreakdown` が `entry.tiktokUid` で1回呼ばれ、内訳が表示される | `flutter test test/ranking_list_tile_test.dart --plain-name "fetchBreakdown指定時は名前タップ"` | PASS | |
| TC-CT-017 | Socket.IOで正常なranking snapshot pushを受信すると、REST再取得を待たず画面のランキング一覧が更新される | `ContributionTab._onRankingSnapshot` + `_users` | 正常/回帰 | `RankingSyncStore`が`canApply`な`chat:ranking:snapshot`を受信(version整合)、かつ表示期間が「今日」を含む | `_applyRankingSnapshotUsers`経由で`_users`が更新され一覧が描画される(過去日のみの表示中はlive snapshotで上書きしない) | `flutter test test/realtime_sync_test.dart` + コードレビュー | PASS | 2026-09-12: `containsToday`ガードをsnapshot反映前に追加(Gemini VALID) |
| TC-CT-018 | REST取得直後、サーバーの現在versionより1小さいversionのpushを欠損と誤判定しない | `RankingSyncStore.acknowledgeResync` + `VersionTracker.acknowledge` | 境界/回帰 | REST取得時点でサーバーversionが7、直後に届くpushがversion 8 | `acknowledgeResync`が`VersionTracker.acknowledge(bootId, epoch, version: 7)`でtrackerを実際のREST版数へ同期するため、version 8のpushは`canApply`になる | `flutter test test/realtime_sync_test.dart`(`acknowledge()`関連ケース) | PASS | |
| TC-CT-019 | 貢献タブの期間ナビ行にシェアアイコン(バトル履歴と同じ共有アイコン)が表示される | `ContributionTab`(`_shareGiftRanking` の `IconButton`) | UI/正常 | 貢献タブを開く | 期間ナビ行の右端に `Icons.share` のアイコンボタンが表示される | 実機確認(Pixel 7a) | PASS | `SliverToBoxAdapter`化後も表示位置・挙動に変化が無いことを2026-09-12(Batch02)実機で再確認 |
| TC-CT-020 | シェアボタンは現在の期間指定でURLを発行しクリップボードへコピー、成功/失敗をSnackBarで通知する | `ContributionTab._shareGiftRanking` | 正常/異常 | (a)`fetchGiftRankingShareUrl` 成功 (b)ネットワークエラー・401等で例外 | (a)`Clipboard.setData`後「コピーしました」のSnackBar (b)「コピーに失敗しました」のSnackBar | 実機確認(Pixel 7a) + `[unit-int]` | (a)NOT RUN: ローカルdevバックエンドへの実機到達がファイアウォールでブロック(既存の既知制約) (b)PASS(既存確認済み) | 成功パスのAPI契約自体は`[unit-int]`で担保 |
| TC-CT-021 | アプリ起動時に`RankingSyncStore`/`CommentFeed`のProvider登録漏れが無く、貢献タブが例外で真っ白にならない | `main.dart`(`LiveSidestageApp`の`MultiProvider`) + `ContributionTab.initState` | 回帰 | アプリ起動(`LiveSidestageApp`を実際にpump) | `Provider.of<CommentFeed>`/`Provider.of<RankingSyncStore>`等が`ProviderNotFoundException`を投げない。実機では貢献タブがランキング一覧を表示する(白画面にならない) | `flutter test test/widget_test.dart --plain-name "Provider登録"` + 実機確認(Pixel 7a) | PASS | |
| TC-CT-023 | 大規模room(数百〜約1900人規模)でランキング行を表示しても操作不能になるほど重くならない(画面外の行が即座に全件構築されない) | `ContributionTab`(`CustomScrollView`+`ListPanelSliver`+`_users`) | 性能/回帰 | 約1900人規模roomの貢献タブを開く | スクロールが実用的な速度で追従する。日付◀/▶で別日(約1892人)へ切替後も一覧が表示され操作可能 | 実機確認(Pixel 7a、adb) | PASS | 2026-09-12: `@ayane_0327` 1200人(2026-09-12)→◀→1892人(2026-09-11)表示確認。build毎全件parse廃止 |
| TC-CT-027 | 既存ランキング表示中の日付◀/▶・期間切替で期間チップ/◀/▶が無効化されず連続操作できる | `ContributionTab._load(silent:)` + `PeriodSelectorBar enabled: true` | 性能/UX | 1200人以上roomで◀を押して再取得中に▶/◀/日チップを触る | 取得中も期間コントロールがグレーアウトされない(世代番号で古い応答は破棄) | 実機確認(Pixel 7a、adb) | PASS | 2026-09-12: 2026-09-12→2026-09-11切替後も日付行・チップが有効のまま |
| TC-CT-028 | silent再取得失敗時に`LinearProgressIndicator`が永久表示されない | `ContributionTab._load` catch(silent) | 異常/回帰 | `silent: true`かつ`_result != null`でAPI失敗 | `_loading`がfalseに戻りプログレスが消える | コードレビュー(Gemini VALID→修正) | PASS | |
| TC-CT-024 | 少人数room(約240人規模)でも見た目・動作に変化が無い | `ContributionTab`(`CustomScrollView`+`ListPanelSliver`) | 回帰 | 約240人規模roomの貢献タブを開く | `ListView`版と同じ見た目・スクロール挙動 | 実機確認(Pixel 7a) | NOT RUN: 別配信者アカウント(約240人規模room)が本ラウンドで用意できず未実施 | 残タスク(推奨)として引き継ぎ |
| TC-CT-025 | pull-to-refreshが`CustomScrollView`化後も機能する | `ContributionTab`(`RefreshIndicator`+`CustomScrollView`) | 回帰 | 貢献タブで下方向スワイプ | `RefreshIndicator`が表示され`_load()`が呼ばれる | 実機確認(Pixel 7a) | PASS | 2026-09-12実機確認。先頭で下スワイプ→円形`RefreshIndicator`のスピナー表示をスクリーンショットで捕捉、直後に表示人数(636→649人)・合計額が更新され`_load()`実行を確認 |
| TC-CT-026 | `ListPanelSliver`のカード視覚(白カード+角丸18+シャドウ+行間1dp区切り線+余白)が旧`ListPanel`と同一に見える | `ListPanelSliver`(`list_panel.dart`) | UI/回帰 | 貢献タブのランキング一覧を表示 | 角丸・シャドウ・区切り線・余白が`ListPanel`使用時(ギフト履歴タブ等)と同一に見える | 実機確認(Pixel 7a、スクリーンショット比較) | PASS(上端のみ) | 2026-09-12実機確認。カード上端の角丸・境界・行間区切り線・余白は`ListPanel`と同一に見える。末尾行(618位)はbottom navigation barの裏に隠れ底辺角丸は未確認(`DecoratedSliver`のSDK実装(`getMaxPaintRect()`)をソース確認済みのため設計上のリスクは無いと判断) |

## Quality Gate

- `live-sidestage-mobile`: `flutter analyze` → PASS(2026-09-12、既存info 1件`use_build_context_synchronously`のみ) / `flutter test test/ranking_list_tile_test.dart test/realtime_sync_test.dart` → PASS(27/27) / `flutter test`(全件) → **574 PASS / 2 FAIL**(`widget_test.dart`ウェルカム文言がオンボーディング変更と不一致。本diff対象外・別ブランチ既知)
- `live-sidestage-analytics`: 本diff対象外

## Out of Scope

- TC-CT-022の「ログアウト」ボタンは存在確認のみ行い、タップ後に実際に`performLogout`が実行され`SessionController.logout()`まで到達するかは検証しない: `performLogout`は`context.read<SessionController>()`と`FlutterForegroundTask`のプラットフォームチャンネルに依存し、`ranking_list_tile_test.dart`の`wrap()`はテスト用Providerを供給していない(他画面の既存ログアウトボタンのテストも同水準の存在確認のみ)。テストインフラ投資はBatch01のスコープ外(DeepSeek指摘、MEDIUM、対応保留)
- バトル履歴タブの `RankingListTile` 呼び出し2箇所(`fetchBreakdown` 未指定)の `openTiktokProfile`(url_launcher)実呼び出し検証: テスト環境でurl_launcherをモックする既存パターンが無いため対象外。タップ領域の存在(InkWellの構造)まではTC-CT-014で回帰確認する
- TC-CT-017/018のpush反映は実データ・実配信での実機確認が理想だが、本worktreeには`.mcp.json`(Marionette MCP)が無く`adb`もPATH未導入のため実機確認はNOT RUN。コードレビューと`flutter test`(`realtime_sync_test.dart`のversion整合性ロジック単体テスト)で担保している
- `fetchGiftRankingShareUrl`(`lib/core/api_client.dart`)自体のFlutter unit test: 既存の`fetchBattleReplayShareUrl`と同様、APIクライアントの薄いラッパー関数はこのプロジェクトの慣行としてFlutter側では単体テストせず、analytics側のroute.integration.test.tsで契約を担保する(既存踏襲)
- Batch03(`gift_history_tab.dart`)は `docs/testing/gift-history-tab/baseline.md` で別管理(2026-09-12 実施)
