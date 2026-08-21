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
2. `sql/drop-event-integration.sql` を superuser で適用して view を落とす

**順序を逆にしない。** 先に view を落とすと、旧版が動いている間だけ集計が失敗する。
view を残したままでも新しいコードは動くので、慌てて流す必要はない。

`event` スキーマ自体と中のテーブルはそのまま使う（データ移行は不要）。所有者が
`event_migrator` になっている場合は、analytics の接続ロールが `db push` できるよう
所有権を移すこと。

### デプロイ

Railway で3サービスに分ける。**同じイメージ・同じ Root Directory（`live-sidestage-analytics`）で、
start command と環境変数だけを変える。**

| サービス | start command | 役割 |
| --- | --- | --- |
| web | `npm start` | Next.js + socket.io。イベントの画面と API もここ |
| worker | `npm run worker` | TikTok Webcast 接続の維持（`WORKER_INDEX` / `WORKER_COUNT` が要る） |
| event-worker | `npm run event-worker` | イベント集計。10秒ごとに再集計 |

スキーマ変更は web の build（`npm run build`）に含まれる `prisma db push --accept-data-loss` が行う。

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

## 集計とランキング

集計ワーカー（`npm run event-worker`）が10秒ごとに開催中のイベントを再集計する。増分ではなく
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
- イベント期間の外

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

- analytics 側の DB 保存エラーは握りつぶされる（再試行も outbox もない）
- `orderId` / `groupId` が両方欠落したギフトは重複判定なしで保存される
- リスナー識別子は `uniqueId`（TikTok ハンドル）のみ。ハンドル変更で同一人物が別人になる
- 接続断中のギフトは記録されない

全期間再集計をしても取り込み時点の欠落・重複は修復できないため、主催者が
`EventScoreAdjustment` で補正できるようにしてある。公開ページにも但し書きを出す。

## 集計ワーカーの環境変数

`event-worker` サービスに必須なのは `DATABASE_URL` だけ。以下は省略可（既定値は `.env.example` 参照）。

- `AGGREGATE_INTERVAL_MS` — 再集計の間隔。既定 10000
- `LEASE_RENEW_INTERVAL_MS` — 監視期限の延長を確認する間隔。既定 3600000

デプロイ構成は「データベースの構成 → デプロイ」を参照。
