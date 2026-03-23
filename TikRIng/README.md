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

`npm run dev` は以下をまとめて起動します。

- Vite フロントエンド: http://localhost:5174
- Cloudflare Pages Functions API: http://127.0.0.1:8788

個別に起動したい場合は以下を使います。

```bash
npm run dev:ui
npm run dev:api
```
