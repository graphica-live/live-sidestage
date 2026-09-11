# Prisma Migration Runbook

`prisma migrate deploy` 運用への移行に伴う、スキーマ変更・本番デプロイ・トラブルシューティングの正本ドキュメント。

## 正規フロー（開発者向け）

### 1. ローカルでスキーマを変更する

```bash
cd live-sidestage-analytics
# .env.local.test を使った開発DB接続
npx prisma migrate dev --name "describe_your_change"
```

`prisma migrate dev` は以下を自動実行します:
- `schema.prisma` の差分をスキャン
- 差分に対応する migration.sql を生成
- ローカルDBへ本番同様に適用（タイムスタンプ付きmigration.sqlをファイルとして保存）
- TypeScript型定義の更新（`prisma generate`）

出力される migration ファイルはコード上のドキュメントとして機能します。

### 2. Migration を確認・レビュー

生成されたmigration.sqlの内容を必ず目視確認してください（`prisma/migrations/<timestamp>-<name>/migration.sql`）。

破壊的DDL（DROP TABLE / DROP COLUMN / ALTER COLUMN TYPE / SET NOT NULL 等）を含む場合は、レビュー時に特に注意が必要です。

### 3. コミットしてmainへマージ

```bash
git add prisma/migrations/
git commit -m "feat: <description>"
git push
# -> PR -> レビュー → mainへマージ
```

**重要**: Migration ファイルを削除・編集してはいけません。本番に適用されたmigrationを遡行的に変更すると、DBと永遠に不一致になります。

### 4. 本番へのデプロイ（自動）

main へのマージ後、Railway の CI/CD が以下を自動実行します:

1. `npm run build`（`prisma generate && next build`）
2. Docker イメージのビルド・GHCR へのpush
3. `LiveAnalytics` サービスの Pre-Deploy Command 実行:
   ```
   npm run predeploy:web
   ```
   実行内容: `tsx scripts/migrate-match-session.ts && prisma migrate deploy && tsx scripts/migrate-match-battle-candidates.ts`

**スキーマ反映は本番の Pre-Deploy Command でのみ実行されます。** ビルド段階では DB に一切触りません。

## Expand / Contract パターン（列追加・テーブル追加に伴う他プロジェクト対応）

複数のバージョンが本番で共存する期間は、以下のパターンで段階的に進めてください。

### Phase 1: 新旧列共存

```sql
-- migration.sql
ALTER TABLE public."Streamer" ADD COLUMN "newColumn" TEXT;
```

- `schema.prisma` には新しい列を追加
- アプリケーション側は古い列を読み書きし続ける
- **新しい列には書き込まない**

### Phase 2: Backfill（既存行の埋め込み）

```bash
# scripts/backfill-<something>.ts のような一度きりのスクリプトを実行
# predeploy:web に追加するか、別 migration で実行
```

すべての既存行に新しい列の値を埋め込みます。

### Phase 3: アプリケーション全ロールアウト

新しいコード（新列読み込み対応）を全サービスへデプロイします。この時点で古い列に書き込むコードはすべて削除済みにしてください。

### Phase 4: Contraction（古い列削除）

```bash
npx prisma migrate dev --name "drop_old_column"
```

古い列を削除するmigrationを生成・デプロイします。

## Baseline Registration（初回本番セットアップ）

**前提条件**: Batch 01（33 migrations をアーカイブ、`prisma/migrations/` が `0_init` のみ）と Batch 02（Dockerfile/package.json の変更）がともにmainへマージ済みであること。

### リカバリ手順（baseline 登録誤り時）

baseline を誤った内容で登録してしまった場合、以下のステップで取り消せます:

1. 他に `_prisma_migrations` テーブルに行が無いことを確認する（手順2を参照）
2. 以下で登録を取り消す:
   ```sql
   DELETE FROM public._prisma_migrations WHERE migration_name = '0_init';
   ```
3. `migrate status` でpending が0件になったことを確認
4. 再度 `migrate resolve --applied 0_init` で登録

**必ず実行前に `_prisma_migrations` 全行を確認し、他の migration 行を巻き込まないこと。**

## Rollback ポリシー

### アプリケーションコード のロールバック

```bash
git revert <commit_hash>
```

通常の git revert で安全に戻せます。Migration は前進のみなので、新しいDB構造に対して古いアプリケーションコードが動く設計が前提です（expand/contract パターンを守っていることを想定）。

### **重要: Railway アプリデプロイイメージ の rollback floor**

**Batch 02 のマージコミット（Dockerfile CMD の `db push` 除去）より前のイメージへは絶対に戻さないこと。**

理由: Batch 02 より前のイメージの Dockerfile CMD には `prisma db push --accept-data-loss` が残っており、cutover 後に migration で追加された列・テーブルを持つ本番 DB に対して起動すると、旧 `schema.prisma` との差分をデータごと DROP します。

### Migration のロールバック

**過去 migration ファイルの削除・書き換えは行わない。** 前進のみの原則を守ってください。

戻す必要があれば新しい reverse migration を追加します:

```bash
npx prisma migrate dev --name "revert_something"
# 手動で migration.sql を書き、新しい状態へ導く
```

### Pre-Deploy Command 失敗時

Railway は新デプロイを「不健全」と判定し、Pre-Deploy Command の失敗を理由に新コンテナの起動を中止します。旧デプロイのコンテナは生き続ける（既存の `healthcheckTimeout=1800` と同じ仕組み）ため、ダウンタイムなしで対応できます:

1. Pre-Deploy Command のログを確認（migration 構文エラー・依存順序ミス等）
2. 原因を修正し commit
3. 再度デプロイ

## Pre-Deploy Command 設定

Railroad ダッシュボードで **`LiveAnalytics` サービスのみに設定** してください。他サービス（worker1/2/3、event-worker、worker-guardian 等）には一切設定しないこと。

設定値: `npm run predeploy:web`

### 設定方式のリスク

現在はダッシュボード限定設定で実装されています。ダッシュボード設定はサービス再作成等で痕跡なく消える可能性があります。

**代替案（将来の改善案）**: `railway.toml` に `preDeployCommand = "npm run predeploy"` を置き、`predeploy:web` script を `RUN_MIGRATIONS=1` 環境変数ガードにする（IaC化。実際にmigrateするのは同変数を持つ `LiveAnalytics` サービスのみ）。

今回はダッシュボード限定設定のまま実装されていますが、恒久化する場合はメインエージェント判断のもと IaC 化を検討してください。

## 禁止事項

### スクリプト型 DDL の追加

`scripts/migrate-match-session.ts` / `scripts/migrate-match-battle-candidates.ts` は既存の管理外 DDL を打つバックフィルスクリプトで、正当な理由がありそのまま使い続けます。

**ただし、cutover 後にこの方式で新規 DDL を追加してはいけません。** スキーマ変更は必ず `prisma migrate dev` で生成する通常の migration.sql として書いてください。

### Migration ファイルの削除・編集

適用済みの migration ファイルを削除・書き換えすると、本番 DB とのズレが永遠に解消されなくなります。

### 複数サービスへの Pre-Deploy Command 設定

Prisma の migration lock・race condition・同時実行競合を避けるため、必ず **`LiveAnalytics` サービスのみ** に設定してください。

## トラブルシューティング

### Q: Pre-Deploy Command 実行中に migration が失敗した

A: Railway ダッシュボードで Pre-Deploy Command のログを確認してください（デプロイ詳細パネル → ビルドログ）。

一般的な原因:
- SQL 構文エラー → migration.sql の内容を確認・修正
- 依存順序ミス（FK 制約などに関連） → migration 間の順序を確認
- 権限不足 → Postgres ロールの権限を確認

### Q: Schema ドリフト（DB と schema.prisma の不一致）が起きた

A: 以下で確認・修正できます:

```bash
# 差分を確認
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script --exit-code
```

- 出力が空 → ドリフトなし
- 出力あり → ドリフト検出。原因を確認し、新しい migration で正す

### Q: Baseline 登録後、pending migration が残っている

A: 誤った状態で登録した可能性があります。以下で確認：

```bash
DATABASE_URL=<本番URL> npx prisma migrate status
```

`0_init` 以外に pending が表示される場合、baseline 登録を取り消して再登録してください（リカバリ手順を参照）。

### Q: Schema.prisma から列を消したが、本番では削除されない

A: Migrate deploy 運用では、削除するときは明示的に migration ファイルを生成する必要があります:

```bash
npx prisma migrate dev --name "drop_something"
```

生成されたmigration.sqlで DROP 文を確認し、その migration をデプロイします。

## 参照

- [Prisma Migration 公式ドキュメント](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate)
- [Expand and Contract Pattern](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/welcome-to-prisma-migrate#expand-and-contract-pattern)
- analytics CLAUDE.md Railway デプロイ節
- docs/EVENT.md（イベント機能の初回デプロイ手順）
