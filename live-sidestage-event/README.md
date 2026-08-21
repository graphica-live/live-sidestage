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
npm run worker         # 集計ワーカー
npm run worker:local   # 集計ワーカー(.env.local.test)
npm run build          # prisma generate + next build
npm run typecheck      # tsc --noEmit
npm run test:unit      # vitest（*.integration.test.ts を除外、DB不要）
npm run test:integration  # ローカル Postgres 必須
npm test               # unit + integration
npm run bench:aggregate:local   # 集計の性能を実測する(ローカルDB専用)
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

## 集計とランキング

集計ワーカー（`npm run worker`）が10秒ごとに開催中のイベントを再集計する。増分ではなく
**毎回イベント期間の全ギフトを計算し直す**（バトル区間が後から確定するため、増分では修正できない）。

- 期間は **`[startAt, endAt)` の半開区間**、`receivedAt` 基準
- タイムゾーンは **Asia/Tokyo**。`gifts.dayKey` は使わない
- 公式スコアは**元の `gifts` のみ**。`gift_edits`（手動編集・非表示）は反映しない。編集は
  編集した本人のビューにしか影響しない仕様なので、混ぜると主催者と参加者で数字が食い違う
- ポイント = ダイヤ実数 × 倍率。**1件のギフトに適用される倍率は必ず1つ**。
  同じ種類の倍率が複数該当したら最大の1つだけを採り、合計も乗算もしない
- チーム戦のスコアは**所属参加者全員の合計**。どのチームにも所属していない参加者の
  ダイヤはチーム順位に入らない（参加者順位とイベント全体のランキングには出る）
- 終了後も締切（終了 + 1時間）までは集計を続け、締切後の1回を最終集計とする。
  主催者が早めに「終了」にしても、直前のギフトが落ちないようにするため

公開ページ（`/e/<slug>`）で見られるもの:

- 参加者順位 / チーム順位（種目がトーナメント・デスマッチのときは「獲得ダイヤ」として表示する）
- リスナー貢献ランキング — イベント全体 / 参加者別、ポイント順 / 実弾（ダイヤ）順で切り替え
- トーナメント表（`/e/<slug>/bracket`、種目がトーナメントで対戦表を作ってあるとき）

開催中は10秒ごとに自動更新する。リスナー貢献の保存は scope ごとに上位200件まで
（順位表の合計は切り捨て前の全ギフトから計算しているので、合計と順位には影響しない）。

**開催中に参加者やチーム所属を変えると、期間中の全ギフトが計算し直される。** 途中で追加した
参加者には登録前のギフトも算入され、外した参加者のぶんは順位から消える。登録し忘れの救済と
不正参加者の除外を優先した仕様で、参加者ページにも警告を出している。

## バトルトーナメント

主催者が対戦管理（`/events/<id>/matches`）でシード順を決めて表を作ると、シングルイリミネーションの
対戦カードが時間枠つきで並ぶ。参加数が2のべき乗でない場合は上位シードが1回戦を不戦勝で通過する。

集計ワーカーが10秒ごとに次を回す。

1. 参加者の room で観測されたバトルを analytics の `public.event_battle_v` から取り込む
2. 対戦カードの時間枠 `[scheduledStartAt, scheduledEndAt)` と突き合わせる
3. 検知区間 `[detectedStartAt, detectedEndAt)` のギフトをサイドごとに集計し、勝者を決める
4. 勝者を次のラウンドへ送る

### 照合は roomId の集合で行う

バトルの payload から**相手の TikTok ハンドルを取る方法がない**（`anchorInfo` の
`BattleBaseUserInfo` に `uniqueId` が無く、`userId` と `displayId` しか出ない）。

代わりに、イベント参加者は全員 `monitorUntil` で監視しているという性質を使う。
1つのバトルについて**両サイドの room からそれぞれ同じ `battleId` のイベントが届く**ので、
`battleId` でグループ化した roomId の集合が「そのバトルに誰が出たか」になる。
これは payload の解釈精度に依存しない。

### 自動確定するのは 1vs1 の完全一致だけ

- **完全一致（exact）** — 観測した room の集合が対戦カードと一致した
- **部分一致（partial）** — 一部の room しか観測できなかったが、時間枠内で候補が1つだけだった

自動で勝敗まで決めるのは **1vs1 の完全一致のみ**。残りは「要確認」で止め、主催者が承認する。

- partial は、予定が A 対 B のときに A が**部外者と**戦っても観測が `{A}` になるため、
  唯一の候補として通ってしまう
- 2vs2 の完全一致は、予定 `[A,B]` 対 `[C,D]` と実際の `[A,C]` 対 `[B,D]` を
  room の和集合では区別できない

### 勝敗の決め方

**TikTok 側の `hostScore` ではなく、当サービスが `gifts` から集計したダイヤで決める**
（集計の出所を1つに揃えるため）。倍率は適用しない — 倍率は個人の通算ポイント用のもので、
対戦の勝敗に効かせると同じ実績でも枠の取り方で結果が変わってしまう。

同点（0対0を含む）は自動で決めず、主催者の手動確定に回す。

`hostScore` は `DetectedBattle.hostScores` に参考値として残る。ただし**サイド単位では比較できない** —
キーが anchorIdStr（TikTok の数値 userId）で、event 側は参加者の数値 userId を持っていないため。

### 検知が働かなかったとき

主催者は対戦管理から次を実行できる。

- **承認** — 要確認の検知を認める。次の集計で勝敗が決まる
- **勝者を確定** — 手動で勝者を決める（`winnerDecidedBy = MANUAL`）。以後の自動検知では上書きしない
- **無効にする（VOID）** — バトルが成立しなかった場合。勝者は次のラウンドへ進まない
- **検知をやり直す** — 状態を戻して自動検知の対象に戻す

**次の対戦がすでに始まっていると、上流の結果は変更できない**（409 を返す）。
進行中の対戦の参加者が途中で入れ替わると、集計対象が変わって結果が壊れるため。

### バトル倍率は参加者ごと

`EventMultiplier(kind="BATTLE")` は、**その参加者が実際にバトルしていた区間にだけ**かかる。
イベント全体で1本の区間リストにすると、1人がバトル中というだけで同時刻の他の参加者にも
倍率がかかってしまうため、バトル区間を持つ参加者だけ個別に集計する
（`aggregate.ts` の `perRoomRooms`）。BATTLE 倍率を設定していなければこの分割は行わない。

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
  `event_worker` の接続文字列を設定する。監視期限の延長を行うので、worker にも
  `ANALYTICS_INTERNAL_URL` と `EVENT_INTERNAL_API_SECRET` が要る（未設定だと警告を出して
  延長だけを飛ばす。終了が120日以上先のイベントで監視が途中で止まる）
