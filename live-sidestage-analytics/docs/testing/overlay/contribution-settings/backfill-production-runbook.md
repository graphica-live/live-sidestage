# 本番backfill実行手順(Batch 02: overlay_contribution_settings)

対象: `Streamer` の overlay 表示設定9列を `overlay_contribution_settings` へコピーする一回限りのbackfill。
スクリプト: [scripts/backfill-overlay-contribution-settings.ts](../../../scripts/backfill-overlay-contribution-settings.ts)

計画書: `.claude/plans/20260909-streamer-overlay-settings-extraction.md` Batch 02。

## 前提

- Batch 01-B が本番へマージ・デプロイ済みで、本番の `overlay_contribution_settings` テーブルが実在すること
- 本番webサービスの起動が完了していること(`db push --accept-data-loss` によるテーブル作成が済んでいること)
- **このBatchはアプリケーションコードのcutover(Batch03)より前に実行する**（cutoverはbackfill完了が前提）

## 実行者

このスクリプトはBatch02の「本番DBへの書き込みを伴う実データ操作」に該当するため、**ユーザーの明示的な指示・確認を経てから実行すること**（worker-expertが自律実行しない）。実行者はRailway本番DBへの書き込み権限を持つ運用担当者（メインエージェント、ユーザー確認後）。

## 事前確認クエリ(読み取り専用)

本番DBへ読み取り専用で接続し、対象件数を確認する。

```bash
railway link -p 9a106d3f-8852-434b-9b3d-ee604ea19160 -e production
DATABASE_URL=$(railway variables -s Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)
```

```sql
SELECT count(*) FROM "Streamer";
SELECT count(*) FROM overlay_contribution_settings;
-- 未backfill件数(実行後にこれが0になっているはず)
SELECT count(*) FROM "Streamer" s
WHERE NOT EXISTS (SELECT 1 FROM overlay_contribution_settings o WHERE o."streamerId" = s.id);
```

## 実行コマンド

1. dry-run(件数確認のみ。書き込みなし):
   ```bash
   DATABASE_URL="$DATABASE_URL" npx tsx scripts/backfill-overlay-contribution-settings.ts --dry-run
   ```
2. dry-runの出力(未backfill件数)がSQLでの事前確認と一致することを目視確認する
3. 実行:
   ```bash
   DATABASE_URL="$DATABASE_URL" npx tsx scripts/backfill-overlay-contribution-settings.ts
   ```
4. スクリプト自身が実行後に `"Streamer"` と `overlay_contribution_settings` の件数一致を確認し、
   不一致なら exit code 1 で異常終了する。**"完了。件数が一致しました。" のログを確認すること。**

## 事後確認クエリ(読み取り専用)

```sql
SELECT count(*) FROM "Streamer";
SELECT count(*) FROM overlay_contribution_settings;
-- 上記2つの件数が一致していること

-- カスタマイズ済みStreamerの値が正しくコピーされていることのサンプル確認(任意の既知配信者で)
SELECT s.id, s."overlayThreshold", s."overlayGoalCount", s."overlayAlign",
       o.threshold, o."goalCount", o.align
FROM "Streamer" s
JOIN overlay_contribution_settings o ON o."streamerId" = s.id
WHERE s."overlayThreshold" != 1000 OR s."overlayGoalCount" != 5 OR s."overlayAlign" != 'left'
LIMIT 20;
-- 左側(Streamer列)と右側(overlay_contribution_settings列)の値が一致していること
```

## 安全性・冪等性

- `ON CONFLICT ("streamerId") DO NOTHING` により、複数回実行しても既存行は上書きされない(冪等)
- 誤って複数回実行しても安全。ただし**取り消し操作**が必要な場合は `DELETE FROM overlay_contribution_settings;` で全消去し、Streamer側の9列は無変更のまま残っているため再実行可能(Batch04で列削除する前提)
- このスクリプトは `Streamer` の既存9列を一切変更しない(READ ONLYでコピー元として使うだけ)

## 完了後の次のステップ

Batch02完了後、Batch03（アプリケーションコードのcutover: `route.ts` / `contribution.server.ts` を新テーブル経由へ切り替え）は別セッションで着手する。
