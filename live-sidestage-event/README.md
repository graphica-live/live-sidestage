# LIVE Sidestage Event

TikTok Live のイベント・大会を作って運営する Web サービス。Next.js 14 (App Router) + Prisma + Railway。

主催者がイベントを作り、参加ライバーの TikTok ID を登録してイベントを開始すると、期間中のギフトを
`live-sidestage-analytics` のデータから集計し、順位とリスナーの貢献ランキングを公開ページに出す。

## 種目

| 種目 | 内容 |
| --- | --- |
| バトルトーナメント | 対戦カードと時間枠を組み、実際の TikTok バトルを自動検知して勝敗を決める。1vs1 / 2vs2 |
| 獲得ダイヤレース | イベント期間中の獲得ダイヤを競う |
| デスマッチ | ライフポイント制。マッチ結果に応じてライフが増減する |

いずれも個人戦とチーム戦（最大100チーム）に対応する。チーム形式は「汎用グループ」と「都道府県（日本地図UI）」。

## セットアップ

依存はプロジェクトごとに独立している。このディレクトリで個別にインストールする。

```bash
npm ci
npx prisma generate
```

### ローカル開発

DB は `live-sidestage-analytics` の docker compose（localhost:5433）を共用する。

```bash
cd ../live-sidestage-analytics
docker compose up -d db
npm run db:push:local     # analytics のテーブル(public)を作る
# analytics のデータを読むための view。ロールが無いローカルでは GRANT はスキップされる
docker compose exec -T db psql -U liveanalytics -d liveanalytics_test < sql/event-integration.sql

cd ../live-sidestage-event
npm run db:push:local     # event スキーマにテーブルを作る
npm run seed:local        # 動作確認用のイベントを2件入れる
npm run dev:local         # http://localhost:3100
```

参加者登録を試すには analytics の Web も動かしておく(`cd ../live-sidestage-analytics && npm run dev:local`)。
`.env.local.test` の `ANALYTICS_INTERNAL_URL` がそれを指す。`EVENT_INTERNAL_API_SECRET` は
analytics 側の同名の変数と一致させ、analytics の `INTERNAL_API_SECRET` とは別の値にする。

`.env.local.test` は git 追跡外。`.env.example` を見て作る。`ENABLE_DEV_LOGIN=1` を入れておくと
メールアドレスだけでログインできる（本番では絶対に設定しない）。

## コマンド

```bash
npm run dev            # 開発サーバー (:3100)
npm run build          # prisma generate + next build
npm run typecheck      # tsc --noEmit
npm run test:unit      # vitest（*.integration.test.ts を除外、DB不要）
npm run test:integration  # ローカル Postgres 必須
npm test               # unit + integration
```

テストを1件だけ流す: `npx vitest run src/lib/validation.test.ts -t "テスト名"`

## データベースの構成

**この構成には壊すと復旧できない箇所があるので、触る前に必ず読むこと。**

`live-sidestage-analytics` と**同じ PostgreSQL インスタンス**を使うが、Prisma が管理するのは
`event` スキーマだけ（`prisma/schema.prisma` の `schemas = ["event"]`）。

analytics のテーブル（`gifts` / `TiktokRoom` / `Streamer` など）は **Prisma に一切書かない**。
Prisma 5.x には「このテーブルは他が管理している」と宣言する手段がないため、`public` を
`schemas` に含めた瞬間、schema.prisma に書いていないテーブルが `db push` の削除差分になる。
analytics の本番デプロイは `prisma db push --accept-data-loss` なので、事故ると復旧できない。

analytics のデータは**列を絞った view 経由で SELECT only** で読む。読み書きは
`src/lib/analytics-db.ts` と `src/lib/auth-adapter.ts` に閉じ込め、SQL は必ず
`public."TiktokRoom"` のように完全修飾する（Prisma の multiSchema は raw SQL を自動修飾しない）。

### ロール

| ロール | 用途 | public への権限 |
| --- | --- | --- |
| `event_migrator` | `event` スキーマの所有者。マイグレーション専用 | なし |
| `event_web` | Web プロセス | view の SELECT + `User`/`Account` の最小 DML |
| `event_worker` | 集計ワーカー | view の SELECT のみ |

`User` の DELETE はどのロールにも与えていない（FK cascade で `Streamer` とその `GiftEdit` まで消えるため）。
`User` の UPDATE は `name` / `email` / `emailVerified` / `image` の4列に限定している（`password` を触らせない）。

### デプロイ順序

逆順がロールバック順。

1. analytics 側のスキーマ変更をデプロイ
2. `live-sidestage-analytics/sql/event-integration.sql`（view と GRANT）を適用
3. `live-sidestage-event/sql/001-bootstrap.sql`（スキーマとロール）を適用 ※初回のみ
4. event の migration を `event_migrator` の接続で適用
   ```bash
   DATABASE_URL="$DATABASE_URL_MIGRATOR" npm run db:push
   ```
5. event の web / worker をデプロイ

**Dockerfile の CMD に `db push` は入れない。** 新表の GRANT を忘れると worker が実行時に権限エラーで落ちる。
DB を復元・clone したら bootstrap SQL と event-integration SQL を再適用する。

## 認証

analytics と**同じ `public."User"` / `"Account"`** を使う。同じ Google アカウントでログインすれば
`User.id` は analytics と一致する（`src/lib/auth-adapter.ts`）。

共通なのは **`User.id` だけ**。セッションは共有しない。analytics も event も `session.strategy = "jwt"` で
DB `Session` を作らないため、`Session` 表を共有しても SSO にも失効共有にも寄与しないので、
サービスごとに独立してログインする（同じ Google アカウントなので体験上は1クリック）。

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` は analytics と同じ値を使う。デプロイ先を増やしたら
Google Cloud Console の Authorized redirect URI に `https://<host>/api/auth/callback/google` を追加すること。

## 参加者登録と配信の監視

主催者が参加者の TikTok ID を登録すると、その配信者の TikTok Live を**イベント終了+24時間**まで
監視するよう analytics に要求する(`POST /api/internal/event-room-lease`)。

- analytics 側に既にその配信者の room があれば**再利用**する。同じ配信者のギフトが分裂しないため
- なければ analytics 側が room を新規作成する。この room は会員登録(`Streamer`)を持たないが、
  `TiktokRoom.monitorUntil` が未来の間だけ Worker の担当に含まれる
- 監視の開始・停止は analytics の reconcile ループ(60秒間隔)で反映される。UI にもそう出す
- 期限が切れると監視は止まるが、**受信済みのギフトと room は残る**。後からその配信者が会員登録すれば
  `streamers` 条件で監視が再開される

同じ配信者が複数のイベントに出ている場合、`monitorUntil` は room につき1本しかないので、
**未解放の `EventRoomLease` が他イベントに残っている間は解除しない**
(`src/lib/participants.ts` の `releaseIfUnused()`)。確保のときは analytics 側が
`max(既存, 要求)` で更新するため、他イベントの期間を縮めることはない。

参加者数の上限は200人(`MAX_PARTICIPANTS`)。analytics 側でも監視中の room 総数に
上限(500)があり、超えると 429 を返す。

## 集計の定義

- 期間は **`[startAt, endAt)` の半開区間**、`receivedAt` 基準
- タイムゾーンは **Asia/Tokyo**。`gifts.dayKey` は使わない
- 公式スコアは**元の `gifts` のみ**。`gift_edits`（手動編集・非表示）は反映しない。編集は
  編集した本人のビューにしか影響しない仕様なので、混ぜると主催者と参加者で数字が食い違う
- ポイント = ダイヤ実数 × 倍率。**1件のギフトに適用される倍率は必ず1つ**

## 競技データとしての限界

`gifts` は分析用の記録として作られており、賞金や公式順位の唯一の根拠に耐える設計ではない。

- analytics 側の DB 保存エラーは握りつぶされる（再試行も outbox もない）
- `orderId` / `groupId` が両方欠落したギフトは重複判定なしで保存される
- リスナー識別子は `uniqueId`（TikTok ハンドル）のみ。ハンドル変更で同一人物が別人になる
- 接続断中のギフトは記録されない

全期間再集計をしても取り込み時点の欠落・重複は修復できないため、主催者が
`EventScoreAdjustment` で補正できるようにしてある。公開ページにも但し書きを出す。

## デプロイ

Railway。Root Directory を `live-sidestage-event` にする。

- **web**: 既定の start command（`Dockerfile` の CMD）
- **worker**: 同じ Dockerfile で start command を `npm run worker` に上書きし、`DATABASE_URL` に
  `event_worker` の接続文字列を設定する
