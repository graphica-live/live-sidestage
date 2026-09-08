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
| TC-06 | 対戦相手不明・複数人バトル・チーム戦(selfTeam/opponentTeam)のいずれもモバイルカードで表示崩れしない | `BattleOpponentInfo` | 境界 | 375px幅、`opponent: null`/`opponent.count>1`/`selfTeam`&`opponentTeam`ありの3パターン | 各パターンともテキストが省略記号で収まり、カード幅を超えない | Playwright, 375x800 | PASS | 2026-09-05 | TC-03と同一実行で3パターンとも確認済み |
| TC-07 | ギフト編集機能撤去後の型検証(UI・API・Prismaモデル一括削除) | `page.tsx`/`gift-history.ts`/`schema.prisma`全体 | 回帰 | - | `tsc --noEmit`がエラー0件で終了 | `npm run typecheck` | PASS | 2026-09-05 | 撤去後に再実行し確認済み(fable-expert指摘#3への対応) |
| TC-10 | 極端に長い対戦相手名(200文字超)でもレイアウト崩れしない | `BattleOpponentInfo` | 境界 | `opponent.nickName`に200文字超の文字列 | `truncate max-w-[160px]`により省略記号で収まる。この`max-w`+`truncate`パターン自体は今回抽出前の既存table実装から変更していない | - | NOT RUN: 既存実装(抽出元のtable版)から変更していないCSSパターンのため、新規リスクなしと判断 | 2026-09-05 | Qwen(TestCase mode)指摘#2への対応 |
| TC-11 | ギフト編集UIが跡形もなく撤去されている(negative check) | `AnalyticsPage`(history) | 回帰 | 375px幅・1280px幅の両方、TC-02/04と同一データ | `button[title="このギフトを編集"]`・`datalist#gift-name-suggestions`・`datalist#coin-suggestions`・テキスト「編集済」・`<th>`の「編集」列見出しがいずれもDOMに0件 | Playwright, 375x800 & 1280x900 | PASS | 2026-09-05 | 両幅とも全項目0件を確認。fable-expert指摘#2への対応(撤去漏れの回帰検出用に新設) |

## Out of Scope

- ネットワーク異常系(API取得失敗時のUI): 本機能の変更はレンダリングのみで、fetchロジック・エラーハンドリングは無改修のため対象外
- ギフト履歴のインライン編集(旧 TC-05 / TC-09): 2026-09-05 に機能ごと撤去済み。撤去の negative check は TC-11 が担う
