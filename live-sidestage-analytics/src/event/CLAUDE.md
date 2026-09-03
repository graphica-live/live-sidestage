# CLAUDE.md — イベント機能（LIVE Sidestage Event）

`src/event/` はイベント（大会）運営機能の中核。画面は `src/app/(event)/events/`、
公開ページは `src/app/(public)/e/`、API は `src/app/api/events/` と `src/app/api/public/`、
集計ワーカーは `event-worker.ts`。

**UI は analytics と表向き分離してある。** 管理画面が `(dashboard)` ではなく `(event)` route group に
あるのはそのため。`(event)` 配下へ analytics の機能・ブランド・導線を持ち込まないこと。
内部のデータ結合（`analytics-db.ts`）は分離対象ではない。

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

例外は `hostUserId` の補完だけで、これは `src/lib/tiktok-host-id.ts` の
`backfillHostUserIds()` を通す（event-worker が回す）。**`monitorUntil` には触らない**ので
上のルールの目的（監視期限の上限・検証・他イベントへの干渉）とは衝突しない。
`hostUserId` は不変値なので `where` に `hostUserId: null` を入れて上書き不能にしてある。

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

**ただし登録の補償経路（`registerParticipant` の catch）だけは `releaseIfNoLeaseRemains()` を使う。**
こちらは**自分のイベントの lease も数える**。同じ ID を並行登録して片方が一意制約で落ちると、
`releaseIfUnused()` では勝った側の lease を数えないまま `monitorUntil` を消してしまい、
**登録は成功しているのに監視されない**状態になる（`participants.integration.test.ts` が固定）。
逆に `releaseEventLeases()` を全イベント数える版にしてはいけない — あちらは lease を解放せずに
呼ぶので、永久に解除されなくなる。

**未解決（既知の穴）**: `ensureRoomForEvent()` で `monitorUntil` を立ててから lease を
commit するまでの間に、別の解除経路が「lease 0件」と数えて `monitorUntil` を消せる。
`count` → `releaseRoomMonitor` 自体も原子的ではない。`removeParticipant` にも同種の穴があり、
参加者を外した直後に同じ ID を再登録すると、後から走る解除が新しい登録の監視を止めうる。
根治には room 単位のロックか、「未解放 lease の最大期限から `monitorUntil` を再計算する」
統一プロトコルが要る。**新しい解除経路を足すときにこの穴を広げないこと。**

期限は `ensureRoomForEvent()` が `max(既存, 要求)` で更新するので、**確保するときは**
他イベントの期間を縮める心配はいらない。

### 5.5. 実在しない TikTok ID を弾く判断を「非 0 の statusCode」に広げない

参加者登録は `api-live/user/room/` を1回引いて、実在しないハンドルを 400 で弾く
（`src/lib/tiktok-existence.ts` → `classifyAccountExistence()`）。守ること:

- **拒否の根拠は `USER_NOT_FOUND_STATUS_CODE`（`19881007`）と `message: "user_not_found"` だけ。**
  実測（2026-08-24）で、実在は `statusCode: 0`、不存在は専用コードを返すことを確認している。
  非 0 をまとめて「いない」にすると、**レート制限や bot 判定で実在アカウントが一斉に弾かれ、
  イベントの参加者登録がまるごと止まる**（`tiktok-room-cleanup.ts` が同じシグナルに
  3回・3日・異常率のガードを積んでいるのはこのため）
- **判定できなければ通す（fail-open）。** 実在確認は打ち間違いの救済であって参加資格の審査ではない。
  結果は `RegisterResult.existence` で返し、`UNVERIFIED` なら UI が警告を出す
- **avatar を実在の根拠にしない。** `parseProfileResponse()` は avatar URL の検証に落ちると
  null を返すので、CDN のホストが変わると実在確認まで壊れる。`classifyAccountExistence()` は
  `data.user` しか見ない
- 呼び出しの間引き（キャッシュ・in-flight 集約・同時実行上限2・サーキットブレーカ）を外さない。
  `fetchTiktokProfile()` はプロキシなしの単一データセンターIPで、avatar キャッシュ・
  `hostUserId` 補完・room cleanup と**同じ枠を共用している**
- 止めたくなったら `EVENT_PARTICIPANT_EXISTENCE_CHECK=0`

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
- **集計対象は種目で変わる**（`isBattleOnlyFormat()`、`src/event/scoring.ts`）。
  `TOURNAMENT` / `DEATHMATCH` は**検知したバトル区間のギフトだけ**、`DIAMOND_RACE` は
  日程の全ギフト。詳しくは下の「バトル中のみ集計する種目」
- 公式スコアは元の `gifts` のみ。`gift_edits` は無視する
- ポイント = ダイヤ実数 × 倍率。**1件のギフトに適用される倍率は必ず1つ**。
  BATTLE 区間に入るなら BATTLE、入らなければ SOLO_STREAM。合計も乗算もしない。
  同じ kind が複数該当したら最も大きい factor を1つだけ採る。
  バトル中のみ集計する種目では区間の kind が必ず BATTLE なので、SOLO_STREAM は効かない

### バトル中のみ集計する種目（トーナメント・デスマッチ）

`buildRateSegments` に `coverage: "BATTLE_ONLY"` を渡すと、**バトル区間の外を1区間も返さない**。
区間の正本は `loadBattleRangesByRoom()` で、勝敗判定・バトル倍率とまったく同じ母集団になる。

守ること:

- **種目の判定は `isBattleOnlyFormat()` の1箇所。** 条件を各所へ散らさない
- **バトル区間を持たない room はクエリを投げない**（`aggregate.ts` の `commonRooms` が空になる）。
  ただし `EventStanding` は参加者一覧から作るので、0点の行は必ず残る
- **`aggregateEvent()` は毎回 `Event.aggregationPolicy` を書く**（`"FULL_PERIOD"` / `"BATTLE_ONLY"`）。
  **主催者が設定する項目ではない。** `finalizedAt` が立った過去イベントは再集計されないので、
  旧方式のスナップショットが残り続ける。**公開ページは `format` ではなくこの列を見る** —
  種目で判定すると、バトル外のギフトを含む過去の数字に「バトル中のみ」という説明が付く
- **同じ区間の room は1本のクエリにまとめる**（`aggregate.ts` の `batches`）。
  `buildRateSegments` の出力区間は互いに重ならないので、同じ room が同じキーへ2度入らない。
  重なったバトル区間を渡しても二重計上にならないのはこの性質のおかげ
- **`fetchListenerProfiles()` は絞らない。** 余分に引いた行は `buildContributionRows` が
  捨てるだけで結果に影響せず、絞るとバトル外でも投げたリスナーの表示名が古いものへ変わる。
  なお集計全体でいちばん重いのはこのクエリのままなので、「バトル区間が短いから速い」とは言えない
- **区間を持たない対戦は0点になる。** 手動確定（`MANUAL`）、`AMBIGUOUS` / `END_UNKNOWN` の
  引き分け確定、終了未観測のバトル。緩めたくなったら `loadBattleRangesByRoom()` の
  status フィルタを広げる話になるが、**勝敗判定と母集団が食い違う**ので安易にやらない
- **数字は単調増加しない。** `NEEDS_REVIEW` の承認で一気に加算され、`CUT_SHORT` の判明で減る。
  公開ページの注記（`BATTLE_ONLY_SCORING_NOTE`）でその旨を出している

### ⚠️トラブル対処: 対戦単位の `forceFullPeriod` 強制フラグ

1回戦の検知失敗（部分一致・`AMBIGUOUS`・`END_UNKNOWN`）で主催者が勝者を手動確定すると、
その `decidedAt`（手動確定した時刻）が下流ラウンドの `feederDecidedAt` に使われる。実際の
バトルがそれより前に開始していると、**正常に検知できたはずの下流ラウンドまで候補から
除外される連鎖**が起きうる（実例: 2026-08-26 `awake-vol-3-kcmkdz`。準決勝の手動確定が
決勝の翌日にずれ込み、前夜に正常終了していた決勝の本物のバトルが「上流決着前に始まった」
として除外され、決勝が `NO_SHOW` のまま固定された）。

これを受けて、`[matchId]/route.ts` の `confirm`/`draw` は主催者がリクエストボディで
`decidedAt`（`<input type="datetime-local">` の値、`parseJstLocal()` でパース）を任意で
指定できる（優先順位: 既存の `decidedAt` → 主催者入力値 → `new Date()`）。**未来時刻の
上限は設けていない**（イベント進行の押し・延びは予測できないため、主催者の裁量を優先する
設計判断）。管理画面（`MatchManager.tsx` の確定/引き分けボタン）は決着時刻の入力欄を出し、
検知情報が残っていれば(`detectedEndAt` または候補行の最後の `endedAt`)それをデフォルト値に
する。**主催者が誤って不正確な(実際より後ろの)時刻を入れると、このバグを自分で
re-create しうる**ため、入力欄には種目別の注意書き（トーナメントは「この時刻より前に
開始したバトルは次のラウンドの検知対象にならない」、デスマッチは「ライフの適用順に
影響する」）を出している。`feederDecidedAt` 制約自体（上流より後のバトルしか見ない）は
撤廃していない — `resolveMatchSeries()` の `CANDIDATES_EXCEEDED` 判定（候補数が
`matchRules.winCondition` の要求本数を超えたら主催者確認に回す）だけでは、複数本勝負
（2本先取等）で無関係な過去のバトルが必要本数の余裕分に紛れ込むリスクを防げないため。

代わりに、主催者が対戦カード単位で明示的に有効化する緊急救済フラグ
（`EventMatch.rules.forceFullPeriod === true`、`match-status.ts` の `isForceFullPeriod`）を
用意してある。管理画面（`MatchManager.tsx` の `TroubleShootingSection`）でのみ操作でき、
**`FINISHED` の対戦にしか存在しない不変条件**（`route.ts` が設定を FINISHED 限定にし、
`reopen`/`void` で自動的に消す）。

守ること・既知の影響:

- **`loadBattleRangesByRoom()` はフラグが立った対戦を検知区間ではなく開催日程
  `[session.startAt, session.endAt)` まるごとで扱う。** 勝敗判定（`resolveMatchResults`）は
  これを見ないので勝者には影響しない
- **BATTLE倍率が設定されている場合、フラグ区間にも通常のBATTLE倍率がそのまま乗る**
  （区間の kind は常に BATTLE）。フラグを立てた参加者は他参加者より構造的に有利になりうるが、
  緊急救済としてこの歪みは許容する
- **公開ページの注記（`aggregationPolicy: BATTLE_ONLY` に基づく説明）は変わらない。**
  「バトル区間のみ集計」という説明とフラグ適用参加者の実態が食い違う点は、主催者の明示操作
  による例外として受容する
- **対戦カードのサイドスコア（`EventMatchSide.diamonds`、検知区間ベース）と、順位表・
  リスナー貢献（フラグ適用時は全期間ベース）の数字が食い違いうる。** バグではなく仕様上の帰結
- フラグは「保存済みだが集計区間の外にあるギフト」しか救済できない。**登録アカウントと
  実際に配信したアカウントが異なる等でギフト自体がDBに存在しない場合は直せない**
- 通常機能ではないので、`REVIEW_REASON_NOTES` 等の通常導線とは別枠（`TroubleShootingSection`）
  に置き、誤操作防止の確認ダイアログを挟む

**性能**（ローカル docker Postgres、ギフト50万 / 参加者50 / 1回戦18対戦）:
バトル区間のみ 1.2秒 に対し、全期間は 2.7〜3.4秒。区間が短いぶん**従来より速い**ので、
`unnest` での一括クエリ化は入れていない。`npm run bench:aggregate:local` は
**両方の経路を測る**（トーナメントのシナリオを外すと新経路を1本も通らない）。
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
- `topParticipantId` / `participantCount` / `breakdown`（リスナーの支援先と枠ごとの内訳）は
  **scope=EVENT の行にだけ**入れる。判定は `top-participant.ts` の
  `resolveListenerAttribution()` で、**打ち切り前の `byParticipant` 全量**から出す
  （打ち切り後だと参加者側の上位200位に入らない分を拾えない）。
  基準は常にポイント（公開ページを実弾順に並べ替えても支援先も内訳の順序も動かさない）。
  FK は張らない（`EventStanding.subjectId` と同じ扱い）ので、読み側は名前を解決できなければ
  表示しないこと
- **`breakdown`（Json）の形式は `contribution-breakdown.ts` の1箇所に閉じる。**
  `[{ p: participantId, d: ダイヤ, pt: ポイント }]`。**`pt` は `formatScaledPoints()` を通した
  Decimal 文字列**で、`Bucket.points` の100倍された内部値をそのまま入れない（公開ページに
  100倍の数字が出る）。参加者名は載せない — クライアントが `EventSnapshot.participants` から引く
  （10秒ごとに全 snapshot を返すので、200リスナー×200枠の最悪ケースで名前まで重複させない）
- **`breakdown` の `null` は「内訳を持たない行」**で、`[]`（投げた枠が0件）と区別する。
  `finalizedAt` が立った過去イベントは再集計されないので、内訳を持たない行は残り続ける。
  読み側は null のとき従来表示（`X のリスナー` +「他N人にも」）へフォールバックすること
  — ここを `[]` に丸めると過去イベントの表示から人数が消える
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

**ロックを取ったあとに status と `finalizedAt` を数え直す。** 対象一覧はトランザクションの
外で引くので、選ばれてからロックが取れるまでの間に主催者が開催中を解除（`RUNNING` →
`SCHEDULED`）しうる。見ないと、開催準備中へ戻したイベントを集計して、締切後なら
`finalizedAt` まで立ててしまう。**`startAt <= now` はここでは見ない** — `aggregateEvent()` は
期間外からでも直接呼べる関数として使われている（テスト・手動の再集計）ので、窓の判定は
呼び出し側（`aggregationWindow`）の責務のままにする。

### ステータス遷移（`status-transition.ts` / `readiness.ts`）

遷移表は `src/event/status-transition.ts` の1箇所。**UI（`EventAdminControls`）と
API（`PATCH /api/events/{id}`）が同じ表を見る。** 以前は表がクライアントにしかなく、
API は列挙値でありさえすればどこからどこへでも飛ばせた。

- `SCHEDULED`（開催準備中）⇄ `RUNNING` ⇄ `FINISHED` ⇄ `ARCHIVED`。飛び越えは 409
- 同じ status への PATCH は**冪等に 200**。副作用は起こさない（二重クリック・別タブ）

**`RUNNING` への遷移はすべて（`SCHEDULED` からも `FINISHED` からも）同じ扱いにする。**

1. 開催準備チェック（`readiness.ts`）を通す。残っていれば 409 `NOT_READY`
2. 同じトランザクションで `reopenAggregation()` を呼ぶ

2 を省くと、締切後に最終集計を終えた（`finalizedAt` が立った）イベントは開催中へ戻しても
`aggregationWindow()` から外れたままで**二度と集計されない**。1 を `SCHEDULED` からだけに
すると、`FINISHED` を経由してゲートを迂回できる。

開催準備チェックが止めるのは2つだけ:

- 出場できるエントリーが必要数（対戦する種目は2、獲得ダイヤレースは1）未満
  — 個人戦なら ACTIVE な参加者、チーム戦なら **ACTIVE メンバーを持つ**チームを数える
  （`createBracket` の `TOO_FEW_ENTRANTS` / `UNKNOWN_ENTRANT` と同じ基準。
  表に使わない空のチームが1つあるだけで止めたりはしない）
- `TOURNAMENT` でトーナメント表が1件も無い（表が無いと検知も勝敗も動かない）

**日程0件は止めない。** `resolveEventWindows()` が外枠を1日程として扱うので集計も検知も
動く。止めると、日程を持たない旧イベントを開催準備中へ戻したとき二度と開催中にできない。
デスマッチの対戦カード0件も止めない（開催中に随時足す運用）— 残タスク一覧に「任意」で出す。

**これはベストエフォートのゲートで、開催中に維持される不変条件ではない。** 参加者・チームの
削除は同じ advisory lock を取らないので、遷移の直後に出場者が減ることはありうる。
そもそも開催中の参加者の追加・削除は仕様（全期間再集計なので過去に遡る）。
ここで守るのは「開催中にした時点で明らかに不完全ではない」ことだけ。

### 実測値（ローカル docker Postgres、`npm run bench:aggregate:local`）

| 規模 | 集計クエリ単体 | 1イベントの再集計 |
| --- | --- | --- |
| ギフト10万 / 参加者20 / リスナー500 | 112ms | 0.94秒（倍率3区間で 1.01秒） |
| ギフト50万 / 参加者50 / リスナー3000 | 914ms | 3.4秒（倍率3区間で 3.9秒） |

バトル中のみ集計する種目（同条件・1回戦18対戦）は **0.19秒 / 1.2秒**。区間が短いぶん
全期間より速い。`bench:aggregate:local` は両方の経路を測る。

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

### 対戦は時間枠を持たない。日程まるごとが検知の対象

`EventMatch` に開始・終了時刻は無く、`sessionId`（開催日程）だけを持つ。候補になるのは
**バトルの終了時刻がその日程 `[startAt, endAt)` に入るもの**（半開区間。終端ちょうどに
終わったバトルが次の日程の候補にならないようにする）。

守ること:

- **終了時刻を推測しない。** `observed`（終了イベント）か `duration`（**開始を観測できている
  ときだけ**、バトル長から計算）の2つだけ。どちらも無いバトルは `detectedEndAt = null` の
  「暫定関連」（`LIVE`）に留め、勝敗もバトル倍率も出さない。予定終了時刻へのフォールバックは
  廃止した（実測でない区間の通常ギフトが倍率と勝敗に混ざるため）
- 暫定関連のまま日程が終わったら `NEEDS_REVIEW`（`rules.reviewReason = "END_UNKNOWN"`）
- 暫定関連は次の周回で候補から外れたら**解除する**（実際の終了が日程外だった場合など）
- **一度確定した `detectedBattleId` は主催者が「検知をやり直す」まで動かさない**
  （`LOCKED_DETECTION_STATUSES`）。後から取り込まれたバトルで過去の割り当てが揺れないように
- 下流のカードは **feeder が決着した時刻より後に始まったバトル**しか候補にしない。
  不戦勝行は自分の決着時刻を持たないので、さらに上流まで遡る（`decidedAtOfSlot`）
- 同じ組み合わせの候補が日程内に複数あるときは、決定的に最初の1件を付けたうえで
  `AMBIGUOUS` にして**承認を許さない**。主催者は勝者を手動で確定する（その経路は検知を捨てる）

### 途中終了（CUT_SHORT）したバトルは勝敗判定に使わない

TikTok の `BattleAction` は `FINISH`(5) と `CUT_SHORT`(6) を区別する。後者は「規定時間を
待たずに打ち切られたバトル」で、**成立したバトルとして扱わない**（誤って開始して即切り上げた
バトルが、本番のバトルと同じ日程に並んで `AMBIGUOUS` を起こすのを防ぐ意味もある）。

判定材料は `DetectedBattle.lastAction`。`detectMatches()` の `select` に**必ず入れること**
（入れ忘れても型は通り、静かに「途中終了なし」になる）。

守ること:

- **除外は `battles.ts` が母集団から丸ごと外して行う。`match-detect.ts` に条件を足さない。**
  `assignBattles()` にマッチごとの例外を持ち込むと、除外したはずのバトルが `AMBIGUOUS` の
  母数や `usedBattles` の取り合いに残る
- **room 横断は「1つでも CUT_SHORT を観測したら途中終了」。** 片側が途中接続で終了イベントを
  取り逃していれば `lastAction` は `OPEN` / `UNKNOWN` のまま残る。`UNKNOWN`(0) は判定不能なので
  従来どおり候補にする（fail-open）
- **`mergeBattleState()` は `CUT_SHORT` を sticky にしてある**（`src/lib/tiktok-battle.ts`）。
  終了イベントどうしは後着が上書きするので、これが無いと `CUT_SHORT → 遅延 FINISH` で
  途中終了だった事実が消える。代償として、誤検知した `CUT_SHORT` は `FINISH` で自己修復しない
- **`parseBattleEvent()` の `phase` は `END` のまま**にする。`CUT_SHORT` を終了として扱わないと
  `endedAt` が入らず「終了未観測」になってしまう

### すでに紐づいてしまった対戦の解除（ここが壊しやすい）

新規の割り当てから外すだけでは足りない。`detectMatches()` は既存の暫定関連の解除
（`retracted`）に CUT_SHORT 由来の解除を合流させている。

- **`LOCKED_DETECTION_STATUSES` を「確定済み」の判定に流用しない。** あれは「別の battleId へ
  付け替えない」という安定性の規則で、`DETECTED` も `NEEDS_REVIEW` も結果は未確定
  （`DETECTED` は次の `resolveMatchResults()` でそのまま `FINISHED` になる）。守るのは実際に
  確定した `FINISHED` と手動確定だけ（後者は `open` フィルタで既に落ちている）
- **`LIVE` は `detectedEndAt` が非 null になりうる。** `resolveEndedAt()` は OPEN 時に
  `duration` が取れると**将来の**終了時刻を作る。既存の解除条件
  （`LIVE && detectedEndAt === null`）だけでは `OPEN(duration=300) → 2分後に CUT_SHORT` が
  引っかからず、`LIVE` のまま BATTLE 倍率区間と公開スコアに残り続ける
- **`!assigned` は OR の外側に置く。** `LIVE` はロックされないので、CUT_SHORT を母集団から
  外した**同じ周回で正常終了バトルへ付け替わる**。内側に書くと、その周回で成立した正しい
  割り当てを直後に巻き戻す（`DETECTED` / `NEEDS_REVIEW` は locked なので付け替えは次周）
- 解除の内容は `[matchId]` API の `reopen` と同じに揃える（検知フィールド・`decidedAt`・
  勝者・`EventMatchSide` の `diamonds` / `score`）。`rules` は `reviewReason` だけを消して
  `roundLabel` / `bye` を残すので、`updateMany` ではなく行ごとの `update` にしてある
- **解除が起きた周回は `finalizedAt` を立てない**（`DetectionResult.invalidated` →
  `aggregate.ts` の `deferFinalize`）。締切後に解除すると次の周回が来ないので、同じ日程に
  正常終了バトルが残っていても `SCHEDULED` / `NO_SHOW` で固定される。解除は冪等
  （`detectedBattleId` を null にする）なので永久に立たなくなることはない

限界:

- CUT_SHORT の観測は `detectMatches()` が読んだ room の範囲でしか見えない（対戦相手が
  イベント参加者でない場合など、範囲外の room だけが持っていても判定できない）
- `finalizedAt` が既に立っているイベントは再評価されない。過去の未確定 CUT_SHORT は自動では直らない
- **ローリングデプロイ中の新旧 event-worker 混在は advisory lock では防げない。** 新版が解除した
  対戦を旧版が `lastAction` を無視して再関連付けし `FINISHED` へ確定させうる。デプロイは
  event-worker を一度止めるか、イベント開催時間外に行う（誤確定しても主催者が
  「検知をやり直す」で戻せる）

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
獲得ダイヤレースでは BATTLE 倍率が設定されていなければ分割自体をしない（クエリ数を増やさないため）。

**トーナメント・デスマッチでは倍率の有無にかかわらず必ず分割する** — この区間が集計する
範囲そのものになるため（上の「バトル中のみ集計する種目」を参照）。

### ブラケットの進行は毎回作り直す

進行は `match-results.ts` の `advanceBracket()` 1箇所。確定した勝者から下流を**再構築**する
（増分で送らない）。主催者が勝者を変えたり VOID にしたりしても、下流に古い勝者が残らない
ようにするため。ただし下流がすでに始まっている（LIVE / DETECTED / NEEDS_REVIEW / FINISHED）
場合は書き換えず、API 側も 409 で拒否する。

**呼び出し元は集計の周回だけではない。** `[matchId]` の PATCH（確定・引き分け・無効・
検知やり直し）と `createBracket()` も、**同じトランザクションの中から**呼ぶ。集計ワーカーは
開催前（`SCHEDULED`）のイベントを対象にしない（`aggregationWindow`）ので、ワーカー任せに
すると事前に組んだ表が永久に進まない — 「勝者を確定したのに次のラウンドが未確定のまま」
という実際の不具合報告がこれだった。**必ず `acquireEventLock` を取った後に呼ぶこと。**

**1回の呼び出しで全ラウンド伝播しきる。** DB を更新したら、読み込んだスナップショット
（`fresh`）も **in-place で**同じ内容へ揃える。揃えないと、不戦勝行を `FINISHED` にしても
その行自身を処理するときに更新前の値を読み、その先へ勝者が流れない（段階的不戦勝方式は
不戦勝が複数ラウンドにわたる）。`slotIndex` は `fresh` と同じオブジェクトを指しているので、
`{...target}` で置き換えると片方にしか反映されず壊れる。

**不戦勝行（`EventMatch.rules.bye === true`）はこの「進行中」ブロックの対象外にする。**
段階的不戦勝方式（`buildStagedBracket()`、`src/event/bracket.ts`）では相手が実試合の勝者
（WINNER_OF）である「動的な不戦勝行」が生成時点では未確定（両サイド空）のまま作られる。
`match-results.ts` の進行処理が、片側に参加者が転送された時点で `FINISHED + winnerDecidedBy:
"BYE"` へ自動確定する。この行は検知対象にならない（`isReadyForDetection()` が両サイドの
出場者を要求する）ので LIVE/DETECTED/NEEDS_REVIEW には絶対にならず、ブロックを外しても
安全 — むしろ外さないと、上流の勝者が変わった（VOID・手動上書き等）ときにこの行が古い勝者の
まま固まってしまう。不戦勝行への `confirm`/`draw`/`void`/`reopen` は `[matchId]/route.ts` が
拒否する（対戦が起きていないので結果操作に意味がなく、`reopen` すると検知対象化して部外者との
バトルを誤って拾うリスクがある）。`downstreamStarted()` も不戦勝行を透過してさらに下流を見る。

### 検知の対象は `isReadyForDetection()` の1箇所で決める

`src/event/match-status.ts` の純粋関数で、**両サイドの出場者が確定していて不戦勝行でないこと**。
`assignBattles`（割り当て）と `findMissedMatches`（NO_SHOW 化）の**両方**がこれを使う。

片方だけの判定にすると食い違う。実際に起きていた: `assignBattles` は
`new Set(sideRoomIds.flat())` の**和集合**を見ていたので、上流の勝者が片方しか決まっていない
`[["roomA"], []]` の枠が `{roomA}` として候補に残り、**roomA が部外者と戦ったバトルが
「完全一致」で載っていた**（`isOneOnOne` が false なので自動確定はされず NEEDS_REVIEW 止まり
だったが、主催者に無関係な対戦が承認待ちで出る）。`findMissedMatches` のほうは
対戦の終了予定だけを見ていたので、**まだ相手が決まっていない枠まで NO_SHOW にしていた**。

サイドの空判定に `teamId` は使わない。検知は roomId 集合の一致でしかできないので、
`teamId` はあるが出場者がいないサイドはそもそも永久に検知されない。

### トーナメント表の破棄（作り直しは「破棄 → 作成」の2手順）

**表がある状態でできるのは破棄と、組み合わせの入れ替え（次節）だけ。** `createBracket()` は
既存の表が1件でもあれば `BRACKET_EXISTS`（409）で拒否する。作り直したい主催者は
`destroyBracket()` で消してから、あらためて作る。
**`createBracket` に「古い表を消してから作り直す」機能を戻さないこと。**

以前は1回の POST が破棄と再作成を兼ねていた。確認（`confirm`）の要否・楽観的排他・
作成が失敗したときの巻き戻しがすべてその1経路に集まり、主催者からは押した結果どうなるのかが
読めず、実際に作り直しが期待どおりに動かないという報告になった。破壊操作を DELETE 1本へ
寄せて、POST は「表が無いところに作る」だけにしてある。

- 存在確認は **`acquireEventLock` を取った後**に `count` する。外で数えると、同時に届いた
  2つの作成がどちらも「表は無い」と読んで表が重なる
- 拒否の理由は進行状態で出し分けない。主催者がすることは常に「先に破棄する」の1つ
- **破棄と作成が別トランザクションになったので、作成側にも `reopenAggregation()` が要る。**
  表が無いあいだにワーカーが「対戦0件のイベント」として最終集計を終える（`finalizedAt` が
  立つ）ことがあるため

**確認（`confirm`）はイベント名で、照合は必ず `acquireEventLock` を取った後に
`Event.title` を読み直して行う。** route 層で比較すると、名前の変更と競合したときに
古い名前への確認で新しい名前のイベントの表を消せてしまう。なおこれは誤操作を止める儀式で
あって認可ではない（イベント名は公開ページに出る）。認可の境界は `requireEventOwner`。

**破棄は進行状態にかかわらず確認を要求する。** 明示的な破壊操作なので、失う結果が無くても
イベント名を打たせる。逆に「進行済みかどうか」で破棄の可否を分けることはしない
（`isStartedMatch()` を破棄のブロックに使わない）。過去に `NO_SHOW` / `VOID` を進行済みと
数えて**表が永久に消せなくなる**事故を2度起こしている:

- `NO_SHOW` は「バトルが**起きなかった**」の記録で、失うデータがない。しかも1回戦の開始を
  過去に置くと集計の周回で自動的に付く
- `VOID` は主催者が明示的に無効と宣言した行

`isStartedMatch()`（`src/event/match-status.ts`）自体は残っていて、下流マッチの書き換え
ブロック（`match-results.ts`）と、破棄ダイアログの「何が消えるか」の表示に使う。

**`expectedMatchIds`（クライアントが見ていたマッチID）は楽観的排他。** `confirm` は
「主催者が破棄を意図した」ことしか保証しない。タブAが表V1を見てダイアログを開く →
タブBがV1を破棄してV2を作る → 遅れて届いたタブAのリクエストがロックを取り、
イベント名は一致するので**V2を消す**、という競合を advisory lock は止められない
（直列化するだけで、古い判断を拒否しない）。

**照合するのは「同じ表かどうか」だけで、行の中身の鮮度ではない。** ダイアログを開いてから
イベント名を入力するまでに同じ行が検知・確定されても破棄は通る（表示している「消える結果」は
開いた時点のスナップショット）。**status を照合条件に足さないこと** — 10秒ごとに status を
書き換える集計ワーカーと競合して、開催中のイベントは破棄そのものができなくなる。壊れた表を
捨てる最後の経路なので、ここは通す側に倒している。

**`DetectedBattle` は消さない。** `eventId` を持たない共有テーブルで、他イベントも
参照しうる。次の `detectMatches` が新しい表へ照合し直すので、破棄して同じ日程で作り直せば
検知が復活する（意図した挙動）。

**転送はソース単位の all-or-nothing。** 1つの対戦は下流へ最大2本の辺を持つ（勝者辺と、
順位決定戦への敗者辺）。**辺ごとに「下流が始まっているか」を判定してはいけない** —
勝敗が覆ったときに「決勝は始まっているので旧勝者のまま、3位決定戦は未開始なので新しい敗者を
受け取る」となり、**同じ参加者が決勝と3位決定戦の両方に載る**（AGGREGATE の再計算で実際に
起きる。日程を後ろへ延ばすと交差区間が広がって勝者が反転しうる）。1つでも弾かれるなら
その上流からの転送は全部やらず、両方を古いまま揃えて `blocked` で主催者に警告を出す。
固定は `battles.integration.test.ts` の「決勝が始まっていたら、3位決定戦のほうも古いまま揃える」。

**進行が起きた周回では `finalizedAt` を立てない**（`resolveMatchResults` の `summary.advanced`）。
転送そのものは1回で全ラウンド伝播しきるが、**新しく埋まった枠のバトル検知は次の周**になる
（検知は進行より先に走る）。締切後に表を作り直すと、1回戦を確定して2回戦へ送った周回で
そのまま最終集計になり、2回戦以降が永久に `SCHEDULED` で残ってしまう。
転送は冪等なので次周には `advanced` が 0 に落ちる。
**下流が始まっていて弾かれた枠（`summary.blocked`）は数えない** — 毎周「転送したい」状態の
ままなので、数えると `finalizedAt` が永久に立たない。

`ARCHIVED` は `aggregationWindow`（`aggregate.ts`）の対象外なので、作り直しても集計が回らない
（ダイアログで案内している）。`EventContribution.scope=MATCH` は `EventMatch` への FK なしの
ソフト参照で、次の全再集計で入れ替わる（`ARCHIVED` では残る）。破棄時に手で消す必要はない。

**ロック順序は全経路で advisory lock が先。** 破棄側が「ロック → 行削除」なので、
`[matchId]` API が「行更新 → `reopenAggregation` の中でロック」だと逆順でデッドロックする。
`[matchId]` の各操作はトランザクション先頭で `acquireEventLock` を取り、対象マッチの読み取り・
`BYE_ROW` 判定・`downstreamStarted()`・`schedule` の status 判定も**すべてロックの内側**で行う。

**`buildStagedBracket()` が「不戦勝行」と印を付けてよいのは、`nextSlot()` の機械的な座標
（`floor(position/2)`）で見て、相手側に構造的に誰も来ないことが保証されている場合だけ。**
このpositionの座標と実際の転送内容の整合性が崩れると、無関係な2人の実試合を丸ごと不戦勝処理
してしまうデータ破損バグになる（実データで一度発生し、修正済み）。ブラケット生成のロジックを
触るときは `src/event/bracket.test.ts` の「座標の整合性」テストを必ず通すこと。

### トーナメント表の組み合わせ変更（表を保ったまま入れ替える）

`src/event/bracket-swap.ts`（純粋関数）と `bracket-swap-apply.ts`（DB 適用）、
`POST /api/events/{id}/matches/swap`。管理画面の「組み合わせを変更」で編集モードに入り、
枠をドラッグ&ドロップで入れ替える。**開催中でも使える。**

**「準決勝のサイドの中身だけ差し替える」は絶対に動かない。** `advanceBracket()` は
`nextSlot()` の固定座標だけで転送先を決めて毎回下流を再構築するので、次の集計周回で
必ず巻き戻される。座標を壊さずに組み合わせを変える唯一の方法は、**上流のサブツリーごと
`bracketPosition` を移すこと**。

そこでスワップを「**1回戦の葉の占有パターンの交換**」として定義してある。スロット
(round r, position p, sideIndex s) が支配する葉は `[(p*2+s) * 2^(r-1), +2^(r-1))` で、
r=1 なら葉そのもの、r=2 なら feeder カード1枚ぶん。**1回戦の入れ替えも準決勝の枝ごと交換も
同じ操作**になり、交換後の構造（どの行が存在するか・どれが不戦勝行か）は既存の
`buildManualBracket()` がそのまま返す。不戦勝の判定を書き直さないので、`rules.bye` の印と
実際の転送内容が食い違わない。

以下は実装で踏んだ地雷。**外すと壊れる。**

**葉の占有は「行の構造」から復元する。サイドの中身から数えない。**
`removeParticipant()` は `EventParticipant` を物理削除し、`EventMatchSideParticipant` は
`onDelete: Cascade`。**確定済みの実試合カードからも出場者が消える。** 中身から復元すると、
参加者を1人外しただけで確定済みの実試合が「不戦勝行」と判定され、スワップ対象ですらない行に
`rules.bye` が付く（= 上で警告している実試合の不戦勝化そのもの）。両方消えていればその行ごと
削除される。`restoreOccupancy()` は「行が無ければ空 / 不戦勝行なら `winnerSideId` の側だけ /
それ以外は両方占有」だけを見る。旧データ（`rules.bye` 無し）は `winnerDecidedBy === "BYE"` で拾う。

**不戦勝の確定・解除は swap 側で正規化する。`advanceBracket()` に任せられない。**
あちらの不戦勝処理は「転送先(target)」にしか効かない:

- **1回戦の行は決して target にならない**（target は必ず round ≥ 2）。1回戦の静的な不戦勝は
  `createBracket()` が作成時に確定させている。放置すると新しく不戦勝になった1回戦が
  `SCHEDULED` のまま固まり、生存者は永久に次のラウンドへ進めない。しかも `[matchId]` API は
  不戦勝行への確定を `BYE_ROW` で拒否するので**主催者は手動でも直せない**
- **不戦勝でなくなった行は巻き戻されない**。`FINISHED` / `winnerDecidedBy: "BYE"` が残ると、
  対戦していない旧勝者が下流へ流れ続け、しかも `detectMatches()` の `open` フィルタが
  `MANUAL_DECISIONS`（"BYE" を含む）を外すので**永久に検知されない**

正規化するのは**不戦勝状態が変わった行だけ**（旧データの印の欠落はここで直さない。
スワップと無関係な行を書き換えないため）。不戦勝でなくなった行は `[matchId]` の `reopen` と
同じ状態へ戻す。

**`VOID` はスワップ対象から外す。** `battles.ts` の `LOCKED_STATUSES` が VOID を検知から
永久に除外するので、新しい相手を入れても照合されない。先に「検知をやり直す」で `SCHEDULED` へ
戻してもらう（`assignSession` が `RESCHEDULABLE` を絞っているのと同じ考え方）。

**行の「作成」は起こらない。起きたら中断する。** 掴む側も置く側も画面に出ている行なので、
交換で新たに alive になる祖先はすでに行を持っている（`bracket-swap.test.ts` の
「スワップ後の座標の整合性」が全パターンで確かめている）。目標構造が要求する行が足りない
ケースは復元が実態とずれている証拠なので、`BRACKET_INCONSISTENT`（409）で止めて
「表を破棄して作り直す」へ誘導する — 壊れた表に正規化をかけて傷を広げない。
**逆に行が減るのは正常経路**（不戦勝行の唯一の出場者を移すとその行と祖先が消える）。
消えるのは「誰も来ない行」だけなので失う対戦結果はない。

**ロック順序は破棄・`[matchId]` と同じ。** `acquireEventLock` をトランザクション先頭で取り、
種目・進行状態・構造の検証も、`downstreamStarted()` も全部その内側で行う。
最後に `advanceBracket()` → `reopenAggregation()`。

**`expectedParticipantIds` は楽観的排他。** スロットは座標ではなく `matchId` + `sideIndex` で
受ける（別タブが上位ラウンドを入れ替えた直後に「同じ座標だが別のカード」を動かさないため）。
中身がずれていたら `SLOT_CHANGED`。

UI 側（`AdminBracketTree.tsx`）は編集モードのとき **不戦勝行も両サイドを描く**。通常表示は
本人だけを見せているが、空き枠そのものがドロップ先なので畳むと操作できない。カードは
`<button>` から `<div>` に切り替える（入れ子のドラッグと競合するため）。**行は増やさない**
（`CARD_H` 固定が幾何の成立条件）。

### 接続の交換（winner feeder edge swap）— 下流が始まっていても組み合わせを変える

上のスワップ（葉スワップ / subtree swap）は、入れ替え対象の下流（次ラウンド・順位決定戦）が
**すでに始まっていると使えない**。「下流ノードを丸ごと座標移動する」拡張を検討したが、
**数学的に不成立と判明した**：順位決定戦（`realMatchesInRound()`）は複数のブロック（東西の
準決勝など）の結果が合流したものなので、片方のブロックだけを座標移動すると、もう片方の
参加者の結果が行き場を失う（実データで、動かそうとしたブロック以外の参加者の結果が同じ
順位決定戦に混在していることを確認済み）。

代わりに、**「まだ対戦していない対戦（round ≥ 2）について、勝者の供給元（フィーダー）の
接続だけを交換する」**方式を採る。過去の結果（score/winner/loser）・`matchId`・
`round`/`bracketPosition`・`loserFrom`・`realMatchesInRound()` の出力は一切変更しない。

**構造（行の存在・不戦勝・順位決定戦トポロジー）は座標が正本。フロー（勝者の転送先）は
座標既定 + `winnerFeeders` によるoverride、という新しい原則で読むこと。** これは
`loserFrom`（座標で表現できない敗者辺を rules に明示する前例）の延長で、原則の放棄ではない。

`src/event/winner-feeders.ts`（純粋関数）と `bracket-swap-apply.ts` の
`swapWinnerFeeders()` / `resetWinnerFeeders()`、`POST /api/events/{id}/matches/swap`
（`mode: "feeder"` / `"feeder-reset"`）。管理画面の「接続を交換」で編集モードに入る。

**データモデル**: 受け側（target）の行の `EventMatch.rules.winnerFeeders` に
`{ slots: [BracketSlot, BracketSlot], changedAt: ISO8601 }` を持たせる。**`loserFrom` と違い
厳密パース**（非null固定2要素）— 対象を非bye行に限定しているので null 要素を許す必要がない。
キーが無い行は従来通り `nextSlot()` の既定計算にフォールバックする。**不正な形式が見つかったら
`parseLoserFrom()` のようにフォールバックせず `BRACKET_INCONSISTENT` で止める（fail closed）。**

**勝者辺を座標から読む箇所は3つに閉じている。すべて `winner-feeders.ts` の
`buildWinnerFeederGraph()` が返す `WinnerFeederGraph` を経由すること**（個別に
「override優先、なければnextSlot」を書き散らすと、追従漏れが「下流巻き戻り」「誤ブロック/
素通り」「誤検知（3位決定戦で過去に実際に起きたバグと同型）」に直結する）:

- `match-results.ts` の `advanceBracket()`（勝者辺の転送先）
- `match-downstream.ts` の `anyDownstreamStarted()`（下流判定）
- `battles.ts` の `upstreamSlots()` / `feederDecidedAt`（検知の feeder 制約）

グラフ構築（`buildWinnerFeederGraph()`）は次を検出したら `{ ok: false }`（呼び出し側は
`BracketInconsistentError` を投げる）: override の構文不正・`source.round !== target.round-1`・
source不在（override が実在しない座標を指す）・全単射崩壊（複数targetが同じsourceを指す）・
孤児source（実在行の勝者辺がどのtargetにも向かわない）。**既定計算（override無し）で
「誰も来ない」座標（段階的不戦勝方式の bye 行）に当たった場合は source不在エラーにせず
`null` として扱う** — override はこの読み替えをしない（override 対象は非bye行に限定される
ため、override が「誰も来ない」座標を指すのは常に異常データ）。

**対象は非bye行のみ。** `isStartedMatch()` は動的bye行に常に `false` を返すため、「未実施
であること」だけのガードでは bye行（構造的に片側にしかフィーダーを持たない）が対象に紛れ込み、
厳密パース仕様（非null固定2要素）と原理的に両立しない。**target・source の両方について
bye行を除外する。** この除外により、bye行を透過した下流へ `changedAt`（下記）が伝播しない
問題も同時に回避される — 実試合の対象行は決着時刻が必ず `changedAt` より後になるため、
下流は再帰的に安全になる。

**検知の誤爆対策（`changedAt`）。** 検知下限（`feederDecidedAt`）は元々「フィーダーの決着
時刻」だけを見ていたが、これだけでは不十分（例: 20:00に準々決勝決着 → 20:10に無関係な
練習バトル → 20:30に接続変更、という順序だと20:10のバトルが誤って新ペアの結果として検知
される）。検知下限は **`max(各feederの決着時刻, winnerFeeders.changedAt)`**（`battles.ts`）。
**正規化（全エントリが座標既定と一致してもキーを削除しない）** — `changedAt` はこの
誤検知リスク期間の記録そのものなので、通常のtranspositionでは残し続ける。

**楽観的排他は座標だけでは不十分。** 交換対象は参加者ではなくフィーダーの接続なので、
両sourceが未決着（参加者集合が空）なら `expectedParticipantIds` 相当の比較は意味をなさない。
`expectedFeeder: { round, position, matchId, participantIds }` を、そのフィーダー行の
**`{matchId, 現在のparticipantIds}` まで含む指紋**にする — round=1 の葉スワップ
（`swapSideContents`。matchId・座標は変えず中身だけ変える）との競合を、座標だけでは
検知できないため。

**既存の葉スワップ（subtree swap）と接続の交換は相互排他。** 判定は「正常にparseできた
override」ではなく、`rules` に**生の** `winnerFeeders` キーが存在するかどうかで行う
（fail closed）。拒否コードは `FEEDER_OVERRIDDEN`。**明示的な「接続をリセットする」操作
（`resetWinnerFeeders()`）だけが `winnerFeeders` キー自体を削除する** — 通常の
transposition ではキーが残り続ける（`changedAt` を保存するため）ので、「元の組み合わせへ
戻す」だけでは葉スワップは解禁されない。

**書き込みは同一ラウンド内の2つのtargetスロット間のtranspositionのみ。** 各スロットの
feederはちょうど1本・各sourceの勝者辺はちょうど1本という全単射が構成的に保たれ、行の存在・
不戦勝配置・順位決定戦トポロジーへの影響がない。**書き込む `slots` は「既定座標」ではなく
`WinnerFeederGraph` で解決した"現在の"値から合成する** — 対象スロットの一方が過去のスワップで
既にoverride済みの場合、既定座標を書くとその変更が黙って巻き戻るため。

**ロック順序・締めは葉スワップと同じ。** `acquireEventLock` を先頭に取り、種目・進行状態・
構造の検証、`anyDownstreamStarted()` も全部その内側で行い、最後に `advanceBracket()` →
`reopenAggregation()`。

**集計ワーカーのfail-closedはすでに `aggregateDueEvents()`（`aggregate.ts`）が担保している。**
「1イベントの失敗で全体を止めない」try/catch が既にイベント単位でループしているので、
`BracketInconsistentError` が発生しても該当イベントだけが `failed` にカウントされ、他の
イベントの集計は継続する。新しい対応は不要（実装時に確認済み）。

**デプロイは2段階。feature flag は既定オフ（`EVENT_WINNER_FEEDER_SWAP=1` で有効化）。**
「`winnerFeeders` 未設定なら従来動作」という後方互換は**新コードが旧データを読む場合のみ**
保証される。ローリングデプロイ中に新しい書き込み経路（Web）が `winnerFeeders` を書けるように
なった一方で、まだ更新されていない旧 `event-worker` が同じデータを読むと、新キーを無視して
固定 `nextSlot()` で参加者を復元し、誤った組み合わせを検知・確定してしまう（advisory lock は
新旧バイナリの逐次実行を防げない — 既存の「ローリングデプロイ中の新旧event-worker混在」
[下記のバトル検知セクション参照]と同型のリスク）。手順: ① `WinnerFeederGraph` を読む
reader（Web・event-worker）を先に全サービスへデプロイ、flag はオフのまま ② 全サービスの
更新を確認 ③ writer（API）とUIを flag で有効化。**`winnerFeeders` を持つ行が1件でも存在する
状態での旧バージョンへのロールバックは禁止** — 必要なら先に `resetWinnerFeeders()` で
明示的にクリアする（開始済みの対戦のクリアは `blocked` 警告が毎周出る可能性があるが、
データは破壊されない）。

UI（`AdminBracketTree.tsx` / 公開ページの `BracketTree.tsx`）は、接続線自体を固定座標から
直接計算しているため、override があると実際のフローと線が食い違う（"表示上の嘘"になる）。
**バッジ/ドット（管理側「接続変更」・公開側の小さいドット。`CARD_H` 固定は維持）に加えて、
実際の勝ち上がり先を黄色の破線矢印で示す。** どちらも既存の接続線には一切触れない
（`CARD_H` 等の幾何不変条件はそのまま）。

**矢印は独立した overlay SVG で描く。既存の接続線（`PairConnector` 等の絶対配置span）は
拡張しない** — あちらは再帰ツリーのサブツリー内でしか座標を持てず、隣接カラムしか結べない
構造なので、東西ブロック跨ぎや同一ラウンドの遠い枠を結ぶ矢印を描くには使えない。ツリー根
（`position:relative` を持つコンテナ）の直下に overlay を1枚敷き、カード・サイド行に付けた
`data-bracket-slot={"round:position"}` / `data-bracket-side={sideIndex}` を実測
（`offsetLeft`/`offsetTop` の積み上げ。`transform: scale()`＝ズーム/縮小の影響を受けない）
して矢印を引く。純粋な幾何計算（ベジェ・矢じり・同一カラム時の迂回）は `src/event/bracket-flow.ts`
に、辺の導出は下の `feederFlowEdges()` に閉じる。実装は `AdminBracketTree.tsx` /
`BracketTree.tsx` それぞれの `FeederFlowOverlay.tsx`（2ファイル。配色・シェイプ言語が
最初から揃っていないため共通化していない。共有するのは純粋関数だけ）。

**表示用ロジックも `buildWinnerFeederGraph()` を正本として使う。** 独自の緩い解釈は作らない
— 書き込み側が不整合として拒否するデータに対して表示側だけ部分的な矢印を描くと、
「勝者辺の解釈はこのモジュールに閉じる」という上の不変条件に反する。表示専用の
`feederFlowEdges()`（`winner-feeders.ts`）は内部で `buildWinnerFeederGraph()` を呼び、
成功時だけ解決済み辺と `defaultSourceOf()` の差分（実効差分）を返す。失敗時は矢印を
1本も返さない（`{ ok: false, edges: [] }`）。公開画面は矢印なしで表示を続け、管理画面は
「接続情報を検証できない」の警告を出す。

**raw override（`rules` の生キーの有無）と実効差分（矢印の表示条件）は別物。** 一度
「接続の交換」をしてから元へ戻しても、`changedAt` 保持のため `winnerFeeders` キー自体は
残り続ける。この場合 `feederFlowEdges()` の実効差分は空（矢印なし）になるが、既存の
バッジ／ドット／「接続をリセット」導線は raw キーの有無で判定するため**残り続けるのが
正しい**（リセット・葉スワップ相互排他の判定は raw キーの有無で行うため）。管理DTO変換
（`page.tsx`）は不正な `winnerFeeders`（ok:false）を表示上は `null` に丸めているが、
**`hasRawWinnerFeeders`（生キーの有無だけを見る別フィールド）を分けて持つ** — `winnerFeeders
!== null` だけで判定すると、壊れたデータのときに「接続をリセット」導線ごと消えて
（葉スワップ側は raw キーの有無で拒否するため）抜け出せなくなる。

**公開DTO（`BracketDto.feederFlows`）は座標のみを返す。** 従来「閲覧者には座標の詳細は
出さず真偽値だけ（`hasFeederOverride`）」という方針だったが、矢印を引くには座標が要るため
最小限だけ緩めた。`matchId`・参加者ID・`changedAt`（検知誤爆リスク期間の内部記録）は
含めない — 座標は表の見た目から自明で秘匿情報ではないが、それ以外は従来どおり非公開。

**overlay は feature flag を見ない。** `EVENT_WINNER_FEEDER_SWAP` をオフへ戻した後も、
既存に `winnerFeeders` を持つ行があれば表示は継続する（書き込みAPIだけが止まる）。

### 順位決定戦は本選と同じ座標空間に埋め込んである

3位決定戦・5位決定戦などのブロック（`buildPlacementBlocks()`、`src/event/bracket.ts`）は、
**本選とは別の表ではなく、同じ `(round, bracketPosition)` 空間の別の列**として作る。

- ブロック `d` の決定戦は `(round: roundCount, position: d)`。本選の決勝は position 0
- ブロック `d` は round `R-k` で position 範囲 `[d*2^k, (d+1)*2^k - 1]` を占める。
  本選は同ラウンドで `[0, 2^k - 1]` なので、`d >= 1` である限り衝突しない
- `d*2^k` は偶数なので `floor((d*2^k + p)/2) = d*2^(k-1) + floor(p/2)` — **`nextSlot()` の
  座標式がブロック内の進行にそのまま成立する**

**この埋め込みは意図的**で、`nextSlot()` / `roundCount = Math.max(...round)`（4箇所）/
`BracketTree` の再帰描画 / `findMissedMatches` を無改修のまま通すためにある。
**ブロックを `roundCount` より後ろのラウンドへ置かないこと** — 置いた瞬間に
`nextSlot(roundCount, 0, ...)` が非 null になり、本選の決勝の勝者が順位決定戦へ転送される。

**新しいのは「敗者を送る辺」1本だけ**で、それは `EventMatch.rules.loserFrom`
（sideIndex 順、BYE 側は null）としてブロックの葉に明示的に持たせる。
**座標から導出しない** — どの本選行が「実試合（＝敗者を出す）」かは不戦勝の配置に依存し、
読み取り側で座標だけからは復元できないため。この辺を読むのは3箇所:

- `match-results.ts` の進行（`applyTransfer` を勝者辺と共有する）
- `battles.ts` の `upstreamSlots()`（feeder 制約。**これが無いと、3位決定戦の枠が埋まった
  瞬間にその2人が過去に行った別のバトルを拾う**）
- `[matchId]/route.ts` の `downstreamStarted()`（準決勝を void したときに、始まっている
  3位決定戦を巻き込まないため）

**深さと順位は `2^d + 1` では対応しない。** 段階的不戦勝方式ではラウンドごとの人数が
2のべき乗にならず、5人なら「3位決定戦は作れないが4位決定戦は作れる」が起きる。
順位は `(その ラウンドより後ろの実試合数) + 2` で数える（1試合＝1人脱落）。
選べる深さも連続しないので、UI には深さではなく `placementOptions()` の一覧を出す。

ブロック内の表は**常に標準方式**で組む（出場者が全員「未確定の敗者」なので、
静的な不戦勝が原理的に発生せず、方式で挙動が変わらない）。
ブロックの不戦勝行は常に動的で、敗者が着いた時点で `match-results.ts` が自動確定する。

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

### TikTok のバトルスコアはサイドへ帰属できたときだけ出す

`hostScores` のキーは `anchorIdStr`（TikTok の数値 userId）。対応表は `TiktokRoom.hostUserId` で、
`src/lib/tiktok-host-id.ts` が `api-live/user/room/` の `data.user.id` から後追いで埋める
（**参加者登録の経路からは引かない**。後述の「参加者登録から TikTok へ問い合わせを足さない」）。

帰属は `src/event/battle-score.ts` に閉じている。**表示専用で勝敗には一切効かない**ので、
迷ったら出さない側に倒す。守ること:

- 行のマージは anchorId ごとに**最大値**を採る。`DetectedBattle.updatedAt` は `ingestBattles` の
  毎周 upsert で書き換わるため鮮度に使えず、上書きマージだと落ちた room の古い値が新しい値を潰す
- `BigInt()` に渡す前に `/^\d{1,30}$/` で弾く。`"12.5"` のような値で公開ページを 500 にしない
- サイドの出場者が1人でも解決できなければ**そのサイドは出さない**（部分和にしない）
- 同じ `hostUserId` が複数 room から解決されたら**マッチごと出さない**（改名で旧 room と
  新 room が同じ配信者を指すと二重加算になる）
- 公開側は `detectionConfidence === "exact"` のマッチだけ。partial は「A が部外者と戦った」
  ケースでも付くので、カード上の対戦相手とは別の戦いの数字が載りうる

lease が切れた room は補完対象外なので、**終了済みイベントの表にはスコアが出ない**（仕様）。

### 公開トーナメント表の幾何を壊さない

`BracketTree.tsx` は決勝を中央に置いた再帰レイアウトで、接続線を絶対配置している。
**成立の前提はカード高さが全部同じであること**（`CARD_H`）。行を1本増やすだけで
子カードの中心が 25% / 75% からずれ、線が刺さらなくなる。

- 状態・不戦勝・時刻は1行に畳んである。補足を足したいときは行を増やさず既存の行に入れる
- バトルスコアも行を増やしていない。**公開側は名前を名前枠(NAME_BOX_H)ごとサイド枠の
  上下中央へ寄せ、余った枠の端(VSに近い側)へスコアを絶対配置**して、VSバッジを挟むように
  見せている(上側サイドは枠の下端、下側サイドは枠の上端)。通常フローの行にすると、
  サイドの境目に絶対配置している「VS」バッジ（高さ18px）が上側サイドの最終行に7px重なって
  数字が読めなくなる（実測で確認）。管理側（`AdminBracketTree.tsx`）は名前を下端に置いたまま
  既存の行の右端にスコアを入れている(公開側と挙動を揃えていない)。どちらも `CARD_H` は据え置き
- 「優勝」バナーは `absolute bottom-full`。通常フローに戻すと決勝カードの中心がずれる
- **順位決定戦は本体の再帰ツリーへ差し込まず、決勝ブロックの下に独立したセクションとして
  置く**（`PlacementSection`）。同じ座標空間にいるので `MatchNode` を根から呼べばそのまま
  完全二分木として描ける。`MatchNode` の `minRound` は再帰の停止ラウンドで、ブロックの葉が
  本選の途中のラウンドにいるために要る（既定 1 = 本選の 1回戦まで降りる）
- 変えたときは実ブラウザで確認する。カード高さが1種類か、コネクタの 25/50/75% が
  カード中心と一致するかを見れば足りる（6人・8人・11人・16人、標準／段階的の両方で検証済み）

### 配信者アイコンの URL を DB へ保存しない（バイト列の恒久保存とは別物）

TikTok の avatar URL は署名付きで約47時間で失効する。`TiktokRoom` や `EventParticipant` に
**URL 文字列を**列として保存することは今も禁止（終了済みイベントの表で必ず腐る）。

一方で **`Event.startAt` 到来時点の参加者アイコンは、画像バイトを自前ストレージ（Railway
Bucket）へダウンロードのうえ恒久保存する**（`src/event/avatar-snapshot.ts`、
`TiktokAvatarAsset` の `kind: "event_participant"`。バトル履歴・貢献タブが使っている
`src/lib/avatar-storage.ts` の仕組みをそのまま再利用しており、DB に持つのはオブジェクトキー
だけで URL 自体は書かない）。トーナメント表が確定した後に本人がアイコンを変えても表示が
揺れないようにする狙い。**トリガーは event-worker の定期ジョブ（`avatarSnapshotTick`、既定
60秒間隔）が `startAt <= now かつ avatarsSnapshottedAt IS NULL` のイベントを見つけて1回だけ
実行する。個々の参加者の取得に失敗しても再試行しない（try-once。`avatarsSnapshottedAt` は
成否に関わらず立てる）** — 失敗した参加者だけは次節のライブ取得へ永続的にフォールバックする
（fail-open）。`startAt` を延長しても `avatarsSnapshottedAt` は自動で戻らない（`finalizedAt`
とは異なり、延長は「スナップショットのやり直し」を意味しない設計判断）。

`GET /api/public/avatar/<participantId>` はまずこのスナップショットを見に行き
（`resolveAvatarUrls("event_participant", ...)`）、無ければ従来どおり閲覧の契機で
プロセス内キャッシュ（`src/lib/tiktok-avatar.ts`）経由でライブ取得して 302 する。
開催準備中（`startAt` 未到来）のプレビューは常にこちらの経路。
参加者IDの解決は `findPublicParticipantTiktokId()` を通し、公開イベントの出場者に限る。

**参加者登録（`registerParticipant`）から TikTok へ問い合わせを足さない。** 主催者の
登録リクエストが外部サービスの応答時間に引きずられる。アイコンは付随情報でしかない。

**例外は実在確認（`src/lib/tiktok-existence.ts`）だけ。** これは付随情報ではなく登録の
要件そのもの（打ち間違いを登録すると、誰も配信しない room を監視し続けたうえに主催者は
開催中まで気づけない）なので、1回だけ問い合わせる。**この例外を他へ広げないこと** —
アイコンと `hostUserId` は従来どおり登録経路から引かない。次節の規則も参照。

同じ `api-live/user/room/` から取れる `data.user.id`（数値 userId）は**逆に不変**なので
`TiktokRoom.hostUserId` に保存してよい（バトルスコアの帰属に要る）。ただし取得タイミングは
アイコンと同じ理由で登録経路から切り離し、event-worker の補完ジョブに任せる。

**表示名の未入力フォールバックだけは、実在確認と同じ応答から `nickname` を読む。**
`checkAccountExistence()`（`src/lib/tiktok-profile.ts`）が実在確認(`EXISTS`)と同時に返す
`AccountExistenceCheck.nickname` を `registerParticipant()` が使う（`sanitizeNicknameFallback()`
で60文字超・制御文字を弾いてから採用、取れなければ従来どおり TikTok ID）。**新規の問い合わせは
増やしていない** — 実在確認1回のレスポンスを2つの目的に使い回しているだけなので、上の
「この例外を他へ広げないこと」には抵触しない。**アイコン取得(`fetchTiktokProfile`)経由の
`parseProfileResponse` は使わない** — あちらは avatar URL の allowlist 検証に落ちると nickname
ごと null を返すため、CDN ホストが変わると実在確認は生きているのに表示名だけ壊れる結合になる。

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

**`confirm` と `draw` は、承認できない理由（`AMBIGUOUS` / `END_UNKNOWN`）が付いていたら
検知情報を捨てる。** どちらか片方だけにしないこと。`loadBattleRangesByRoom()` は
「`FINISHED` かつ両端あり」を拾うので、残したままだと「どのバトルか特定できていないため
承認させない」はずの区間がバトル倍率に乗り、**バトル中のみ集計する種目では順位・リスナー貢献の
母集団そのもの**になる。`decidedAt`（ライフの適用順に要る）は残す。
固定は `matches/[matchId]/draw-detection.integration.test.ts`。

### 結果を変える操作は `reopenAggregation()` を同じトランザクションで呼ぶ

集計ワーカーは `finalizedAt` が立ったイベントを飛ばす。**確定後に勝敗を覆したり
対戦を足したりしても、これを消さないと順位・ライフに反映されない。**
`src/event/reopen-aggregation.ts` を、対戦の追加・削除・承認・確定・引き分け・VOID・
検知やり直し・日程の割り当て変更・ライフ設定の変更・トーナメント表の作成・トーナメント表の破棄・
トーナメント表の組み合わせ変更で呼んでいる。
新しく結果を変える操作を足すときは、同じトランザクションから必ず呼ぶこと。

### ライフは全期間再計算

`EventLifePoint` と `EventLifeLedger` は毎回まるごと入れ替える。増分にすると、
勝敗の変更・VOID・ルール変更を遡って反映できない。

- 決着時刻は `EventMatch.decidedAt`（自動検知なら実測の終了時刻、主催者の確定ならその時刻)。
  **`updatedAt` を使わない**（再集計のたびに動いて適用順が不安定になる）。
  `decidedAt` が null の対戦は「まだ決着していない」のでライフ計算に入れない
- 同時刻の決着は `matchId` で並べて安定させる
- 0 になった時点で脱落。それ以降のイベントは適用しない。**この判定は適用順に依存する**ので、
  並び順の規則を変えるときは慎重に
- **脱落者が1人でも含まれる対戦は、丸ごと無視する。** 脱落した側だけ飛ばすと相手には
  WIN が入り、回復ありの設定では「脱落者と組まれた側だけが得をする」ことになる
- 参加者が0人になったら `aggregate.ts` の早期 return でライフも消す。
  残すと脱落表示が残り、対戦を組む導線が塞がれ続ける

### 確定した対戦の日程は動かせない

日程は検知の対象区間そのものなので、確定後に動かすと確定済みの検知が区間の外に出る。
ライフの適用順（`decidedAt` の昇順）も変わって脱落の結果まで変わる。`assignSession` 操作は
SCHEDULED / NO_SHOW のときだけ受け付け、それ以外は 409 で拒否する（UI 側でもボタンを出さない）。
動かしたい場合は先に「検知をやり直す」で SCHEDULED へ戻す。

### 同じ日程に同じ出場者の対戦が並ぶのは常態

1回戦と2回戦が同じ日程に同居するので、かつての「時間枠を重ねさせない」検証は無くなった
（`assertMatchWindow` → `assertEventSession`）。曖昧さは検知側で吸収する（上記の
`AMBIGUOUS` / feeder フィルタ / 確定済みの固定）。**日程がこのイベントのものか**の確認は
書き込みと同じトランザクションで行う（`assertEventSession`）。DB 側にも複合FK
`(eventId, sessionId)` がある。

### 日程の更新は差分。全置換にしない

`src/event/session-update.ts` の `applySessionDiff()`。対戦が `sessionId` で日程を参照して
いるので、delete → create で作り直すと割り当てが壊れる（FK は `Restrict` なのでそもそも
消せない）。設定フォームは既存の日程 id を必ず送り返すこと（`SessionFormValue.id`）。
外部キーを `Restrict` にしてあるのは、**日程を全置換する古いコードが動いても表を消させない**
ため。イベントごと削除するときは、DELETE が対戦を先に消してから Event を消す。

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

## 勝利条件（1本勝負/2本先取）— 対戦カード1件が複数バトルを持つ

`Event.rules.matchRules.winCondition`（`src/event/match-rules.ts`）が実際のバトル検出・
勝敗確定に反映される。以前は表示専用の設定だった。設計は2回の Codex 独立レビューを経て
確定している。ここには壊しやすい箇所だけ書く。

### データモデル: `EventMatchBattleCandidate`

1対戦カード（`EventMatch`）が複数の候補バトルを持てるようにする子テーブル。**採点結果は
キャッシュしない** — `resolveMatchSeries()`（`match-results.ts`）が呼ばれるたびに毎回
`scoreSides()` で再計算する（全期間再計算という既存の集計哲学に合わせるため）。

- `selected`: `resolveMatchSeries()` が毎回計算する「現在の実効ゲーム集合
  （effectiveGames）」。`loadBattleRangesByRoom()` はこの列だけを見る
- `organizerSelected`: 主催者が「候補過多」画面で選んだプール。`selectCandidates` API
  だけが書き、`resolveMatchSeries()` は書き換えない
- **この2列を混同しないこと。** 混同すると、主催者が選んだ候補のうち先取に届かず
  未使用だった分（`selected=false`）を、後から遅延ギフトで結果が反転したときに
  再評価できなくなる（1回目のレビューで実際に指摘された欠陥）
- `ambiguous`: 同じバトルが複数の対戦カードの room 集合と完全一致した（cross-match衝突。
  デスマッチの同一組み合わせ複数カードで起きる）。**一度 true になったら「検知をやり直す」
  まで sticky に true のまま**（片方のマッチが `confirm` で `open` から外れても、
  もう片方の判定が動的に false へ戻らないように）

### 検知の凍結条件は「決着」ではなく「主催者の確定」

`detectMatches()`（`battles.ts`）の `open` フィルタは `status !== "FINISHED"` では対象から
外さない。**自動確定（AGGREGATE）は日程が終わるまで検知を続け、超過候補が見つかったら
差し戻す。** 凍結するのは主催者が候補選択を明示的に確定した
（`rules.candidatesConfirmedByOrganizer=true`）マッチだけ。

### 下流が着手済みなら、超過検知でも既存結果を差し戻さない

`resolveMatchSeries()` の候補数超過判定・候補0件の後始末は、`downstreamStarted`（次ラウンドが
`isStartedMatch()`）なら**何もせず既存の確定結果を維持する**（ユーザー確定方針、安全重視）。
これにより「上流は未決着、下流は旧勝者のまま」という矛盾状態を構造的に防いでいる。
**新しい差し戻し経路を足すときは、この `downstreamStarted` ガードを外さないこと。**

### `decidedAt` が優先参照先。`detectedEndAt` は表示用ミラーでしかない

`EventMatch.detectedStartAt/detectedEndAt` 等は「現在の実効ゲーム集合（`selected=true`）の
最初/最後」を指す**表示専用のミラー列**。ライフ計算（`life-points.ts`）とfeeder境界判定
（`battles.ts`）は **`decidedAt` を優先し、`detectedEndAt` へはBYE確定等の後方互換としてだけ
フォールバックする**。`resolveMatchSeries()` は決着（AGGREGATE）時に必ず `decidedAt` を書く。

### 候補が「終了時刻はあるがまだ未来」なら進行中（LIVE）として扱う

duration から終了時刻を計算した OPEN 状態のバトルは、`endedAt` が非nullでも、その時刻が
まだ `now` より先なら `pending` 扱いにする（`resolved` に混ぜて `scoreSides()` を呼ばない）。
混ぜてしまうと、まだ終わっていないバトルの結果を先取りして確定させてしまう。

### 開催後は `matchRules.winCondition` を変更できない

対戦カードが1件でもあるイベントでは変更不可（イベント更新API、`acquireEventLock` 取得後に
`EventMatch.count()` を読み直して判定する）。`matchRules` の他フィールド（グローブ等）は
引き続き変更できる。DB件数を扱う判定なので `validation.ts`（純粋関数層）には置けない。

### `selectCandidates` / `resetCandidates` の楽観的排他

候補ID集合だけでなく、`endedAt`/`confidence`/`ambiguous` を含めた指紋（`candidatesFingerprint`、
`src/event/candidates-fingerprint.ts` の `buildCandidatesFingerprintInput`）で照合する。
既存の `expectedMatchIds`（`destroyBracket`）パターンは「表の同一性だけを保証し、行内容の
鮮度は保証しない」ため、候補選択にはそのまま流用できない。ハッシュ化はサーバー側
（`route.ts`、Node.js `crypto`）とクライアント側（`MatchManager.tsx`、Web Crypto API）で
実行環境が異なるため別々に行う — 共有するのは入力文字列を組み立てる部分だけ。

### マイグレーション

`EventMatchBattleCandidate` は新規テーブルなので `prisma db push` 自体は普通に通る。
既存 `EventMatch` の検知結果を複製するバックフィル（`scripts/migrate-match-battle-candidates.ts`、
意味変換つき・冪等）を db push の後・`server.js` 起動の前に Dockerfile CMD で実行する。
**新旧 `event-worker` を同時に動かさないこと**（旧版は「最新候補ミラー1本」だけでシリーズ
勝者を上書きしうる）。ロジック変更（`detectMatches`/`resolveMatchResults` 書き換え）を含む
デプロイの前に `event-worker` を一度止めるのが安全。

## 候補調整モード — 検知バトル候補の「合算」（途中終了+やり直しの救済）

TikTok Live のバトルは熱暴走・通信トラブルで途中終了することがある。運用慣例は
「2戦目を行い、1戦目の途中終了したバトルのスコアを加算して勝敗をジャッジする」。
これを実現するため、`EventMatchBattleCandidate.combinedGroupId`（nullable String）を主催者が
明示的に書き込むことで、複数の候補バトルを1ゲームとして合算できる。設計は2回の独立レビュー
（1回目Codex・2回目fable-expert、Codex利用制限のためフォールバック）を経て確定している。
ここには壊しやすい箇所だけ書く。

### `combinedGroupId` — 合算グループの印

- null = 単独ゲーム（従来どおり1候補=1ゲーム）。同じ値を持つ候補群は
  `resolveMatchSeries()` がスコアを合算して1ゲームとして扱う
- **`selectCandidateGroups` API だけが書く。`organizerSelected` と対で運用する不変条件**
  （「非null ⇒ `organizerSelected` も true」。`void`/`reopen`/`resetCandidates`、および
  `confirm`/`draw` の検知破棄しないパスは必ず両方をクリアする）
- 値そのものに意味はない不透明な文字列（サーバーが `crypto.randomUUID()` で発行）。
  同じ `matchId` 内に複数のグループが同時に存在してよい

### 候補調整モード — `CANDIDATES_EXCEEDED` とは別の入口

生候補数がちょうど `maxGames`（勝利条件の要求本数）に収まると、`resolveMatchSeries()` の
超過判定（`!organizerCurated && resolvedGroups.length > maxGames`）に一度も引っかからず、
そのまま複数ゲームとして自動確定してしまう。**これは合算機能が最も必要になる典型ケース
そのもの**（例: BEST_OF_THREE で「途中終了A+やり直しB=1本」「正常終了C=1本」の生候補3件は
`maxGames=3` とちょうど一致し `CANDIDATES_EXCEEDED` を経由しない）。

そこで `canAdjustCandidates()`（`src/event/match-status.ts`）を判定基準の1箇所にし、
**API・UI・低ダイヤ計算のスコープ絞り込みの3箇所すべてがこれを参照する**
（`isReadyForDetection()` が検知経路の唯一の判定基準になっているのと同じ思想）。

```ts
export function canAdjustCandidates(match: {
  status: string;
  winnerDecidedBy: string | null;
  candidateCount: number;
}): boolean {
  if (match.candidateCount < 2) return false;
  if (match.status === "VOID" || match.status === "NO_SHOW") return false;
  if (match.winnerDecidedBy && MANUAL_DECISION_WINNER_KINDS.has(match.winnerDecidedBy)) return false;
  return true;
}
```

- **`CANDIDATES_EXCEEDED`(強制)**: 既存どおり `status === "NEEDS_REVIEW" && reviewReason
  === "CANDIDATES_EXCEEDED"` のとき、候補選択UIは強制的に開いたまま(既存挙動)
- **候補調整モード(任意)**: それ以外で `canAdjustCandidates()` が true の対戦
  （自動確定済みの BEST_OF_THREE を含む）に、「候補を調整する」ボタンを新設し、
  主催者が能動的に開く

**超過判定の式自体は変更しない。** 候補調整モードは「主催者が明示的に
`organizerSelected`/`combinedGroupId` を書き込んで `candidatesConfirmedByOrganizer=true` に
する」という書き込みの起点を増やすだけであり、`resolveMatchSeries()` 側は
「`organizerCurated` になったかどうか」しか見ない。

`⚠️トラブル対処`（`forceFullPeriod`、赤枠・確認ダイアログ必須）とは性格が異なるため
視覚的に分離する（黄枠、確認ダイアログなし）。合算は異常対応ではなく仕様どおりの通常操作。

### pool-then-group化 — グルーピングは未来終了フィルタより前に行う

`resolveMatchSeries()`（`match-results.ts`）は、先に `resolved`（終了確定済み）へ絞ってから
グループ化すると、グループの1メンバーだけ未来終了（duration由来のLIVE）のときにそのメンバー
だけ静かに脱落し、「完了済みメンバーだけの偽の1件グループ」として確定してしまう。

**必ず `pool` 全体を先にグループ化してから、グループ単位で完了判定する**：

```ts
const orderedPool = sortCandidatesDeterministically(pool);
const groupedPool = groupByCombinedGroup(orderedPool);
const isGroupResolved = (g) => g.every((c) => c.endedAt !== null && c.endedAt <= now);
const resolvedGroups = groupedPool.filter(isGroupResolved);
const pendingGroups = groupedPool.filter((g) => !isGroupResolved(g));
```

候補数超過判定・実効ゲーム集合の計算（`scoreSides()` をグループのメンバー分ループして合算
してから `resolveGameWinner()` を1回呼ぶ）・未決着時の `pending` 判定は、すべて
`resolved`/`pending`（フラット化した配列）ではなく `resolvedGroups`/`pendingGroups` を基準にする。

**API側（`selectCandidateGroups`）でも二重防御を入れる**: 候補IDバリデーション時に
`endedAt === null || endedAt > now` の候補を含む選択は400で拒否する。これにより未来終了候補を
含むグループが `organizerSelected` として保存されること自体を未然に防ぐ。

### `validateCandidateGroups()` — groupsは「候補の厳密な分割」でなければならない

`src/event/candidate-groups.ts`。**「平坦化した集合が candidateIds の集合と一致」だけでは
不十分** — `[[a,b],[b,c]]` のような重複ID混入を検出できず、`b` が後勝ちのUUIDで上書きされて
検証したグループ数とDB上の結果が食い違う。各IDが全グループを通じてちょうど1回だけ現れる
ことを構造的に検証し、各グループが `startedAt→battleId` 順で連続区間を成すことも確認する。

UI側（`MatchManager.tsx` の `deriveGroupsFromSelection()`）は「checkedIds」と
「mergeWithPreviousIds（前の候補と合算する）」の2集合から groups を導出することで、
**構造的にグループの厳密な分割しか作れない**（id重複・非連続が原理的に発生しない）。
`selectedCandidateIds` と `mergedGroups` を別々の state として個別管理しない — 重複所属・
チェック解除・低ダイヤ非表示との不整合を構造的に防ぐため。

### `selectCandidateGroups` — 新しいaction、既存`selectCandidates`は無改修のまま

ローリングデプロイ対策として、既存の `selectCandidates` に `groups` パラメータを追加する
のではなく、**新しいaction名 `selectCandidateGroups` を新設し、既存 `selectCandidates` は
無改修のまま残す**（旧クライアントの安全な着地点）。旧Webサーバーが未知の `groups` を無視して
`candidateIds` を独立ゲームとして受理してしまう、旧event-workerが `combinedGroupId` を読まず
独立ゲームとして再計算してしまう、という誤判定を避けるため。

デプロイは `EVENT_WINNER_FEEDER_SWAP` と同じ2段階パターンを踏襲する
（feature flag: `EVENT_CANDIDATE_GROUPING`、既定オフ）:

1. **列追加**: `combinedGroupId` を `prisma db push`。既存行は全部 `null`
2. **reader配布**: `resolveMatchSeries()` のグループ対応版を event-worker と Web の両方へ
   デプロイ。フラグは未設定(オフ)のまま。DB上は `combinedGroupId` が依然全部 `null` なので、
   `groupByCombinedGroup()` は「候補1件=グループ1件」に退化し、新旧ロジックは出力が完全に
   一致する（既存integrationテストがそのまま回帰確認になる）。`selectCandidateGroups`
   ハンドラのコードも同時にデプロイしてよい（フラグチェックで即400を返すため実害はない）
3. **旧event-worker消滅確認**: event-worker Railwayサービスのローリング再起動が完了し、
   新ビルドの1リビジョンのみが稼働していることを確認する
4. **writer/UI有効化**: Webの `EVENT_CANDIDATE_GROUPING=1` を設定

**`combinedGroupId` を持つ行が1件でも存在する状態での旧バージョンへのロールバックは禁止**
（`winnerFeeders` と同じ注記）。ロールバックが必要な場合は、対象マッチに `resetCandidates`
（`combinedGroupId` を明示的に全クリア）してから行う。

**フラグOFF期間中のUIフォールバックを忘れないこと。** `MatchManager.tsx` の確定ボタンは
`candidateGroupingEnabled` が false のとき常に旧action（`selectCandidates`、合算UIなし）へ
フォールバックする。段階的デプロイの reader配布〜writer有効化の間（旧event-worker消滅確認を
挟むため数時間〜数日）は、サーバー側が `selectCandidateGroups` を常に400で拒否するため、
フォールバックが無いとその間 `CANDIDATES_EXCEEDED` を主催者が一切確定できなくなる
（2回目レビューで発見された欠陥。既存機能の一時停止を招くため必須）。

低ダイヤ非表示フィルタ（次節）はこのフラグの対象**外**とする — DBの新規書き込みを伴わない
純粋な表示フィルタであり、event-workerのバージョン不整合とは無関係なため、通常のデプロイで
そのまま有効化してよい。

### 楽観的排他 — `candidatesFingerprint` と `selectionFingerprint` の2本立て

`buildCandidatesFingerprintInput()`（`src/event/candidates-fingerprint.ts`）に `startedAt`
が要る。検知ワーカーは候補の `startedAt` を更新しうる（`battles.ts` の upsert）が、合算の
連続性・順序判定はこの値に依存するため、含めないと画面を開いた後に検知データが動いても
気づけない。

`resetCandidates` と、既に `candidatesConfirmedByOrganizer` 済みの対戦への再
`selectCandidateGroups` は、検知データの指紋に加えて**新規 `buildSelectionFingerprintInput()`
（選択状態: `organizerSelected`/`combinedGroupId`）も照合する** — 主催者の判断を古いタブ・
別画面から無条件に上書き・消去させないため。`combinedGroupId` はサーバー発行UUIDで再選択の
たびに値が変わるので、生の値ではなく「そのグループの先頭候補ID」を代表値として正規化してから
比較する（同じ分割なら同じ指紋になる）。

### 公開API — `games`（合算グループ単位）は`battles`（候補単位）に加算する

`match-detail.ts` の `PublicMatchDetail.battles`（既存、`BattleDetail[]`）は**現状のフィールド
構成のまま無改修**にする。認証不要の公開API（`/api/public/events/[slug]/bracket/[matchId]`）が
これをそのまま返すため、既存の外部利用者にフィールド追加以外の変更を発生させないための設計
判断（APIバージョニングは導入しない）。

新規に `games: GameDetail[]`（合算グループ単位）を**加算**する。`loadPublicMatchDetail()` は
既存の `battles` 計算結果を再利用して組み立てる（2回目のギフト集計は発生させない）。

**`games` のグループ化は `selected: true` の候補だけを対象にすること。** 全候補を対象にすると、
中心シナリオ（「途中終了A(21:00)+やり直しC(22:00)を合算し、間に挟まったゴミ検知B(21:30)を
非選択で除外」）で全候補のソート列がA,B,Cとなり、合算グループのメンバーA,Cが非隣接になる。
`groupByCombinedGroup()` は隣接一致しかまとめないため、Gが「A単独」「C単独」という2つの
偽のゲームに分断されて公開表示されてしまう（2回目レビューで発見された欠陥。合算機能そのものの
正しさを壊す）。`selected` 列は `resolveMatchSeries()` が計算する「現在の実効ゲーム集合」で、
`validateCandidateGroups()` が保証する連続性も選択集合内での連続性なので、選択後の `selected`
列を定義域にすることで書き込み時の検証と表示時のグループ化が一致する。

`games` の組み立ては `battleState === "AVAILABLE"` 分岐の内側で行うこと（外だと候補0件・
VOID・NO_SHOW等で `battleByCandidateId.get(c.id)!` が `undefined` になる）。`games` に含まれない
候補（非選択・承認待ち等）は `battles` 側にそのまま残るので、表示側（`match-detail-ui.tsx`,
`BattleCard.tsx`）は `games` をメインに描画しつつ `battles` のうち `games` のどの
`candidateIds` にも含まれない候補を別枠（`UnselectedBattleNote`）で表示する。「候補単位の
TikTokスコアと『結果に未反映』の表示を失わない」という要件を満たすため。

TikTokスコア（hostScore）は候補単位のまま合算しない（`GameDetail` に `tiktokScores` フィールド
自体を持たせていない）。単一候補のゲームでは `BattleCard.tsx` が対応する `BattleDetail` から
表示し、合算グループ（候補2件以上）では表示しない。

### `match-contributions.ts` — 合算グループを持つ対戦だけ候補区間unionに切り替える

`resolveMatchSpans()`（`match-spans.ts`）は `detectedStartAt`〜`detectedEndAt` を1本の連続
区間として扱うため、合算グループを持つ対戦ではCUT_SHORT終了〜やり直し開始の空白ギフトが
貢献者モーダルにだけ混入し、勝敗・順位の対象区間（`scoreSides()` が候補ごとに個別集計する
区間）とズレる。

`combinedGroupId` を持つ選択済み候補が1件でもある対戦だけ、`resolveGroupedMatchSpans()`
（各 `selected: true` 候補の `[startedAt, endedAt)` を個別に日程で切ってから結合）へ分岐する。
**通常のBO3（合算なしのゲーム間の空白）は対象外とし、既存の連続区間のまま維持する**（合算機能
導入前から存在する別の既知差異であり、本機能のスコープを広げてまで直す理由がない）。

`selectCandidateGroups` は候補選択の完了（全メンバーの `endedAt` 確定）を要求するため、この
経路に来る時点で対象候補は必ず確定済み — 「進行中(LIVE)の合算グループ」というケース自体が
発生しない。したがって `resolveGroupedMatchSpans()` の `provisional` は常に `false` でよい。

### 低ダイヤ候補の非表示フィルタ — オンデマンドAPI（page.tsx の事前計算にしない）

候補選択UIの「1000ダイヤ以下のバトルを隠す」トグル（初期状態でON）用の生ダイヤ集計は、
`page.tsx`（対戦一覧のサーバーコンポーネント）で事前計算**しない**。

理由: `canAdjustCandidates()` は「候補調整モードの入口」として、確定済みBEST_OF_THREE
（FINISHED・AGGREGATE、候補2件以上）も意図的にtrueを返す設計（指摘1の救済対象そのものの
ため除外できない）。この述語を低ダイヤ計算の対象絞り込みにそのまま使うと「確定済み対戦は
対象から外れる」という前提が成立せず、`MatchManager.tsx` は10秒ポーリングで再描画されるため、
大きめのブラケットでは毎ポーリングごとに大量の候補別ギフト集計が走りうる（2回目レビューで
発見された欠陥）。

代わりに、候補選択パネル/候補調整パネルを開いたときにだけ叩く新規GETエンドポイント
（`GET /api/events/{id}/matches/{matchId}/candidate-diamonds`、ロジックは
`src/event/candidate-diamonds.ts` の `loadCandidateDiamonds()`）に切り出した:

- ダイヤは倍率適用前の生値（`resolveGameWinner()` が倍率適用前ダイヤで勝者を決めているのと
  同じ考え方）。`scoreSides()` に `multipliers: []` を渡せば倍率がかからない
- 区間は対戦固有の `EventSession` 単体を使う（日程未割り当ての旧データだけ
  `resolveEventWindows(event)` へフォールバック、「期間の正本はEventSession」の不変条件を
  満たす）
- 未来終了(duration由来のLIVE)候補は計算せず `diamonds: null` を返す（進行中候補が低ダイヤ
  扱いで隠れる事故を防ぐ）
- **fail-open**: 集計に失敗した候補は該当候補だけ `diamonds: null` を返し、API全体・対戦
  全体は落とさない

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

公開ページの順位表は `STANDING_HEADINGS` で種目ごとに見出しを変えている
（デスマッチは集計が回っていれば「ライフ」表示に差し替わる）。`FORMAT_PENDING_NOTES` は
フェーズ4・5で中身が空になった。新しい未実装の種目を足すときに使う。
