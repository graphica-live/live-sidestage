# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## このリポジトリの位置づけ

`c:\dev\live-sidestage` は **5プロジェクトを束ねたモノレポ**（`graphica-live/live-sidestage`）。いずれも以前それぞれ独立リポジトリで、各リポジトリの全履歴をサブディレクトリのパスへ書き換えたうえで統合した。

一時期6プロジェクトあり、6番目の `live-sidestage-event`（TikTok Live のイベント運営サービス）だけはモノレポ内で新規に作ったものだったが、**analytics へ統合して `live-sidestage-analytics/src/event/` に移した**（後述の「イベント機能」参照）。

- git 操作はリポジトリルートで行う。サブディレクトリに `.git` はもう存在しない
- npm / flutter / wrangler などの**ビルド系コマンドは必ず各プロジェクトディレクトリ内で実行する**。ルートに統合 `package.json` はなく、npm workspaces も使っていない（Electron の native module が hoisting で壊れるため意図的に分離している）
- 各プロジェクトに個別の `CLAUDE.md` / `PRODUCT.md` / `DESIGN.md` がある。プロジェクト固有の指示はそちらが優先
- ディレクトリ名・npm パッケージ名・統合前の GitHub リポジトリ名が三者三様なので混同しないこと

| ディレクトリ | 製品名 | パッケージ名 | 統合前リポジトリ | 統合前の既定ブランチ |
| --- | --- | --- | --- | --- |
| `live-sidestage-analytics` | LIVE Sidestage Analytics（イベント運営機能を含む） | `live-analytics` | `graphica-live/LiveAnalytics` | `master` |
| `live-sidestage-desktop` | TikEffect | `tikeffect` | `graphica-live/TikEffect` | `main` |
| `live-sidestage-mobile` | Live Sidestage (Android) | `live_sidestage_mobile` | remote なし | `master` |
| `TikCaption` | TikCaption | `tikcaption` | `graphica-live/TikCaption` | `master` |
| `TikRIng` | TikRing | `profileimagefitservice` | `graphica-live/frame` | `main` |

統合前の履歴もサブディレクトリのパスに書き換えて取り込んであるので、`git log -- live-sidestage-analytics/` のようにパス指定で従来どおり追える。モノレポの既定ブランチは `main`。

## 5プロジェクトの関係

TikRIng を除く4つは TikTok Live 配信者向けで、`tiktok-live-connector` によるギフト/コメント受信を共通の土台にしている。

- **live-sidestage-analytics** — Next.js 14 + Prisma/PostgreSQL + socket.io。Railway ホスティングの Web サービス本体。ギフト集計・ランキング・OBS 用貢献者オーバーレイを提供し、モバイルとデスクトップ両方のバックエンドを兼ねる。**イベント（大会）運営機能もここに入っている**（`src/event/` ほか）
- **live-sidestage-desktop** — Electron + Express + better-sqlite3。**ローカル完結**の OBS ウィジェット（演出オーバーレイ）アプリ。analytics とは API キー経由の一方向連携のみ
- **live-sidestage-mobile** — Flutter (Android)。analytics のクライアント。受信コメントをオンデバイス VOICEVOX で読み上げる
- **TikCaption** — Electron + Python ASR。マイク音声を文字起こしして字幕オーバーレイを出す独立プロダクト（analytics とは繋がっていない）
- **TikRIng** — Cloudflare Pages + Functions。透過フレームをアップロードしてリスナー向けの着せ替え URL を発行する Web サービス。他3つとはコード上の連携がない独立プロダクト

コード上で確認できる実際の連携ポイント:

- **desktop → analytics**: `GET /api/analytics/monthly-contributors?month=YYYY-MM`（[backend/lib/monthly-mvp-client.js](live-sidestage-desktop/backend/lib/monthly-mvp-client.js)）。baseUrl と apiKey は称号ウィジェット設定として SQLite に保存され、先月の MVP/TOP5 を取り込む
- **mobile → analytics**: `POST /api/mobile/auth/google` → JWT → `GET /api/mobile/streamer` で apiKey 取得 → socket.io に `?apiKey=` で接続し `chat:{streamerId}` ルームの `chat:comment` を受信
- **OBS ブラウザソース → analytics**: `/overlay/contribution?token=<overlayToken>` → socket.io `?token=` で `overlay:{streamerId}` ルーム。socket 認証は [server.js](live-sidestage-analytics/server.js) の `io.use()` にトークン/APIキーの2系統がまとまっている

## 共通資産 `shared/`

プロジェクトをまたいで同じデータを使う場合だけ、ルート直下の `shared/` に正本を置く。コードは共有しない（言語もランタイムも揃っていないため）。

- **`shared/gift-names/`** — TikTok ギフト名（英語）→日本語表示名の辞書。もとは TikEffect の `backend/lib/gift-name-ja.js` にインラインで埋め込まれていたものを切り出した。現在は TikEffect と mobile（ギフト選択画面・登録済み一覧）が参照する
  - 正本は `shared/gift-names/gift-names-ja.json` と `gift-names-ja-reference.json` **だけ**
  - 各プロジェクトのビルドはリポジトリルートを参照できない（electron-builder の `files` はアプリディレクトリ配下のみ、Flutter の asset も package 外を辿れない）ので、`node shared/gift-names/sync.mjs` が配布コピーを生成する。**コピーは生成物。直接編集しない**
    - `live-sidestage-desktop/backend/lib/gift-names/`
    - `live-sidestage-mobile/assets/gift_names/`
  - `node shared/gift-names/sync.mjs --check` が正本の整形・キーの正規化・重複・配布コピーの更新漏れを検証する。ルートの [.githooks/pre-commit](.githooks/pre-commit) と [.github/workflows/shared-gift-names.yml](.github/workflows/shared-gift-names.yml) の両方から走る
  - 辞書を引くキーの正規化（アポストロフィ統一・空白畳み込み・小文字化）は **JS / Dart で別々に実装されている**（`sync.mjs` / `backend/lib/gift-name-ja.js` / `lib/core/gift_name_ja.dart` の3箇所）。片方だけ直すと同じギフトの表示が端末とデスクトップで食い違うので、入出力の組を `shared/gift-names/normalize-cases.json` に置き、JS と Dart 双方のテストがそれを読んでいる
  - **表示専用**。ギフトの一致判定（効果音のトリガ、集計キー）は TikTok が送ってくる英語名のまま行う。辞書のキーは正規化済みだが照合側は `trim` + `toLowerCase` しかしないため、日本語→英語の逆引きをして保存すると鳴らなくなる（意図的に逆引き API を持たせていない）
  - 追加ルール・配布先一覧は [shared/gift-names/README.md](shared/gift-names/README.md)

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
npm run worker              # TikTok接続Worker (worker.ts)
npm run event-worker        # イベント集計ワーカー (event-worker.ts)
npm run seed:event:local    # イベント機能のシード
npm run bench:aggregate:local  # イベント集計の性能を実測する（ローカルDB専用）
```

単体テストを1つだけ流す: `npx vitest run src/lib/overlay.test.ts -t "テスト名"`
（integration は DB 接続が要るので `npx dotenv -e .env.local.test -- vitest run src/lib/overlay.integration.test.ts`）

**typecheck → docker DB 起動 → db:push:local → npm test** はコミット前に強制される。ただしモノレポ化で hook の置き場所が変わった（後述の「コミット前フック」参照）。Docker Desktop が動いていないとコミットできない点は同じ。

**ビルドの検証に `npm run build` を使わない。** analytics の build は `prisma db push --accept-data-loss` を含むので、実行した時点で `DATABASE_URL` の指す DB を書き換える。型とルーティングだけ確かめたいときは `npx next build` を使う。

**`prisma/schema.prisma` は `public` と `event` の両スキーマを1ファイルで管理している**（`schemas = ["public", "event"]`）。モデルを消したり `@@schema` を外したりすると `db push --accept-data-loss` の削除差分になる。イベント機能を触るときは [live-sidestage-analytics/src/event/CLAUDE.md](live-sidestage-analytics/src/event/CLAUDE.md) を必ず読むこと。

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
- Worker が接続を維持する部屋の条件は `watchedRoomFilter()`（[tiktok-listener.ts](live-sidestage-analytics/src/lib/tiktok-listener.ts)）の1箇所に集約されていて、`getMyRooms()` はこれを使う。**「`Streamer` が1人以上いる」「`AgencyWatch`（事務所の監視対象）が1件以上ある」「`TiktokRoom.monitorUntil` が未来」のいずれか**で、3つ目はイベント機能が期限付きで監視を要求している状態。どれも満たさなくなった部屋は60秒ごとの reconcile が切断する（ギフトデータは残る）
- Worker → Web は `POST /api/internal/gift-event`（`INTERNAL_API_SECRET` で保護）。`WEB_INTERNAL_URL` 未設定なら Web/Worker 同居とみなして in-process 直呼びにフォールバックする
- Worker 数を変えたら全プロセスの `WORKER_COUNT` を揃えてから `npm run rebalance-workers -- --apply`
- **データモデルの肝**: 同一 `tiktokId` は `TiktokRoom` 1行 = TikTok 接続1本を複数の `Streamer`（登録ユーザー）で共有する。ギフト元データ `Gift` は不変で、手動編集・非表示は `GiftEdit(giftId, streamerId)` として別レコードに持ち、表示時に上書きする。したがって編集は編集者本人のビューにしか影響しない
- 認証は段階的。BIO 認証（bio に認証コードを貼ってサーバーがスクレイピング確認）前でもオーバーレイは動き、コイン数・履歴だけが `VerifyGate` でぼかされる
- TikTok 接続は公式 API ではなく匿名 WebSocket。プロキシは `TIKTOK_PROXY_POOL` から sticky 割当されるため、**プールへの追加は必ず配列末尾に**（途中挿入・削除は既存割当をずらす）
- `linkMicBattle` / `linkMicArmies` を購読して `tiktok_battles` に残す（`src/lib/tiktok-battle.ts` がパーサ、`tiktok-listener.ts` の `persistBattle` が保存）。読むのはイベント機能の対戦自動検知だけ。**実 payload は実配信のバトルでしか得られない**ため、`raw` を必ず保存し `GET /api/debug/battle-payloads?token=<GIFT_LOG_TOKEN>` で取り出せるようにしてある
- **ギフトの一致キーは `giftId` ではなく名前**（trim + 小文字化）。`chat:gift` はその形で配信し、モバイルの効果音設定はそれと文字列比較する。全ギフトカタログ `tiktok_gift_catalog`（[src/lib/tiktok-gift-catalog.ts](live-sidestage-analytics/src/lib/tiktok-gift-catalog.ts) が `gift/list/` から取得、Worker の60秒 reconcile が24時間TTLで叩く）も **giftId 主キーで持つが消費側は名前で畳む**。実測で **670件中29の名前が複数 giftId を持ち、giftId 自体もレスポンス内で重複する**ので、giftId 照合にすると同名の別IDを取りこぼす。カタログ名は英語で、`app_language: "ja"` を渡しても日本語にならない（実イベント側も英語なので照合は成立する）
- カタログ取得で `enableExtendedGiftInfo: true` を**使わない**。あれを立てると `connect()` の内部で `fetchAvailableGifts()` が呼ばれ、失敗時に `InvalidResponseError` で**ライブ接続そのものが落ちる**。未接続の使い捨て接続から明示的に呼び、失敗はログのみに留める

### イベント機能（LIVE Sidestage Event）— 同じコードベース、別プロセス

もとは `live-sidestage-event/` という別プロジェクトだったが、analytics へ統合した。同じ Postgres・同じ `public."User"`・同じ Google OAuth を共有していて分離の実体がなく、「`public` を Prisma の管理下に置けない」制約が恒久的な事故要因として残り続けていたため。**プロセス分離（TikTok 接続を巻き込まない）は Railway のサービス分割で達成している。**

- コードは `src/event/`（ロジック）/ `src/app/(dashboard)/events/`（管理画面）/ `src/app/(public)/e/`（公開ページ）/ `src/app/api/events/` と `api/public/`（API）/ `event-worker.ts`（集計）
- **`prisma/schema.prisma` が `public` と `event` の両方を管理する**（`schemas = ["public", "event"]`、`previewFeatures = ["multiSchema"]`）。モデルを消したり `@@schema` を外したりすると `db push --accept-data-loss` の削除差分になる
- `public` のテーブルを読むのは [src/event/analytics-db.ts](live-sidestage-analytics/src/event/analytics-db.ts) だけ。raw SQL は multiSchema でも自動修飾されないので `public."TiktokRoom"` のように完全修飾する。**列は必ず明示する**（`SELECT *` は `Streamer.apiKey` や `User.password` まで持ってくる）
- `TiktokRoom.monitorUntil` の書き込みは [src/lib/tiktok-room.ts](live-sidestage-analytics/src/lib/tiktok-room.ts) の `ensureRoomForEvent()` / `releaseRoomMonitor()` を通す。**主催者入力がそのまま届く経路なので、tiktokId の形式検証・120日の期限上限・監視中 room 500件の上限を外さないこと**
- 認証は analytics の NextAuth をそのまま使う。保護範囲は `src/middleware.ts` の除外リストで決まり、**各エントリには境界 `(?:/|$)` が要る**（境界なしの `e` は `/events` まで公開してしまう）。[src/middleware.test.ts](live-sidestage-analytics/src/middleware.test.ts) が固定している
- 日時は必ず `src/event/datetime.ts` の `parseJstLocal()` を通す。`new Date("2026-09-01T20:00")` はサーバーのタイムゾーン依存で、Railway（UTC）では9時間ずれる
- **集計は web でも `worker.ts` でもなく [event-worker.ts](live-sidestage-analytics/event-worker.ts) が10秒間隔で回す**。増分ではなく毎回イベント期間の全ギフトを再計算し、結果を `EventContribution` / `EventStanding` にスナップショットとして置き換える（バトル区間が後から確定するため増分では修正できない）。排他は `pg_try_advisory_xact_lock` を interactive transaction 内で取る（セッション単位のロックは Prisma のプールで取得と解放が別接続になりうるので使わない）
- 集計の打ち切りに `status` を使わない。締切（`endAt` + 1時間）後の集計が成功したら `Event.finalizedAt` を立てて以後スキップする。`endAt` を延ばしたら `finalizedAt` を `null` に戻すこと
- 仕様の全体像は [docs/EVENT.md](live-sidestage-analytics/docs/EVENT.md)、実装時の制約は [src/event/CLAUDE.md](live-sidestage-analytics/src/event/CLAUDE.md)

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
- `analytics-ci.yml` — `live-sidestage-analytics/**` の push / PR で発火。typecheck → ユニットテスト → `db push` → integration テスト（postgres:16 の service コンテナを使う）→ build。イベント機能もここで検証される

ワークフローを足すときは **必ず `paths:` フィルタで対象プロジェクトを絞る**。絞らないと無関係なプロジェクトの push でも発火する。プロジェクトのディレクトリで動くものは `defaults.run.working-directory` も指定する。

## コミット前フック

analytics の検証（typecheck → docker DB → db:push:local → npm test）はモノレポでも維持しているが、置き場所が `live-sidestage-analytics/.husky/` から**ルートの [.githooks/pre-commit](.githooks/pre-commit)** に移った。git の hooksPath はリポジトリに1つしか持てないためで、clone 直後に一度だけ有効化が要る。

```bash
git config core.hooksPath .githooks
```

`.githooks/pre-commit` はステージされたパスを見て、変更のあったプロジェクトの検証だけを走らせる。現在検証があるのは `live-sidestage-analytics/` だけで、typecheck + docker DB + テスト（イベント機能を含む）が走る。他プロジェクトだけの変更なら何も実行しない。`live-sidestage-analytics/.husky/pre-commit` は統合前の履歴として残してあるが、モノレポでは**呼ばれない**ので、検証内容を変えるときはルート側を編集する。

## デプロイ

モノレポ化でビルドコンテキストがリポジトリルートに変わったため、ホスティング側の設定でプロジェクトのサブディレクトリを指定する必要がある。

- **live-sidestage-analytics → Railway**: Root Directory を `live-sidestage-analytics` にする。[railway.toml](live-sidestage-analytics/railway.toml) と [Dockerfile](live-sidestage-analytics/Dockerfile) はそのディレクトリ基準なので、Root Directory さえ合っていれば中身の変更は不要。**同じイメージを3サービスで使い、start command と環境変数だけを変える** — 未指定（web。Dockerfile の CMD）/ `npm run worker`（TikTok 接続、`WORKER_INDEX` が要る）/ `npm run event-worker`（イベント集計）。**スキーマ反映は build ではなく web の起動時**（CMD が `prisma db push --accept-data-loss` を実行する）。start command を上書きする worker と event-worker は CMD を通らないので push しない
- **TikRIng → Cloudflare Pages**: Root directory を `TikRIng`、ビルドコマンドは `npm run build`、出力は `dist`
- **live-sidestage-desktop / TikCaption**: electron-builder によるローカルビルドなので、モノレポ化の影響は受けない
- **live-sidestage-mobile**: `flutter build apk` をディレクトリ内で実行するだけなので影響なし

## 既知の落とし穴

- **旧パス参照が残っている**: 5プロジェクトは以前 `C:\dev\tiktok-app` / `C:\dev\LiveAnalytics` にあり、現在の場所へ移動・改名された。`live-sidestage-desktop/.mcp.json` の `cwd` と `.claude/settings.json` の hooks が `C:\dev\tiktok-app` を、`live-sidestage-analytics/.claude/merge-queue.md` が `C:/dev/LiveAnalytics` を指したままで、**どちらも実在しない**。code-review-graph MCP / hook はこの状態では動かないので、各 CLAUDE.md 冒頭の「まずグラフツールを使え」という指示は現状あてにできない
- `live-sidestage-desktop` の `.cursorrules` / `AGENTS.md` / `GEMINI.md` / `QODER.md` は CLAUDE.md 冒頭と同じ code-review-graph ボイラープレートで、固有の指示は入っていない
- **統合前の既定ブランチがバラバラだった**（desktop と TikRIng が `main`、他3つが `master`）。モノレポの既定ブランチは `main` に統一した。各プロジェクトの CLAUDE.md やスクリプトに `master` 前提の記述が残っていないか、触るときに確認する
- **統合前の旧リポジトリ（LiveAnalytics / TikEffect / TikCaption / frame）は GitHub 上に残してある**。どちらへコミットしているのか取り違えないこと。今後の変更はモノレポ側に入れる
- `live-sidestage-mobile` は統合前 git remote を持たないローカル専用リポジトリだった。モノレポが唯一のリモートバックアップになる
