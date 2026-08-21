# CLAUDE.md — live-sidestage-event

セットアップ・コマンド・デプロイ順序は [README.md](README.md) にある。ここには、コードを読むだけでは
気づけない制約と、壊しやすい箇所だけを書く。

## 絶対に守ること

### 1. `prisma/schema.prisma` の `schemas` に `public` を足さない

Prisma 5.x には「外部管理テーブル」を除外する手段がない。`public` を `schemas` に含めると、
schema.prisma に書いていない `gifts` / `TiktokRoom` / `Streamer` / `gift_edits` / `AppSetting` が
`db push` の削除差分になる。analytics の本番デプロイは `prisma db push --accept-data-loss` なので、
警告が出ないまま消える。

NextAuth の `User` / `Account` も Prisma で持たない。analytics の `User` には標準の NextAuth 定義に
ない `password` と `createdAt` があり、標準定義をコピーした時点で破壊差分になる。
共有テーブルへのアクセスは `src/lib/auth-adapter.ts` の `$queryRaw` で行う。

### 2. `public` を触るのは `analytics-db.ts` と `auth-adapter.ts` だけ

Prisma の multiSchema は raw SQL を自動修飾しない。`public."TiktokRoom"` のように完全修飾し、
大文字小文字も正確に書く。値は必ずタグ付きテンプレートでパラメータ化する
（`$queryRawUnsafe` とテーブル名の動的補間は使わない）。

### 3. 日時のパースに `new Date("2026-09-01T20:00")` を使わない

サーバーのタイムゾーンに依存する。Railway のコンテナは UTC なので9時間ずれる。
`<input type="datetime-local">` の値は必ず `src/lib/datetime.ts` の `parseJstLocal()` を通す。

### 4. `normalizeTiktokId` を analytics とずらさない

analytics 側は `live-sidestage-analytics/src/lib/tiktok-room.ts` の
`raw.trim().replace(/^@/, "").toLowerCase()`（先頭の `@` は**1個だけ**除去）。
ここがずれると同じ配信者が別 room 扱いになり、ギフトが分裂する。

### 5. analytics 側の列を変えたら view も直す

`live-sidestage-analytics/sql/event-integration.sql` が event 向けの view を定義している。
analytics の `prisma/schema.prisma` で列を変えたら、このファイルも追随させること。
view が古いままだと event 側は実行時に初めて壊れる。

### 6. 内部API の secret を使い回さない

analytics の `/api/internal/event-room-lease` は `EVENT_INTERNAL_API_SECRET` で保護する。
analytics の `INTERNAL_API_SECRET` を使い回すと、event から `/api/internal/gift-event` も叩けてしまい、
任意の chatEvent / overlay 更新を注入できる。

### 7. room の監視要求を解除するときは、他のイベントが使っていないか必ず確認する

analytics 側の `TiktokRoom.monitorUntil` は room につき**1本しかない**。同じ配信者が複数の
イベントに出ている状態で片方から解除すると、もう片方の監視まで止まる。
解除は必ず `src/lib/participants.ts` の `releaseIfUnused()` を通すこと
(未解放の `EventRoomLease` が他イベントに残っていれば解除しない)。

期限は analytics 側が `max(既存, 要求)` で更新するので、**確保するときは**他イベントの
期間を縮める心配はいらない。

## 集計の規則（実装時に迷ったらここ）

- 期間は `[startAt, endAt)` の半開区間、`receivedAt` 基準、Asia/Tokyo
- 公式スコアは元の `gifts` のみ。`gift_edits` は無視する
- ポイント = ダイヤ実数 × 倍率。**1件のギフトに適用される倍率は必ず1つ**。
  BATTLE 区間に入るなら BATTLE、入らなければ SOLO_STREAM。合計も乗算もしない。
  同じ kind が複数該当したら最も大きい factor を1つだけ採る
- ダイヤ合計は `BigInt`（`Int` だと 21億を超えうる）。**ポイントは 100倍した `bigint`**
  として計算し、保存直前に `formatScaledPoints()` で Decimal 文字列にする
  （`number` で掛けると大きなダイヤ値で精度が落ちる）
- `giftCount` は**レコード数ではなく `repeatCount` の合計**。analytics 側の
  `gift-analytics.ts` と定義を揃えている（連打がまとまって1レコードになるため）
- TikTok 側の `battleId` / `hostScore` / `startTimeMs` は API 上すべて `string`。
  `battleId` と `hostScore` は文字列のまま保存する

### 全期間再集計なので、編成の変更は過去に遡る

参加者・チーム所属は「現在の状態」で全期間を計算し直す。したがって開催中に

- 参加者を追加すると、**登録前のギフトも算入される**
- 参加者を外すと、その参加者ぶんは順位から消える
- 所属チームを変えると、過去のギフトも新しいチームに入る

これは仕様（登録し忘れの救済と不正参加者の除外を優先している）。参加者ページの
開催中の警告でその旨を出している。履歴を持たせて凍結したくなったら、
`EventParticipant` に有効期間を足す設計変更が要る。

### 順位表とスナップショット

- `EventStanding` は**ギフトが1件もない参加者・チームも0点で載せる**。
  参加者一覧・チーム一覧そのものから作ること（集計結果の Map から作ると0点が消える）
- `EventContribution` は scope ごとに `MAX_CONTRIBUTION_ROWS`(200) 件で打ち切る。
  順位表の合計は**切り捨て前の全ギフト**から計算しているので、合計や順位には影響しない
- スナップショットの入れ替えは delete → createMany を同一トランザクションで行う
  （読み手が中間状態を見ないように）

## 集計ワーカー

- 全期間再集計。増分カーソルは持たない（バトル区間が後から確定するため）
- **advisory lock は `pg_try_advisory_xact_lock` を interactive transaction 内で取る。**
  セッション単位の `pg_try_advisory_lock` は使わない — Prisma のコネクションプールでは
  取得と解放が別の接続になりうる。読み取りから書き込みまで同じトランザクションで完結させること
- `setInterval` には in-flight guard を持つ。analytics の `worker.ts` には guard がないので踏襲しない
- `Event.aggregateMs` を記録し、SLO（1イベント10秒以内）の 50% を超えたら増分 rollup へ移行する
- 監視期限の延長（`renewClampedLeases`）も同じワーカーが1時間ごとに回す。
  **worker サービスにも `ANALYTICS_INTERNAL_URL` と `EVENT_INTERNAL_API_SECRET` が要る**

### 集計対象の決め方と最終集計

対象は `status ∈ {RUNNING, FINISHED}` かつ `startAt <= now` かつ `finalizedAt IS NULL`。

**終了判定に status を使わない。** 主催者は開催中いつでも FINISHED にできるので、それを
打ち切り条件にすると直前のギフトや遅れて保存されたギフトが永久に反映されない。
代わりに締切（`endAt` + `AGGREGATE_GRACE_MS`）を過ぎてからの集計を「最終集計」とし、
成功したら `Event.finalizedAt` を立てて以後スキップする。

`endAt` を後ろへ動かしたら `finalizedAt` を `null` に戻すこと（イベント更新APIでやっている）。
戻し忘れると延長分が二度と集計されない。

### 実測値（ローカル docker Postgres、`npm run bench:aggregate:local`）

| 規模 | 集計クエリ単体 | 1イベントの再集計 |
| --- | --- | --- |
| ギフト10万 / 参加者20 / リスナー500 | 112ms | 0.94秒（倍率3区間で 1.01秒） |
| ギフト50万 / 参加者50 / リスナー3000 | 914ms | 3.4秒（倍率3区間で 3.9秒） |

SLO（10秒）には収まっているが、50万件規模で警告閾値（5秒）に近い。
同時に開催中のイベントが増えると1周が伸びるので、`aggregateMs` の警告が出たら増分 rollup を検討する。

## テストの作法

analytics に揃える。

- `*.test.ts` = unit（DB不要）、`*.integration.test.ts` = ローカル Postgres 必須
- テスト名は日本語
- integration は `itest_` プレフィックスでデータを分離し、カスケード削除で後片付けする
- ロジックは純粋関数に切り出して unit でカバーする（`scoring` / `match-detect` / `bracket` / `deathmatch`）

## 未実装（計画上のフェーズ）

現在はフェーズ3まで。

| フェーズ | 内容 |
| --- | --- |
| 1 ✅ | プロジェクト雛形、共有 User 認証、イベント CRUD、公開ページの器、CI |
| 2 ✅ | 参加者登録 + room lease（analytics 側の `monitorUntil` / 内部API / `getMyRooms()` 変更を含む） |
| 3 ✅ | 獲得ダイヤレース（集計ワーカー、チーム管理、公開ランキング、SLO の実測） |
| 4 | バトルトーナメント（実 payload の fixture 取得 → battle 検知 → マッチ照合） |
| 5 | デスマッチ（ライフポイントエンジン） |
| 6 | 都道府県UI（日本地図） |

`prisma/schema.prisma` にはフェーズ5までのモデルが入っているが、使っているのはフェーズ3の範囲だけ。
`EventScoreAdjustment`（主催者による手動補正）はモデルだけあって未使用 —
集計に効かせるコードと管理UIは同時に入れること。

### フェーズ4で気をつけること

**`buildRateSegments` の `battleRanges` をイベント全体で1本にしない。** バトルは配信者ごとに
起きるので、1人がバトル中というだけで同時刻の他の参加者にまで BATTLE 倍率がかかってしまう。
参加者(room)ごとに `buildRateSegments` を呼び直し、区間集約もその参加者の roomId だけを
対象にすること。区間数 × 参加者数のクエリになるので、性能は再測定が要る。

公開ページの順位表は `STANDING_HEADINGS` で種目ごとに見出しを変えている。トーナメントの
勝敗が出せるようになったら、そこと `FORMAT_PENDING_NOTES` を更新する。
