# CLAUDE.md — イベント機能（LIVE Sidestage Event）

`src/event/` はイベント（大会）運営機能の中核。画面は `src/app/(dashboard)/events/`、
公開ページは `src/app/(public)/e/`、API は `src/app/api/events/` と `src/app/api/public/`、
集計ワーカーは `event-worker.ts`。

仕様の全体像・セットアップ・デプロイ順序は [docs/EVENT.md](../../docs/EVENT.md) にある。
ここには、コードを読むだけでは気づけない制約と、壊しやすい箇所だけを書く。

> **経緯**: この機能はもともと `live-sidestage-event/` という別プロジェクト・別DBロールで、
> analytics のデータを view 経由で読む構成だった。同じ Postgres・同じ認証・同じユーザーを
> 共有していて分離の実体がなく、`public` を Prisma の管理下に置けないという制約が
> 恒久的な事故要因（`db push --accept-data-loss` の削除差分）になっていたため、
> analytics へ統合した。プロセス分離（TikTok接続 / Web / 集計）は Railway のサービス分割で行う。

## 絶対に守ること

### 1. `public` を触るのは `analytics-db.ts` だけ

イベント機能から `gifts` / `TiktokRoom` / `Streamer` / `tiktok_battles` を読むのは
`src/event/analytics-db.ts` に集約する。Prisma の multiSchema は raw SQL を自動修飾しないので、
`public."TiktokRoom"` のように完全修飾し、大文字小文字も正確に書く。値は必ずタグ付き
テンプレートでパラメータ化する（`$queryRawUnsafe` とテーブル名の動的補間は使わない）。

**列は必ず明示して SELECT する。`SELECT *` を書かない。** 統合前は列を絞った view と GRANT で
これを構造的に強制していたが、今は規約でしか守られていない。`Streamer` の
`apiKey` / `verificationCode` / `overlayToken`、`User.password`、`Account` の
access/refresh token は、イベント機能には一切必要ない。

`TiktokRoom` への**書き込み**は `src/lib/tiktok-room.ts` の
`ensureRoomForEvent()` / `releaseRoomMonitor()` だけを通す（後述の 5 を参照）。

### 2. `prisma/schema.prisma` は public と event の両方を1ファイルで管理する

`schemas = ["public", "event"]`。**analytics のモデルを消したり `@@schema` を外したりしない。**
本番デプロイは `prisma db push --accept-data-loss` なので、schema.prisma に書かれていない
テーブルは警告なしで削除される。

### 3. 日時のパースに `new Date("2026-09-01T20:00")` を使わない

サーバーのタイムゾーンに依存する。Railway のコンテナは UTC なので9時間ずれる。
`<input type="datetime-local">` の値は必ず `src/event/datetime.ts` の `parseJstLocal()` を通す。

### 4. `normalizeTiktokId` は `src/lib/tiktok-room.ts` のものを使う

`raw.trim().replace(/^@/, "").toLowerCase()`（先頭の `@` は**1個だけ**除去）。
`src/event/validation.ts` にも同名の関数があるが、これは入力検証つきの薄いラッパで、
正規化そのものは analytics 側の定義に従っている。ここがずれると同じ配信者が別 room 扱いになり、
ギフトが分裂する。

### 5. room の監視要求を解除するときは、他のイベントが使っていないか必ず確認する

`TiktokRoom.monitorUntil` は room につき**1本しかない**。同じ配信者が複数の
イベントに出ている状態で片方から解除すると、もう片方の監視まで止まる。
解除は必ず `src/event/participants.ts` の `releaseIfUnused()` を通すこと
(未解放の `EventRoomLease` が他イベントに残っていれば解除しない)。

期限は `ensureRoomForEvent()` が `max(既存, 要求)` で更新するので、**確保するときは**
他イベントの期間を縮める心配はいらない。

### 6. `ensureRoomForEvent()` の上限と検証を外さない

統合前は内部API（`/api/internal/event-room-lease`）がこの検証を持っていた。API を消した
代わりに関数側へ移してある。**主催者の入力がそのまま届く経路であることは変わらない**ので、
上限を外すと監視対象が無制限に増える。

- `tiktokId` の形式検証（`^[a-z0-9._]{1,64}$`）
- 監視期限は最大 120 日（`MAX_LEASE_DAYS`、`src/lib/room-lease.ts`）
- 監視中 room の総数上限 500（`MAX_ACTIVE_LEASES`）。TikTok 接続はプロキシと Euler 署名の枠を消費する

### 7. 期間を読むときは必ず `resolveEventWindows()` を通す

1イベントは複数の開催日程（`EventSession`）を持つ。**期間の正本は `EventSession` で、
`Event.startAt` / `endAt` は全日程を覆う外枠（min/max の派生値）**。

`event.startAt` / `event.endAt` を直接ギフトの抽出範囲に使わないこと。日程の隙間
（1日目の終了〜2日目の開始）のギフトまで集計に入る。読むのは `src/event/sessions.ts` の
`resolveEventWindows(event)` 一本にする。**日程を1件も持たないイベント（この機能より前に
作られたもの）が本番に残っている** — バックフィルしていないので、外枠を1日程とみなす
フォールバックがそこにある。

外枠を使ってよいのは「イベント全体がいつ始まっていつ終わるか」だけ:
集計対象の判定（`aggregationWindow` の `startAt <= now`）、締切（`aggregationDeadline(endAt)`）、
`finalizedAt`、room の監視期限（`computeLeaseWindow(endAt)`）、一覧の並び。
日程の隙間でも監視と集計ワーカーは動き続ける（隙間のギフトが結果に入らないだけ）。

日程を書き換える操作（イベント更新 API）と対戦を組む操作は、**同じ advisory lock を
トランザクションの先頭で取る**（`acquireEventLock`）。順序を崩すと、古い日程で通した
対戦枠が新しい日程の外へ取り残される。

## 集計の規則（実装時に迷ったらここ）

- 期間は開催日程ごとの `[start, end)` の半開区間、`receivedAt` 基準、Asia/Tokyo。
  **日程どうしの隙間は集計しない**。日程は重ならないので、境界のギフトも二重に数えない
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
- `topParticipantId` / `participantCount`（リスナーの支援先）は **scope=EVENT の行にだけ**入れる。
  判定は `top-participant.ts` の `resolveListenerAttribution()` で、**打ち切り前の
  `byParticipant` 全量**から出す（打ち切り後だと参加者側の上位200位に入らない分を拾えない）。
  基準は常にポイント（公開ページを実弾順に並べ替えても支援先は動かさない）。
  FK は張らない（`EventStanding.subjectId` と同じ扱い）ので、読み側は名前を解決できなければ
  表示しないこと
- スナップショットの入れ替えは delete → createMany を同一トランザクションで行う
  （読み手が中間状態を見ないように）

## 集計ワーカー

- 全期間再集計。増分カーソルは持たない（バトル区間が後から確定するため）
- **advisory lock は `pg_try_advisory_xact_lock` を interactive transaction 内で取る。**
  セッション単位の `pg_try_advisory_lock` は使わない — Prisma のコネクションプールでは
  取得と解放が別の接続になりうる。読み取りから書き込みまで同じトランザクションで完結させること
- `setInterval` には in-flight guard を持つ。TikTok 接続の `worker.ts` には guard がないので踏襲しない
- `Event.aggregateMs` を記録し、SLO（1イベント10秒以内）の 50% を超えたら増分 rollup へ移行する
- 監視期限の延長（`renewClampedLeases`）も同じワーカーが1時間ごとに回す
- **`event-worker.ts` は `worker.ts` とは別プロセス・別 Railway サービスにする。**
  集計が詰まったときに Webcast の WebSocket を巻き込まないため

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

規則の全体像は [docs/EVENT.md](../../docs/EVENT.md) の「バトルトーナメント」にある。ここには壊しやすい箇所だけ書く。

### 照合を uniqueId ベースに変えない

バトルの payload に**相手の TikTok ハンドルは入っていない**。`anchorInfo` の値型
`WebcastLinkMicBattle_BattleUserInfo` の `user` は `BattleBaseUserInfo = { userId, nickName,
avatarThumb, displayId }` で `uniqueId` フィールドが存在せず、`simplifyObject()` が呼ぶ
`getUserAttributes()` は `webcastUser.uniqueId` を読むので `battleUsers[].uniqueId` は**常に
undefined になる**。

照合は `battleId` でグループ化した roomId の集合で行う（`src/event/match-detect.ts`）。
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
なるのを防ぐ。開催日程の扱い（`[start, end)`）と揃えている。

### 検知したバトルは日程で切ってから集計する

観測したバトルは日程の終わりをまたぐことがある（22:59 開始 → 23:04 終了）。
`match-results.ts` は `intersectWindows()` で `[detectedStartAt, detectedEndAt)` を日程で切り、
交差した区間のギフトだけで勝敗とライフを決める。**切らずに使わないこと** — 日程の外の
ギフトが勝敗に効き、順位表（日程内だけ）と食い違う。

バトルの取り込み（`ingestBattles`）は日程を前後 `BATTLE_INGEST_GRACE_MS` 広げてつないだ
区間ごとに引く。外枠1本で引くと、日程が疎に散っているイベント（90日に週1など）で
隙間のバトルまで毎回取り込むことになる。

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

**不戦勝行（`EventMatch.rules.bye === true`）はこの STARTED_STATUSES ブロックの対象外にする。**
段階的不戦勝方式（`buildStagedBracket()`、`src/event/bracket.ts`）では相手が実試合の勝者
（WINNER_OF）である「動的な不戦勝行」が生成時点では未確定（両サイド空）のまま作られる。
`match-results.ts` の進行処理が、片側に参加者が転送された時点で `FINISHED + winnerDecidedBy:
"BYE"` へ自動確定する。この行は検知対象にならない（空側があると `assignBattles` が候補から
外す）ので LIVE/DETECTED/NEEDS_REVIEW には絶対にならず、STARTED_STATUSES ブロックを外しても
安全 — むしろ外さないと、上流の勝者が変わった（VOID・手動上書き等）ときにこの行が古い勝者の
まま固まってしまう。不戦勝行への `confirm`/`draw`/`void`/`reopen` は `[matchId]/route.ts` が
拒否する（対戦が起きていないので結果操作に意味がなく、`reopen` すると検知対象化して部外者との
バトルを誤って拾うリスクがある）。`downstreamStarted()` も不戦勝行を透過してさらに下流を見る。

**`buildStagedBracket()` が「不戦勝行」と印を付けてよいのは、`nextSlot()` の機械的な座標
（`floor(position/2)`）で見て、相手側に構造的に誰も来ないことが保証されている場合だけ。**
このpositionの座標と実際の転送内容の整合性が崩れると、無関係な2人の実試合を丸ごと不戦勝処理
してしまうデータ破損バグになる（実データで一度発生し、修正済み）。ブラケット生成のロジックを
触るときは `src/event/bracket.test.ts` の「座標の整合性」テストを必ず通すこと。

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

### 公開トーナメント表の幾何を壊さない

`BracketTree.tsx` は決勝を中央に置いた再帰レイアウトで、接続線を絶対配置している。
**成立の前提はカード高さが全部同じであること**（`CARD_H`）。行を1本増やすだけで
子カードの中心が 25% / 75% からずれ、線が刺さらなくなる。

- 状態・不戦勝・時刻は1行に畳んである。補足を足したいときは行を増やさず既存の行に入れる
- 「優勝」バナーは `absolute bottom-full`。通常フローに戻すと決勝カードの中心がずれる
- 変えたときは実ブラウザで確認する。カード高さが1種類か、コネクタの 25/50/75% が
  カード中心と一致するかを見れば足りる（6人・11人・16人で検証済み）

### 配信者アイコンの URL を永続化しない

TikTok の avatar URL は署名付きで約47時間で失効する。`TiktokRoom` や `EventParticipant` に
列を足して保存したくなるが、**やらないこと**。終了済みイベントの表で必ず腐るうえ、
取り直しの排他・失敗時のバックオフ・ロールバック時の列の扱いが全部乗ってくる。

閲覧の契機で引いてプロセス内キャッシュに置く（`src/lib/tiktok-avatar.ts`）、
配信は `GET /api/public/avatar/<participantId>` からの 302 だけにする。
参加者IDの解決は `findPublicParticipantTiktokId()` を通し、公開イベントの出場者に限る。

**参加者登録（`registerParticipant`）から TikTok へ問い合わせを足さない。** 主催者の
登録リクエストが外部サービスの応答時間に引きずられる。アイコンは付随情報でしかない。

## デスマッチ（フェーズ5）

規則は [docs/EVENT.md](../../docs/EVENT.md) の「デスマッチ」にある。ここには壊しやすい箇所だけ書く。

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
`src/event/reopen-aggregation.ts` を、対戦の追加・削除・承認・確定・引き分け・VOID・
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
| 2 ✅ | 参加者登録 + room lease（`TiktokRoom.monitorUntil` / `getMyRooms()` の変更を含む） |
| 3 ✅ | 獲得ダイヤレース（集計ワーカー、チーム管理、公開ランキング、SLO の実測） |
| 4 ✅ | バトルトーナメント（battle 検知 → マッチ照合 → 勝敗確定 → トーナメント表）※実 payload での検証は未 |
| 5 ✅ | デスマッチ（ライフポイント、対戦カードの個別追加、引き分け） |
| 6 | 都道府県UI（日本地図） |

`EventScoreAdjustment`（主催者による手動補正）はモデルだけあって未使用 —
集計に効かせるコードと管理UIは同時に入れること。

公開ページの順位表は `STANDING_HEADINGS` で種目ごとに見出しを変えている
（デスマッチは集計が回っていれば「ライフ」表示に差し替わる）。`FORMAT_PENDING_NOTES` は
フェーズ4・5で中身が空になった。新しい未実装の種目を足すときに使う。
