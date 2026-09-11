# migrations-archive-2026-09

このディレクトリは、Prisma db push運用からmigrate deploy運用への移行時に、本番へ一度も適用されていなかった既存33件のmigrationを退避したアーカイブです。

## 重要な注意事項

- **これらのmigrationは本番の `_prisma_migrations` テーブルに一度も適用されていません**
- **baseline migration（`0_init`）がこれら33件の全ての変更を内包しており、以後Prismaのいかなるコマンドからも参照されることはありません**
- このディレクトリは履歴ドキュメント専用です
- migrate deployコマンドの対象パスから除外されています

## 背景

2026年9月、live-sidestage-analyticsの本番DB反映方式を以下のように切り替えました：

- **旧方式**: `prisma db push --accept-data-loss`（migrations フォルダを読まない）
- **新方式**: `prisma migrate deploy`（baseline→以降のmigrationを順序通り適用）

旧方式では `prisma/migrations/` フォルダは履歴ドキュメント以上の役割を持たず、本番適用には一切使用されていませんでした。新方式へ移行する際、baseline migration（`0_init`）を作成し、既存33件は `prisma/migrations/` から退避させました。

33件を本番の適用対象のままにすると、baseline後に誤った順序で重複適用される可能性があり、データ損失のリスクがあります。アーカイブにより、その危険を構造的に排除しています。

## ファイルリスト

33個のmigrationディレクトリ：
- 20260612000000_add_listener_status
- 20260813093744_add_overlay_align
- （以下32個省略）

各ディレクトリは元の場所と同じ名前・構成を保持しており、git履歴（blame）から追跡可能です。
