---
date: 2026-09-09
feature: 貢献タブ(ContributionTab)
risk: HIGH
reviewers: DeepSeek + Codex(Primary)
---

## 変更内容

貢献タブの行タップ挙動を web版(`AnalyticsView.tsx`)に合わせて変更。

- 従来: 行全体タップでTikTokプロフィールへ遷移
- 変更後: **アバターアイコンのタップのみ**プロフィール遷移、行のそれ以外(順位メダル・名前・コイン数)のタップは**アコーディオン展開**してギフト名別内訳を表示
- 内訳取得元は analytics 側新規API `GET /api/mobile/analytics/gifts/breakdown`(モバイルJWT認証 + `requireHistoryPlan`、既存 `src/lib/gift-breakdown.ts` を web 版と共用)

対象は `RankingListTile`(`fetchBreakdown` 指定時のみ)。バトル履歴タブの2箇所(`fetchBreakdown` 未指定)は行全体タップでプロフィール遷移する従来動作のまま変更していない。

## reviewer の重要指摘と採否判断

- **Codex(HIGH primary、VALID→修正）**: 初期実装ではタップ領域が `Expanded`(名前・コイン数部分)に限定されており、web版の `<tr onClick>` が行全体(順位セルを含む)をトグル対象にしているのと乖離していた。順位メダル部分にも `InkWell` を追加してタップ対象を拡張し、回帰テスト(4位の数字表示・1〜3位のグラデーションメダル両方)を追加した。
- **DeepSeek(LOW、VALID→修正）**: `_retry()`/`_toggle()` 内の `widget.fetchBreakdown!` 非null断定がクラッシュしうる指摘。ローカル変数へ抽出してnullチェックする形に修正。
- **DeepSeek(HIGH、追加レビューでVALID→修正）**: `_retry()`構文バグ修正後の再レビューで、アコーディオン対応の実装変更により `fetchBreakdown` 未指定(バトル履歴タブ)側の順位メダル部分が `InkWell` から漏れ、「行全体タップでプロフィール遷移」という従来動作が退行していた指摘。メダル部分の `onTap` を `fetchBreakdown != null ? _toggle : openTiktokProfile` の分岐に統一して修正、構造面の回帰テスト(TC-CT-014、url_launcherモック不可のためInkWell存在確認のみ)を追加した。
- **DeepSeek(HIGH) / Codex(MEDIUM)、TestCase Modeで指摘、対応未了**: 期間切替(`_rangeSignature` による `RankingListTile` の `key` 変更)で展開状態・内訳キャッシュが残らないことの自動回帰テストが無い。Flutter の `key` 変更によるState破棄・再構築という標準機構への依存が強く、widget test での再現コストが高いと判断し、**自動テスト化は見送り、実機確認(Pixel 7a、実データ)で担保**した(baseline TC-CT-006)。今後 `ContributionTab` 側の統合テストを整備する際に合わせて自動化を検討する。

## 検証

- `flutter analyze`: No issues found
- `flutter test`: 501件 PASS(`ranking_list_tile_test.dart` 11件、新規: 順位メダル部分タップ2件・複数ギフト種別の降順表示・取得失敗+再試行を含む)
- analytics: `route.integration.test.ts`(gifts/breakdown 5件、ranking 19件回帰)PASS済み(review-auto Code Mode 実施時点)
- 実機 Pixel 7a(`33071JEHN14416`、実データ `@zunda5884`): アバタータップでのプロフィール遷移、名前部分タップでの展開・エラー表示・再試行、期間切替(日→週)での展開状態クリアを確認

## デバッグメモ(実装上の落とし穴)

`_retry()` を当初 `setState(() => _future = fetchBreakdown(...))` という式構文で書いていたところ、
代入式の値(`Future`)がそのまま `setState` のコールバックの戻り値として扱われ、
「setState() callback argument returned a Future」assertionで実行時エラーになった。
ブロック構文 `setState(() { _future = ...; })` へ修正。

別途、`fetchBreakdown` が返す `Future` がエラーで即完了するケースで、生成(`_toggle`/`_retry`内)から
`FutureBuilder` の購読(次のbuildの`initState`)までのタイムラグの間にDartがunhandled errorとして
検出することがあった(widgetテストで再現)。`future.then((_) {}, onError: (_) {})` でダミーの購読を
先に登録し、unhandled判定を防いでいる(実際のエラーハンドリングは `FutureBuilder` 側で行う)。

## 残存リスク

- TC-CT-006(期間切替時のキャッシュクリア)の自動回帰テストが未整備。今回のリグレッションは実機確認のみで担保しており、将来の変更で崩れても自動テストでは検知できない。
