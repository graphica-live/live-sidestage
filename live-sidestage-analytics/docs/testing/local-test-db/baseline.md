---
project: live-sidestage-analytics
feature: local-test-db-per-worktree
last_updated: 2026-09-14
last_risk: LOW
last_reviewers: skipped (local hooks / test DB helper)
---

# テストベースライン: local-test-db-per-worktree

ローカル Docker Postgres (`localhost:5433`) では git worktree ごとに別データベースを使う。CI (`localhost:5432`) は書き換えない。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-LTD-001 | 別 worktree パスは別 DB 名 | `databaseNameForWorktree` | 正常 | 2つの絶対パス | 名前が異なり、いずれも `liveanalytics_test_<slug>_<8hex>` | `npx vitest run scripts/with-local-test-db.test.ts` | PASS | |
| TC-LTD-002 | 同じパスは同じ名前 | 同上 | 回帰 | 同一パスを2回 | 文字列が一致する | 同上 | PASS | |
| TC-LTD-003 | 長いディレクトリでも 60 文字以内 | 同上 | 境界 | 80文字のディレクトリ名 | 名前長 ≤ 60、末尾は `_` + 8hex | 同上 | PASS | |
| TC-LTD-004 | 5433 だけ書き換え対象 | `isLocalDockerTestUrl` | negative | 5433 / 5432 / Railway URL | 5433 のみ true | 同上 | PASS | CI は 5432 |
| TC-LTD-005 | 手動 npm test も同じ helper | `package.json` test:integration / db:push:local | 正常 | スクリプト定義 | `with-local-test-db.mjs` 経由。`.env.local.test` は未変更 | ファイル確認 | PASS | |
| TC-LTD-006 | この worktree で専用DBが作られる | helper `--print-name` | 正常 | Docker Postgres 起動 | `liveanalytics_test_local_test_db_per_worktree_*` を表示し DB が存在する | `node scripts/with-local-test-db.mjs --print-name` | PASS | drop しない |
| TC-LTD-007 | analytics 配下から worktree root を特定 | `findGitRootFrom` | 正常 / 回帰 | `live-sidestage-analytics` を起点。pre-commit の `GIT_DIR=.git` でも可 | 末尾が `live-sidestage-analytics` でない git root。DB名に `_live_sidestage_analytics_` を含まない | `npx vitest run scripts/with-local-test-db.test.ts` と `GIT_DIR=.git` 付き `--print-name` | PASS | hook が subdirectory に cd するため |

## Quality Gate

- `npx vitest run scripts/with-local-test-db.test.ts`
- pre-commit の `npm test` は worktree 専用DBへ push してから走る

## Out of Scope

- 古い `liveanalytics_test_*` の自動削除
- Prisma connection pool / max_connections 変更
- GitHub Actions
