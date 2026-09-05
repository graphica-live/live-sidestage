---
project: live-sidestage-analytics
feature: analytics-dashboard-mobile-layout
last_updated: 2026-09-05
last_risk: HIGH
last_reviewers: Fable, Qwen(canary失敗によりTestCase未実施扱い)
---

# テストケース設定表: analytics-dashboard-mobile-layout

`/analytics` ダッシュボードの3タブ(貢献/ギフト履歴/バトル履歴)のモバイル表示。`sm`(640px)未満はカードレイアウト、`sm`以上は既存tableを維持する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 由来 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-01 | 貢献タブがモバイル幅で横スクロールしない(既存動作の回帰確認) | `AnalyticsPage`(ranking) | 回帰 | 375px幅、ギフト受信済み配信者アカウントでログイン | ページの`body`幅がviewport幅を超えない。列間引き(`hidden sm:table-cell`)が従来どおり効く | Playwright, 375x800 | PASS | base | scrollWidth===clientWidth(375)を確認 |
| TC-02 | ギフト履歴タブがモバイル幅でカード表示になり横スクロールしない | `AnalyticsPage`(history) | 正常 | 375px幅、直近ギフトイベント複数件(長いギフト名を含む)ありのアカウント | `sm:hidden`のカードdivが表示され、`overflow-x-auto`なテーブルは非表示。ページ幅がviewportを超えない。`GiftNameDisplay`の各要素(ギフト画像・×N表示)がカード内でも正しく描画される | Playwright, 375x800 | PASS | 2026-09-05 | scrollWidth===clientWidth(375)。編集機能撤去後の`page.tsx`で再実行し確認済み(fable-expert指摘#3への対応)。「編集済」バッジは同日の編集機能撤去で消滅 |
| TC-03 | バトル履歴タブがモバイル幅でカード表示になり横スクロールしない | `AnalyticsPage`(battles) | 正常 | 375px幅、対戦相手情報(1vs1)・複数陣営バトルの両方を含むアカウント | カードに時刻/対戦相手/スコア/状態/コインが表示され、ページ幅がviewportを超えない | Playwright, 375x800 | PASS | 2026-09-05 | scrollWidth===clientWidth(375)、1vs1/チーム戦/相手不明の3パターンとも崩れなし |
| TC-04 | デスクトップ幅(sm以上)では従来どおりtable表示を維持する。ギフト履歴tableは編集列撤去後の4列(時刻/ユーザー/ギフト/💎)構成であること | `AnalyticsPage`(history/battles) | 回帰 | 1280px幅、TC-02/TC-03と同一データ | `hidden sm:block`のtableが表示され、モバイルカード(`sm:hidden`)は非表示。ギフト履歴tableのthead/tbodyは4列のみで、旧`<th>編集</th>`列・`PencilIcon`ボタンは存在しない | Playwright, 1280x800 | PASS | 2026-09-05 | scrollWidth===clientWidth(1280)、`document.querySelectorAll('th')`4件・`button[title="このギフトを編集"]`0件を確認(fable-expert指摘#1への対応、撤去後に再実行) |
| TC-05 | (廃止) ギフト履歴タブのインライン編集 | - | - | - | - | - | 廃止: ギフト編集機能(`startEdit`/`commitEdit`/`PATCH /api/analytics/gifts/history/:id`)は2026-09-05に撤去。当該API routeファイル自体を削除済みのため呼び出せば404(実体消滅) | 2026-09-05 | 撤去前の実行記録: PASS |
| TC-06 | 対戦相手不明・複数人バトル・チーム戦(selfTeam/opponentTeam)のいずれもモバイルカードで表示崩れしない | `BattleOpponentInfo` | 境界 | 375px幅、`opponent: null`/`opponent.count>1`/`selfTeam`&`opponentTeam`ありの3パターン | 各パターンともテキストが省略記号で収まり、カード幅を超えない | Playwright, 375x800 | PASS | 2026-09-05 | TC-03と同一実行で3パターンとも確認済み |
| TC-07 | ギフト編集機能撤去後の型検証(UI・API・Prismaモデル一括削除) | `page.tsx`/`gift-history.ts`/`schema.prisma`全体 | 回帰 | - | `tsc --noEmit`がエラー0件で終了 | `npm run typecheck` | PASS | 2026-09-05 | 撤去後に再実行し確認済み(fable-expert指摘#3への対応) |
| TC-08 | ネットワーク異常系(API取得失敗)はUI変更の対象外 | - | 異常 | 該当なし: 今回の変更はレンダリングのみでfetchロジック・エラーハンドリングは無改修 | - | - | NOT RUN: 対象外 | 2026-09-05 | |
| TC-09 | (廃止) ギフト編集(`commitEdit`)失敗時のモバイルカード挙動 | - | - | - | - | - | 廃止: ギフト編集機能は2026-09-05に撤去 | 2026-09-05 | Qwen(TestCase mode)指摘#1への対応として追加したが、機能撤去により対象消滅 |
| TC-10 | 極端に長い対戦相手名(200文字超)でもレイアウト崩れしない | `BattleOpponentInfo` | 境界 | `opponent.nickName`に200文字超の文字列 | `truncate max-w-[160px]`により省略記号で収まる。この`max-w`+`truncate`パターン自体は今回抽出前の既存table実装から変更していない | - | NOT RUN: 既存実装(抽出元のtable版)から変更していないCSSパターンのため、新規リスクなしと判断 | 2026-09-05 | Qwen(TestCase mode)指摘#2への対応 |
| TC-11 | ギフト編集UIが跡形もなく撤去されている(negative check) | `AnalyticsPage`(history) | 回帰 | 375px幅・1280px幅の両方、TC-02/04と同一データ | `button[title="このギフトを編集"]`・`datalist#gift-name-suggestions`・`datalist#coin-suggestions`・テキスト「編集済」・`<th>`の「編集」列見出しがいずれもDOMに0件 | Playwright, 375x800 & 1280x900 | PASS | 2026-09-05 | 両幅とも全項目0件を確認。fable-expert指摘#2への対応(撤去漏れの回帰検出用に新設) |

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

### 2026-09-05: ギフト履歴タブの手動編集機能(GiftEdit)を完全撤去

- diff: worktree `remove-gift-history-edit`(未コミット)。編集UI(編集ボタン・入力欄・datalist・「編集済」バッジ・編集列)撤去、`PATCH /api/analytics/gifts/history/[id]` route削除、`src/lib/gift-history.ts` の編集ロジック削除、Prisma `GiftEdit` モデル削除(migration追加)、mobile `GiftHistoryEvent.edited` 削除
- risk: HIGH(migration・data loss を含む) / reviewers: Code Mode = Fable-expert + Qwen(カナリア通過)。Codex(quota切れ、9/7まで復旧予定)・Gemini(agy.exe ENAMETOOLONGで技術的に起動不能、2回失敗)は利用不能につきユーザー判断のうえFable+Qwenで完了扱い
- Code Mode review_summary: findings=5(CRITICAL/HIGH無し) valid=0(修正要のVALIDなし、MEDIUM1件は db push 運用時の既知の一時的挙動、LOW3件はスコープ外/記録目的)
- TestCase Mode: Qwenはカナリア検証で注入した既知欠陥を検出できず「レビュー未実施」と判定。Fable-expertへ設定表レビューを追加依頼し、findings=5(MEDIUM2 valid、LOW3 valid)を本表へ反映(下表)
- 反映した指摘:

  | # | reviewer | severity | 指摘 | 分類 | 対応 |
  | --- | --- | --- | --- | --- | --- |
  | 1 | Fable | MEDIUM | TC-04期待結果「列・セル内容がリファクタ前と同一」が現実装(編集列撤去済み4列)と不一致 | VALID | TC-04の対象・期待結果を4列構成の明記へ書き換え |
  | 2 | Fable | MEDIUM | 編集UI非存在を確認するnegative checkのテストケースが無い(撤去漏れの回帰検出手段が無い) | VALID | TC-11として新設。編集ボタン/datalist/編集済バッジ/編集列見出しの0件確認をPlaywrightで実施しPASS |
  | 3 | Fable | LOW | TC-02/04/07のPASSは撤去前(page.tsx変更前)の実行記録 | VALID | 撤去後の`page.tsx`で全項目を再実行し確認、備考に明記 |
  | 4 | Fable | LOW | TC-05/09の廃止判断自体は妥当 | ALREADY_HANDLED | 対応不要(現状維持) |
  | 5 | Fable | LOW | 本セクション(変更履歴)の追記漏れ | VALID | 本エントリとして追記 |

- 実行結果サマリ: PASS 4(TC-02再実行/TC-04再実行/TC-07再実行/TC-11新設) / FAIL 0 / 既存のTC-01/03/06の記録は今回の変更で対象外のため維持
- 検証済み: typecheck(pass) / test:unit 1221件(pass) / test:integration 696件(pass) / `npx next build`(pass) / flutter analyze(no issues) / flutter test 471件(pass) / Playwright実機確認(PC 1280px・375px、編集UI全項目0件)
