---
last_updated: 2026-09-10
last_risk: LOW
last_reviewers: [DeepSeek(high), Codex-terra(medium)]
---

# バトル履歴一覧(mobile)

対象: `lib/screens/tabs/battle_history_tab.dart`(コイン閾値非表示フィルタ)、
`lib/core/battle_filter_store.dart`(`BattleFilterStore` 既定値、`isSmallBattle`)

## 正常

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 1 | 両陣営ともしきい値未満 | `flutter test test/battle_filter_store_test.dart` | `isSmallBattle` が `true` を返す |
| 2 | 片方でもしきい値以上 | 同上 | `isSmallBattle` が `false` を返す |
| 6 | 未保存(初回起動)の既定値 | `flutter test test/battle_filter_store_test.dart` | `BattleFilterStore().hideSmall` が `false`、`threshold` が 100。`load()` で保存値が無い場合もトグルOFF |
| 7 | 端末で明示的にONにした後の再起動 | 実機(Pixel 7a)でトグルON → アプリ再起動 | ON が復元される(保存済み値が優先)。**NOT RUN**: 既定値の定数変更のみで保存・復元ロジック自体は無変更のため、`flutter test`(ケース6)で代替。実機確認は今回スコープ外 |

## 境界

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 3 | 両陣営とも未観測(null)スコア | `flutter test test/battle_filter_store_test.dart` | `isSmallBattle` が `false` を返す(未観測を「小さい」と断定しない) |
| 4 | フィルタON時、しきい値未満の**進行中**バトル(`status == BattleStatus.live`) | `_BattleHistoryTabState.build` の一覧生成ロジックをコードレビューで確認(実機での進行中バトル再現は実配信が必要なためNOT RUN、詳細は変更履歴参照) | `b.status == BattleStatus.live` の場合、`isSmallBattle` の結果によらず一覧から除外されない |

## 異常

該当なし: 本修正はフィルタ条件のみで、異常系(API通信断・不正入力等)の挙動は変更していない

## 回帰

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 5 | `flutter analyze` | `flutter analyze lib/screens/tabs/battle_history_tab.dart lib/core/battle_filter_store.dart` | No issues found |

## UI

該当なし(NOT RUN): 進行中バトルの実データは実配信中のTikTok LIVEでしか生成できず、ローカル環境でDBへ直接シードした行はエミュレータ/実機のUIには反映されない(サーバー側のREST APIが正データソースのため)。ロジック自体はWeb版(`live-sidestage-analytics`)と同一条件式であり、Web側でPlaywrightにより実データ確認済み(該当baseline参照)

## Out of Scope

- web側の同等フィルタ修正・スコア色変更は別baseline(`live-sidestage-analytics/docs/testing/battle-history-list/baseline.md`)で管理

## 変更履歴

### 2026-09-06 進行中バトルをコイン閾値フィルタから除外

- 変更: `_BattleHistoryTabState.build` のフィルタ条件に `b.status == BattleStatus.live ||` を追加し、進行中バトルを `isSmallBattle` 判定の対象外にした
- 追加: `isSmallBattle` の単体テスト(`test/battle_filter_store_test.dart`)を新規作成(既存テストが無かったため)
- レビュー: Qwen(risk=MEDIUM、web側と合わせて実施) — finding 3件、実コード照合の結果いずれもINVALIDまたはスコープ外(詳細はweb側baselineの変更履歴を参照。同一diffレビュー)
- テスト結果: PASS 4 / FAIL 0 / NOT RUN 1(UIケース、理由: 進行中バトルの実データは実配信でしか生成できないため。ロジックはWeb版と同一条件式でWeb側は実データ確認済み)

### 2026-09-10 既定トグルをOFFへ変更

- 変更: `BattleFilterStore._hideSmall` 初期値と `load()` の未保存時フォールバックを `true` → `false`。web側(`live-sidestage-analytics`)のDB既定値 `hideLowDiamondEnabled=false` と揃えた。ケース6/7を追加
