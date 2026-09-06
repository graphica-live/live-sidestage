---
project: live-sidestage-mobile
feature: battle-history-tab
last_updated: 2026-09-06
last_risk: LOW
last_reviewers: Qwen(Code Mode, カナリア検証済みNO ISSUES) / Qwen(TestCase Mode, カナリア検証済みNO ISSUES)
---

# テストベースライン: battle-history-tab

バトル履歴タブ(`lib/screens/tabs/battle_history_tab.dart`)。analyticsの `chat:battle` 集計を読み取り専用で表示し、
日/週/月/カスタム期間の切替、しきい値トグルによる非表示、カードタップでの貢献者ボトムシート展開を持つ。
視覚仕様は `.impeccable/approved/battle-history-kosai/spec.md` を正本とする。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-BH-001 | 2陣営バトルのスコア・勝敗表示が崩れない | `_BattleCard` / `_ScoreSegment` | UI | selfScore > opponentScore の1vs1バトル | カードが表示され、自陣スコアがグラデーション文字、勝敗バッジ「WIN」が表示される | 実機/エミュレータ(Marionette MCP) | NOT RUN: Marionette MCP未接続。実データに該当バトル(明確な1vs1 WIN)が無かった | |
| TC-BH-002 | 参加人数合計>2でも1vs1と同じ基準サイズで表示され、収まらない陣営数のときだけ自動縮小する | `_ScoreSegment` / `_BattleCard.build`(`FittedBox`) | 境界 | selfCount+opponentCount>2 のバトル(2vs2等)、および3陣営以上(`teams`経由) | 2vs2はアバター40dp/スコア24dp/名前11.5dp(1vs1と同一)で表示される。1vs1vs1vs1(4陣営)はカード幅に収まらないため`FittedBox(scaleDown)`で全体が比例縮小されるが、数値は省略されずoverflowも発生しない | 実機adb screencap(Pixel 7a、一時プレビューハーネスで6パターン確認) | PASS(2026-09-06、設計変更後の6パターン再確認で全てPASS) | Artifact参照(下記URL) |
| TC-BH-003 | スコア不明時は勝敗バッジを出さない | `_OutcomeBadge` | 異常 | selfScore/opponentScore の一方または両方がnull | ステータスがlive/cutShort以外ならバッジ非表示 | 実機adb screencap(Pixel 7a) | PASS(2026-09-06、実データ opponentScore null で確認) | ロジック自体は本変更で未変更 |
| TC-BH-004 | しきい値トグルで低スコアバトルが一覧から隠れる | しきい値トグル行 | 正常 | max(selfScore, opponentScore) < しきい値のバトルが存在 | 該当バトルが一覧から消える。全件非表示なら専用文言を表示 | 実機/エミュレータ(Marionette MCP) | NOT RUN: Marionette MCP未接続。実データがしきい値(既定100)を超えており非表示条件に該当しない | ロジック自体は本変更で未変更 |
| TC-BH-005 | カードサイズが視認しやすい大きさになっている(2026-09-06サイズ改訂、アバター再拡大・最小高さ再調整込み) | `_BattleCard` 全体 | UI | 通常のバトル1件以上 | カード最小高さ148dp・padding18dp・アバター40/32dp・スコア文字24/16dp・名前11.5/10dp・勝敗バッジ12dpで表示され、旧サイズ(142dp・アバター26/19dp等)より明確に大きい。かつスコア行下からフッターまでの余白が間延びしない | 実機adb screencap(Pixel 7a)、実データで撮影 | PASS(2026-09-06、最小高さ再調整後の再撮影込みでArtifactでユーザー提示済) | 配信者フィードバック「カード全体小さい」→サイズ拡大→「アイコンまだ小さい」→アバター再拡大(32/24→40/32dp)→「空きスペース多すぎ」→最小高さ168→148dpへ縮小 |
| TC-BH-006 | カードタップで貢献者ボトムシートが開く | `_BattleContributorsSheet` | 回帰 | カードをタップ | `RankingListTile`でこのバトルの貢献者一覧が表示される | 実機/エミュレータ(Marionette MCP) | NOT RUN: Marionette MCP未接続。タップ操作は未実施 | 本変更でロジック未変更 |
| TC-BH-007 | 同点(DRAW)時のバッジ表示が崩れない | `_OutcomeBadge` | 境界 | selfScore == opponentScore | 背景card・枠1dp line・文字subの「DRAW」バッジが拡大後サイズ(12dp/padding縦6横14)で表示される | 実機/エミュレータ(Marionette MCP) | NOT RUN: Marionette MCP未接続。実データに同点バトルが無かった | |
| TC-BH-008 | ちょうど2陣営(1vs1)は基準サイズをそのまま使う(縮小されない) | `_ScoreSegment` | 境界 | selfCount+opponentCount == 2(1vs1) | 基準サイズ(アバター40dp/スコア24dp/名前11.5dp)で表示され、`FittedBox`による縮小は発生しない(カード幅に自然に収まるため) | 実機adb screencap(Pixel 7a、一時プレビューハーネス) | PASS(2026-09-06、1vs1パターンで確認) | |
| TC-BH-009 | 短い名前・低スコアでもカード拡大後のレイアウトが崩れない | `_BattleCard` 全体 | 境界 | 表示名が短い(1〜2文字)・スコアが1桁のバトル | 最小高さ148dpは維持され、要素の重なり・はみ出しが発生しない | 実機/エミュレータ(Marionette MCP) | NOT RUN: Marionette MCP未接続。実データが該当しなかった | |
| TC-BH-010 | 3陣営以上(teams経由)のスコア行が横幅overflowしない | `_BattleCard.build`(`FittedBox`) | 境界 | teamsが3件以上(1vs1vs1、1vs1vs1vs1等) | 各陣営セグメントがカード幅に収まり、RenderFlexのoverflow(黄黒縞)が発生しない。数値・アイコンは省略されず必要なら全体が自動縮小される | 実機adb screencap(Pixel 7a、一時プレビューハーネスで6パターン確認) | FAIL→修正→PASS(2026-09-06。1vs1vs1vs1で実際にoverflow発生を確認、当初`_ScoreSegment`個別にConstrainedBox+FittedBoxでラップして修正。その後の陣営数サイズ統一(TC-BH-002参照)で個別FittedBoxを撤去し、`_BattleCard.build`がスコア行全体を`FittedBox(scaleDown)`で包む方式へ再設計、再撮影でoverflow消失を再確認) | 6パターン確認作業中に発見した回帰。3陣営(1vs1vs1)までは発生せず4陣営から顕在化する境界値バグだった |

## Quality Gate

- `flutter analyze lib/screens/tabs/battle_history_tab.dart` → No issues found (2026-09-06)
- `flutter test` → 471 tests, All tests passed! (2026-09-06)

## Out of Scope

- 4陣営以上での「4スコア横並び」表示: サーバーAPIがselfScore/opponentScoreの2値しか返さないため未実装(spec.md記載のとおり、データ不在による意図的な仕様)
