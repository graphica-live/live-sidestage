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

## バトル検知（フェーズ4）

規則の全体像は [README.md](README.md) の「バトルトーナメント」にある。ここには壊しやすい箇所だけ書く。

### 照合を uniqueId ベースに変えない

バトルの payload に**相手の TikTok ハンドルは入っていない**。`anchorInfo` の値型
`WebcastLinkMicBattle_BattleUserInfo` の `user` は `BattleBaseUserInfo = { userId, nickName,
avatarThumb, displayId }` で `uniqueId` フィールドが存在せず、`simplifyObject()` が呼ぶ
`getUserAttributes()` は `webcastUser.uniqueId` を読むので `battleUsers[].uniqueId` は**常に
undefined になる**。

照合は `battleId` でグループ化した roomId の集合で行う（`src/lib/match-detect.ts`）。
`hostDisplayIds` に入る `displayId` はハンドル相当と思われるが**実 payload で未検証**なので、
照合の根拠にはしていない。検証できたら 2vs2 のサイド構成の裏取りに使える。

### 自動確定の条件を緩めない

`assignBattles` が `autoConfirm: true` を返すのは **1vs1 の完全一致だけ**。緩めると誤検知が
そのまま勝敗になる。

- partial は「A が部外者と戦った」場合も観測が `{A}` になり、唯一の候補として通ってしまう
- 2vs2 の完全一致は `[A,B]対[C,D]` と `[A,C]対[B,D]` を room の和集合では区別できない

自動確定しないものは `NEEDS_REVIEW` で止まり、主催者が承認する。**一度承認したマッチを
再検知で承認待ちへ戻さないこと**（`battles.ts` の `alreadyApproved`）。

### 時間枠は半開区間

`[scheduledStartAt, scheduledEndAt)`。終端ちょうどに始まったバトルが前後2つの枠の候補に
なるのを防ぐ。イベント期間の扱い（`[startAt, endAt)`）と揃えている。

### バトル倍率は参加者ごとに区間を作る

**`buildRateSegments` の `battleRanges` をイベント全体で1本にしない。** 1人がバトル中という
だけで同時刻の他の参加者にまで BATTLE 倍率がかかる。`aggregate.ts` はバトル区間を持つ
参加者だけを個別に回し（`perRoomRooms`）、残りはまとめて1本で集約する。
BATTLE 倍率が設定されていなければ分割自体をしない（クエリ数を増やさないため）。

### ブラケットの進行は毎回作り直す

`match-results.ts` は確定した勝者から下流を**再構築**する（増分で送らない）。主催者が勝者を
変えたり VOID にしたりしても、下流に古い勝者が残らないようにするため。ただし下流が
すでに始まっている（LIVE / DETECTED / NEEDS_REVIEW / FINISHED）場合は書き換えず、
API 側も 409 で拒否する。

### analytics 側の観測記録

`TiktokBattle`（`@@map("tiktok_battles")`）に room ごとの行として入る。

- **`raw` は `{ battle: <linkMicBattle>, armies: <linkMicArmies> }` の2キー**。実 payload の
  fixture を取るとき両方のイベント形が1レコードから読めるようにしてある。1件 64KB で打ち切る
- 同じ (roomId, battleId) の書き込みは `queueBattleWrite` で**直列化**する。
  イベントが何度も届き、それぞれが read-modify-write になるため
- `mergeBattleState` は**情報が増える方向にしか動かさない**。確定した開始時刻を推定値で
  上書きしない、終了を観測した後に OPEN が遅れて届いても action を巻き戻さない
- 成立していない招待（INVITE / REJECT / CANCEL）は保存しない
- payload を取り出す口は `GET /api/debug/battle-payloads?token=<GIFT_LOG_TOKEN>`。
  **実配信のバトルでしか実 payload は得られない。** 取れたら
  `src/lib/tiktok-battle.test.ts` の合成 payload を差し替える

## デスマッチ（フェーズ5）

規則は [README.md](README.md) の「デスマッチ」にある。ここには壊しやすい箇所だけ書く。

### 対戦の検知はトーナメントと共通

`battles.ts`（取り込みと照合）と `match-results.ts`（勝敗確定）は種目を見ていない。
デスマッチ固有なのは**ライフの計算**（`deathmatch.ts` / `life-points.ts`）と
**対戦カードの組み方**（`single-match.ts`）だけ。

ブラケットの進行（`match-results.ts` の後半）はデスマッチでは自動的に何もしない —
全マッチが `round = 1` なので `nextSlot()` が null を返す。

### 主催者が決めた結果を自動集計で上書きしない

`MANUAL_DECISIONS`（`match-detect.ts`）= `MANUAL` / `DRAW` / `BYE`。
`battles.ts` の再検知と `match-results.ts` の勝敗確定の両方でこれを見る。
**片方だけ直すと、主催者が確定した引き分けが次の集計で勝敗に化ける。**

### 結果を変える操作は `reopenAggregation()` を同じトランザクションで呼ぶ

集計ワーカーは `finalizedAt` が立ったイベントを飛ばす。**確定後に勝敗を覆したり
対戦を足したりしても、これを消さないと順位・ライフに反映されない。**
`src/lib/reopen-aggregation.ts` を、対戦の追加・削除・承認・確定・引き分け・VOID・
検知やり直し・時間枠変更・ライフ設定の変更・トーナメント表の作り直しで呼んでいる。
新しく結果を変える操作を足すときは、同じトランザクションから必ず呼ぶこと。

### ライフは全期間再計算

`EventLifePoint` と `EventLifeLedger` は毎回まるごと入れ替える。増分にすると、
勝敗の変更・VOID・ルール変更を遡って反映できない。

- 決着時刻は `detectedEndAt ?? scheduledEndAt`。**`updatedAt` を使わない**
  （再集計のたびに動いて適用順が不安定になる）
- 同時刻の決着は `matchId` で並べて安定させる
- 0 になった時点で脱落。それ以降のイベントは適用しない。**この判定は適用順に依存する**ので、
  並び順の規則を変えるときは慎重に
- **脱落者が1人でも含まれる対戦は、丸ごと無視する。** 脱落した側だけ飛ばすと相手には
  WIN が入り、回復ありの設定では「脱落者と組まれた側だけが得をする」ことになる
- 参加者が0人になったら `aggregate.ts` の早期 return でライフも消す。
  残すと脱落表示が残り、対戦を組む導線が塞がれ続ける

### 確定した対戦の時間枠は動かせない

ライフは決着時刻（`detectedEndAt ?? scheduledEndAt`）の順に適用するので、確定後に枠を
動かすと過去の対戦順が変わり、脱落の結果まで変わる。`schedule` 操作は SCHEDULED /
NO_SHOW のときだけ受け付け、それ以外は 409 で拒否する（UI 側でもボタンを出さない）。
動かしたい場合は先に「検知をやり直す」で SCHEDULED へ戻す。

### 対戦枠を重ねさせない

`single-match.ts` の `assertMatchWindow()`。同じ出場者の枠が重なると、検知したバトルを
どちらの対戦に割り当てるべきか決められない（`assignBattles` は候補が複数あるものを
割り当てないので、どちらも検知されないまま NO_SHOW になる）。組む時点と枠を動かす時点の
両方で止める。**検証は書き込みと同じトランザクション内で行う** — 外に出すと、同じ枠を
2つの操作が同時に組んだときにどちらも「重なっていない」と判定して通ってしまう。

### チーム戦でもサイドに入れるのは「出場するメンバー」だけ

検知はサイドの room 集合とバトルの room 集合の一致で行う。チーム全員をサイドに入れると

- 3人以上のチームは永久に `exact` にならない
- メンバー0人のチームはサイドの room が空になり、そもそも検知されない
- `matchType` がチーム数（常に1）由来になり 1V1 / 2V2 を区別できない

`createSingleMatch` はサイドを `{ teamId, participantIds }` で受け、参加者がその
チームに所属しているかを検証する。`matchType` は**出場人数**から決める。

トーナメント（`tournament.ts`）は表の生成時点で全ラウンドのサイドを作るため、
いまもチーム全員をサイドに入れている。2人チームどうしなら `exact` になるが
`isOneOnOne` が false なので自動確定はされず `NEEDS_REVIEW` で止まる（安全側）。
3人以上のチームは常に `NEEDS_REVIEW`。メンバー0人のチームは表に入れられない
（`createBracket` が弾く）。ラウンドごとに出場メンバーを選ばせるなら別途設計が要る。

## 未実装（計画上のフェーズ）

現在はフェーズ5まで。

| フェーズ | 内容 |
| --- | --- |
| 1 ✅ | プロジェクト雛形、共有 User 認証、イベント CRUD、公開ページの器、CI |
| 2 ✅ | 参加者登録 + room lease（analytics 側の `monitorUntil` / 内部API / `getMyRooms()` 変更を含む） |
| 3 ✅ | 獲得ダイヤレース（集計ワーカー、チーム管理、公開ランキング、SLO の実測） |
| 4 ✅ | バトルトーナメント（battle 検知 → マッチ照合 → 勝敗確定 → トーナメント表）※実 payload での検証は未 |
| 5 ✅ | デスマッチ（ライフポイント、対戦カードの個別追加、引き分け） |
| 6 | 都道府県UI（日本地図） |

`EventScoreAdjustment`（主催者による手動補正）はモデルだけあって未使用 —
集計に効かせるコードと管理UIは同時に入れること。

公開ページの順位表は `STANDING_HEADINGS` で種目ごとに見出しを変えている
（デスマッチは集計が回っていれば「ライフ」表示に差し替わる）。`FORMAT_PENDING_NOTES` は
フェーズ4・5で中身が空になった。新しい未実装の種目を足すときに使う。
