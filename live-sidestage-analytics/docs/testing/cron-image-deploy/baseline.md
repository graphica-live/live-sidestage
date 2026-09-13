---
project: live-sidestage-analytics
feature: cron イメージ配布ゲート
last_updated: 2026-09-14
last_risk: HIGH
last_reviewers: Gemini 3.7 Flash + Codex-terra
---

# テストベースライン: cron イメージ配布ゲート

cron エントリ4本を起点にした import graph と変更ファイルの交差で、GHCR イメージを Railway Cron へ `serviceConnect` するかを決める CLI
（`npm run check:cron-image-deploy` / `scripts/check-cron-image-deploy.ts`）。

交差なしでは cron を更新しない。git diff 失敗は fail-open せず exit 1。Railway API への書き込みはこの baseline の対象外（workflow の `deploy-railway`）。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CID-001 | cron 期待パスに worker.ts を入れない | `buildCronExpectedPatterns` | 負 | libFiles に gift-retention | `live-sidestage-analytics/worker.ts` は無い。4エントリと prisma/** はある | `npx vitest run scripts/worker-watch-patterns/cron-cli.test.ts` | PASS | COMMON_WATCH_PATTERNS は worker 用のまま |
| TC-CID-002 | エントリ変更は NEEDED | CLI | 正常 | `--changed-files` に gift-retention.ts | `CRON_IMAGE_DEPLOY_NEEDED`、exit 0 | 同上 | PASS |
| TC-CID-003 | web ページのみは NOT_NEEDED | CLI | 正常 | src/app/page.tsx のみ | `CRON_IMAGE_DEPLOY_NOT_NEEDED`、exit 0 | 同上 | PASS |
| TC-CID-004 | worker.ts のみは NOT_NEEDED | CLI | 正常 | worker.ts のみ | `CRON_IMAGE_DEPLOY_NOT_NEEDED`、exit 0 | 同上 | PASS |
| TC-CID-005 | prisma は NEEDED | CLI | 正常 | prisma/schema.prisma | `CRON_IMAGE_DEPLOY_NEEDED`、exit 0 | 同上 | PASS | スキーマは cron 実行時に効く |
| TC-CID-006 | git 失敗は exit 1 | CLI | 異常 | `--base` 不正 | exit 1、NOT_NEEDED を出さない | 同上 | PASS | 誤スキップ防止 |
| TC-CID-007 | 推移的 src/lib 依存でも NEEDED | CLI | 回帰 | gift-retention-window.ts | CRON_IMAGE_DEPLOY_NEEDED | 同上 | PASS | Codex finding |
| TC-CID-008 | GITHUB_OUTPUT を書く | CLI | 正常 | gift-retention.ts + GITHUB_OUTPUT | ファイルに cron_image_deploy=true | 同上 | PASS | Codex finding |
| TC-CID-009 | workflow 分岐文字列 | analytics-ci.yml | 契約 | ファイル内容 | cutover/skip/空ID/CRON_IMAGE_DEPLOY を含む | 同上 | PASS | curl モックはしない |


## Quality Gate

- `npm run typecheck`
- `npx vitest run scripts/worker-watch-patterns/cron-cli.test.ts`

## Out of Scope

- Railway 本番への GraphQL 書き込みの自動テスト
- GitHub Actions variable の実値
- TikTok worker の自動再起動