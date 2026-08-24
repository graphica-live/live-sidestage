<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**重要: このプロジェクトにはナレッジグラフがある。コードベース探索時は Grep/Glob/Read より先に必ず code-review-graph MCPツールを使うこと。** グラフはより高速・低コスト（トークン節約）で、ファイルスキャンでは得られない構造的コンテキスト（呼び出し元・依存関係・テストカバレッジ）を提供する。

### グラフツールを優先すべき場面

- **コード探索**: Grep の代わりに `semantic_search_nodes` か `query_graph`
- **影響範囲把握**: importを手動で追う代わりに `get_impact_radius`
- **コードレビュー**: ファイル全読みの代わりに `detect_changes` + `get_review_context`
- **関係性調査**: `query_graph` に callers_of/callees_of/imports_of/tests_for を指定
- **アーキテクチャ把握**: `get_architecture_overview` + `list_communities`

グラフで対応できない場合のみ Grep/Glob/Read にフォールバックする。

### 主要ツール

| ツール | 使用場面 |
| ------ | ---------- |
| `detect_changes` | コード変更レビュー — リスクスコア付き分析 |
| `get_review_context` | レビュー用ソースの断片取得 — トークン効率が高い |
| `get_impact_radius` | 変更の影響範囲を把握 |
| `get_affected_flows` | 影響を受ける実行パスの特定 |
| `query_graph` | 呼び出し元・先・import・テスト・依存関係のトレース |
| `semantic_search_nodes` | 名前やキーワードで関数/クラスを検索 |
| `get_architecture_overview` | コードベースの高レベル構造把握 |
| `refactor_tool` | リネーム計画・デッドコード検出 |

### ワークフロー

1. グラフはファイル変更時に自動更新される（フック経由）。
2. コードレビューには `detect_changes` を使う。
3. 影響把握には `get_affected_flows` を使う。
4. カバレッジ確認には `query_graph` pattern="tests_for" を使う。

ルール: まずファイルを読む。完全な解を書く。テストは1回。過剰設計しない。

## Commit Rule

**MANDATORY**: 修正・機能追加・設定変更が完了するたびに即座に `git commit` すること。スキップ禁止。

- prefix: `fix:` / `feat:` / `chore:` / `refactor:`
- メッセージは変更内容を端的に記述
- 複数ファイルの変更でも、論理的に1単位なら1コミットでOK

## Build Rule

`npm run build:windows` 実行前に node/electron プロセスを全停止すること。

```powershell
Get-Process | Where-Object { $_.Name -match '^(electron|node)$' } | Stop-Process -Force
```

**Why:** `better_sqlite3.node` がロックされたままだと gyp clean で `EPERM: operation not permitted, unlink` が出てビルド失敗する。

## Widget Preview Background Rule

新規ウィジェットに iframe プレビューを追加するとき:

1. `html, body { background: transparent; }` はそのまま（overlay用）
2. preview/sample モード時にJS でbodyにdark gradient設定:
   ```js
   if (previewMode) {
       document.body.style.background = 'radial-gradient(circle at top, rgba(30, 41, 59, 0.88) 0%, rgba(15, 23, 42, 0.94) 100%)';
       document.body.style.minHeight = '100vh';
   }
   ```
3. 設定ページUI行要素（iframeではない）は `background: var(--panel)`
4. 参考実装: `top-gift.html` の `body.preview-card` CSS rule

## 並行作業ルール（複数タブ）

**コード変更を伴うタスクを開始する際は、ユーザーに確認せず自動的に `EnterWorktree` ツールを使って作業ブランチを分離すること。** 同一ディレクトリを複数タブで同時編集すると、Editツールの内容衝突や意図しない上書きが発生するため。

- `EnterWorktree` は `.claude/worktrees/` 配下に新規ブランチを作成しセッションの作業ディレクトリを切り替える。`node_modules` は設定済みのsymlinkDirectoriesにより自動共有される
- 単純な確認・調査のみのタスク（コード変更なし）では不要
- ユーザーからの明示的な指示がなくても、このCLAUDE.mdの指示によりworktree使用がトリガーされる（EnterWorktreeツールの仕様）

### 片付け（ExitWorktree）

`ExitWorktree` はツール仕様上「ユーザーが明示的に頼んだ時のみ呼ぶ」制約があり、CLAUDE.mdの指示だけでは自動発動しない（未コミット変更やブランチを誤って消さないための安全策）。そのためユーザーに確認なしで黙って削除することはしない。代わりに以下を徹底する：

- コミット完了・PR作成・マージ完了など「このworktreeでの作業が一区切りついた」タイミングを検知したら、ユーザーに聞かれる前にこちらから `keep`/`remove` をワンクリックで選べる形で確認を出す（ユーザーが「片付けて」と言うのを待たない）
- タブを閉じるだけの場合はセッション終了時にkeep/removeの確認が自動で出る仕様のため、追加対応は不要

**Why:** 複数タブが同じディレクトリを共有すると、ファイル競合や意図しない上書きが起きる。タスク開始時に自動でworktree分離すれば、ユーザーが毎回コマンドを打つ必要がなく、他タブの完了を待たずに真の並行作業ができる。

### worktree作成に失敗した場合

`EnterWorktree`が失敗した場合（すでにworktreeセッション内にいる／新規ブランチ名が既存ブランチと衝突している／対象worktreeが`locked`状態、など）、**黙ってmainを直接編集しない**。

- 失敗を検知したら `AskUserQuestion` でユーザーに状況（失敗理由・衝突したブランチ名やlocked中のworktreeパスなど）を伝え、対応方針を確認する。選択肢の例:
  - 別名で `EnterWorktree` を再試行する
  - 関連する既存worktreeに `path` 指定で切り替えて作業する
  - 今回に限り明示的な許可を得た上でmainを直接編集する
- ユーザーの回答を待たずにmain編集へフォールバックしてはならない。

### マージキュー方式

worktreeでのタスクが完了（コミット済み）しても、mainへは**即マージしない**。代わりに「マージキュー」に積んでおき、ユーザーからのマージ指示があった時点でキューをまとめて消化する。

- キューは常に1つ。実体は **mainチェックアウト直下**の `.claude/merge-queue.md`(絶対パス、例: `C:\dev\LiveAnalytics\.claude\merge-queue.md`)のみで、**gitでは追跡しない**(`.gitignore`に登録済み)。worktreeブランチにこのファイルをコミットしてはならない — worktree隔離セッションはmainへgit操作できず、ブランチにコミットするとmainへマージされるまで他セッションから見えず「キューが存在しない」状態になるため。
- ファイルへの追記・削除はgit操作を介さず、mainチェックアウト直下のパスへの**直接のファイル書き込み**(Write/Editツールやリダイレクトなど、`cd`によるgitコマンドではない手段)で行う。worktree隔離セッションからでもこの方式なら書き込める。
- 1行1エントリで `- <branch> — <タスク概要> (<完了日時>)` の形式。
- worktreeタスクのコミットが完了したら、mainのcheckoutでマージする代わりに、上記の方法でこのキューファイルにエントリを追加する。
- ユーザーが「マージして」「キュー消化して」「たまってるやつマージして」等の指示を出したら、キューにあるブランチを上から順に main の checkout から `git merge --no-ff <branch> -m "..."` でマージし、成功したエントリをキューファイルから削除する。
- 各マージ成功後、worktreeのkeep/remove確認をAskUserQuestionで出す（[片付け（ExitWorktree）](#片付けexitworktree)のルールに従う）。
- コンフリクトなど消化中に問題が起きたら、そのエントリはキューに残したまま処理を止めてユーザーに報告する。
- ユーザーが特定タスクで「今回はすぐマージして」等、明示的に即時マージを指示した場合はキューを経由せずその場でマージしてよい（例外）。

**Why:** 複数タブで並行してworktreeタスクを進めていると、都度mainへ自動マージするとタイミングによってはユーザーが把握していないマージが積み重なる。マージ作業をユーザーの明示的な指示に紐づけることで、いつ・何がmainに入るかをユーザー側でコントロールできるようにする。キューファイルをgit追跡・ブランチコミットにすると「常に1つの共有状態」という前提が壊れ、worktree隔離セッションからは書けず他セッションからも見えないという矛盾が生じるため、mainチェックアウト直下の非追跡ファイル1つに一本化する。

## フロントエンドの完了条件

- package.jsonに定義済みのlint、test、buildを実行する
- 存在しないコマンドを捏造しない
- 開発サーバーを起動し、実際のブラウザで確認する
- コンソールエラー、画像404、ネットワークエラーを確認する
- 画像のアスペクト比を維持し、意図しない引き伸ばしをしない
- PC表示とスマートフォン表示を確認する
- 動作確認していない状態で「完了」と報告しない

## コマンド

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

**typecheck → docker DB 起動 → db:push:local → npm test** はコミット前に強制される（モノレポルートの `.githooks/pre-commit`、`git config core.hooksPath .githooks` の有効化が前提）。Docker Desktop が動いていないとコミットできない。

**ビルドの検証に `npm run build` を使わない。** build は `prisma db push --accept-data-loss` を含むので、実行した時点で `DATABASE_URL` の指す DB を書き換える。型とルーティングだけ確かめたいときは `npx next build` を使う。

**`prisma/schema.prisma` は `public` と `event` の両スキーマを1ファイルで管理している**（`schemas = ["public", "event"]`）。モデルを消したり `@@schema` を外したりすると `db push --accept-data-loss` の削除差分になる。イベント機能を触るときは [src/event/CLAUDE.md](src/event/CLAUDE.md) を必ず読むこと。

## アーキテクチャの要点

### Web/Worker 2ロール構成

- [server.js](server.js) が Next.js と socket.io を**同一プロセス**で起動し、`global.__io` に Server を格納する。`src/lib/overlay.ts` はこのグローバル経由で emit する。server.js が `src/lib/prisma.ts` のシングルトンではなく独自の `PrismaClient` を作っているのは JS↔TS 境界の都合
- [worker.ts](worker.ts) は Next を持たず、担当 shard の TikTok Webcast 接続だけを維持する軽量プロセス。`hash(streamerId) % WORKER_COUNT` で配信者を分散し、`WORKER_INDEX` が自分の担当番号。`GET /healthz` は初回 `resumeAllListeners()` 完了まで 503 を返し、Railway のゼロダウンタイム切替に使う
- Worker が接続を維持する部屋の条件は `watchedRoomFilter()`（[src/lib/tiktok-listener.ts](src/lib/tiktok-listener.ts)）の1箇所に集約されていて、`getMyRooms()` はこれを使う。**「`Streamer` が1人以上いる」「`AgencyWatch`（事務所の監視対象）が1件以上ある」「`TiktokRoom.monitorUntil` が未来」のいずれか**で、3つ目はイベント機能が期限付きで監視を要求している状態。どれも満たさなくなった部屋は60秒ごとの reconcile が切断する（ギフトデータは残る）
- Worker → Web は `POST /api/internal/gift-event`（`INTERNAL_API_SECRET` で保護）。`WEB_INTERNAL_URL` 未設定なら Web/Worker 同居とみなして in-process 直呼びにフォールバックする
- Worker 数を変えたら全プロセスの `WORKER_COUNT` を揃えてから `npm run rebalance-workers -- --apply`
- **データモデルの肝**: 同一 `tiktokId` は `TiktokRoom` 1行 = TikTok 接続1本を複数の `Streamer`（登録ユーザー）で共有する。ギフト元データ `Gift` は不変で、手動編集・非表示は `GiftEdit(giftId, streamerId)` として別レコードに持ち、表示時に上書きする。したがって編集は編集者本人のビューにしか影響しない
- 認証は段階的。BIO 認証（bio に認証コードを貼ってサーバーがスクレイピング確認）前でもオーバーレイは動き、コイン数・履歴だけが `VerifyGate` でぼかされる
- **モバイル認証は NextAuth を通らない別系統**（`src/app/api/mobile/auth/{google,apple}`）。レスポンスの形は [src/lib/mobile-oauth.ts](src/lib/mobile-oauth.ts) の `mobileAuthResponseBody()` に一本化してある（端末の `AuthSession.fromJson` は1つしかないので、片方だけ形を変えると壊れる）。Apple は **id_token を受け取らず authorizationCode を Apple と交換する**（Android は web フローで、端末の受け口 Activity が exported なため id_token 単体では他人の応答を差し込める）。Apple のアカウント紐付けは [src/lib/apple-account.ts](src/lib/apple-account.ts) に隔離してあり、**メール一致でリンクしてよいのは `Account(provider:"google")` を持つ User だけ** — `/api/auth/register` がメール未確認で User を作れるので、単なる `User.email` 一致で繋ぐと先取り登録による乗っ取りが成立する。リンクを断った相手が同じメールを持っている場合は `User.email` を `null` にして作る（unique 衝突で 500 にすると、メールを先に取るだけで Apple ログインを永久に妨害できる）
- TikTok 接続は公式 API ではなく匿名 WebSocket。プロキシは `TIKTOK_PROXY_POOL` から sticky 割当されるため、**プールへの追加は必ず配列末尾に**（途中挿入・削除は既存割当をずらす）
- `linkMicBattle` / `linkMicArmies` を購読して `tiktok_battles` に残す（`src/lib/tiktok-battle.ts` がパーサ、`tiktok-listener.ts` の `persistBattle` が保存）。読むのはイベント機能の対戦自動検知だけ。**実 payload は実配信のバトルでしか得られない**ため、`raw` を必ず保存し `GET /api/debug/battle-payloads?token=<GIFT_LOG_TOKEN>` で取り出せるようにしてある
- **ギフトの一致キーは `giftId` ではなく名前**（trim + 小文字化）。`chat:gift` はその形で配信し、モバイルの効果音設定はそれと文字列比較する。全ギフトカタログ `tiktok_gift_catalog`（[src/lib/tiktok-gift-catalog.ts](src/lib/tiktok-gift-catalog.ts) が `gift/list/` から取得、Worker の60秒 reconcile が24時間TTLで叩く）も **giftId 主キーで持つが消費側は名前で畳む**。実測で **670件中29の名前が複数 giftId を持ち、giftId 自体もレスポンス内で重複する**ので、giftId 照合にすると同名の別IDを取りこぼす。カタログ名は英語で、`app_language: "ja"` を渡しても日本語にならない（実イベント側も英語なので照合は成立する）
- カタログ取得で `enableExtendedGiftInfo: true` を**使わない**。あれを立てると `connect()` の内部で `fetchAvailableGifts()` が呼ばれ、失敗時に `InvalidResponseError` で**ライブ接続そのものが落ちる**。未接続の使い捨て接続から明示的に呼び、失敗はログのみに留める

### イベント機能（LIVE Sidestage Event）— 同じコードベース、別プロセス

もとは `live-sidestage-event/` という別プロジェクトだったが、analytics へ統合した。同じ Postgres・同じ `public."User"`・同じ Google OAuth を共有していて分離の実体がなく、「`public` を Prisma の管理下に置けない」制約が恒久的な事故要因として残り続けていたため。**プロセス分離（TikTok 接続を巻き込まない）は Railway のサービス分割で達成している。**

- コードは `src/event/`（ロジック）/ `src/app/(event)/events/`（管理画面）/ `src/app/(public)/e/`（公開ページ）/ `src/app/api/events/` と `api/public/`（API）/ `event-worker.ts`（集計）
- **UI は analytics と表向き分離してある。** 管理画面は `(dashboard)` ではなく専用の `(event)` route group に置き、`src/app/(event)/EventHeader.tsx`（ブランドのみ）と専用 metadata を持つ。**`(event)` 配下に analytics の機能・ブランド・導線を持ち込まないこと**（リスナー接続ステータス、貢献リストオーバーレイ設定、`/setup`、`/admin` など）。逆に analytics 側の `DashboardHeader.tsx` からも `/events` への導線は外してある。内部のデータ結合（`src/event/analytics-db.ts`）は分離対象ではないのでそのまま
- **`prisma/schema.prisma` が `public` と `event` の両方を管理する**（`schemas = ["public", "event"]`、`previewFeatures = ["multiSchema"]`）。モデルを消したり `@@schema` を外したりすると `db push --accept-data-loss` の削除差分になる
- `public` のテーブルを読むのは [src/event/analytics-db.ts](src/event/analytics-db.ts) だけ。raw SQL は multiSchema でも自動修飾されないので `public."TiktokRoom"` のように完全修飾する。**列は必ず明示する**（`SELECT *` は `Streamer.apiKey` や `User.password` まで持ってくる）
- `TiktokRoom.monitorUntil` の書き込みは [src/lib/tiktok-room.ts](src/lib/tiktok-room.ts) の `ensureRoomForEvent()` / `releaseRoomMonitor()` を通す。**主催者入力がそのまま届く経路なので、tiktokId の形式検証・120日の期限上限・監視中 room 500件の上限を外さないこと**
- 認証は analytics の NextAuth をそのまま使う（セッション Cookie も共有）。保護範囲は `src/middleware.ts` の除外リストで決まり、**各エントリには境界 `(?:/|$)` が要る**（境界なしの `e` は `/events` まで公開してしまう）。[src/middleware.test.ts](src/middleware.test.ts) が固定している。未ログイン時の**飛び先**は [src/lib/login-path.ts](src/lib/login-path.ts) の `loginPathFor()` が決め、イベント側は analytics の `/login` ではなく `/event/login` へ送る。飛び先を変えても保護範囲は動かない
- 日時は必ず `src/event/datetime.ts` の `parseJstLocal()` を通す。`new Date("2026-09-01T20:00")` はサーバーのタイムゾーン依存で、Railway（UTC）では9時間ずれる
- **集計は web でも `worker.ts` でもなく [event-worker.ts](event-worker.ts) が10秒間隔で回す**。増分ではなく毎回イベント期間の全ギフトを再計算し、結果を `EventContribution` / `EventStanding` にスナップショットとして置き換える（バトル区間が後から確定するため増分では修正できない）。排他は `pg_try_advisory_xact_lock` を interactive transaction 内で取る（セッション単位のロックは Prisma のプールで取得と解放が別接続になりうるので使わない）
- 集計の打ち切りに `status` を使わない。締切（`endAt` + 1時間）後の集計が成功したら `Event.finalizedAt` を立てて以後スキップする。`endAt` を延ばしたら `finalizedAt` を `null` に戻すこと
- 仕様の全体像は [docs/EVENT.md](docs/EVENT.md)、実装時の制約は [src/event/CLAUDE.md](src/event/CLAUDE.md)

### Railway デプロイ

Root Directory を `live-sidestage-analytics` にする。[railway.toml](railway.toml) と [Dockerfile](Dockerfile) はそのディレクトリ基準。**同じイメージを3サービスで使い、start command と環境変数だけを変える** — 未指定（web。Dockerfile の CMD）/ `npm run worker`（TikTok 接続、`WORKER_INDEX` が要る）/ `npm run event-worker`（イベント集計）。**スキーマ反映は build ではなく web の起動時**（CMD が `prisma db push --accept-data-loss` を実行する）。start command を上書きする worker と event-worker は CMD を通らないので push しない。本番構成の詳細は auto-memory の `railway-analytics-production-services` を参照。
