---
project: live-sidestage-analytics
feature: analytics-dashboard-mobile-layout
last_updated: 2026-09-05
last_risk: LOW
last_reviewers: Qwen
---

# テストケース設定表: analytics-dashboard-mobile-layout

`/analytics` ダッシュボードの3タブ(貢献/ギフト履歴/バトル履歴)のモバイル表示。`sm`(640px)未満はカードレイアウト、`sm`以上は既存tableを維持する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 由来 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 貢献タブがモバイル幅で横スクロールしない(既存動作の回帰確認) | `AnalyticsPage`(ranking) | 回帰 | 375px幅、ギフト受信済み配信者アカウントでログイン | ページの`body`幅がviewport幅を超えない。列間引き(`hidden sm:table-cell`)が従来どおり効く | Playwright, 375x800 | PASS | base | scrollWidth===clientWidth(375)を確認 |
| TC-02 | ギフト履歴タブがモバイル幅でカード表示になり横スクロールしない | `AnalyticsPage`(history) | 正常 | 375px幅、直近ギフトイベント複数件(長いギフト名を含む)ありのアカウント | `sm:hidden`のカードdivが表示され、`overflow-x-auto`なテーブルは非表示。ページ幅がviewportを超えない。`GiftNameDisplay`の各要素(ギフト画像・×N表示・「編集済」バッジ)がカード内でも正しく描画される | Playwright, 375x800 | PASS | 2026-09-05 | scrollWidth===clientWidth(375)、スクリーンショットで長いギフト名・編集済バッジ表示を目視確認 |
| TC-03 | バトル履歴タブがモバイル幅でカード表示になり横スクロールしない | `AnalyticsPage`(battles) | 正常 | 375px幅、対戦相手情報(1vs1)・複数陣営バトルの両方を含むアカウント | カードに時刻/対戦相手/スコア/状態/コインが表示され、ページ幅がviewportを超えない | Playwright, 375x800 | PASS | 2026-09-05 | scrollWidth===clientWidth(375)、1vs1/チーム戦/相手不明の3パターンとも崩れなし |
| TC-04 | デスクトップ幅(sm以上)では従来どおりtable表示を維持する | `AnalyticsPage`(history/battles) | 回帰 | 1280px幅、TC-02/TC-03と同一データ | `hidden sm:block`のtableが表示され、モバイルカード(`sm:hidden`)は非表示。列・セル内容がリファクタ前と同一 | Playwright, 1280x800 | PASS | 2026-09-05 | scrollWidth===clientWidth(1280)、table表示を目視確認 |
| TC-05 | ギフト履歴タブのインライン編集(ギフト名・コイン数)がモバイルカードでも動作する | `AnalyticsPage`(history, startEdit/commitEdit) | 正常 | 375px幅、任意のギフトイベント1件 | 編集アイコンタップ→入力欄表示→値変更→blurで`PATCH`相当の`commitEdit`が呼ばれ、表示が更新される | Playwright, 375x800 | PASS | 2026-09-05 | 編集ボタンタップ→ギフト名入力→blurでモック`PATCH /api/analytics/gifts/history/ev-1`発火・`giftName`反映を確認。フィールド単位blurで即時commitする既存仕様(desktop版と同一)のためcoin側は次のblurで別途反映される |
| TC-06 | 対戦相手不明・複数人バトル・チーム戦(selfTeam/opponentTeam)のいずれもモバイルカードで表示崩れしない | `BattleOpponentInfo` | 境界 | 375px幅、`opponent: null`/`opponent.count>1`/`selfTeam`&`opponentTeam`ありの3パターン | 各パターンともテキストが省略記号で収まり、カード幅を超えない | Playwright, 375x800 | PASS | 2026-09-05 | TC-03と同一実行で3パターンとも確認済み |
| TC-07 | 開発サーバーでの型検証(ロジック変更なし、UIのみの変更) | `page.tsx`全体 | 回帰 | - | `tsc --noEmit`がエラー0件で終了 | `npm run typecheck` | PASS | 2026-09-05 | 実施済み |
| TC-08 | ネットワーク異常系(API取得失敗)はUI変更の対象外 | - | 異常 | 該当なし: 今回の変更はレンダリングのみでfetchロジック・エラーハンドリングは無改修 | - | - | NOT RUN: 対象外 | 2026-09-05 | |
| TC-09 | ギフト編集(`commitEdit`)失敗時のモバイルカード挙動 | `AnalyticsPage`(history, commitEdit) | 異常 | fetch失敗をモック、モバイルカードで編集確定 | エラーハンドリング自体は今回の変更で新規追加・変更していない(desktop版と同一の`commitEdit`関数を共有) | - | NOT RUN: 対象外(commitEditのエラー処理は今回の差分で変更していない既存ロジック。desktop版と共通関数のため回帰リスクは低い) | 2026-09-05 | Qwen(TestCase mode)指摘#1への対応 |
| TC-10 | 極端に長い対戦相手名(200文字超)でもレイアウト崩れしない | `BattleOpponentInfo` | 境界 | `opponent.nickName`に200文字超の文字列 | `truncate max-w-[160px]`により省略記号で収まる。この`max-w`+`truncate`パターン自体は今回抽出前の既存table実装から変更していない | - | NOT RUN: 既存実装(抽出元のtable版)から変更していないCSSパターンのため、新規リスクなしと判断 | 2026-09-05 | Qwen(TestCase mode)指摘#2への対応 |

## 変更履歴

### 2026-09-05: バトル履歴/ギフト履歴タブのモバイルカードレイアウト追加

- diff: working tree (worktree `analytics-mobile-tabs`)
- risk: LOW / reviewers: Qwen
- review_summary: findings=8 valid=1 fixed=1(重複ロジック指摘→`GiftNameDisplay`共通化)、残りはpre-existing/範囲外/誤検知としてINVALID
- 追加したケース: TC-02, TC-03, TC-04, TC-05, TC-06, TC-07, TC-08
- レビュー指摘と対応:

  | # | reviewer | severity | 指摘 | 分類 | 対応 |
  | --- | --- | --- | --- | --- | --- |
  | 1 | Qwen | HIGH | `battleStatusClass`のdark mode対応不備 | INVALID | 既存コードから抽出しただけで新規ロジックなし。既存のdark:プレフィックス運用と同一 |
  | 2 | Qwen | HIGH | ギフト名編集でXSS | INVALID | Reactの通常テキストバインディング(`{ev.giftName}`)のみ。`dangerouslySetInnerHTML`未使用でエスケープされる |
  | 3 | Qwen | MEDIUM | モバイル/デスクトップでスコア表示が不一致 | INVALID | 両ビューとも同一のwin/lose判定・className条件を共有 |
  | 4 | Qwen | MEDIUM | ギフト名編集の入力バリデーション欠如 | ALREADY_HANDLED(範囲外) | 既存挙動をそのまま複製しただけで今回のdiffで導入した問題ではない |
  | 5 | Qwen | MEDIUM | commitEditのレースコンディション | ALREADY_HANDLED(範囲外) | 既存の`onBlur`実装をそのまま複製。今回のdiff起因ではない |
  | 6 | Qwen | LOW | 表示ID固定幅truncateのアクセシビリティ | ALREADY_HANDLED(範囲外) | 既存コードの`max-w-[...]`パターンを踏襲しただけ |
  | 7 | Qwen | LOW | バトル対戦相手表示のモバイル/デスクトップ重複 | INVALID(誤検知/対応済) | 対戦相手表示は`BattleOpponentInfo`として既に共通化済み。実際に重複していたのはギフト履歴タブの非編集表示部分 |
  | 8 | Qwen | LOW | 編集コントロールのARIAラベル欠如 | ALREADY_HANDLED(範囲外) | 既存ボタンも`title`属性のみでaria-label未設置という同一パターン |

  - 補足: finding#7の指摘趣旨(重複ロジック)自体は妥当だったため、`GiftNameDisplay`ヘルパーを新規抽出してhistory tabのcard/table両方から参照する形に修正した(finding自体の対象箇所は誤りだが、対応は実施)
  - canary検証: 既知バグ(SQLi風関数)を追記して再実行したところ`CRITICAL`枠は生成されたが本文が空欄で、実質的な検出とは言えなかった。単独レビューの信頼度は限定的と判断し、上記findingは全件手動で実コード照合のうえ分類した

- テストケースレビュー(Qwen, TestCase mode): findings=3 valid=2(TC-09/TC-10として追加、いずれもNOT RUN対象外理由付き) invalid=0 low=1(TC-02の期待結果を詳細化して反映)
- 実行結果サマリ: PASS 7(TC-01〜TC-07) / FAIL 0 / NOT RUN 3(TC-08/09/10、理由は各行参照)
