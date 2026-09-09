# project-dictionary — 用語・識別子の正本

このプロジェクトで**意味が固定されている語**だけを載せる。運用は [.claude/skills/project-dictionary/SKILL.md](../.claude/skills/project-dictionary/SKILL.md)。

- **語の意味・正式名称・別名禁止**はここが正本
- **Entityが何を表すか / 誰が正本か / lifecycle / 保存禁止項目**は [docs/architecture/ENTITY_MAP.md](architecture/ENTITY_MAP.md) が正本。ここでは繰り返さない
- **識別子3語彙の規約と改名不可の背景**は [live-sidestage-analytics/CLAUDE.md](../live-sidestage-analytics/CLAUDE.md)「識別子の命名規約」が正本
- **列の型・制約**は `schema.prisma` / `backend/lib/db/store.js` / `TikRIng/migrations/*.sql`
- ここと実コードが食い違ったら**実コードが正**。推測でどちらかを上書きせず、不整合として扱う
- 一般的な技術用語・一時変数・実装詳細は載せない

---

## 1. 識別子

### principalId

#### Definition
sidestage内部の **Principal**（Prisma model `Principal`、物理テーブル名は `User` のまま）を一意に識別するID。cuid。sidestageが発行する内部ID。immutable。`Principal.id` が実体で、主キーとして使う。認証・課金・所有の主体。

#### Not
- TikTokのユーザーIDではない（→ `tiktokUid`）
- TikTokのhandleではない（→ `tiktokHandle`）
- 「配信者」を指す語ではない（→ `Streamer` / `streamerId`）
- メールアドレスは所有証明ではない（Apple経路では `Principal.email` が null）

#### Usage
- 認証・課金・所有の主体の識別
- Principalを参照する外部キーおよび論理参照（`Event.ownerPrincipalId` はFKを張らない論理参照）

#### Naming
正式名称は `principalId`。`userId` / `sidestageUserId` / `internalUserId` / `memberId` / `creatorId` 等の別名を同一概念として新設しない。
**`userId` という語の使用は禁止**。例外は `OAuthAccount.userId` と `Session.userId` の2フィールドのみ（`@next-auth/prisma-adapter` がPrismaのフィールド名を直書きするため改名不可）。

---

### tiktokUid

#### Definition
TikTokが発行する**不変の数値ID**（型は文字列で扱う）。TikTokアカウントの同一性を定義する唯一の値。外部ID。immutable。

#### Not
- @ハンドルではない（→ `tiktokHandle`）
- sidestage内部のIDではない（→ `principalId`）
- `secUid` ではない（この体系では一切使っていない）

#### Usage
- TikTokアカウントの同一性判定・集計キー
- `TiktokRoom.hostTiktokUid` が room の同一性の定義

#### Naming
正式名称は `tiktokUid`。TLC payload の `anchorIdStr` / `data.userId`、外部API応答の `data.user.id` という名前は、**payloadのプロパティを読む式の右辺にしか書かない**。読んだ値は即座に `tiktokUid` として扱う。
`normalizeTikTokUserId()` は `"0"` を null にする（ts-proto の既定値 `userId:"0"` を弾かないと uid 不明者が全員1人へ畳まれる）。

---

### tiktokHandle

#### Definition
TikTokの @ハンドル。**ユーザー本人が変更できる mutable な外部識別子**。

#### Not
- **同一性の判定キーではない**。改名で同一人物の集計が別人として割れる
- 改名で空いたハンドルは第三者が取得しうるので、ハンドルから引いた `tiktokUid` は信用できない
- `TikTokUser` を `tiktokHandle → tiktokUid` の逆引き表に使ってはいけない

#### Usage
- 表示
- `https://www.tiktok.com/@<handle>` の生成
- TikTok接続（接続にはハンドルが要る）

#### Naming
正式名称は `tiktokHandle`。**`tiktokId` / `uniqueId` / `anchorId` という名前を使わない**（TLC payload と外部TikTok APIのプロパティを読む式の右辺だけが例外）。
唯一の関数名の例外が `normalizeTiktokId()`（`src/lib/tiktok-room.ts`。ハンドル正規化の正本として参照されているため名前だけ据え置き。扱う値の意味は `tiktokHandle`）。
**正規化ルールは保存箇所ごとに違う**（`TiktokRoom` は正規化済み、`Streamer` / `AgencyWatch` は入力そのまま、監査ログ・スナップショット系は観測そのまま）。詳細は ENTITY_MAP.md §3。

---

### roomId

#### Definition
`TiktokRoom.id`（cuid）。sidestageが発行する内部ID。1 TikTokアカウント = 1本のLIVE接続を表す器で、ギフト・コメント・バトル等**全観測データの帰属先**。

#### Not
- **TikTokの配信枠roomIdではない。** schema上の `roomId` はすべて `TiktokRoom.id`
- 配信セッション（1回のLIVE）を表す値ではない。room は永続的で、配信の開始・終了で作り直されない

#### Usage
- 観測データ（`Gift` / `ListenerComment` / `TiktokBattle*` 等）の帰属キー
- 同一 room を複数の `Streamer` と `Agency` が共有する

#### Naming
正式名称は `roomId`。TikTok側の配信枠IDを保存・命名する必要が生じた場合、`roomId` という名前を再利用しない。

---

### battleId

#### Definition
TikTokが発行するバトルの識別子。**API上stringなので数値化しない**。外部ID。

#### Not
- `BattleHistory.id`（内部cuid）ではない
- 1バトル1行を保証する値ではない。両サイドを監視していると**同じ battleId のイベントが両方の room から届く**ので、`(roomId, battleId)` の複合で一意

#### Usage
- `TiktokBattle` 系・`BattleHistory` 系の照合キー（`@@unique([roomId, battleId])`）
- 子テーブルへは**意図的にFKを張らない**（親行未作成のことがある）

---

### streamerId

#### Definition
`Streamer.id`。内部ID。「どのPrincipalがどのTikTokアカウントを所有主張しているか」＋overlay設定の置き場を識別する。

#### Not
- `principalId` ではない（`Streamer.principalId` は @unique だが別の語）
- `roomId` ではない。**データは room 単位、設定は Streamer 単位**という非対称が設計の核

#### Usage
- `Overlay*Settings` 5種の @id 兼 FK

---

### apiKey / overlayToken / shareToken

#### Definition
サーバーが発行するシークレット。`Streamer.apiKey`（**平文保存**）/ `Streamer.overlayToken` / `BattleHistory.shareToken` / `AmbassadorInvite.token` / `PendingPurchaseIntent.token` / `Agency.apiKeyHash`（SHA-256）。

#### Not
- 識別子ではない。認可の材料であって、同一性の判定キーに使わない
- `Agency` はハッシュ、`Streamer` は平文という非対称は**意図的**（schemaに「Streamerの平文保存は踏襲しない」と明記）

#### Naming
新しいシークレット列で `Streamer.apiKey` の平文方式を踏襲しない。

---

### workerId

#### Definition
`TiktokRoom.workerId`。room を担当する Worker プロセス番号。

#### Not
- **`hash(roomId) % WORKER_COUNT` は初回決定の既定値にすぎない。** worker-guardian の死亡移送・コラボ自己申告がhashと無関係な値を書くため、**列の値が常に正**。hashから再計算して判断しない

---

### desktop（TikEffect）の識別子は体系が違う

#### Definition
`live-sidestage-desktop` のローカルSQLiteは、保存しているのが `unique_id`（＝@ハンドル）だけで、**数値の tiktokUid を列に持たない**。`broadcaster_id` も @ハンドル。

#### Not
- analytics の3語彙規約をそのまま適用できない
- `unique_id` を「不変ID」と読まない。**PKも集計キーも改名で割れる**

---

## 2. ドメイン語

### Principal

sidestageの「人」。Prisma model 名は `Principal`、**物理テーブル名は `User`**。認証・課金・所有のルート。`Agency` とはFKもrelationも持たない別系統。詳細は ENTITY_MAP.md §2.1。

### Streamer

sidestageユーザーによる**TikTokアカウントの所有主張**と、contributionオーバーレイの個人設定。**「配信者という人」を表すEntityではない**（人は `Principal`、TikTokアカウントの表示名は `TikTokUser`、接続とデータの器は `TiktokRoom`）。

### Agency

事務所アカウント。自分ではTikTok IDを持たず `AgencyWatch` 経由でのみデータを見る。**`Principal` とFKもrelationも無く、ログイン中のGoogleメール一致だけで解決する。** 「行が存在すること自体が利用許可」なので承認フラグを持たない。

### TikTokUser

`tiktokUid` → `tiktokHandle` / `nickname` の解決表。**表示名の正本**。対象は**視聴者を含む全TikTokアカウント**で、roomでもstreamerでもない。

### Event（大会）

`event` スキーマの大会運営ドメイン。**HTTPのイベントやTLCの受信イベントとは無関係。** 集約ルートが `Event`。

| 語 | 意味 |
| --- | --- |
| `EventSession` | 集計区間 `[startAt, endAt)`（半開区間。隙間は集計しない）の正本 |
| `EventMatch` | 対戦。勝敗の正本 |
| `EventMatchSide` | 対戦の陣営枠。得点は `public.gifts` から毎回再計算する derived |
| `EventMatchSideParticipant` | **誰が実際に出場するか**の junction。チーム戦でも出場者はここが持つ |
| `EventParticipant` | 出場者。identity は `tiktokUid`（取れなければ登録拒否のfail-closed） |
| `DetectedBattle` | `TiktokBattle` を `event` スキーマへ raw SQL でコピーしたもの |

### Battle（生観測 / 確定履歴）

- `TiktokBattle*` = TikTokが送ってきた**生観測。source of truth**
- `BattleHistory*` = `TiktokBattle` + `Gift` から計算して凍結した**非正規化キャッシュ**。行の存在自体が「確定済み」フラグ
- 「ライブ中の一時データ vs 確定履歴」ではない。区別は**生観測 対 導出済みキャッシュ**
- ただし `Gift` が消える90日以降は `BattleHistory` が実質唯一の恒久記録

### giftName / giftId / labelJa

- **一致判定（効果音トリガ・集計キー）に使うのは `giftName`**（TikTokが実際に送ってくる名前）。LIVEのgiftイベントは**言語指定と無関係に英語固定**
- `labelJa` は**表示専用**。一致キーに日本語を入れると**例外もログも出ないまま鳴らなくなる**
- ただし配信者ごとのサブスクギフトはTikTok自身が日本語名で送る（例:「わやハグ」）ので、「一致キーは常に英語」ではない
- **`giftId` を identity として信用しない。** 実測で複数の giftId が同じ名前を持ち、レスポンス内で重複もする。消費側は name で畳む

### PlanTier / 実効プラン

`PlanTier` enum は `FREE` / `PRO` / `ULTRA`。
**「実効プラン」に単一の正本は存在しない。** `Subscription` 複数行（Web/Stripe とモバイル/Google Play・Apple は独立に成立する）＋ `Ambassador` 行の存在（行がある = PRO無料）＋ `AppSetting` のβフラグ の合成で、`getUserPlan()` を通して算出する。**単一の列で表せる場所は無い。**

### βフラグ

`AppSetting` の `mobileBetaEnabled` / `analyticsBetaEnabled` / `eventsBetaEnabled` / `agencyBetaEnabled`。**fail-closed で `"true"` のみ有効**。
**FREEの制限を一時解除するだけで、プランは書き換えない**（旧設計でULTRA昇格に使った反省）。

### 購読（room購読）

**`TiktokRoom` が誰かの監視対象になっている状態。** 単一の列は無く、次の4経路のいずれかが成立していれば「購読あり」。判定の正本は `hasBattleSubscriber()`（`src/lib/battle-subscription.ts`）。

| 経路 | 条件 | 主体 |
| --- | --- | --- |
| Streamer登録 | `Streamer.roomId` の行が存在 | sidestageユーザー |
| AgencyWatch登録 | `AgencyWatch.roomId` の行が存在 | `Agency` |
| 特別監視 | `TiktokRoom.specialWatch === true` | 管理者（`/admin/workers` 手動ON / `ensureRoomWatchedByAdmin`） |
| イベント参加 | `TiktokRoom.monitorUntil > now` | `Event`（`RoomMonitorLease` 経由） |

#### Not

- **課金の定期購読（`Subscription` / Stripe / Google Play / Apple）ではない。** 同じ「購読」でもドメインが全く別
- socket.io のイベント購読（`overlay:` / `chat:` / `effects:` の subscribe）でもない
- `TiktokRoom.watchSource` は**現在の購読状態ではない**。「最初に発見された経路」の記録なので判定に使わない
- listener 側の `subscriberIds`（`tiktok-listener.ts`）は**Streamer由来のIDだけ**で、購読4経路の全体ではない。`specialWatch` が別条件として並記されるのはこのため（`inst.subscriberIds.size > 0 || inst.specialWatch`）

#### Usage

- `BattleHistory` を確定してよいかのゲート（購読なしroomは確定しない）
- `gift-retention` の削除保護（購読なしroomのギフトは保護対象外）
- コラボ相手の room を監視対象へ引き込むキック条件

---

## 3. 略語・製品名

### TLC

`tiktok-live-connector`。ギフト/コメント受信の共通土台となるライブラリ。「TLC payload」はこのライブラリが渡してくる生イベント。

### 製品名 / ディレクトリ名 / パッケージ名は三者三様

**混同しない。** 正本は [ルートCLAUDE.md](../CLAUDE.md) の表。

| ディレクトリ | 製品名 | パッケージ名 |
| --- | --- | --- |
| `live-sidestage-analytics` | LIVE Sidestage Analytics | `live-analytics` |
| `live-sidestage-desktop` | **TikEffect** | `tikeffect` |
| `live-sidestage-mydesktop` | **MyDesktop** | `live-sidestage-mydesktop` |
| `live-sidestage-mobile` | LIVE Sidestage (Android) | `live_sidestage_mobile` |
| `TikCaption` | TikCaption | `tikcaption` |
| `TikRIng` | **TikRing** | `profileimagefitservice` |

- **`TikRIng` はディレクトリ名の綴り（大文字I）で、製品名は TikRing。** 統合前のリポジトリ名は `frame`
- **desktop（TikEffect）と mydesktop（MyDesktop）は別アプリ。** mydesktop は desktop（ポート38100固定）へ socket.io-client で接続するだけの観測者アプリで、SQLite・TikTok接続・動画保存ロジックを持たない
- イベント（大会）運営機能は独立プロジェクトではなく `live-sidestage-analytics/src/event/` にある

### worker / worker-guardian / event-worker

Railway上のanalyticsサービス構成の語。`web` + `worker1/2/3` + `event-worker` + `worker-guardian`。`worker-guardian` は死亡したworkerの担当roomを移送する。

### euler sign

TikTok接続に使う署名API。使用実績は `EulerSignUsage`（リクエスト1回 = 1行、FKを一切張らない）、APIキーは `AppSetting.eulerSignApiKey`（**平文**）。
