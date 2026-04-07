# TikRing

透過フレームをアップロードして、リスナー向けの着せ替え URL を発行するサービスです。

## Stripe 設定

サブスクリプションに加えて、単発寄付ボタンを使う場合は以下も設定してください。

- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- STRIPE_MONTHLY_PRICE_ID
- STRIPE_YEARLY_PRICE_ID

寄付ボタンは Stripe Checkout の one-time payment を使います。金額は画面から自由入力し、サーバー側で検証した上で Checkout Session を動的生成します。

現在の制約は以下です。

- 100円以上
- 100000円以下
- 100円単位

Cloudflare Pages では secrets / vars を使って設定できます。

## 開発コマンド

```bash
npm install
npm run dev
npm run build
npm run lint
```

## 本番デプロイ後の自動検証とロールバック

main へ push した後、GitHub Actions で Cloudflare Pages の production deployment 完了を待ち、本番 URL に対して検証を実行します。検証が失敗した場合は、直前の successful production deployment に自動で rollback します。

必要な GitHub Secrets は以下です。

- CLOUDFLARE_ACCOUNT_ID
- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_PAGES_PROJECT_NAME
- SITE_URL
- PROD_TEST_SESSION_COOKIE
- PROD_TEST_FRAME_ID

補足:

- CLOUDFLARE_API_TOKEN には Pages Write 権限が必要です。
- SITE_URL は production の公開 URL を指定します。
- PROD_TEST_SESSION_COOKIE には Pro テストアカウントの session cookie をそのまま入れます。例: session=xxxxx
- PROD_TEST_FRAME_ID は、その Pro テストアカウントで所有しているフレーム ID を 1 つ指定します。
- 本番検証では /api/health、トップページ応答、/api/auth/me、/api/frames を確認し、Pro アカウントで viewCount と wearCount が数値で返ることを検証します。

`npm run dev` は以下をまとめて起動します。

- Vite フロントエンド: http://localhost:5174
- Cloudflare Pages Functions API: http://127.0.0.1:8788

個別に起動したい場合は以下を使います。

```bash
npm run dev:ui
npm run dev:api
```
