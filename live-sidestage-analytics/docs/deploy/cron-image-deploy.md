# Cron イメージ配布（パス交差ゲート）

web / TikTok worker など cron と無関係な変更では、Railway Cron をビルドも再デプロイもしない。

## 仕組み

1. `analytics-ci` の `build-and-push` が GHCR へイメージを1回 push する（既存）。
2. `verify` が `npm run check:cron-image-deploy` で、変更ファイルと cron import graph の交差を判定する。
3. `deploy-railway` は `vars.RAILWAY_ANALYTICS_CRON_SERVICE_IDS`（JSON 配列）へ `serviceConnect(image)` する。条件は次のいずれか。
   - 交差あり（`cron_image_deploy=true`）
   - まだ GitHub Source（`source.repo` が残っている）= cutover。以降 GitHub 由来のフルビルドは止まる

交差に使うパス: 4つの cron エントリ、その `src/lib` import graph、`prisma/**`、`package.json`、`package-lock.json`、`Dockerfile`、`tsconfig.json`。`worker.ts` と `src/app/**` は対象外。

## やってはいけないこと

- Cron の service id を `RAILWAY_ANALYTICS_MANAGED_SERVICE_IDS` に入れる（毎 main push で cron が動く）
- コードから Railway の `watchPatterns` / DeploymentTrigger を書く
- TikTok worker1/2/3 を MANAGED や CRON 配列に入れる

## 本番で人手でやること

コード完了だけでは GitHub Source の cron ビルドは止まらない。

1. 各 cron サービスの Railway service id を確認する（gift-retention / tiktok-cleanup / listener-comment-retention / ambassador-invite-retention）。
2. GitHub Actions variable `RAILWAY_ANALYTICS_CRON_SERVICE_IDS` を JSON 配列で設定する。例: `["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]`
3. 次の main の `deploy-railway` で GitHub Source なら cutover が走る（パス交差が無くても1回接続する）。
4. 以降は cron 関連ファイルの変更時だけイメージが更新される。

空 / `[]` なら cron 配布は skip（現状維持）。

## ローカル確認

```bash
cd live-sidestage-analytics
npm run check:cron-image-deploy -- --changed-files=paths.txt
npm run check:cron-image-deploy -- --base=origin/main --head=HEAD
```

## ロールバック

- workflow を revert するとゲートは消える。
- `RAILWAY_ANALYTICS_CRON_SERVICE_IDS` を空にすると cron への `serviceConnect` は止まる。既に Docker Image Source なら GitHub push だけでは cron は動かない。
## 途中失敗

`serviceConnect` は最大3回まで GraphQL を再試行する。それでも一部 cron だけ失敗した場合、同じ workflow の `deploy-railway` を Re-run する（その run の `cron_image_deploy=true` が残るので全 cron ID が再接続される）。web-only の次 push では失敗したサービスは自動では追いつかない。
