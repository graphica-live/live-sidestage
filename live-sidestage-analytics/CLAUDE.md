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

単体テストを1つだけ流す: `npx vitest run src/lib/overlay/day-key.test.ts -t "テスト名"`
（integration は DB 接続が要るので `npx dotenv -e .env.local.test -- vitest run src/lib/overlay/contribution.server.integration.test.ts`）

**typecheck → docker DB 起動 → db:push:local → npm test** はコミット前に強制される（モノレポルートの `.githooks/pre-commit`、`git config core.hooksPath .githooks` の有効化が前提）。Docker Desktop が動いていないとコミットできない。

**ビルドの検証に `npm run build` を使わない。** build は `prisma db push --accept-data-loss` を含むので、実行した時点で `DATABASE_URL` の指す DB を書き換える。型とルーティングだけ確かめたいときは `npx next build` を使う。

**`prisma/schema.prisma` は `public` と `event` の両スキーマを1ファイルで管理している**（`schemas = ["public", "event"]`）。モデルを消したり `@@schema` を外したりすると `db push --accept-data-loss` の削除差分になる。イベント機能を触るときは [src/event/CLAUDE.md](src/event/CLAUDE.md) を必ず読むこと。

## アーキテクチャの要点

### Web/Worker 2ロール構成

- [server.js](server.js) が Next.js と socket.io を**同一プロセス**で起動し、`global.__io` に Server を格納する。`src/lib/overlay/emit.ts` はこのグローバル経由で emit する。server.js が `src/lib/prisma.ts` のシングルトンではなく独自の `PrismaClient` を作っているのは JS↔TS 境界の都合
- [worker.ts](worker.ts) は Next を持たず、担当 shard の TikTok Webcast 接続だけを維持する軽量プロセス。`hash(streamerId) % WORKER_COUNT` で配信者を分散し、`WORKER_INDEX` が自分の担当番号。`GET /healthz` は初回 `resumeAllListeners()` 完了まで 503 を返し、Railway のゼロダウンタイム切替に使う
- Worker が接続を維持する部屋の条件は `watchedRoomFilter()`（[src/lib/tiktok-listener.ts](src/lib/tiktok-listener.ts)）の1箇所に集約されていて、`getMyRooms()` はこれを使う。**「`Streamer` が1人以上いる」「`AgencyWatch`（事務所の監視対象）が1件以上ある」「`TiktokRoom.monitorUntil` が未来」のいずれか**で、3つ目はイベント機能が期限付きで監視を要求している状態。どれも満たさなくなった部屋は60秒ごとの reconcile が切断する（ギフトデータは残る）
- Worker → Web は `POST /api/internal/gift-event`（`INTERNAL_API_SECRET` で保護）。`WEB_INTERNAL_URL` 未設定なら Web/Worker 同居とみなして in-process 直呼びにフォールバックする
- Worker 数を変えたら全プロセスの `WORKER_COUNT` を揃えてから `npm run rebalance-workers -- --apply`
- **データモデルの肝**: 同一 `tiktokId` は `TiktokRoom` 1行 = TikTok 接続1本を複数の `Streamer`（登録ユーザー）で共有する。ギフト元データ `Gift` は不変で、手動編集・非表示は `GiftEdit(giftId, streamerId)` として別レコードに持ち、表示時に上書きする。したがって編集は編集者本人のビューにしか影響しない
- 認証は段階的。BIO 認証（bio に認証コードを貼ってサーバーがスクレイピング確認）前でもオーバーレイは動き、コイン数・履歴だけが `VerifyGate` でぼかされる仕組みだが、**現在 `analytics/page.tsx` の `BIO_VERIFICATION_GATE_ENABLED = false` でゲート無効化中**（未認証でも全機能利用可）。認証フロー自体（`/setup`、`verify/generate`）は復活に備えて残してある。**モバイルアプリはBIO認証ゲートの対象外**（`server.js` の socket.io `io.use()` と `src/app/api/mobile/listener-status/route.ts` の apiKey 認証は `verified` を問わない）。未 verified でもアプリは通常どおり使える
- **モバイル認証は NextAuth を通らない別系統**（`src/app/api/mobile/auth/{google,apple}`）。レスポンスの形は [src/lib/mobile-oauth.ts](src/lib/mobile-oauth.ts) の `mobileAuthResponseBody()` に一本化してある（端末の `AuthSession.fromJson` は1つしかないので、片方だけ形を変えると壊れる）。Apple は **id_token を受け取らず authorizationCode を Apple と交換する**（Android は web フローで、端末の受け口 Activity が exported なため id_token 単体では他人の応答を差し込める）
- **Google と Apple は常に別ユーザーにする。メールが同じでも統合しない。** 実装は [src/lib/apple-account.ts](src/lib/apple-account.ts) に隔離してある。担保しているのは「**Apple 経由の `User` は `User.email` を持たない**（`null` で作る）」ことだけで、メールが無ければ Google ルートのメール一致リンクが拾えない。Apple が申告したメールは `Account.providerEmail` に置き、表示にだけ使う（DB の `User.email` は null なのに応答の `email` には値が入るのはこのため）。**これは現行コードパス上の不変条件であって DB 制約ではない** — NextAuth はログイン済みセッションがあるとメールを見ずに `linkAccount()` するので、Web へ Apple を足すときは `signIn` コールバック等で別途弾くこと。分離は [src/app/api/mobile/auth/provider-separation.integration.test.ts](src/app/api/mobile/auth/provider-separation.integration.test.ts) が両ルートを実際に叩いて固定している
- **メール一致で既存 User へ繋ぐのは「`Account` を1件も持たない User」だけ。** `User.email` は「そのメールの所有者である」ことを証明していない（旧 `/api/auth/register`・`dev-login`・Workspace のメール再利用）ので、Account を持つ現役ユーザーまで拾わせると、同じメールを後から入手できた別人がそのアカウントへ正面からログインできる。この制限は**モバイルと Web の2箇所**にある — [src/app/api/mobile/auth/google/route.ts](src/app/api/mobile/auth/google/route.ts)（該当したら 409）と [src/lib/auth.ts](src/lib/auth.ts) の `emailLinkRestrictedAdapter()`（PrismaAdapter の `getUserByEmail` を包む。`allowDangerousEmailAccountLinking` はプロバイダのオプションでは条件を書けず、`signIn` コールバックは現在のセッションを受け取れないためアダプタ側で担保している）。**通す側の唯一の用途は 5a3e97a 以前の「メール/パスワード登録」で作られた旧 User の Google への移行**で、旧 User は Account を持たないので成立する。固定は [email-link-restriction.integration.test.ts](src/app/api/mobile/auth/google/email-link-restriction.integration.test.ts)
- **`verifyMobileToken` は `5a3e97a` の本番デプロイ時刻より前に発行されたトークンを拒否する**（[src/lib/mobile-auth.ts](src/lib/mobile-auth.ts) の `LEGACY_TOKEN_CUTOFF_SEC`）。旧 `/api/mobile/auth/register` はメールの所有確認なしに 90日トークンを発行していて、stateless で失効機構が無いため下限を入れないと 2026-11 月まで有効なまま残る。**値はコミット時刻ではなくデプロイ時刻**（コミットからデプロイ完了までに発行された分を取りこぼす）
- `/api/auth/register`（パスワード登録）は **`ENABLE_PASSWORD_REGISTER=1` のときだけ開く既定オフのエンドポイント**。`authOptions` にパスワード用 provider が無いのに加え、モバイルのメール認証ログイン（[src/app/api/mobile/auth/email/login/route.ts](src/app/api/mobile/auth/email/login/route.ts)）は `provider: "email"` の `Account` を持つ User にしか許可しないため、ここで作った Account 0件の User は誰もログインできない。開けると「他人のメールで先に User 行を作る」ことだけが可能になる（上のメール一致制限があるので、それを使って既存アカウントを乗っ取ることはできない）
- **モバイルのメール+パスワード認証**（[src/app/api/mobile/auth/email/](src/app/api/mobile/auth/email/)）は Apple App Store 審査用アカウント提供のために追加した第三のログイン手段。メール確認・パスワードリセット送信基盤は無い（確認メールなしで登録直後にログイン可）。**登録時に `Account`（`provider: "email"`）を User と同時に作ることが安全性の核心**——これにより登録直後から Google/Apple 版と同じ「Account を持つ User」に分類され、上記のメール一致リンク制限が新しいコードを書かずにそのまま防御になる。Account を作らず `User.password` だけ立てる設計は、設計レビューで「攻撃者が他人のメールで先に登録 → JWT取得 → 本物の所有者が後日Googleでログイン → メール一致リンクで被害者のGoogle Accountが攻撃者のUser行に吸着される」というアカウント乗っ取り経路が見つかり撤回した（[src/app/api/mobile/auth/email/register/route.ts](src/app/api/mobile/auth/email/register/route.ts) のコメント参照）。ログインは `provider: "email"` の Account を持つ User にのみ許可し、5a3e97a以前の旧パスワードUser（Account 0件）を構造的に除外する
- TikTok 接続は公式 API ではなく匿名 WebSocket。プロキシは `TIKTOK_PROXY_POOL` から sticky 割当されるため、**プールへの追加は必ず配列末尾に**（途中挿入・削除は既存割当をずらす）
- `linkMicBattle` / `linkMicArmies` を購読して `tiktok_battles` に残す（`src/lib/tiktok-battle.ts` がパーサ、`tiktok-listener.ts` の `persistBattle` が保存）。イベント機能の対戦自動検知に加え、analytics側のバトル履歴タブ（`src/lib/battle-history.ts`）もこのテーブルを読む。**実 payload は実配信のバトルでしか得られない**ため、`raw` を必ず保存し `GET /api/debug/battle-payloads?token=<GIFT_LOG_TOKEN>` で取り出せるようにしてある
- **相手の TikTok ハンドル・表示名・アイコンは、相手が analytics 未登録でも取れる。** `anchorInfo` は両サイド分が同時に配信されるため、自分の room の `hostProfiles`（anchorId → `{displayId, nickName, avatarUrl}`、2026-08-27に本番データで実証済み）だけで解決できる。**`hostUserIds` と `hostDisplayIds` は配列インデックスで対応していない**（armies走査とanchorInfo走査が別ループで順序保証が無い）ため、`hostProfiles` は配列ではなく anchorId をキーにした Record にしてある。`avatarUrl` は署名付きURL（数十時間で失効）なので恒久表示には使わず、`src/lib/avatar-storage.ts` の再保存処理の入力としてのみ使う
- **TikTokアバター画像（対戦相手・ギフト送信者・イベント参加者）は自前ストレージ（Railway Bucket）へ圧縮のうえ恒久保存する**（`src/lib/avatar-storage.ts`、`TiktokAvatarAsset` テーブル）。`src/lib/media-bucket.ts` の S3クライアントは web/worker 両方から使う共有モジュール（`media-storage.ts` はこれを使うよう差し替え済み）。同時実行制御・サーキットブレーカーは `src/lib/tiktok-avatar.ts` と同じ考え方。**`TiktokAvatarAsset` は roomId を持たないテナント非依存設計**（TikTokのuniqueId/anchorIdはグローバルに一意なので、同じ人物が複数配信者に登場しても1回のダウンロードで済む）。イベント参加者アイコン（`kind: "event_participant"`）は `Event.startAt` 到来時点で `event-worker.ts` の定期ジョブ（`src/event/avatar-snapshot.ts`）が書き込む（詳細は [src/event/CLAUDE.md](src/event/CLAUDE.md)）。worker / event-worker で使うには Railway 側で `worker1`/`worker2`/`worker3`/`event-worker` サービスにも `MEDIA_BUCKET_*` 環境変数が必要（web にしか設定されていない場合、静かに機能しないだけでクラッシュはしない）
- **ギフトの一致キーは `giftId` ではなく名前**（trim + 小文字化）。`chat:gift` はその形で配信し、モバイルの効果音設定はそれと文字列比較する。全ギフトカタログ `tiktok_gift_catalog`（[src/lib/tiktok-gift-catalog.ts](src/lib/tiktok-gift-catalog.ts) が `gift/list/` から取得、Worker の60秒 reconcile が24時間TTLで叩く）も **giftId 主キーで持つが消費側は名前で畳む**。実測で **670件中29の名前が複数 giftId を持ち、giftId 自体もレスポンス内で重複する**ので、giftId 照合にすると同名の別IDを取りこぼす
- **日本語のギフト表示名は TikTok 公式から取る**（`labelJa` 列）。カタログは `gift/list/` を**英語版と日本語版の2回叩いて giftId で突合**する。日本語化の条件は `webcast_language=ja-JP` ただ1つで、`ja`（2文字）では効かず `app_language` / `browser_language` / `region` / `tz_name` / `Accept-Language` / Cookie / room_id はいずれも無関係（2026-08-27 に実ルームで実測。地域にも依存せず、Railway の Singapore から `region=DE` のままでも日本語が返る）。671 giftId 中 651 件が日本語化し、`TikTok` / `GG` など20件は公式でも英語のまま
- **`name` と `label` は必ず英語版から採る。`labelJa` は表示専用。** LIVE の `gift` イベント（WS の protobuf）の名前は言語指定と無関係に**英語固定**なので、一致キーを日本語にすると `chat:gift` と永久に一致せず、**例外もログも出ないまま全ユーザーの効果音が鳴らなくなる**。日本語版の取得は表示にしか効かないため、失敗してもカタログ更新そのものは通し、既存の `labelJa` は upsert の `COALESCE` で守る
- カタログ取得で `enableExtendedGiftInfo: true` を**使わない**。あれを立てると `connect()` の内部で `fetchAvailableGifts()` が呼ばれ、失敗時に `InvalidResponseError` で**ライブ接続そのものが落ちる**。未接続の使い捨て接続から明示的に呼び、失敗はログのみに留める（`true` にすると connector が giftId でカタログを引いて `extendedGiftInfo.name` に日本語を入れてくれるが、この接続断リスクに見合わない）

### オーバーレイ（OBS ブラウザソース）

- **表示ページの URL `/overlay/<kind>?token=<overlayToken>` は配信者の OBS に設定済み。絶対に変えないこと。** ファイルは `src/app/(overlay)/overlay/<kind>/` に置くが、`(overlay)` はルートグループなので URL には出ない
- 種類の一覧は [src/lib/overlay/kinds.ts](src/lib/overlay/kinds.ts) が正本。**表示系の種類を足すなら (1) `kinds.ts` に1エントリ (2) [server-kinds.ts](src/lib/overlay/server-kinds.ts) に集計実装 (3) `(overlay)/overlay/<kind>/page.tsx` の3点**で、API (`/api/overlay/[kind]`) と管理画面のカードは自動で載る。`server-kinds.ts` は `satisfies Record<OverlayKind, ...>` なので実装を書き忘れると型エラーになる
- **`src/lib/overlay/` は client/server をファイルで分けている。** `contracts.ts`(型・定数)と `kinds.ts`(種類の一覧)だけが import ゼロでクライアント安全。`index.ts`(= `@/lib/overlay`)・`token.ts`・`contribution.server.ts`・`emit.ts` は prisma / crypto を引くのでサーバー専用。**クライアントコンポーネントから `@/lib/overlay` を import しないこと**
- データ取得は `(overlay)/_hooks/useOverlaySnapshot.ts` に集約。socket.io の push が主経路で、切断中だけ 30秒 polling が動く（GET はその日のギフト全件を読む重い処理なので接続中は投げない）。クエリの読み取りは `useOverlayParams.ts` を通す — **`useSearchParams` に戻さないこと**（Suspense 構成が本番でだけ "Element type is invalid" を起こした経緯がある）
- 背景の透過は `(overlay)/layout.tsx` の inline script が hydration 前に `body.overlay-body` を付けて実現する。CSS は必ず `.overlay-body` にスコープを閉じる（裸の `body` セレクタだとダッシュボード側の背景まで消える）
- 設定 UI は `/overlays`（[src/app/(overlay-settings)/overlays/](src/app/(overlay-settings)/overlays/)）。**ヘッダーのドロップダウンへ戻さないこと。** 未送信の変更は項目別ではなく1つの patch にマージして直列 PATCH する（[useOverlaySettings.ts](src/app/(overlay-settings)/overlays/useOverlaySettings.ts)）— 項目ごとに debounce タイマーを共有すると、連続操作で先の変更が握り潰される
- 設定の保存 API `/api/streamer/overlay-settings` は **contribution 固定**。設定が要る種類を2つ目に足すときは、この API か `Streamer` の `overlay*` 列（種類ごとに増え続ける）の設計から必要になる

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

Root Directory を `live-sidestage-analytics` にする。[railway.toml](railway.toml) と [Dockerfile](Dockerfile) はそのディレクトリ基準。**同じイメージを6サービス（web + worker1/2/3 + event-worker + worker-guardian）で使い、start command と環境変数だけを変える** — 未指定（web。Dockerfile の CMD）/ `npm run worker`（TikTok 接続、`WORKER_INDEX` が要る、worker1〜3の3インスタンス）/ `npm run event-worker`（イベント集計）/ `npm run worker-guardian`（worker監視・フェイルオーバー）。**スキーマ反映は build ではなく web の起動時**（CMD が `prisma db push --accept-data-loss` を実行する）。start command を上書きするworker系サービスはCMDを通らないので push しない。本番構成の詳細は auto-memory の `railway-analytics-production-services` を参照。
