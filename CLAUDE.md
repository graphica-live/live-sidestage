# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリの位置づけ

`c:\dev\live-sidestage` は **5プロジェクトを束ねたモノレポ**（`graphica-live/live-sidestage`）。以前は5つの独立リポジトリで、各リポジトリの全履歴をサブディレクトリのパスへ書き換えたうえで統合した。

- git 操作はリポジトリルートで行う。サブディレクトリに `.git` はもう存在しない
- npm / flutter / wrangler などの**ビルド系コマンドは必ず各プロジェクトディレクトリ内で実行する**。ルートに統合 `package.json` はなく、npm workspaces も使っていない（Electron の native module が hoisting で壊れるため意図的に分離している）
- 各プロジェクトに個別の `CLAUDE.md` / `PRODUCT.md` / `DESIGN.md` がある。プロジェクト固有の指示はそちらが優先
- ディレクトリ名・npm パッケージ名・統合前の GitHub リポジトリ名が三者三様なので混同しないこと

| ディレクトリ | 製品名 | パッケージ名 | 統合前リポジトリ | 統合前の既定ブランチ |
| --- | --- | --- | --- | --- |
| `live-sidestage-analytics` | LIVE Sidestage Analytics | `live-analytics` | `graphica-live/LiveAnalytics` | `master` |
| `live-sidestage-desktop` | TikEffect | `tikeffect` | `graphica-live/TikEffect` | `main` |
| `live-sidestage-mobile` | Live Sidestage (Android) | `live_sidestage_mobile` | remote なし | `master` |
| `TikCaption` | TikCaption | `tikcaption` | `graphica-live/TikCaption` | `master` |
| `TikRIng` | TikRing | `profileimagefitservice` | `graphica-live/frame` | `main` |

統合前の履歴もサブディレクトリのパスに書き換えて取り込んであるので、`git log -- live-sidestage-analytics/` のようにパス指定で従来どおり追える。モノレポの既定ブランチは `main`。

## 5プロジェクトの関係

TikRIng を除く4つは TikTok Live 配信者向けで、`tiktok-live-connector` によるギフト/コメント受信を共通の土台にしている。

- **live-sidestage-analytics** — Next.js 14 + Prisma/PostgreSQL + socket.io。Railway ホスティングの Web サービス本体。ギフト集計・ランキング・OBS 用貢献者オーバーレイを提供し、モバイルとデスクトップ両方のバックエンドを兼ねる
- **live-sidestage-desktop** — Electron + Express + better-sqlite3。**ローカル完結**の OBS ウィジェット（演出オーバーレイ）アプリ。analytics とは API キー経由の一方向連携のみ
- **live-sidestage-mobile** — Flutter (Android)。analytics のクライアント。受信コメントをオンデバイス VOICEVOX で読み上げる
- **TikCaption** — Electron + Python ASR。マイク音声を文字起こしして字幕オーバーレイを出す独立プロダクト（analytics とは繋がっていない）
- **TikRIng** — Cloudflare Pages + Functions。透過フレームをアップロードしてリスナー向けの着せ替え URL を発行する Web サービス。他4つとはコード上の連携がない独立プロダクト

コード上で確認できる実際の連携ポイント:

- **desktop → analytics**: `GET /api/analytics/monthly-contributors?month=YYYY-MM`（[backend/lib/monthly-mvp-client.js](live-sidestage-desktop/backend/lib/monthly-mvp-client.js)）。baseUrl と apiKey は称号ウィジェット設定として SQLite に保存され、先月の MVP/TOP5 を取り込む
- **mobile → analytics**: `POST /api/mobile/auth/google` → JWT → `GET /api/mobile/streamer` で apiKey 取得 → socket.io に `?apiKey=` で接続し `chat:{streamerId}` ルームの `chat:comment` を受信
- **OBS ブラウザソース → analytics**: `/overlay/contribution?token=<overlayToken>` → socket.io `?token=` で `overlay:{streamerId}` ルーム。socket 認証は [server.js](live-sidestage-analytics/server.js) の `io.use()` にトークン/APIキーの2系統がまとまっている

## コマンド

いずれも**各プロジェクトディレクトリに `cd` してから**実行する。

### live-sidestage-analytics

```bash
npm run dev                 # server.js (Next + socket.io) を .env.local で起動
npm run dev:local           # ローカルPostgres(.env.local.test)向けに起動。dev用の簡易ログイン有効
docker compose up -d db     # ローカルテストDB (postgres:16, localhost:5433)
npm run db:push:local       # ローカルDBへスキーマ反映
npm run seed:local
npm run typecheck           # tsc --noEmit
npm run test:unit           # vitest（*.integration.test.ts を除外）
npm run test:integration    # ローカルDB必須
npm test                    # unit + integration
npm run worker              # Worker単体プロセス (worker.ts)
```

単体テストを1つだけ流す: `npx vitest run src/lib/overlay.test.ts -t "テスト名"`
（integration は DB 接続が要るので `npx dotenv -e .env.local.test -- vitest run src/lib/overlay.integration.test.ts`）

**typecheck → docker DB 起動 → db:push:local → npm test** はコミット前に強制される。ただしモノレポ化で hook の置き場所が変わった（後述の「コミット前フック」参照）。Docker Desktop が動いていないとコミットできない点は同じ。

### live-sidestage-desktop

```powershell
npm run electron            # Electron起動（prepare-electron.ps1 が先に走る）
npm run electron:dev        # nodemon + electron
npm run run                 # loader-server(38099) + electron を並走
npm run backend:dev         # Expressバックエンドのみ (ブラウザで確認したいとき)
npm test                    # jest (tests/unit/**/*.test.js)
npm run test:visual         # playwright（mock-server.js を自動起動、日本語ロケール固定）
npm run test:visual:update  # スクリーンショット更新
npm run build:windows       # electron-builder（NSIS）
npm run build:publish       # ビルド + Cloudflare R2 へ publish
```

単体テスト1件: `npx jest tests/unit/store.test.js -t "テスト名"` / ビジュアル1件: `npx playwright test tests/visual/widgets.spec.js`

`build:windows` の前に **このプロジェクトのパスに紐づく** node/electron プロセスだけを停止する（`better_sqlite3.node` のロックで `EPERM ... unlink` になる）。停止コマンドはグローバル `~/.claude/rules/electron-desktop-widgets.md` の repo スコープ版を使い、全 node プロセスの一括 kill はしない。モノレポ化後はパス絞り込みが `live-sidestage-desktop` まで含む点に注意（ルートパスで絞ると他4プロジェクトのプロセスまで巻き込む）。

### live-sidestage-mobile

```bash
flutter pub get
flutter run                 # 実機/エミュレータ
flutter analyze             # analysis_options.yaml (flutter_lints)
flutter test                # test/widget_test.dart
flutter test test/widget_test.dart --plain-name "テスト名"
flutter build apk --release
```

### TikCaption

```powershell
npm start                   # electron .
npm test                    # jest --forceExit
npm run build:windows       # electron-builder (NSIS)
npm run deploy              # scripts/deploy.ps1
```

単体テスト1件: `npx jest tests/server.test.js -t "テスト名"`

### TikRIng

```bash
npm run dev                 # build してから scripts/dev.mjs（vite + wrangler pages dev を束ねる）
npm run dev:ui              # vite のみ
npm run dev:api             # wrangler pages dev dist --port 8788
npm run build               # tsc -b && vite build
npm run lint                # eslint
npm run pages:dev           # build + wrangler pages dev dist
```

## アーキテクチャの要点

### live-sidestage-analytics — Web/Worker 2ロール構成

- [server.js](live-sidestage-analytics/server.js) が Next.js と socket.io を**同一プロセス**で起動し、`global.__io` に Server を格納する。`src/lib/overlay.ts` はこのグローバル経由で emit する。server.js が `src/lib/prisma.ts` のシングルトンではなく独自の `PrismaClient` を作っているのは JS↔TS 境界の都合
- [worker.ts](live-sidestage-analytics/worker.ts) は Next を持たず、担当 shard の TikTok Webcast 接続だけを維持する軽量プロセス。`hash(streamerId) % WORKER_COUNT` で配信者を分散し、`WORKER_INDEX` が自分の担当番号。`GET /healthz` は初回 `resumeAllListeners()` 完了まで 503 を返し、Railway のゼロダウンタイム切替に使う
- Worker → Web は `POST /api/internal/gift-event`（`INTERNAL_API_SECRET` で保護）。`WEB_INTERNAL_URL` 未設定なら Web/Worker 同居とみなして in-process 直呼びにフォールバックする
- Worker 数を変えたら全プロセスの `WORKER_COUNT` を揃えてから `npm run rebalance-workers -- --apply`
- **データモデルの肝**: 同一 `tiktokId` は `TiktokRoom` 1行 = TikTok 接続1本を複数の `Streamer`（登録ユーザー）で共有する。ギフト元データ `Gift` は不変で、手動編集・非表示は `GiftEdit(giftId, streamerId)` として別レコードに持ち、表示時に上書きする。したがって編集は編集者本人のビューにしか影響しない
- 認証は段階的。BIO 認証（bio に認証コードを貼ってサーバーがスクレイピング確認）前でもオーバーレイは動き、コイン数・履歴だけが `VerifyGate` でぼかされる
- TikTok 接続は公式 API ではなく匿名 WebSocket。プロキシは `TIKTOK_PROXY_POOL` から sticky 割当されるため、**プールへの追加は必ず配列末尾に**（途中挿入・削除は既存割当をずらす）

### live-sidestage-desktop — 3レイヤーのローカル完結アプリ

- ルートの `index.js` は `backend/index.js` を再 export するだけ。実体は **[backend/index.js](live-sidestage-desktop/backend/index.js)（130KB超のモノリス）+ [backend/lib/](live-sidestage-desktop/backend/lib/) のウィジェット別 state モジュール群**（`*-state.js` / `*-runtime.js`）。ルートは `backend/lib/routes/`、SQLite アクセスは `backend/lib/db/store.js`
- レイヤー: `electron/main.js`（ウィンドウ・トレイ常駐・electron-updater） / `backend`（Express + socket.io + better-sqlite3） / `backend/public`（`db/` = 管理UI「Control」、`widgets/` = OBS に読ませる HTML）
- **ポートは 38100 固定**。競合しても自動フォールバックせず起動失敗する。`loader-server/index.js`（38099）はバックエンドの TCP 生存を見て起動を仲介するランチャー用サーバー
- 管理UIが「URLをコピー」で出す配布 URL は `127.0.0.1.sslip.io` ベース。TikTok Live Studio が bare `localhost` を無効扱いするための回避
- 実行データは `%LOCALAPPDATA%\TikEffect`（SQLite DB、`.auth.env`、`.env`）。TikTok 認証は Electron 版からのみ実行可能
- ウィジェットを1つ増やすと触るのは: `backend/public/widgets/<name>.html` + `backend/lib/<name>-state.js` + 管理UI側 `backend/public/db/widgets.html` / `widgets.js`（295KB）への登録。iframe プレビュー背景の扱いはグローバルルールの Widget Preview Background Rule に従う
- Windows ランチャー(.vbs/.cmd)は `scripts/windows-launchers.config.json` に1エントリ追加して `npm run generate:windows-launchers` で再生成する。詳細は [WINDOWS-PACKAGING.md](live-sidestage-desktop/WINDOWS-PACKAGING.md)

### live-sidestage-mobile — Flutter + オンデバイス VOICEVOX

- `lib/core/` が中核: `SessionController`（認証・セッション、ChangeNotifier）/ `CommentFeed`（socket.io 受信）/ `SpeechQueue` + `TtsEngine` + `VoicePool`（VOICEVOX 合成）/ `background_task_handler.dart`（`flutter_foreground_task` で画面オフ中も読み上げ継続）
- 本番バックエンド URL は `lib/core/api_client.dart` にハードコード（`https://liveanalytics-production.up.railway.app`）
- Google サインインは **パッケージ名 + 署名 SHA-1 の組**を Google Cloud Console に Android OAuth クライアントとして登録しないと必ず `DEVELOPER_ERROR`(code 10) になる。`applicationId` を変えたら再登録が必要。手順は [README.md](live-sidestage-mobile/README.md)
- VOICEVOX モデルと OpenJTalk 辞書は `assets/` に同梱（サイズ大）

### TikCaption — Electron + Python ASR

- `main.js` が Python を探し、無ければ `winget` で導入 → `pip install -r requirements.txt` → `caption_server.py` を spawn する自動セットアップを持つ。ASR は NeMo Parakeet + silero-VAD、パッケージ時は `extraResources` として同梱される
- Python → Node は `POST /api/caption/asr-text`、Node → 表示は socket.io で `public/overlay.html`（字幕）と `public/tts-overlay.html` へ配信。制御は `/api/caption/*` と `/api/tts/*`
- TTS 側は `main.js` が `WebcastPushConnection` で TikTok Live に接続しコメントを読み上げる
- 設定は `%USERPROFILE%\.tikcaption-settings.json`（`TIKCAPTION_SETTINGS_PATH` で変更可）

### TikRIng — Cloudflare Pages + Functions

- フロントは React 19 + Vite（`src/`）、API は Pages Functions（`functions/`）。`functions/[[path]].ts` が catch-all。`_auth.ts` / `_session.ts` / `_framePassword.ts` のようにアンダースコア始まりはルーティングされない共有モジュール
- ストレージは Cloudflare の3種を併用する。D1 `tikring-db`（binding `DB`、スキーマは `migrations/*.sql` の連番 SQL）／ R2 `profile-frames`（binding `FRAMES_BUCKET`、フレーム画像の本体）／ KV（binding `SESSIONS`）
- 認証は Google と LINE の OAuth（`functions/api/auth/`）、課金は Stripe（`functions/api/checkout/`、`webhook.ts` 込み）
- binding と Stripe の price ID は [wrangler.toml](TikRIng/wrangler.toml) にある。secret（`RECAPTCHA_SECRET_KEY` など）は値を置かず `wrangler pages secret put` 側で設定する
- `pages_build_output_dir = "dist"`。ビルド成果物 `dist/` を Pages が配信する

## CI (GitHub Actions)

ワークフローはルートの `.github/workflows/` にのみ置く。モノレポでは**サブディレクトリ配下のワークフローは GitHub に認識されない**。

- `tikring-prod-verify.yml` — `TikRIng/**` の push で発火。Cloudflare Pages の本番デプロイ完了を待ち、`TikRIng/scripts/prod-smoke-test.mjs` でスモークテストする。失敗したら直前の成功デプロイへ自動ロールバックする
- `tikring-cleanup.yml` — 毎日 JST 12:00、期限切れフレームの cleanup API を叩く

ワークフローを足すときは **必ず `paths:` フィルタで対象プロジェクトを絞る**。絞らないと無関係なプロジェクトの push でも発火する。プロジェクトのディレクトリで動くものは `defaults.run.working-directory` も指定する。

## コミット前フック

analytics の検証（typecheck → docker DB → db:push:local → npm test）はモノレポでも維持しているが、置き場所が `live-sidestage-analytics/.husky/` から**ルートの [.githooks/pre-commit](.githooks/pre-commit)** に移った。git の hooksPath はリポジトリに1つしか持てないためで、clone 直後に一度だけ有効化が要る。

```bash
git config core.hooksPath .githooks
```

`.githooks/pre-commit` はステージされたパスを見て、`live-sidestage-analytics/` に変更があるときだけ analytics の検証を走らせる。他プロジェクトだけの変更なら何も実行しない。`live-sidestage-analytics/.husky/pre-commit` は統合前の履歴として残してあるが、モノレポでは**呼ばれない**ので、検証内容を変えるときはルート側を編集する。

## デプロイ

モノレポ化でビルドコンテキストがリポジトリルートに変わったため、ホスティング側の設定でプロジェクトのサブディレクトリを指定する必要がある。

- **live-sidestage-analytics → Railway**: Root Directory を `live-sidestage-analytics` にする。[railway.toml](live-sidestage-analytics/railway.toml) と [Dockerfile](live-sidestage-analytics/Dockerfile) はそのディレクトリ基準なので、Root Directory さえ合っていれば中身の変更は不要
- **TikRIng → Cloudflare Pages**: Root directory を `TikRIng`、ビルドコマンドは `npm run build`、出力は `dist`
- **live-sidestage-desktop / TikCaption**: electron-builder によるローカルビルドなので、モノレポ化の影響は受けない
- **live-sidestage-mobile**: `flutter build apk` をディレクトリ内で実行するだけなので影響なし

## 既知の落とし穴

- **旧パス参照が残っている**: 5プロジェクトは以前 `C:\dev\tiktok-app` / `C:\dev\LiveAnalytics` にあり、現在の場所へ移動・改名された。`live-sidestage-desktop/.mcp.json` の `cwd` と `.claude/settings.json` の hooks が `C:\dev\tiktok-app` を、`live-sidestage-analytics/.claude/merge-queue.md` が `C:/dev/LiveAnalytics` を指したままで、**どちらも実在しない**。code-review-graph MCP / hook はこの状態では動かないので、各 CLAUDE.md 冒頭の「まずグラフツールを使え」という指示は現状あてにできない
- `live-sidestage-desktop` の `.cursorrules` / `AGENTS.md` / `GEMINI.md` / `QODER.md` は CLAUDE.md 冒頭と同じ code-review-graph ボイラープレートで、固有の指示は入っていない
- **統合前の既定ブランチがバラバラだった**（desktop と TikRIng が `main`、他3つが `master`）。モノレポの既定ブランチは `main` に統一した。各プロジェクトの CLAUDE.md やスクリプトに `master` 前提の記述が残っていないか、触るときに確認する
- **統合前の旧リポジトリ（LiveAnalytics / TikEffect / TikCaption / frame）は GitHub 上に残してある**。どちらへコミットしているのか取り違えないこと。今後の変更はモノレポ側に入れる
- `live-sidestage-mobile` は統合前 git remote を持たないローカル専用リポジトリだった。モノレポが唯一のリモートバックアップになる
