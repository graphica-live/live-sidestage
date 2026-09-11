---
date: 2026-09-11
feature: db-check-constraints
change_summary: Wave1-B(CHECK制約5件)のcode-reviewでCodexが検出したmigration.sqlの安全性指摘を反映
risk: HIGH(Wave1全体としての最上位severity。db-check-constraints unit自体はMEDIUM)
reviewers: Codex-terra(HIGH/MODERATE) + DeepSeek(Code Mode、Wave1全体diff)
---

## 対象

Wave1全体(TikTok再紐付けatomic化・CHECK制約5件・hostDisplayIds除去・EventMatch scheduled列除去・
RoomMonitorLease削除)のcode-review。ここでは`db-check-constraints`機能に関わるfindingのみ記録する。
`tiktok-id-change-lock`機能側のfindingは無し(Codexのroute.ts finding参照。ALREADY_HANDLEDのためbaseline側に
新規ケース追加のみで、changes記録の対象外と判断)。

## Findings

1. **[HIGH → 採用不要、記載済みを再確認]** migration.sqlの5件CHECK制約は`prisma db push`経路では本番に
   一切反映されない。→ migration.sql冒頭コメントに元々明記済み(DEPLOY BLOCKED)。最終報告にも明示する方針は
   Wave1着手時から決定済みのため、ALREADY_HANDLED。
2. **[MEDIUM → VALID、採用]** `ADD CONSTRAINT ... CHECK`が既存行を即時検証する形式で、事前検査・NOT VALID
   段階導入が無い。適用時に既存データが1件でも違反すればDDL全体が失敗する。
   → migration.sqlを`NOT VALID`方式に書き換え。各`ALTER TABLE ... ADD CONSTRAINT`に`NOT VALID`を付与し、
   末尾に適用者向けの違反件数確認SQL・`VALIDATE CONSTRAINT`文をコメントとして追記した。
3. **[MEDIUM → INVALID(誤り)]** DeepSeekの`resolveRoomForStreamerInTx`早期return分岐でのnull型絞り込み指摘
   (`tiktok-id-change-lock`関連)。実コード照合の結果、`streamer.roomId &&`によるtruthy narrowingで正しく
   型絞り込みされており、typecheckも実際に通過している。誤検出と判断。

## Verification

- `db-check-constraints/baseline.md`のTC-CHK-001〜005・101を再実行し5/5(修正後101含め6/6)PASSを確認
- migration.sqlの`NOT VALID`化は新規INSERT/UPDATEへの即時強制を変えないため、既存integrationテストの
  期待結果(制約違反を拒否する)に変更なし

## Remaining risks

- 本番DBへの実際の適用(`VALIDATE CONSTRAINT`含む)は未実施。`prisma migrate deploy`運用への移行、または
  手動psql適用が別途必要(DEPLOY BLOCKED、Wave1の範囲外)
