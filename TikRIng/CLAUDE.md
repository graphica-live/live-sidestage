# CLAUDE.md — TikRIng

`c:\dev\live-sidestage` モノレポ内のサブプロジェクト。全体構成はルートの [../CLAUDE.md](../CLAUDE.md) を参照。

TikRIng は透過フレームをアップロードしてリスナー向けの着せ替え URL を発行する Web サービス。他4プロジェクト（analytics/desktop/mobile/TikCaption）とはコード上の連携がない独立プロダクト。

## コマンド

```bash
npm run dev                 # build してから scripts/dev.mjs（vite + wrangler pages dev を束ねる）
npm run dev:ui               # vite のみ
npm run dev:api              # wrangler pages dev dist --port 8788
npm run build                 # tsc -b && vite build
npm run lint                  # eslint
npm run pages:dev             # build + wrangler pages dev dist
```

## アーキテクチャの要点 — Cloudflare Pages + Functions

- フロントは React 19 + Vite（`src/`）、API は Pages Functions（`functions/`）。`functions/[[path]].ts` が catch-all。`_auth.ts` / `_session.ts` / `_framePassword.ts` のようにアンダースコア始まりはルーティングされない共有モジュール
- ストレージは Cloudflare の3種を併用する。D1 `tikring-db`（binding `DB`、スキーマは `migrations/*.sql` の連番 SQL）／ R2 `profile-frames`（binding `FRAMES_BUCKET`、フレーム画像の本体）／ KV（binding `SESSIONS`）
- 認証は Google と LINE の OAuth（`functions/api/auth/`）、課金は Stripe（`functions/api/checkout/`、`webhook.ts` 込み）
- binding と Stripe の price ID は [wrangler.toml](wrangler.toml) にある。secret（`RECAPTCHA_SECRET_KEY` など）は値を置かず `wrangler pages secret put` 側で設定する
- `pages_build_output_dir = "dist"`。ビルド成果物 `dist/` を Pages が配信する

## デプロイ

Cloudflare Pages。Root directory を `TikRIng`、ビルドコマンドは `npm run build`、出力は `dist`。

- `tikring-prod-verify.yml`（ルート `.github/workflows/`）— `TikRIng/**` の push で発火。Cloudflare Pages の本番デプロイ完了を待ち、`scripts/prod-smoke-test.mjs` でスモークテストする。失敗したら直前の成功デプロイへ自動ロールバックする
- `tikring-cleanup.yml` — 毎日 JST 12:00、期限切れフレームの cleanup API を叩く
