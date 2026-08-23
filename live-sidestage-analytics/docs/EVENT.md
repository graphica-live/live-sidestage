# LIVE Sidestage Event

TikTok Live のイベント・大会を作って運営する機能。`live-sidestage-analytics` の一部として動く。

主催者がイベントを作り、参加ライバーの TikTok ID を登録してイベントを開始すると、期間中のギフトを
analytics が受信した `gifts` から集計し、順位とリスナーの貢献ランキングを公開ページに出す。

コードの置き場所:

| 役割 | パス |
| --- | --- |
| ロジック（集計・照合・スコア計算など） | `src/event/` |
| 主催者向け画面 | `src/app/(dashboard)/events/` |
| 公開ページ | `src/app/(public)/e/` |
| 主催者向け API | `src/app/api/events/` |
| 公開 API | `src/app/api/public/` |
| 集計ワーカー | `event-worker.ts` |
| 実装時の制約 | [src/event/CLAUDE.md](../src/event/CLAUDE.md) |

> **経緯**: 当初は `live-sidestage-event/` という別プロジェクト・別 Railway サービス・別 DB ロールで、
> analytics のデータを view 経由で読む構成だった。だが同じ Postgres・同じ `public."User"` を共有していて
> 分離の実体がなく、「`public` を Prisma の管理下に置けない」という制約が恒久的な事故要因
> （`db push --accept-data-loss` の削除差分）として残り続けていた。プロセスを分けたいという
> 本来の目的（TikTok 接続の WebSocket を巻き込まない）は Railway のサービス分割で達成できるため、
> コードは analytics に統合し、プロセスだけを分けている。

## 種目

| 種目 | 内容 |
| --- | --- |
| バトルトーナメント | 対戦カードと時間枠を組み、実際の TikTok バトルを自動検知して勝敗を決める。1vs1 / 2vs2 |
| 獲得ダイヤレース | イベント期間中の獲得ダイヤを競う |
| デスマッチ | ライフポイント制。負けるとライフが減り、0 で脱落する |

いずれも個人戦とチーム戦（最大100チーム）に対応する。チーム形式は「汎用グループ」と「都道府県（日本地図UI）」。

## ローカル開発

`live-sidestage-analytics` の一部なので、セットアップは analytics のものと同じ。

```bash
cd live-sidestage-analytics
docker compose up -d db
npm run db:push:local        # public と event の両スキーマを作る
npm run seed:event:local     # 動作確認用のイベントを2件入れる
npm run dev:local            # http://localhost:3000
npm run event-worker:local   # 別ターミナル。集計ワーカー
```

`.env.local.test` は git 追跡外。`.env.example` を見て作る。`ENABLE_DEV_LOGIN=1` を入れておくと
メールアドレスだけでログインできる（本番では絶対に設定しない）。

イベント機能に固有の npm script:

```bash
npm run seed:event:local        # イベント用シード（analytics 本体の seed:local とは独立）
npm run event-worker            # 集計ワーカー
npm run event-worker:local      # 集計ワーカー(.env.local.test)
npm run bench:aggregate:local   # 集計の性能を実測する(ローカルDB専用)
```

typecheck / test / build は analytics 共通のものがイベント機能も含めて検証する。
テストを1件だけ流す: `npx vitest run src/event/validation.test.ts -t "テスト名"`

## データベースの構成

**この構成には壊すと復旧できない箇所があるので、触る前に必ず読むこと。**

`prisma/schema.prisma` が `public` と `event` の**両方**を管理する
（`schemas = ["public", "event"]`、`previewFeatures = ["multiSchema"]`）。
イベント機能のテーブルはすべて `@@schema("event")`、analytics のテーブルは `@@schema("public")`。

**schema.prisma からモデルを消したり `@@schema` を外したりしない。** 本番デプロイは
`prisma db push --accept-data-loss` なので、schema.prisma に書かれていないテーブルは
警告なしで削除される。統合前は「event 側の `schemas` に `public` を足すと analytics のテーブルが
消える」という形で同じ危険があった。1つの schema.prisma が両方を書くことで解消している。

`public` のテーブルを読むのは `src/event/analytics-db.ts` だけ。SQL は必ず
`public."TiktokRoom"` のように完全修飾する（Prisma の multiSchema は raw SQL を自動修飾しない）。
`TiktokRoom` への書き込みは `src/lib/tiktok-room.ts` の `ensureRoomForEvent()` /
`releaseRoomMonitor()` を通す。

### 統合前の構成から移行するとき

統合前は `event_migrator` / `event_web` / `event_worker` の3ロールと、列を絞った view
（`public.event_gift_v` など）で分離していた。統合後はどちらも不要。

1. イベント機能を含む版をデプロイする
2. （掃除。任意）`sql/drop-event-integration.sql` を view の所有者ロールで適用して view を落とす

**順序を逆にしない。** 先に view を落とすと、旧版が動いている間だけ集計が失敗する。
2 はやらなくても壊れない — 新しいコードは view を参照しないので、使われないオブジェクトが
`public` に残るだけ。所有者ロールは元の `event-integration.sql` を流したロール
（Railway のマネージド Postgres なら既定の `postgres`）で、真の superuser でなくてよい。

`event` スキーマ自体と中のテーブルはそのまま使う（データ移行は不要）。所有者が
`event_migrator` になっている場合は、analytics の接続ロールが `db push` できるよう
所有権を移すこと。

### デプロイ

Railway で3サービスに分ける。**同じイメージ・同じ Root Directory（`live-sidestage-analytics`）で、
start command と環境変数だけを変える。**

| サービス | start command | 役割 |
| --- | --- | --- |
| web | 未指定（Dockerfile の CMD） | Next.js + socket.io。イベントの画面と API もここ |
| worker | `npm run worker` | TikTok Webcast 接続の維持（`WORKER_INDEX` / `WORKER_COUNT` が要る） |
| event-worker | `npm run event-worker` | イベント集計。10秒ごとに再集計 |

**スキーマ反映は build ではなく、web の起動時に走る。** [Dockerfile](../Dockerfile) の CMD が
`migrate-shared-tiktok-room.ts` → `prisma db push --accept-data-loss` → `node server.js` の順で実行する。
build（`npx prisma generate && npx next build`）は DB に触らない。

worker と event-worker は start command を上書きするので CMD を通らず、**`db push` を実行しない**。
スキーマを反映するプロセスが web の1本だけになるようにわざとそうしている。この非対称は
初回デプロイで問題になる（下記）。

### 初回デプロイ手順

イベント機能を本番へ初めて出すときの手順。analytics の web / worker は既に動いている前提。

#### 0. 事前確認（read-only、DB を変更しない）

**`prisma migrate diff` で、本番に対して何が起きるかを先に読む。** web の起動時に走るのは
`db push --accept-data-loss` で、警告を出さずにテーブルを消す。事前に差分を目で見ておく。

```bash
npx prisma migrate diff \
  --from-url "$PROD_DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

出力の SQL に **`DROP TABLE` / `DROP COLUMN` が1つも無いこと**を確認する。
期待される出力は `CREATE SCHEMA "event"` と `event` 配下14テーブルの `CREATE TABLE` だけ
（`public` 側に差分が出るなら本番がスキーマからドリフトしている。その場合は先に原因を潰す）。

#### 1. web をデプロイする

main へマージして push すると web が入れ替わり、起動時の CMD が
`prisma db push --accept-data-loss` を実行して `event` スキーマと14テーブルを作る。

- `db push` は `CREATE SCHEMA` を含むので、**web の `DATABASE_URL` のロールに対象DBの
  `CREATE` 権限が要る**。Railway のマネージド Postgres の既定ロール（`postgres`）なら持っている
- ログに `[startup] PORT=...` の後で Prisma の出力が出る。ここで失敗すると `node server.js` まで
  進まないので、web が起動しない = すぐ気づける

この時点で `/events` と `/e/<slug>` は動く。集計だけがまだ回っていない状態。

#### 2. event-worker サービスを作る

**web のデプロイが成功してから作る。** 順序が逆だと、`event` スキーマがまだ存在しない DB に対して
event-worker が起動し、10秒ごとにテーブル不在で落ち続ける
（`restartPolicyMaxRetries = 3` で停止する）。

Railway で analytics と同じリポジトリ・同じ Root Directory（`live-sidestage-analytics`）の
サービスを新規作成し、以下だけを変える。

| 設定 | 値 |
| --- | --- |
| Start Command | `npm run event-worker` |
| `DATABASE_URL` | web と同じ |
| Healthcheck Path | 設定しない（`event-worker.ts` は HTTP を持たない） |

`WORKER_INDEX` / `WORKER_COUNT` / `INTERNAL_API_SECRET` / `TIKTOK_PROXY_POOL` は**不要**。
これらは TikTok 接続の worker のものなので、混ぜない。

起動ログに `[event-worker] イベント集計ワーカーを開始した(...)` が出れば成功。

#### 3. 動作確認

1. `/events` で新しいイベントを作る（`status` は `SCHEDULED`、`visibility` は既定で `PRIVATE`）
2. 参加者を1人登録する → `TiktokRoom.monitorUntil` が立つ
3. **最大60秒待つ。** TikTok 接続の worker の reconcile が拾って接続を開始する。
   参加者一覧の監視状態が `connecting` → `connected` に変わる
4. イベントを `RUNNING` にする
5. 実際にギフトが飛ぶと、10秒以内に `/e/<slug>` の順位が動く。
   `Event.lastAggregatedAt` が更新されているかでも確認できる

#### 4.（任意）統合前の view の掃除

`sql/drop-event-integration.sql`。詳細は「統合前の構成から移行するとき」を参照。
**統合前の event を一度も本番デプロイしていないなら、view はそもそも存在しないので不要。**

#### ロールバック

event-worker サービスを停止するだけでよい。web を戻す必要はない
（`event` スキーマが残っていても `public` 側の動作には影響しない）。
`event` スキーマを消すと作ったイベントのデータごと消えるので、慌てて `DROP SCHEMA` しない。

#### `EventLifeLedger` に FK を足すとき（フェーズ5の変更を既存DBへ入れる場合）

`EventLifeLedger` は当初 `Event` への関連を持っておらず、イベントを削除しても履歴が残った。
FK（`onDelete: Cascade`）を足したので、**既存DBには孤児行が残っている**。そのまま `db push` すると
`EventLifeLedger_eventId_fkey` の作成で失敗するので、先に消す。

```sql
DELETE FROM event."EventLifeLedger" l
 WHERE NOT EXISTS (SELECT 1 FROM event."Event" e WHERE e.id = l."eventId");
```

消えるのは既に存在しないイベントの履歴だけなので、生きているイベントには影響しない。

## 認証

analytics の `src/lib/auth.ts`（NextAuth + `PrismaAdapter`）をそのまま使う。イベント機能は
独自の認証を持たない。1回ログインすれば `/analytics` と `/events` の両方が使える。

統合前は `$queryRaw` ベースの自前 NextAuth アダプタで `public."User"` / `"Account"` を
共有していた（Prisma に User/Account を持たせられなかったため）。統合でその制約が消えたので
標準の `PrismaAdapter` に戻し、`src/event/auth-adapter.ts` と `cuid` 依存は削除した。

`src/middleware.ts` が保護範囲を決める。イベントの公開ページ（`/e/...`）と公開API
（`/api/public/...`）は認証なしで通し、それ以外は全部ログインを要求する。
**除外エントリには必ず境界 `(?:/|$)` を付けること** — 境界なしの `e` は `/events`
（主催者向け管理画面）まで公開してしまう。`src/middleware.test.ts` がこれを固定している。

## 参加者登録と配信の監視

主催者が参加者の TikTok ID を登録すると、その配信者の TikTok Live を**イベント終了+24時間**まで
監視するよう `TiktokRoom.monitorUntil` を立てる(`src/lib/tiktok-room.ts` の `ensureRoomForEvent()`)。

- 既にその配信者の room があれば**再利用**する。同じ配信者のギフトが分裂しないため
- なければ room を新規作成する。この room は会員登録(`Streamer`)を持たないが、
  `monitorUntil` が未来の間だけ Worker の担当に含まれる（`getMyRooms()` の `OR` 条件）
- 監視の開始・停止は Worker の reconcile ループ(60秒間隔)で反映される。UI にもそう出す
- 期限が切れると監視は止まるが、**受信済みのギフトと room は残る**。後からその配信者が会員登録すれば
  `streamers` 条件で監視が再開される

同じ配信者が複数のイベントに出ている場合、`monitorUntil` は room につき1本しかないので、
**未解放の `EventRoomLease` が他イベントに残っている間は解除しない**
(`src/event/participants.ts` の `releaseIfUnused()`)。確保のときは
`max(既存, 要求)` で更新するため、他イベントの期間を縮めることはない。

サーバー側の上限:

- 参加者数は1イベント200人(`MAX_PARTICIPANTS`)
- 監視期限は最大120日(`MAX_LEASE_DAYS`)。イベント終了がそれより先だと切り詰められ、
  集計ワーカーの `renewClampedLeases` が1時間ごとに伸ばし直す
- 監視中の room 総数は500(`MAX_ACTIVE_LEASES`)。超えると登録が 429 で失敗する

統合前はこの検証を内部API(`/api/internal/event-room-lease`)が持っていた。API は消したが
**検証と上限は関数側へそのまま移してある** — 主催者の入力がそのまま届く経路であることは
変わらないため。

## 開催日程

1つのイベントは**複数の開催日程**（`event."EventSession"`）を持てる。
「1日目 22:00-23:00 で予選、2日目 22:00-23:00 で決勝」のように日を分けて開催するため。

- **集計されるのは日程の中だけ。日程と日程の隙間のギフトは入らない**（1日目の23:00〜2日目の
  22:00 に届いたギフトは順位にも貢献ランキングにも出ない）
- 各日程も `[startAt, endAt)` の半開区間。日程どうしは重ねられない（重なると同じギフトを
  二重に数える）。前の終わりと次の始まりが同時刻なのは許す
- 日程は最大20件、最初の日程の開始から最後の日程の終了までが最大90日
- 日程には任意で名前を付けられる（「予選」「決勝」など）。公開ページと対戦管理に出る

`Event.startAt` / `endAt` は**全日程を覆う外枠**で、日程の min/max から作る派生値。
集計対象の判定（`startAt <= now`）・締切（`endAt` + 1時間）・room の監視期限は今も外枠を見る。
したがって**日程の隙間でも監視は続き、集計ワーカーも10秒ごとに回る**（隙間のギフトが
結果に入らないだけ）。

**期間を読むコードは必ず `src/event/sessions.ts` の `resolveEventWindows()` を通すこと。**
この機能より前に作られたイベントは日程を1件も持たないので、外枠を1日程とみなす
フォールバックがそこにある（既存データのバックフィルはしていない）。

対戦の時間枠は**1つの日程に収まっていること**を要求する（日程をまたぐ枠・隙間に置かれた枠は
弾く）。トーナメント表の生成では、ラウンドの枠が日程からはみ出す場合に次の日程の先頭へ送る。

日程を後から変更するとき、**VOID でない対戦が新しい日程のどれにも収まらなければ 409 で拒否する**
（`PATCH /api/events/<id>`）。自動で VOID にも移動もしない — 主催者に先に対戦の時間を直させる。
検証は日程の書き込みと同じトランザクション（advisory lock 取得後）で行うので、
対戦を組む操作と同時に走っても、古い日程で通した枠が取り残されることはない。

## 集計とランキング

集計ワーカー（`npm run event-worker`）が10秒ごとに開催中のイベントを再集計する。増分ではなく
**毎回イベント期間の全ギフトを計算し直す**（バトル区間が後から確定するため、増分では修正できない）。

- 期間は**開催日程ごとの `[start, end)` の半開区間**、`receivedAt` 基準
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
対戦カードが時間枠つきで並ぶ。参加数が2のべき乗でない場合は不戦勝(BYE)が出る。

不戦勝の配り方はイベント作成時に選ぶ（`src/event/bracket-rules.ts`、`Event.rules.bracket.method`）。

- **標準シード方式(既定)**: 不戦勝を1回戦に集中させ、上位シードへ優先的に割り当てる
  （`buildBracket()`）。参加者が2のべき乗でない場合、1回戦で複数人が同時に不戦勝になることがある
- **段階的不戦勝方式**: 各ラウンドの同時不戦勝は最大1人（`buildStagedBracket()`）。標準方式との
  違いは「同時に複数人が不戦勝にならない」ことだけで、**同じ人が複数ラウンドにわたって不戦勝に
  なることはある**（`src/event/bracket.ts` の `buildStagedBracket` のコメント参照 — `nextSlot()` の
  固定座標の制約上、連続不戦勝を完全に排除する保証まではできない）

どちらの方式でも総試合数は entrantCount-1 で同じ。表生成（`tournament.ts` の `createBracket()`）は
イベント作成後いつでも方式を変えて作り直せる（既存の表がまだ何も進行していなければ）。

集計ワーカーが10秒ごとに次を回す。

1. 参加者の room で観測されたバトルを analytics の `public.tiktok_battles` から取り込む
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

### 公開トーナメント表の見せ方

`/e/<slug>/bracket` は**決勝を中央に置き、左右へブロックを分けて**描く（`BracketTree.tsx`）。
ラウンドごとの縦カラムを並べるのではなく、マッチを根とする再帰構造にして接続線を引いている。

**この線が引けるのはカードの高さを固定しているから**（`CARD_H`）。高さが揃っていれば
完全二分木の各サブツリーの高さも揃うので、子カードの中心が必ず 25% / 75% に来る。
カードの中身を可変行数にすると幾何が崩れて線がずれるので、時刻・状態・不戦勝は1行にまとめてある。
「優勝」バナーを絶対配置にしているのも同じ理由（通常フローに置くと決勝カードの中心がずれる）。

各出場者の名前の隣にはアイコンが出る。チーム戦はチーム名の横に出場メンバーのアイコンを
2つまで重ねて出し、残りは `+N` で表す（メンバー名は出さない。名前は `title` で見える）。

狭い画面では横スクロールになるが、初期位置は決勝（中央）に寄せてある（`BracketScroller.tsx`）。

### アイコンは DB に保存しない

配信者のアイコンは `GET /api/public/avatar/<participantId>` が TikTok の CDN へ 302 で送る。
**URL を DB に持たない。** TikTok の avatar URL は署名付きで `x-expires` がおよそ47時間、
つまり値そのものが賞味期限つきのキャッシュでしかなく、保存すると

- 終わったイベントの表で画像が壊れる（公開判定は PRIVATE(オーナー以外) を除くだけなので、
  終了・アーカイブ済みのイベントもずっと見られる）
- 取り直しの成否・間隔・排他をアプリ側で管理することになる
- ロールバックのたびに列を残すか消すかの判断が要る

が付いてくる。閲覧の契機で引いてプロセス内に持つだけなら、どれも起きない。

- 取得は [src/lib/tiktok-profile.ts](../src/lib/tiktok-profile.ts)。`api-live/user/room/` を叩く。
  署名も Cookie も要らず、**配信していなくても返る**。`redirect: "error"` で想定外の遷移を追わず、
  レスポンスの `uniqueId` を要求したハンドルと突き合わせる。URL は https と TikTok の画像 CDN に限定する
- キャッシュは [src/lib/tiktok-avatar.ts](../src/lib/tiktok-avatar.ts)。成功6時間 / 不在6時間 /
  レート制限15分 / 一時失敗5分。同一ハンドルへの同時要求は1本にまとめ、外向きの同時実行は4本まで。
  連続8回失敗したら5分止める。`TIKTOK_AVATAR_DISABLED=1` で全面停止できる
- 引けなかった場合も 404 ではなく**プレースホルダ画像（200）**を返すので、表示側に
  読み込み失敗のフォールバックが要らない
- 参加者IDからハンドルへの解決は `findPublicParticipantTiktokId()` を通し、
  公開してよいイベントに属するものだけに絞る（PRIVATE(オーナー以外) の出場者を引き当てさせない）

### バトル倍率は参加者ごと

`EventMultiplier(kind="BATTLE")` は、**その参加者が実際にバトルしていた区間にだけ**かかる。
イベント全体で1本の区間リストにすると、1人がバトル中というだけで同時刻の他の参加者にも
倍率がかかってしまうため、バトル区間を持つ参加者だけ個別に集計する
（`aggregate.ts` の `perRoomRooms`）。BATTLE 倍率を設定していなければこの分割は行わない。

## デスマッチ

ライフポイント制。**対戦の検知と勝敗の決め方はバトルトーナメントと完全に共通**で、違うのは
進行の形だけ。トーナメントは表があって敗者が即脱落するが、デスマッチは表がなく、
主催者が対戦カードを随時追加する。負けるとライフが減り、0 になった時点で脱落する。

ルールは `Event.rules` の `deathmatch` に置く。対戦管理から変更できる。

| 項目 | 既定 | 内容 |
| --- | --- | --- |
| `initialLife` | 3 | 開始時のライフ |
| `lossDelta` | 1 | 敗北で減る量 |
| `winDelta` | 0 | 勝利で増える量。0 なら回復なし |
| `drawDelta` | 0 | 引き分けで減る量 |
| `maxLife` | null | 回復の上限。null なら `initialLife` |

**未設定でも既定値でそのまま動く。** 不正な値は既定へ落とし、集計は止めない。

### 計算の規則

- 全員 `initialLife` から始める
- 対戦の決着時刻（`detectedEndAt` があればそれ、なければ `scheduledEndAt`）の昇順に適用する
- ライフが 0 になったら脱落。**脱落した出場者が1人でも含まれる対戦は、丸ごと無視する**
  （脱落した側だけ飛ばすと相手には勝利が入り、回復ありの設定で不公平になる）
- ライフは 0 未満にも上限超にもならない
- 不戦勝（`winnerDecidedBy = "BYE"`）はライフを動かさない。対戦が行われていないため

**全期間再計算する。** マッチの勝敗は主催者が後から変えられるし VOID にもできるので、
増分では直せない。`EventLifePoint` と `EventLifeLedger` は毎回まるごと入れ替える。
ライフ設定の変更も過去に遡って効く（対戦管理の変更フォームで警告を出している）。

### 対戦カードを組む

`POST /api/events/<id>/matches/single` で1件ずつ追加する（トーナメントの一括生成とは別）。
サイドは `{ teamId, participantIds }` で指定する。**チーム戦でも「実際にバトルへ出る
メンバー」を選ぶ** — チーム全員をサイドに入れると、検知（サイドの room 集合とバトルの
room 集合の一致）が成立しなくなるため。`matchType`（1V1 / 2V2）は出場人数から決まる。

組む時点で次を弾く。

- 同じ出場者を両サイドに入れる
- 脱落した出場者を入れる
- 指定チームに所属していない参加者を入れる
- **同じ出場者の対戦枠が重なる** — 重なると検知したバトルをどちらに割り当てるか決まらない
  （`assignBattles` は候補が複数あるものを割り当てない）
- **開催日程の外**（日程の隙間、または日程をまたぐ枠）。またぐ枠を許すと、日程の外の
  ギフトで勝敗が決まってしまう

まだ検知していない（SCHEDULED）対戦は `DELETE` で取り消せる。検知・確定した後は
無効化（VOID）で対応する。

時間枠の変更（`PATCH ... { action: "schedule" }`）は **SCHEDULED / NO_SHOW のときだけ**。
確定後に枠を動かすとライフの適用順が変わって過去の結果まで変わるため、409 で拒否する。
動かしたいときは先に「検知をやり直す」で SCHEDULED へ戻す。

### 結果を変えたら再集計させる

集計ワーカーは締切後の最終集計が済んだイベント（`finalizedAt` あり）を飛ばす。
対戦の追加・削除・承認・確定・引き分け・VOID・検知やり直し・時間枠変更・ライフ設定の
変更では、`finalizedAt` を同じトランザクションで `null` に戻して再集計させている
（`src/event/reopen-aggregation.ts`）。

### 引き分け

同点は自動で決めず、主催者が「引き分けにする」で確定する（`winnerDecidedBy = "DRAW"`）。
デスマッチだけで使える — トーナメントは勝者が出ないと次へ進めないため。

主催者が決めた結果（`MANUAL` / `DRAW` / `BYE`）は**自動集計で上書きしない**
（`match-detect.ts` の `MANUAL_DECISIONS`）。

### 順位

デスマッチの順位は**残ライフ → 遅く脱落した順 → 獲得ダイヤ**で決まる。
`EventStanding.rank`（獲得ダイヤの順位）とは別物なので混ぜない。公開ページは
デスマッチのとき順位表をライフ表示に差し替える。

## 競技データとしての限界

`gifts` は分析用の記録として作られており、賞金や公式順位の唯一の根拠に耐える設計ではない。

- analytics 側の DB 保存エラーは握りつぶされる（再試行も outbox もない）。
  ログには残り、`msgId` が取れていれば TikTok の再送で拾い直せる余地はあるが、保証はない
- **`msgId` が取れないギフトは重複判定なしで保存される。** `msgId` があれば
  「プロセス内 FIFO」＋「直近5分の `(roomId, msgId)` 照会」の2層で弾く
- リスナー識別子は `uniqueId`（TikTok ハンドル）のみ。ハンドル変更で同一人物が別人になる
- 接続断中のギフトは記録されない

**combo（連打）の個数は取り込み側で整合が取れている。** `Gift.repeatCount` に入るのは
累計ではなく前回からの増分で、その増分は DB の確定値（`(roomId, groupId)` の
`SUM(repeatCount)`）から advisory lock 下で計算する。プロセスのメモリに前回値を持たないので、
デプロイ中に新旧 Worker が並走しても、再送でも、逆順到着でも、保存後の合計は
`max(保存済み, 受信した累計)` に収束する。ただし `groupId` が欠落した combo
（実測では giftType=1 の全行が実 `groupId` を持ち発生していない）はプロセス内の前回値で
追うため、この保証の外にある。

全期間再集計をしても取り込み時点の欠落は修復できないため、主催者が
`EventScoreAdjustment` で補正できるようにしてある。公開ページにも但し書きを出す。

## 集計ワーカーの環境変数

`event-worker` サービスに必須なのは `DATABASE_URL` だけ。以下は省略可（既定値は `.env.example` 参照）。

- `AGGREGATE_INTERVAL_MS` — 再集計の間隔。既定 10000
- `LEASE_RENEW_INTERVAL_MS` — 監視期限の延長を確認する間隔。既定 3600000

デプロイ構成は「データベースの構成 → デプロイ」を参照。
