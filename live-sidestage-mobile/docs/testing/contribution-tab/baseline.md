---
project: live-sidestage-mobile
feature: 貢献タブ(ContributionTab)
last_updated: 2026-09-11
last_risk: HIGH
last_reviewers: DeepSeek + Codex(terra, medium)
---

# テストベースライン: 貢献タブ(ContributionTab)

期間別(day/week/month/year/カスタム)のユーザー別コイン数ランキング。行のアバターアイコンのタップのみ
TikTokプロフィールへ遷移し、行のそれ以外(順位メダル・名前・コイン数)のタップはアコーディオン展開して
ギフト名別内訳(Web版 AnalyticsView.tsx と同じ `src/lib/gift-breakdown.ts` を参照)を表示する。
展開・内訳取得は貢献タブの `RankingListTile`(`fetchBreakdown` 指定)のみの挙動で、バトル履歴タブの
2箇所(`fetchBreakdown` 未指定)は行全体タップでプロフィール遷移する従来動作のまま変わらない。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CT-001 | アバターアイコンのタップはプロフィール遷移のみで展開しない | `RankingListTile`(貢献タブ) | UI | `fetchBreakdown` 指定、アバターをタップ | `fetchBreakdown` は呼ばれない、内訳パネルは表示されない | `flutter test test/ranking_list_tile_test.dart -t "アバター"` | PASS | |
| TC-CT-002 | 名前・コイン数部分のタップでアコーディオン展開し内訳を取得・表示する | `RankingListTile`(貢献タブ) | 正常 | `fetchBreakdown` 指定、名前部分をタップ | 展開してギフト名・数量・pt が表示される | `flutter test test/ranking_list_tile_test.dart -t "名前部分"` | PASS | |
| TC-CT-003 | 順位メダル部分のタップでも展開する(Web版 `<tr onClick>` の行全体トグルに合わせる、1〜3位のグラデーションメダル・4位以下の数字表示どちらも) | `RankingListTile`(貢献タブ) | UI | `fetchBreakdown` 指定、順位メダル(1位グラデーション/4位数字表示)をタップ | 展開して内訳が表示される | `flutter test test/ranking_list_tile_test.dart --plain-name "順位メダル"` / `--plain-name "グラデーションメダル"` | PASS | Codex指摘(タップ領域がExpanded部分に限定されていた)を受け追加 |
| TC-CT-004 | 展開状態は再タップでキャッシュされ、再取得しない | `RankingListTile`(貢献タブ) | 回帰 | 展開→閉じる→再展開 | 2回目の展開で `fetchBreakdown` が再度呼ばれない | `flutter test test/ranking_list_tile_test.dart --plain-name "名前部分"` | PASS | |
| TC-CT-005 | ギフト明細が保持期間(90日)を過ぎている期間は「内訳は残っていません」を表示する | `RankingListTile`(貢献タブ) | 境界 | `coverage.detailAvailable: false` | 「この期間の内訳は残っていません(ギフト明細は90日で削除されます)」の文言を表示 | `flutter test test/ranking_list_tile_test.dart --plain-name "明細が残っていない"` | PASS | |
| TC-CT-006 | 期間切替(day/week/month/カスタム範囲)で行が再マウントされ、前の期間の展開・キャッシュを残さない | `ContributionTab._rangeSignature` + `RankingListTile` の `key` | 回帰 | 貢献タブで1位行を展開(エラー状態)後、期間セレクタを「日」→「週」に切替 | 切替後は展開状態が閉じており、順位・行内容も新しい期間のものに入れ替わる | 実機確認(手動、下記備考) | PASS | 2026-09-09 Pixel 7a(`33071JEHN14416`)、実データ(`@zunda5884`)で確認。自動テストは未整備(DeepSeek(HIGH)・Codex(MEDIUM)が指摘したギャップ、`_rangeSignature`によるkey変更でのState破棄はFlutter標準機構依存のため今回は実機確認のみで担保) |
| TC-CT-012 | 複数のギフト種別をtotalDiamonds降順で表示する(サーバー返却順をそのまま尊重) | `RankingListTile`(貢献タブ) | 正常 | `fetchBreakdown` が2種別(500pt/300pt)を降順で返す | 両方表示され、500pt側が先に描画される | `flutter test test/ranking_list_tile_test.dart --plain-name "totalDiamonds降順"` | PASS | |
| TC-CT-013 | 内訳取得失敗時はエラー表示、再試行タップで再取得し成功時は表示が切り替わる | `RankingListTile`(貢献タブ) | 異常/回帰 | `fetchBreakdown` が1回目のみ例外を投げる | 「内訳を取得できませんでした」+「再試行」ボタン表示→再試行タップで再取得、成功後はエラー表示が消え内訳が出る | `flutter test test/ranking_list_tile_test.dart --plain-name "取得失敗"` | PASS | |
| TC-CT-007 | 未認証(トークン無し)は401 | `GET /api/mobile/analytics/gifts/breakdown` | 異常 | Authorization ヘッダ無し | ステータス401 | `analytics: npx dotenv -e .env.local.test -- npx vitest run src/app/api/mobile/analytics/gifts/breakdown/route.integration.test.ts` | PASS | |
| TC-CT-008 | `tiktokUid` 未指定は400 | 同上 | 異常 | トークンあり、`tiktokUid` パラメータ無し | ステータス400 | 同上 | PASS | |
| TC-CT-009 | Streamer は存在するが room 未接続の場合、内訳なしで200 | 同上 | 境界 | room未接続のstreamerトークン | `gifts: []`、`coverage.detailAvailable: false` | 同上 | PASS | |
| TC-CT-010 | FREEプランは month/year/カスタム範囲の内訳取得を拒否される | 同上 + `requireHistoryPlan` | 異常/権限差 | FREEプラントークン、`period=month` | ステータス403 | 同上 | PASS | |
| TC-CT-011 | day期間内のギフトをギフト名別に集計して返す(明細が残っている期間、他ユーザー分は混ざらない) | 同上 + `queryGiftBreakdown` | 正常 | 同一room内 `fan_a`(2ギフト種別)・`fan_b`(別ユーザー) | `fan_a` のみ集計、`total`・`gifts` が totalDiamonds 降順で一致 | 同上 | PASS | |
| TC-CT-014 | `fetchBreakdown` 未指定時(バトル履歴タブ)、順位メダル部分にもタップ領域が残る(退行防止) | `RankingListTile`(バトル履歴タブ) | 回帰 | `fetchBreakdown` 未指定 | 順位メダル部分に `InkWell` が存在する(プロフィール遷移の呼び出し自体はurl_launcherのモック手段が無いため対象外) | `flutter test test/ranking_list_tile_test.dart --plain-name "順位メダル部分にもタップ領域"` | PASS | DeepSeek指摘(HIGH、アコーディオン対応でメダル部分だけタップ領域から漏れ、行全体タップの従来動作が退行していた)を受け追加。openTiktokProfile呼び出しの検証自体は Out of Scope 節参照 |
| TC-CT-015 | `tiktokHandle` が null(TikTokUser 行が無い送信者)の行はプロフィール遷移のタップを受け付けない | `RankingListTile`(バトル履歴タブ) | 異常/データ欠損 | `tiktokHandle: null`、`fetchBreakdown` 未指定 | 行内の `InkWell`・アバターの `GestureDetector` の `onTap` が全て null(`https://www.tiktok.com/@` を組み立てられないため導線を出さない) | `flutter test test/ranking_list_tile_test.dart --plain-name "タップを受け付けない"` | PASS | tiktokUid統一(`worktree-tiktok-uid-unify`)で `tiktokHandle` が nullable になったことによる新規保証条件 |
| TC-CT-016 | `tiktokHandle` が null でも内訳アコーディオンは `tiktokUid` をキーに動作する | `RankingListTile`(貢献タブ) | 境界 | `tiktokHandle: null`、`fetchBreakdown` 指定、名前をタップ | `fetchBreakdown` が `entry.tiktokUid` で1回呼ばれ、内訳が表示される | `flutter test test/ranking_list_tile_test.dart --plain-name "fetchBreakdown指定時は名前タップ"` | PASS | 内訳取得キーはハンドルでなく不変な uid なので、ハンドル欠損は展開を妨げない |
| TC-CT-017 | Socket.IOで正常なranking snapshot pushを受信すると、REST再取得を待たず画面のランキング一覧が更新される | `ContributionTab.build` + `RankingSyncStore` | 正常/回帰 | `RankingSyncStore`が`canApply`な`chat:ranking:snapshot`を受信(version整合) | `store.getSnapshot()`が非nullになり、`build()`がそれを`users`のソースとして描画する(RESTの`_result`のみに依存しない) | コードレビュー(`build()`が`context.watch<RankingSyncStore>().getSnapshot()`を参照し、`entities`を`GiftRankingEntry.tryParse`で復元していることを確認) + `flutter test`/`flutter analyze` | PASS(コードレビュー確認、Codexレビューで検出されたHIGH不具合の修正) | Batch06で修正。修正前は`needsResync`時のみ`_load()`が呼ばれ、正常push受信時は画面が一切更新されない不具合があった |
| TC-CT-018 | REST取得直後、サーバーの現在versionより1小さいversionのpushを欠損と誤判定しない | `RankingSyncStore.acknowledgeResync` + `VersionTracker.acknowledge` | 境界/回帰 | REST取得時点でサーバーversionが7、直後に届くpushがversion 8 | `acknowledgeResync`が`VersionTracker.acknowledge(bootId, epoch, version: 7)`でtrackerを実際のREST版数へ同期するため、version 8のpushは`canApply`になる | `flutter test test/realtime_sync_test.dart`(`acknowledge()`関連ケース) | PASS | Batch06で修正。修正前は`acknowledgeResync`が常に`VersionTracker.reset()`(=0)していたため、次のpushが恒久的にversion欠損(mismatch)と誤判定されREST再取得が無限に続くおそれがあった(Codexレビューで検出) |

## Quality Gate

- `live-sidestage-mobile`: `flutter analyze` / `flutter test`
- `live-sidestage-analytics`: `npm run typecheck` / `npx dotenv -e .env.local.test -- npx vitest run <対象ファイル>`

## Out of Scope

- バトル履歴タブの `RankingListTile` 呼び出し2箇所(`fetchBreakdown` 未指定)の `openTiktokProfile`(url_launcher)実呼び出し検証: テスト環境でurl_launcherをモックする既存パターンが無いため対象外。タップ領域の存在(InkWellの構造)まではTC-CT-014で回帰確認する
- TC-CT-017/018のpush反映は実データ・実配信での実機確認が理想だが、本worktreeには`.mcp.json`(Marionette MCP)が無く`adb`もPATH未導入のため実機確認はNOT RUN。コードレビューと`flutter test`(`realtime_sync_test.dart`のversion整合性ロジック単体テスト)で担保している
