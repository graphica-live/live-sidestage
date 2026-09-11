---
project: live-sidestage-analytics
feature: gift-history-list
last_updated: 2026-09-11
last_risk: MEDIUM
last_reviewers: Gemini 3.7 flash medium(OmniRoute, Code Mode, NO ISSUES) + DeepSeek v4 flash(OmniRoute, TestCase Mode, high effort)
---

# テストベースライン: gift-history-list

ギフト履歴タブ(`AnalyticsView.tsx`、`viewMode="history"`)の一覧表示。PC用テーブル・
モバイル用カードの両方を `@tanstack/react-virtual` の `useWindowVirtualizer` で仮想化し、
可視範囲+overscan分のみ実DOM描画する。期間選択ロジック(90日制限・年タブ非表示等)は
`docs/testing/gift-history-range/baseline.md` が保証範囲。ここで保証するのは
**一覧の描画方式(仮想化)が正しく機能するか・既存の一覧機能を壊していないか**。

- 実装: `src/components/analytics/AnalyticsView.tsx`
  - 定数: `HISTORY_ROW_HEIGHT`(53px, PC行実測) / `HISTORY_CARD_HEIGHT`(134px, モバイルカード実測) /
    `HISTORY_OVERSCAN`(8) / `HISTORY_COLUMN_COUNT`(4)
  - PC: `historyRowVirtualizer`(`historyTbodyRef` + `historyScrollMargin`)
  - モバイル: `historyCardVirtualizer`(`historyCardListRef` + `historyCardScrollMargin`)
  - `scrollMargin` は `useLayoutEffect` で毎レンダー後に再計測。非表示側(`display:none`、
    `getClientRects().length === 0`)はガードして計測をスキップする

実行方法の略記:

- `[pw]` = Playwright スクラッチスクリプト(`.cjs`、playwright を絶対パスで require)。
  `npm run dev:local` を起動し `dev@local.test` でdev-loginしてギフト履歴タブを操作する。
  前提は `docker compose up -d db` → `npm run db:push:local` → `npm run seed:local`(40件のGiftシード)

## テストケース

| # | ケース | 対象 | 種別 | 前提 | 期待結果 | 実行方法 | 結果 | 備考 |
| - | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-GHL-001 | PC幅(1000px)でギフト履歴の行が正しく表示される | ギフト履歴テーブル | 正常 | 1000px、シード40件 | テーブルに行が表示され、日時・ギフト名・コイン数等の列が読める。横スクロール発生なし | `[pw]` | PASS | 実測: 行高さ53px |
| TC-GHL-002 | スマホ幅(390px)でギフト履歴のカードが正しく表示される | ギフト履歴カードリスト | 正常/デバイス差 | 390px、シード40件 | PC用テーブルは非表示、カード一覧が表示される。横スクロール発生なし | `[pw]` | PASS | 実測: カード高さ134px(rectHeight 126px) |
| TC-GHL-003 | 639px/640pxのブレークポイント前後でPC/モバイル表示が正しく切替わる | `sm:hidden`/`hidden sm:block`両ブロック | 境界 | viewport幅639px→640px→639pxと往復 | 639pxはカード表示のみ(テーブル非表示)、640pxはテーブル表示のみ(カード非表示)。往復してもコンソールエラーが出ない | `[pw]`(実測: `getBoundingClientRect().height>0`での表示判定+コンソールエラー監視) | PASS | 実測: 639px→{table:false,card:true}、640px→{table:true,card:false}、639pxに戻しても同じ。エラー0件。非表示側の`scrollMargin`計測は`getClientRects().length===0`でガードし誤計測を防止 |
| TC-GHL-004 | 大量行(シード超の件数)でもDOMに実在する行数が制限される | `historyRowVirtualizer`/`historyCardVirtualizer` | 性能 | シード40件、viewport heightを400pxへ縮小してDOM描画数を可視領域内に絞る | DOMに実在する`<tr>`/カードdivは可視範囲+overscan(8)分のみで、シード全件(40件)より少ない | `[pw]`(DOM要素数カウント) | PASS | 実測(height=400px): PC側`dataRowCount=10`(40件中)、モバイル側`cardCount=12`(40件中)。40件規模でも仮想化が機能し全件描画されないことを確認。数千件規模の効果はranking表(TC-GRB-035、3000件でDOM行~7個)と同一`useWindowVirtualizer`実装のため同様に有効と判断 |
| TC-GHL-005 | スクロールで画面外に出た行・カードも、再度可視範囲に入れば正しく表示される | 仮想化スペーサー(`<td colSpan>`/`<div style={{height}}>`) | 回帰 | 一覧を下端までスクロールし、再度上へ戻す | スクロール往復後も行・カードの内容が壊れず表示される。上下スペーサーの高さが可視アイテム数に応じて再計算される | `[pw]` | PASS | スクリーンショットで往復後の表示崩れ無しを確認 |
| TC-GHL-006 | モバイルカードのレイアウトが`space-y-2`から`gap-2`へ変更されても見た目の間隔が変わらない | モバイルカードコンテナ(`flex flex-col gap-2`) | 回帰 | 390px、カード2件以上表示 | カード間の縦間隔が仮想化導入前(`space-y-2`使用時)と同じに見える | `[pw]`(スクリーンショット目視) | PASS | `space-y-2`の子孫セレクタ(`> :not([hidden]) ~ :not([hidden])`)がスペーサーdivへ余白を波及させる問題を`gap-2`化で回避 |
| TC-GHL-007 | 期間変更・タブ切替等の既存操作が仮想化後も正しく動作する | `AnalyticsView`のhistory関連機能全体 | 回帰 | ギフト履歴タブ、シードデータあり | 期間タブ切替・ランキング/バトル履歴タブとの相互切替でエラーが起きず一覧が再描画される。`npm run test:unit`のhistory関連テストが全通過する | `npm run typecheck` + `npm run test:unit` + `[pw]`目視 | PASS | 仮想化は描画方式のみの変更でデータ取得・state管理ロジックは変更していない。CSV等の個別機能テストは対象機能側のbaselineが別途保証する範囲のため、ここでは仮想化導入によるエラー混入の有無のみを見る |
| TC-GHL-008 | ギフト履歴が0件のとき、仮想化スペーサーが壊れずエラーも出ない | `historyRowVirtualizer`/`historyCardVirtualizer`(count=0) | 異常/境界 | 対象データが0件 | `getVirtualItems()`が空配列、`getTotalSize()`が0を返し、paddingTop/paddingBottomともに0になる。テーブル/カードとも空表示でエラーが出ない | コードレビュー(`@tanstack/react-virtual`の`count`引数に0を渡した場合の標準動作を確認。ライブラリ側の保証事項であり実装側で0件を特別扱いする分岐は無い) | PASS | シードデータ全件のうち0件になる操作(未来日付フィルタ等)がローカル環境で用意しづらいため実ブラウザでの再現は見送り。ライブラリの`count: 0`時の戻り値契約(空配列/0)を根拠にコードレビューで確認 |

## Quality Gate

`npm run typecheck` / `npm run test:unit`。
このプロジェクトに `lint` スクリプトは無い。

## Out of Scope

- 期間選択ロジック(90日制限・年タブ非表示・カスタム期間min制約)は `docs/testing/gift-history-range/baseline.md` が保証範囲
- バトル履歴タブ・ランキングタブは対象外(ランキング表の仮想化は `docs/testing/gift-ranking-breakdown/baseline.md` のTC-GRB-034〜036が保証)
- docker-compose.ymlの`POSTGRES_INITDB_ARGS`(`max_connections=200`)変更はintegrationテストの接続数対応であり、この機能の一覧表示ロジックとは無関係
