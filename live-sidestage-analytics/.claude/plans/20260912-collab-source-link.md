# TiktokRoomCollabSource — コラボ解散時のコラボ相手監視の即時停止

## 背景と問題

live-sidestage-analytics は TikTok LIVE へ匿名 WebSocket 接続する worker を持つ。接続はプロキシの sticky 枠と EulerStream 署名 API 枠という有限リソースを消費する。

Streamer 登録済み room（または `specialWatch`）がコラボを検知すると、コラボ相手（サービス未登録）の `TiktokRoom` 行が作られ、`lastWatchInstructedAt` が現在時刻になって監視対象へ入る（`watchedRoomFilter()` の枝5: `!monitoringSuspended && lastWatchInstructedAt > now - 30分`）。

この `lastWatchInstructedAt` は **コラボメンバー変動イベント（`WebcastLinkLayerMessage.messageType:18`）でしか更新されない**。したがって:

- コラボが 5 分で終わっても 30 分経つまで接続が残る（25 分ぶん無駄）
- コラボが 30 分以上続いてもメンバー変動がなければ途中で切れる

つまり実際のコラボ継続時間と無関係な時間切れ方式になっている。

## probe 実測で確定した事実（2026-09-12、@himeka.official、900秒 8431行）

3人コラボの解散を第三者（匿名視聴者）として捕捉した。

- 解散の瞬間に飛んだのは 2 イベントのみ（`createTime` 18ms 差）:
  - **`WebcastLinkMessage` の `MessageType: 2`（`TYPE_LINKER_CLOSE`）**、`LinkerId` = コラボの channelId、`Scene: 2`
  - `WebcastLinkLayerMessage` の `messageType: 1`（`Linker_Create`）、`channelId` = 自分の roomId
- **解散時に `messageType:18` は飛ばない** → 「相手 room 側の `userInfos` 差分で離脱を検知する」案は成立しない
- `messageType:9`（`Linker_Leave`）は過去 169 件 + 今回の 8431 行で一度も観測されていない
- 900 秒で `WebcastLinkMessage` の受信はこの 1 件だけ。過去に自アカウントで観測した `MessageType:17` の連打は**第三者には配信されない** → 判定ノイズが無い
- 過去ログの `messageType:18` 169 件を調べたところ **`channelId` は全件で自分の `roomId` と同じ値**（`rtcRoomId` は `"0"`）。つまりコラボ検知時点でコラボセッション ID は取得できない

## 既存コードの実態（worktree で確認済み）

- `conn.on("linkLayer", ...)` は `tiktok-listener.ts:2882` にあるが、**`conn.on("linkMessage", ...)` は存在しない** → `WebcastLinkMessage` はまるごと捨てられている
- fork した connector（`shared/tiktok-live-connector`）には **`WebcastEvent.LINK_MESSAGE = 'linkMessage'` が既に定義済み**（`src/types/events.ts:90`）、`LinkMessageType.TYPE_LINKER_CLOSE = 2`（`src/types/tiktok-schema.ts:272`）、`WebcastLinkMessage.MessageType` / `.LinkerId` も型定義済み → **connector の改修は不要**
- `TiktokRoom.lastCollabSourceRoomId` は単一値を毎回上書きする列で、列コメントに「`/admin/workers`「コラボ署名消費」列の集計専用。購読判定・接続キック判定には一切使わない」と明記。`worker-status.ts:271` がこれを読む
- `schema.prisma` に `channelId` という列はどこにも存在しない。`TiktokBattle` も `battleId` のみ
- `ensureRoomWatchedForCollab()`（`tiktok-room.ts:423`）が相手 room 行を用意し、`watchDiscoveredRooms()`（`tiktok-listener.ts:2469`）がそれを呼ぶ。呼び出し元は `recordCollabGroupChange()`（`collab`）と `watchBattleOpponents()`（`battle_start`）の 2 経路
- worker の reconcile は `worker.ts:177 reconcileOnce()`、30 秒周期（未 ready 時 5 秒）

## 未解決の問題: 複数の発見元

- 登録ユーザー X が未登録 Z とコラボ → Z の room を監視開始
- 同時に登録ユーザー Y も**同じ Z** とコラボ（`TiktokRoom` は `hostTiktokUid @unique` なので Z の行は 1 つしかなく共有される）
- **X と Z のコラボだけが解散**した

このとき Z の監視を止めると、まだコラボ中の Y の観測まで失われる。しかも Y 側からは再発見されない（メンバー変動がなければ `messageType:18` が飛ばないため）。利用者が増えるほど衝突は増える。

`lastCollabSourceRoomId` は単一値なので複数の発見元を同時に保持できない。

## 採用する設計

### 1. 新テーブル `TiktokRoomCollabSource`

「監視対象 room × 発見元 room」の多対多リンク。

```prisma
model TiktokRoomCollabSource {
  id            String   @id @default(cuid())
  watchedRoomId String
  sourceRoomId  String   // FK なし(論理参照)
  createdAt     DateTime @default(now())
  lastSeenAt    DateTime @default(now())

  watchedRoom TiktokRoom @relation(fields: [watchedRoomId], references: [id], onDelete: Cascade)

  @@unique([watchedRoomId, sourceRoomId])
  @@index([sourceRoomId])
  @@index([lastSeenAt])
  @@map("tiktok_room_collab_sources")
  @@schema("public")
}
```

`TiktokRoom` 側に `collabSources TiktokRoomCollabSource[]` を追加する。既存列の型・制約は一切変更しない。

`lastCollabSourceRoomId` は従来どおり「直近の引き金」の集計用として残し、新テーブルとは役割を分ける（ユーザー指示）。

### 2. lifecycle

| 契機 | 処理 |
| --- | --- |
| コラボ/バトル相手を検知 | `{ watchedRoomId, sourceRoomId }` を upsert。update 側で `lastSeenAt = now()` |
| 発見元 room で `TYPE_LINKER_CLOSE` を受信 | `sourceRoomId = <その room>` のリンクを全削除 |
| リンク削除後 | リンクが 0 件になった watched room の `lastWatchInstructedAt` を期限切れ方向へ倒す |
| TTL cleanup | `lastSeenAt < now - 30分` のリンクを削除 → 同じ 0 件判定を実行 |
| 30 秒 reconcile | `watchedRoomFilter()` が対象外と判定した room を切断（既存の仕組み。変更なし） |

**TTL は `createdAt` ではなく `lastSeenAt` 基準**（ユーザー指示）。`createdAt` は作成時刻・デバッグ用途として残す。

### 3. race condition 対策（atomic conditional update）

「削除 → count で 0 件を確認 → 更新」という素朴な 3 ステップにはしない。この間に別 worker が新しいリンクを作ると、生存中のコラボがあるのに停止側へ倒れる。

停止用の更新は **UPDATE 実行時点でもリンクが 1 件も存在しないことを DB 側で保証する** 単一文にする。Prisma API では `NOT EXISTS` を表現できないため、この部分だけ parameterized `$executeRaw` を使う。

```sql
UPDATE public."TiktokRoom" AS r
SET "lastWatchInstructedAt" = $2
WHERE r.id = ANY($1::text[])
  AND r."lastWatchInstructedAt" > $2
  AND NOT EXISTS (
    SELECT 1 FROM public.tiktok_room_collab_sources s
    WHERE s."watchedRoomId" = r.id
  )
```

- `$1` = 削除で影響を受けた watchedRoomId の配列
- `$2` = 期限切れ時刻（`now - ANONYMOUS_ROOM_AUTO_STOP_TIMEOUT_MS - 1秒`）
- `lastWatchInstructedAt > $2` を条件に入れることで、既に十分古い行を無駄に書き換えず、時刻の巻き戻しも起こさない
- **CLOSE 経路と TTL cleanup 経路で同じ関数を使う**（ユーザー指示）

残余リスク: READ COMMITTED では UPDATE 開始時のスナップショットを見るため、直前にコミットされた INSERT を取りこぼす理論的な窓は残る。ただし取りこぼしても次のコラボ検知で `ensureRoomWatchedForCollab()` が `reviveSuspendedMonitoring()` 経由で `lastWatchInstructedAt` を再スタンプするため自己回復する。この判断はコードコメントへ残す。

### 4. `TYPE_LINKER_CLOSE` を sourceRoomId 単位で全削除する前提

この設計は **「1 つの source room が同時に複数の独立した collaboration session を保持しない」** という前提に依存する。コラボ検知時点で安定して取得できる session ID が無いため、今回はこの前提を採用して `sourceRoomId` 単位で処理する。

**この前提はコードコメントに明示する**（ユーザー指示）。将来この前提が実測で崩れた場合は `{ watchedRoomId, sourceRoomId, collabSessionId }` のセッション単位管理へ拡張する。今回は session ID を推測したり独自生成したりしない。

### 5. `watchedRoomFilter()` は変更しない

停止は `lastWatchInstructedAt` を倒すだけで行う。Streamer / AgencyWatch / `monitorUntil` / `specialWatch` がある room では OR の他の枝が真のまま残るので、この停止は自動的に no-op になる。既存 30 分 timeout はイベント取りこぼし（worker 再起動、再接続中の断、payload 構造の変化）に対するバックストップとして残す。**置き換えではなく加速。**

## 変更ファイル

| ファイル | 変更 |
| --- | --- |
| `prisma/schema.prisma` | `TiktokRoomCollabSource` 追加、`TiktokRoom.collabSources` relation 追加 |
| `prisma/migrations/<ts>_add_tiktok_room_collab_sources/migration.sql` | `prisma migrate dev` で生成 |
| `src/lib/tiktok-collab-source.ts`（新規） | `recordCollabSourceLink()` / `releaseCollabSourceLinksBySource()` / `cleanupStaleCollabSourceLinks()` / 内部の atomic conditional update |
| `src/lib/tiktok-listener.ts` | `watchDiscoveredRooms()` でリンク upsert、`conn.on("linkMessage")` を追加して `TYPE_LINKER_CLOSE` を処理 |
| `worker.ts` | reconcile 後に TTL cleanup を呼ぶ |
| `src/lib/tiktok-collab-source.integration.test.ts`（新規） | lifecycle・0 件判定・他の監視理由がある room が no-op になること |

## スコープ外（今回やらない）

- **案 B（`streamEnd` で再接続をやめる）**: `conn.on("streamEnd")` の `scheduleReconnect()` を素朴に止めると、Streamer 登録済み room が配信終了後に再接続しなくなり**次の配信開始を検知できなくなる**という重大な回帰になる。匿名観測 room に限定する条件分岐が別途必要で、ユーザーの実装指示リストにも含まれていないため今回は入れない
- 案 E（`linkMicBattle` / `linkMicArmies` 受信での `lastSeenAt` 再スタンプ）: 打ち切りを遅らせるだけで即時停止にならない。ただしこれを入れると「30 分以上続くコラボが途中で切れる」既存問題も改善しうるので、フォローアップ候補として残す

## Schema Change Justification: TiktokRoomCollabSource

- **Change**: 「監視対象 room × 発見元 room」を多対多で保持する新テーブル
- **Existing alternatives**: `TiktokRoom.lastCollabSourceRoomId`（単一値・毎回上書き）／`TiktokRoom` への JSON 列・配列列の追加／`TiktokBattle`
- **Why existing structures cannot be reused**: `lastCollabSourceRoomId` は単一値で複数の同時発見元を保持できず、列コメントで「集計専用」と明示されている。JSON 列・配列列は read-modify-write になるため、別々の worker が同じ相手 room を異なるコラボ経由で登録したときに lost update が起きる。中間テーブルなら `upsert` / `deleteMany` が行単位で原子的になり、この競合が構造的に発生しない。`TiktokBattle` はバトルを伴わない通常コラボを記録しない
- **Source of truth**: このテーブル自身。TikTok 側に対応する概念（コラボセッションの参加関係）はあるが、検知時点で session ID が取れないため写せない
- **Ownership**: `watchedRoom`（`TiktokRoom`）。room が削除されればリンクも消える
- **Lifecycle**: コラボ検知で作成 → 再検知ごとに `lastSeenAt` 更新 → `TYPE_LINKER_CLOSE` または TTL（`lastSeenAt` から 30 分）で削除
- **Relation impact**: `TiktokRoom` に逆参照 1 本を追加するのみ。既存 relation・既存列は不変
- **Duplication risk**: `lastCollabSourceRoomId` と概念が重なるが、あちらは「直近の引き金 1 件」の集計用スナップショット、こちらは「現在有効な発見元の集合」で役割が異なる。相互に同期しない（同期処理を新設しない）
- **Synchronization risk**: 無し（導出元が存在しない一次データ）
- **Migration impact**: 新規テーブル追加のみ。既存列の型・制約は変更しない。worker が web より先に起動する窓では `P2021`（テーブル未作成）になるが、既存の `schemaLagMessage()` が「スキーマ待ち」と判別して 5 秒周期の reconcile で自力復帰する
- **Rollback impact**: テーブルを落とすと 30 分 timeout のみの現行動作へ戻る。データ損失なし
- **Justification**: 複数の発見元を同時に保持しないと「片方のコラボだけ解散した」場合に生存中の観測を巻き添えで止めてしまう。単一値列でも JSON 列でも表現できず、lost update を構造的に避けられるのは中間テーブルだけ

## レビュー用参考情報（PRODUCT 相当の抜粋）

- **目的**: TikTok LIVE 配信者向けのギフト集計・ランキング・OBS 貢献者オーバーレイを提供する Web サービス（Next.js 14 + Prisma/PostgreSQL + socket.io、Railway ホスティング）。イベント（大会）運営機能も同居する
- **システム境界**: web（Next + socket.io、1 インスタンス）/ worker1-3（TikTok 接続の維持だけを行う軽量プロセス、`hash(streamerId) % WORKER_COUNT` で分散）/ event-worker（イベント集計）/ worker-guardian（worker 死活監視・フェイルオーバー）。TikTok は公式 API ではなく匿名 WebSocket
- **主要ユースケース**: 登録配信者のギフトをリアルタイム集計してオーバーレイへ push する。コラボ・バトルの相手 room も観測して対戦履歴を残す
- **連携方針**: Worker → Web は `POST /api/internal/gift-event`（`INTERNAL_API_SECRET` 保護）。スキーマ反映は web の Pre-Deploy Command のみで実行し、**worker 系サービスには migration を実行させない**（複数サービス同時マイグレートの競合回避）
- **識別子規約（厳格）**: `principalId` / `tiktokUid`（不変）/ `tiktokHandle`（可変、同一性の判定キーにしない）の 3 語彙。`userId` は `Account.userId` / `Session.userId` の 2 例外のみ。`tiktokId` という名も使わない
- **`watchedRoomFilter()` の不変条件**: 5 つの枝の **OR of 連言**。`AND(monitoringSuspended:false, OR[...])` に組み替えてはいけない（枝1・2 は `monitoringSuspended` を無視する必要がある）

## 特にレビューしてほしい点

1. `TYPE_LINKER_CLOSE` を「その room のコラボが終わった」シグナルとして `sourceRoomId` 単位で扱う判断。「相手だけが抜けて自分はコラボ継続」のケースで CLOSE が飛ぶと、継続中のコラボの相手まで止めてしまう。観測サンプルが 1 件しかない
2. atomic conditional update の SQL が意図どおりか。`ANY($1::text[])` のパラメータ化、`lastWatchInstructedAt > $2` ガードの妥当性、READ COMMITTED での残余リスクの評価
3. リンク lifecycle の穴。worker 再起動、デプロイ中の新旧 worker 並走、再接続中の断で、リンクが永久に残る／早すぎて消えるシナリオ
4. `watchedRoomFilter()` を変更せず `lastWatchInstructedAt` を倒すだけで停止させる設計の副作用。とくに `monitorUntil`・`AgencyWatch`・`specialWatch` が同時にある room
5. TTL cleanup を 3 つの worker が同時に実行することの是非（冪等な `deleteMany` + conditional update なので問題ないと判断しているが、無駄な負荷や競合が無いか）
6. schema 変更を含むデプロイでの worker 先行起動の窓。`P2021` を既存の `schemaLagMessage()` が拾えるか
