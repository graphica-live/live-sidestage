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

## 集計の規則（実装時に迷ったらここ）

- 期間は `[startAt, endAt)` の半開区間、`receivedAt` 基準、Asia/Tokyo
- 公式スコアは元の `gifts` のみ。`gift_edits` は無視する
- ポイント = ダイヤ実数 × 倍率。**1件のギフトに適用される倍率は必ず1つ**。
  BATTLE 区間に入るなら BATTLE、入らなければ SOLO_STREAM。合計も乗算もしない。
  同じ kind が複数該当したら最も大きい factor を1つだけ採る
- ダイヤ合計は `BigInt`（`Int` だと 21億を超えうる）
- TikTok 側の `battleId` / `hostScore` / `startTimeMs` は API 上すべて `string`。
  `battleId` と `hostScore` は文字列のまま保存する

## 集計ワーカー（フェーズ3以降）

- 全期間再集計。増分カーソルは持たない（バトル区間が後から確定するため）
- イベント単位の PostgreSQL advisory lock で排他する
- `setInterval` には in-flight guard を持つ。analytics の `worker.ts` には guard がないので踏襲しない
- `Event.aggregateMs` を記録し、SLO（1イベント10秒以内）の 50% を超えたら増分 rollup へ移行する

## テストの作法

analytics に揃える。

- `*.test.ts` = unit（DB不要）、`*.integration.test.ts` = ローカル Postgres 必須
- テスト名は日本語
- integration は `itest_` プレフィックスでデータを分離し、カスケード削除で後片付けする
- ロジックは純粋関数に切り出して unit でカバーする（`scoring` / `match-detect` / `bracket` / `deathmatch`）

## 未実装（計画上のフェーズ）

現在はフェーズ1（walking skeleton）まで。

| フェーズ | 内容 |
| --- | --- |
| 1 ✅ | プロジェクト雛形、共有 User 認証、イベント CRUD、公開ページの器、CI |
| 2 | 参加者登録 + room lease（analytics 側の `monitorUntil` / 内部API / `getMyRooms()` 変更を含む） |
| 3 | 獲得ダイヤレース（集計ワーカー、ランキング、EXPLAIN ANALYZE と SLO の確定） |
| 4 | バトルトーナメント（実 payload の fixture 取得 → battle 検知 → マッチ照合） |
| 5 | デスマッチ（ライフポイントエンジン） |
| 6 | 都道府県UI（日本地図） |

`prisma/schema.prisma` にはフェーズ5までのモデルが入っているが、使っているのはフェーズ1の範囲だけ。
