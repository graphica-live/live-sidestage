# live-sidestage

TikTok Live 配信者向けプロダクト群のモノレポ。統合前は5つの独立リポジトリだったものを、全履歴を保持したまま1つにまとめている。

| ディレクトリ | 製品 | スタック | デプロイ先 |
| --- | --- | --- | --- |
| [live-sidestage-analytics](live-sidestage-analytics/) | LiveAnalytics | Next.js 14 + Prisma/PostgreSQL + socket.io | Railway |
| [live-sidestage-desktop](live-sidestage-desktop/) | TikEffect | Electron + Express + better-sqlite3 | ローカル（NSIS インストーラ） |
| [live-sidestage-mobile](live-sidestage-mobile/) | Live Sidestage (Android) | Flutter | APK |
| [TikCaption](TikCaption/) | TikCaption | Electron + Python ASR | ローカル（NSIS インストーラ） |
| [TikRIng](TikRIng/) | TikRing | React 19 + Vite + Cloudflare Pages Functions | Cloudflare Pages |

## セットアップ

依存はプロジェクトごとに独立している。ルートに統合 `package.json` はなく、npm workspaces も使っていない（Electron の native module が hoisting で壊れるため意図的に分離している）。使うプロジェクトのディレクトリで個別にインストールする。

```bash
cd live-sidestage-analytics && npm ci
cd live-sidestage-desktop   && npm ci
cd TikCaption               && npm ci
cd TikRIng                  && npm ci
cd live-sidestage-mobile    && flutter pub get
```

コミット前フックは clone 直後に一度だけ有効化する。

```bash
git config core.hooksPath .githooks
```

`live-sidestage-analytics/` に変更があるコミットでのみ、typecheck とテスト（ローカル PostgreSQL が必要）が走る。

## 各プロジェクトのコマンド・アーキテクチャ

[CLAUDE.md](CLAUDE.md) にまとまっている。プロジェクト固有の詳細は各ディレクトリの `CLAUDE.md` / `PRODUCT.md` / `DESIGN.md` を参照。

## 履歴

統合前の履歴はサブディレクトリのパスへ書き換えたうえで取り込んである。パス指定でそのまま追える。

```bash
git log -- live-sidestage-analytics/
git log --follow -- TikRIng/functions/api/upload.ts
```

統合前の旧リポジトリ（`LiveAnalytics` / `TikEffect` / `TikCaption` / `frame`）は GitHub 上に残っているが、今後の変更はこのモノレポに入れる。
