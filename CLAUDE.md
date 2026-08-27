# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリの位置づけ

`c:\dev\live-sidestage` は **5プロジェクトを束ねたモノレポ**（`graphica-live/live-sidestage`）。いずれも以前それぞれ独立リポジトリで、各リポジトリの全履歴をサブディレクトリのパスへ書き換えたうえで統合した。

一時期6プロジェクトあり、6番目の `live-sidestage-event`（TikTok Live のイベント運営サービス）だけはモノレポ内で新規に作ったものだったが、**analytics へ統合して `live-sidestage-analytics/src/event/` に移した**（詳細は [live-sidestage-analytics/CLAUDE.md](live-sidestage-analytics/CLAUDE.md)）。

- git 操作はリポジトリルートで行う。サブディレクトリに `.git` はもう存在しない
- npm / flutter / wrangler などの**ビルド系コマンドは必ず各プロジェクトディレクトリ内で実行する**。ルートに統合 `package.json` はなく、npm workspaces も使っていない（Electron の native module が hoisting で壊れるため意図的に分離している）
- **各プロジェクトのコマンド一覧・アーキテクチャの詳細はそのプロジェクトの CLAUDE.md にある。作業対象のプロジェクトへ入ったら必ずそちらも読むこと**（PRODUCT.md / DESIGN.md がある場合も同様）
- ディレクトリ名・npm パッケージ名・統合前の GitHub リポジトリ名が三者三様なので混同しないこと

| ディレクトリ | 製品名 | パッケージ名 | 統合前リポジトリ | 統合前の既定ブランチ |
| --- | --- | --- | --- | --- |
| [live-sidestage-analytics](live-sidestage-analytics/CLAUDE.md) | LIVE Sidestage Analytics（イベント運営機能を含む） | `live-analytics` | `graphica-live/LiveAnalytics` | `master` |
| [live-sidestage-desktop](live-sidestage-desktop/CLAUDE.md) | TikEffect | `tikeffect` | `graphica-live/TikEffect` | `main` |
| [live-sidestage-mobile](live-sidestage-mobile/CLAUDE.md) | LIVE Sidestage (Android) | `live_sidestage_mobile` | remote なし | `master` |
| [TikCaption](TikCaption/CLAUDE.md) | TikCaption | `tikcaption` | `graphica-live/TikCaption` | `master` |
| [TikRIng](TikRIng/CLAUDE.md) | TikRing | `profileimagefitservice` | `graphica-live/frame` | `main` |

統合前の履歴もサブディレクトリのパスに書き換えて取り込んであるので、`git log -- live-sidestage-analytics/` のようにパス指定で従来どおり追える。モノレポの既定ブランチは `main`。**統合前は desktop と TikRIng が `main`、他3つが `master` だった**ので、各プロジェクトのCLAUDE.mdやスクリプトに `master` 前提の記述が残っていないか、触るときに確認する。

## 5プロジェクトの関係

TikRIng を除く4つは TikTok Live 配信者向けで、`tiktok-live-connector` によるギフト/コメント受信を共通の土台にしている。

- **live-sidestage-analytics** — Next.js 14 + Prisma/PostgreSQL + socket.io。Railway ホスティングの Web サービス本体。ギフト集計・ランキング・OBS 用貢献者オーバーレイを提供し、モバイルとデスクトップ両方のバックエンドを兼ねる。**イベント（大会）運営機能もここに入っている**
- **live-sidestage-desktop** — Electron + Express + better-sqlite3。**ローカル完結**の OBS ウィジェット（演出オーバーレイ）アプリ。analytics とは API キー経由の一方向連携のみ
- **live-sidestage-mobile** — Flutter (Android)。analytics のクライアント。受信コメントをオンデバイス VOICEVOX で読み上げる
- **TikCaption** — Electron + Python ASR。マイク音声を文字起こしして字幕オーバーレイを出す独立プロダクト（analytics とは繋がっていない）
- **TikRIng** — Cloudflare Pages + Functions。透過フレームをアップロードしてリスナー向けの着せ替え URL を発行する Web サービス。他3つとはコード上の連携がない独立プロダクト

コード上で確認できる実際の連携ポイント（実装の詳細は各プロジェクトのCLAUDE.mdを参照）:

- **desktop → analytics**: `GET /api/analytics/monthly-contributors?month=YYYY-MM`。先月の MVP/TOP5 を取り込む
- **mobile → analytics**: Google認証 → JWT → apiKey 取得 → socket.io `chat:{streamerId}` ルームでコメント受信
- **OBS ブラウザソース → analytics**: `/overlay/contribution?token=<overlayToken>` → socket.io `overlay:{streamerId}` ルーム。socket 認証は [server.js](live-sidestage-analytics/server.js) の `io.use()` にトークン/APIキーの2系統がまとまっている

## 共通資産 `shared/`

プロジェクトをまたいで同じデータを使う場合だけ、ルート直下の `shared/` に正本を置く。コードは共有しない（言語もランタイムも揃っていないため）。

- **`shared/gift-name-normalization/`** — ギフト名キーの正規化（アポストロフィ統一→空白畳み込み→trim→小文字化）を JS と Dart で揃えるための共有テストベクタ。desktop の jest と mobile の flutter test が両方これを読む。仕様と経緯は [shared/gift-name-normalization/README.md](shared/gift-name-normalization/README.md)
- **ギフト名の日本語表示は TikTok 公式から取る。** 以前ここにあった手作業辞書 `shared/gift-names/`（553エントリ、`sync.mjs` が desktop と mobile へ配布）は 2026-08-27 に廃止した。`gift/list/` に **`webcast_language=ja-JP`**（`ja` では効かない）を渡すと公式の日本語名が返り、671 giftId 中 651 件をカバーする。desktop は `backend/lib/tiktok-gift-catalog.js` が英語版と日本語版を突き合わせて SQLite に貯め、mobile は analytics の `GET /api/mobile/gifts` が返す `labelJa` を端末に貯める
- **日本語は表示専用。** ギフトの一致判定（効果音のトリガ、集計キー）は TikTok が実際に送ってくる名前で行う。LIVE の gift イベントは英語で届くので、日本語を一致キーに保存すると**例外もログも出ないまま鳴らなくなる**。ただし配信者ごとのサブスクギフトは TikTok 自身が日本語名で送ってくる（例:「わやハグ」）ので、「一致キーは常に英語」ではない

## CI (GitHub Actions)

ワークフローはルートの `.github/workflows/` にのみ置く。モノレポでは**サブディレクトリ配下のワークフローは GitHub に認識されない**。ワークフローを足すときは**必ず `paths:` フィルタで対象プロジェクトを絞る**（絞らないと無関係なプロジェクトの push でも発火する）。プロジェクトのディレクトリで動くものは `defaults.run.working-directory` も指定する。

- `tikring-prod-verify.yml` / `tikring-cleanup.yml` — TikRIng用（詳細は [TikRIng/CLAUDE.md](TikRIng/CLAUDE.md)）
- `analytics-ci.yml` — `live-sidestage-analytics/**` の push / PR で発火。typecheck → ユニットテスト → `db push` → integration テスト（postgres:16 の service コンテナ）→ build。イベント機能もここで検証される

## コミット前フック

analytics の検証（typecheck → docker DB → db:push:local → npm test）はモノレポでも維持しているが、置き場所が `live-sidestage-analytics/.husky/` から**ルートの [.githooks/pre-commit](.githooks/pre-commit)** に移った。git の hooksPath はリポジトリに1つしか持てないためで、clone 直後に一度だけ有効化が要る。

```bash
git config core.hooksPath .githooks
```

`.githooks/pre-commit` はステージされたパスを見て、変更のあったプロジェクトの検証だけを走らせる。現在検証があるのは `live-sidestage-analytics/` だけで、他プロジェクトだけの変更なら何も実行しない。`live-sidestage-analytics/.husky/pre-commit` は統合前の履歴として残してあるが、モノレポでは**呼ばれない**ので、検証内容を変えるときはルート側を編集する。

## デプロイ

モノレポ化でビルドコンテキストがリポジトリルートに変わったため、ホスティング側の設定でプロジェクトのサブディレクトリを指定する必要がある。各プロジェクトの具体的なデプロイ設定はそのCLAUDE.mdを参照（[analytics](live-sidestage-analytics/CLAUDE.md) / [TikRIng](TikRIng/CLAUDE.md)）。desktop / TikCaption は electron-builder によるローカルビルド、mobile は `flutter build apk` をディレクトリ内で実行するだけなので、モノレポ化の影響は受けない。

## 既知の落とし穴

- **旧パス参照が残っている**: 5プロジェクトは以前 `C:\dev\tiktok-app` / `C:\dev\LiveAnalytics` にあり、現在の場所へ移動・改名された。`live-sidestage-desktop/.mcp.json` の `cwd` と `.claude/settings.json` の hooks が `C:\dev\tiktok-app` を、`live-sidestage-analytics/.claude/merge-queue.md` が `C:/dev/LiveAnalytics` を指したままで、**どちらも実在しない**。code-review-graph MCP / hook はこの状態では動かないので、各 CLAUDE.md 冒頭の「まずグラフツールを使え」という指示は現状あてにできない
- `live-sidestage-desktop` の `.cursorrules` / `AGENTS.md` / `GEMINI.md` / `QODER.md` は CLAUDE.md 冒頭と同じ code-review-graph ボイラープレートで、固有の指示は入っていない
- **統合前の旧リポジトリ（LiveAnalytics / TikEffect / TikCaption / frame）は GitHub 上に残してある**。どちらへコミットしているのか取り違えないこと。今後の変更はモノレポ側に入れる
- `live-sidestage-mobile` は統合前 git remote を持たないローカル専用リポジトリだった。モノレポが唯一のリモートバックアップになる
