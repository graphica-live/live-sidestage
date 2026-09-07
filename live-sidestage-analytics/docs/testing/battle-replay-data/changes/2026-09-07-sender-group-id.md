# senderGroupId をスキーマへコピーした判断（コンボの束ね鍵）

- date: 2026-09-07
- feature: battle-replay（データ層 / P5）
- risk: HIGH（既存テーブルへの列追加 + 本番バックフィル）

## 変更概要

`battle_history_gift_events` へ `senderGroupId` と `multiplierValue` を追加し、確定処理
（`battle-history-finalize.ts`）が `Gift.groupId` / `Gift.multiplierValue` をコピーする。
既存行は `backfillSenderGroupIds()`（`scripts/attach-replay-data.ts --sender-group-only`）が埋める。

## なぜこの形か

再生UIはコンボ（同一ギフトの連打）を1枚のカードへ束ねる。束ね鍵の候補は2つあった。

1. 再生ペイロード構築時に `Gift` を join して `groupId` を引く
2. 確定時に `groupId` を `battle_history_gift_events` へコピーする（採用）

`Gift` は受信から90日で削除される（`gift-retention.ts`）。1を採ると、90日を超えたバトルの再生から
コンボの束ねだけが静かに消え、同じバトルが時期によって別の見え方になる。バトル履歴自体は90日制限が
無いので、束ね鍵は確定時点でスナップショットするのが正しい。ユーザー判断も同じ結論。

## 実装上の制約

- バックフィルは `commitBattleSnapshot` の interactive transaction の**外**で行う。中に入れると
  P2022（列未到着）で tx 全体が abort し、確定そのものを巻き込む
- そのためバックフィル失敗は「コンボが束ねられない」degradation に留まり、再生可否には影響しない
- 元 `Gift` が既に削除された行は `senderGroupId` が null のまま残る（正常。埋められない）

## 影響する baseline ケース

- TC-BRD-027（確定時に `groupId` / `multiplierValue` をコピー）
- TC-BRD-028（バックフィルは null 行だけを埋め、元 `Gift` 削除済みの行は null のまま）
- TC-BRA-038 / TC-BRA-039（API の `k` / `m` の意味。`"0"` と null を潰さない）

## reviewer の重要指摘

- Fable F1「finalize が `senderGroupId` をコピーする挙動を integration テストが一切固定していない」
  → VALID（grep で該当0件を確認）。ベースラインへの注記でなく実テスト2件を追加して解消
- `multiplierType` の null と 0 を同一視しない規則（設計レビュー F5-1）はここでも維持。API は
  `2 / null / 0` を区別したまま返す

## 残リスク・未実施

- **本番の `scripts/attach-replay-data.ts --sender-group-only` は未実行。** ユーザーの明示指示があった
  ときだけ実行する。`Gift` の90日保持窓の内側で回さないと、古いバトルは永久に null で確定する
