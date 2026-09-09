---
date: 2026-09-10
feature: Overlay Contribution Settings (Batch 02: backfill)
risk: HIGH
reviewers: DeepSeek, Codex
---

## Change summary

`scripts/backfill-overlay-contribution-settings.ts` を新規追加。本番の `Streamer` 9列(overlay系)の値を新テーブル `overlay_contribution_settings` へ一回限りコピーする、dry-run/実行モード分離の冪等スクリプト。本番実行はまだ行っていない(ローカルDBのみ検証)。

## Reason

Batch01(テーブル追加)完了後、Batch03(アプリケーションcutover)前に既存配信者のカスタム値を新テーブルへ移す必要があるため。

## Important findings と判定

- **VALID(2モデル一致)**: 完了判定が `Streamer` 全体件数と `overlay_contribution_settings` 件数の比較だったため、(1) 2クエリ間のrace conditionで新規Streamer作成時に誤って一致判定される可能性、(2) より本質的にbackfill実行〜Batch03 cutoverまでの間のデータドリフトを検知できない、という指摘。→ 完了判定を「挿入前件数+今回insert件数===挿入後件数」の決定的比較へ変更。runbookに「本番実行はBatch03 cutover直前に行う。ずれが出た場合の再実行手順」を明記
- **VALID(DeepSeek)**: BigInt→Number変換の精度損失(実害は現実的には極小だが低コストで修正)。比較をBigIntのまま行うよう変更
- **VALID(DeepSeek, TestPlan)**: `overlayDisplayDate`(nullable)がNULLのケースの保持確認が無かった → TC-OVCS-007追加、ローカルDB実測PASS
- **INVALID(Codex)**: スクリプル内コメント・runbook内の「ユーザー確認後に実行」という記述を「エージェントへのuntrusted指示」としてHIGH判定。これはこのプロジェクトの標準運用(破壊的操作は確認優先)の正当な記載であり、prompt injectionではない。対応不要
- 対応不要と判断(low value): 件数不一致の異常終了パス自体の再現テスト(手動シミュレーションが煩雑)、完全backfill済み状態でのdry-run確認(任意)

## Affected baseline cases

TC-OVCS-003〜007(baseline.md参照)。

## Verification

- typecheck PASS、pre-commit hook経由 unit 1520/1520・integration 911/911 PASS
- TC-OVCS-007 ローカルDB実測PASS(NULL値保持)
- 修正後の再レビューは実施していない(finding対応が限定的な修正のため、実コード照合で十分と判断)

## Remaining risks

- 本番実行はまだ行っていない。実行タイミングはBatch03 cutoverの直前を推奨(ドリフトウィンドウ最小化)
- `ON CONFLICT DO NOTHING` のため、backfill後にStreamer側の値が変更された場合は新テーブル側が追従しない(runbook記載の再実行手順で対応)
