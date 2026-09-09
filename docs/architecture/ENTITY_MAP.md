# ENTITY_MAP — データモデルの意味論

`schema.prisma` のコピーではない。列の型は schema にあるので繰り返さない。ここに書くのは
**そのEntityが何を表しているか / 誰が正本か / 誰が所有するか / いつ消えるか / 何を入れてはいけないか**。

- **schema を読む前にここを読む。** schema はカラム名と型しか語らない
- **ここと実コードが食い違ったら実コードが正。** その場合はこのファイルの該当箇所を直す
- 「不明」と書いてある項目は実コードで確認できなかったもの。**推測で確定させない**
- DDL の正本は3ファイルだけ（[../../CLAUDE.md](../../CLAUDE.md) の「データモデル / DB設計ルール」）
  - `live-sidestage-analytics/prisma/schema.prisma`（Prisma。`public` + `event` の2スキーマ）
  - `live-sidestage-desktop/backend/lib/db/store.js`（better-sqlite3）
  - `TikRIng/migrations/*.sql`（Cloudflare D1）
- mydesktop / TikCaption / mobile はリレーショナルスキーマを持たない（JSON・secure storage の key-value のみ）

---

## 0. ドメイン地図

| ドメイン | 主要Entity | 一言 |
| --- | --- | --- |
| Principal / 認証 / 課金 | `User` `Account` `Session` `VerificationToken` `Subscription` `StripeCustomerLink` `PendingPurchaseIntent` `Ambassador` `AmbassadorInvite` | sidestage の「人」と支払い |
| Agency | `Agency` `AgencyWatch` | 事務所。User と FK を持たない別系統 |
| TikTok identity / 接続 | `TikTokUser` `TiktokRoom` `Streamer` `RoomMonitorLease` `RoomConnectionInterval` `EulerSignUsage` `ListenerEpoch` `TiktokRoomAdminAuditLog` | TikTok アカウントと LIVE 接続 |
| 観測データ | `Gift` `ListenerComment` | 生ログ。保持期限あり |
| 集計 | `GiftDailyListenerStat` `GiftLifetimeStat` | Gift のロールアップ |
| Overlay 設定 | `Overlay*Settings` 5種 `OverlayTimerGiftRule` `OverlayTimerState` | OBS ウィジェットの設定（Streamer 単位） |
| Battle 観測 | `TiktokBattle` `TiktokBattleItemUse` `TiktokBattleBonusMission` `TiktokBattleArmiesSnapshot` `TiktokBattleTapPoint` | TikTok が送ってきた生の対戦イベント |
| Battle 確定履歴 | `BattleHistory` `BattleTeam` `BattleHistoryParticipant` `BattleHistoryGiftEvent` `BattleHistoryItemCardEvent` `BattleHistoryBonusMission` `BattleHistoryScorePoint` | 上を Gift と突き合わせて凍結した非正規化キャッシュ |
| Event（大会運営、`event` スキーマ） | `Event` `EventSession` `EventMultiplier` `EventTeam` `EventParticipant` `EventRoomLease` `EventMatch` `EventMatchBattleCandidate` `EventMatchSide` `EventMatchSideParticipant` `EventLifePoint` `EventLifeLedger` `EventContribution` `EventStanding` `DetectedBattle` | 大会と採点 |
| Asset / Cache / 運用 | `TiktokAvatarAsset` `TiktokGiftCatalog` `AppSetting` `DbStatsSnapshot` | 外部が正本のキャッシュと汎用KV |

---

## 1. Identity Rules

**この3語彙以外の識別子名を新しい列・型・JSONキーへ入れない。** 正本は
[live-sidestage-analytics/CLAUDE.md](../../live-sidestage-analytics/CLAUDE.md) の「識別子の命名規約」。ここは要点のみ。

| 語 | 実体 | 可変性 | identity に使ってよいか |
| --- | --- | --- | --- |
| `principalId` | `User.id`（cuid） | immutable | **よい**。認証・課金・所有の主体 |
| `tiktokUid` | TikTok の不変な数値ID | **immutable** | **よい**。TikTok 側の同一性はこれだけ |
| `tiktokHandle` | ユーザーが変更できる @ハンドル | **mutable。改名で空いた値を第三者が取得しうる** | **絶対に使ってはいけない**（表示と URL 生成のみ） |

- **`tiktokHandle` に unique は1つも張られていない。** `@@index([tiktokHandle])` は運用調査用であって逆引きキーではない
- `TikTokUser` を `tiktokHandle → tiktokUid` の逆引き表に使ってはいけない
- `userId` という名前を使わない。例外は `Account.userId` と `Session.userId` の2つだけ（`@next-auth/prisma-adapter` が Prisma のフィールド名を直書きするため改名不可）
- `tiktokId` / `uniqueId` / `anchorId` という名前も使わない。TLC payload と外部 TikTok API のプロパティを読む式の右辺だけが例外
- `normalizeTikTokUserId()` は `"0"` を null にする（ts-proto の既定値 `userId:"0"` を弾かないと uid 不明者が全員1人へ畳まれる）
- **schema の `roomId` はすべて `TiktokRoom.id`（cuid）であって、TikTok の配信枠 roomId ではない**
- **secUid はこの体系で一切使っていない**（`scripts/cleanup-nonexistent-streamers.ts` のコメントに「secUid / user_id 単独では実在確認に使えない」という実測記録があるだけ）
- **desktop（TikEffect）だけは identity 体系が違う。** 保存しているのは `unique_id`（@ハンドル）のみで数値 userId を列に持たない。`broadcaster_id` も @ハンドル。**PK も集計キーも改名で割れる**。analytics のルールをそのまま適用できない

### 外部サービス由来の identity

| 値 | 場所 | 性質 |
| --- | --- | --- |
| Google / Apple の `sub` | `Account.providerAccountId`（`@@unique([provider, providerAccountId])`） | immutable。IdP↔User 紐付けの正 |
| Stripe Customer ID | `StripeCustomerLink.stripeCustomerId` @unique | immutable。principal↔customer の**唯一の正**（`Subscription.stripeCustomerId` は旧列） |
| Stripe Subscription ID / Apple originalTransactionId | `Subscription.providerSubscriptionId` | immutable |
| Google Play purchaseToken | 同上（`provider=GOOGLE_PLAY`） | **再購読で変わる**。別行になるのが正常 |
| `Agency.email` | @unique | 外部 Google アカウント。実質 mutable。**小文字正規化必須** |
| `User.email` | @unique | **所有証明ではない**。Apple 経路では null |
| `Account.providerEmail` | unique なし | Apple 申告メール。**表示専用。リンク判定に使うのは明示的に禁止** |

### サーバー発行のシークレット

`Streamer.apiKey`（**平文保存**） / `Streamer.overlayToken` / `BattleHistory.shareToken` /
`AmbassadorInvite.token` / `PendingPurchaseIntent.token` / `Agency.apiKeyHash`（SHA-256）。
**`Agency` はハッシュ、`Streamer` は平文という非対称は意図的**（schema に「Streamer の平文保存は踏襲しない」と明記）。

---

## 2. Entity 別

### 2.1 Principal / 認証 / 課金

#### `User`
- **役割**: サービス内部の principal。`User.id` が全ドメインの `principalId` の実体
- **ownership**: ルート。所有される側を持たない。Streamer / Subscription / Account / Session / Ambassador / StripeCustomerLink / PendingPurchaseIntent は全て `onDelete: Cascade`
- **lifecycle**: NextAuth（Google）/ dev-login / mobile Google / mobile Apple / mobile email 登録で作成。更新は `lastActiveAt` のみ（24時間スロットル）。削除は `DELETE /api/mobile/account` の1箇所だけ。自動 retention は無い
- **source of truth**: 自身。ただし Apple 経路の表示メールは `Account.providerEmail` が正
- **保存してよい**: 認証の中核ID、表示名/画像、旧パスワードハッシュ、`lastActiveAt`
- **保存すべきでない**: **プラン状態**（実効プランは `Subscription` 複数行 + `Ambassador` 行の存在 + `AppSetting` のβフラグの合成で、単一列で表せる場所は存在しない）、TikTok 関連ID、provider 申告メール
- **責務境界**: `Agency` とは FK も relation も持たない。`Event.ownerPrincipalId` も FK を張らない（User 削除でイベントは残る）

#### `Account` / `Session` / `VerificationToken`
- NextAuth 標準テーブル + 独自3列（`providerEmail` / `appleClientId` / `refresh_token` 更新）
- **`Account` を1件でも持つ User はメール一致リンクの対象外**という不変条件が、アカウント乗っ取り防御の中核
- `Session` / `VerificationToken`: **`strategy: "jwt"` かつ Email provider 未設定のため、アプリコードからの参照は0件。** 実際に行が書かれるかは**不明**（PrismaAdapter がテーブルを要求するので存在する）

#### `Subscription`
- **役割**: provider 契約1件 = 1行。**1ユーザー複数行が正常**（`principalId` に unique なし）
- **source of truth**: **外部 provider が真、この行はミラー。** webhook payload を信用せず毎回 retrieve する。ただし「principalId との紐付け」だけはこちらが正
- **lifecycle**: 収束型 sync のみ。解約でも行は残り `entitlementActive=false`。`lastVerifiedAt` を `updateMany` の WHERE に入れて古い fetch の上書きを防ぐ
- **保存すべきでない**: ユーザーの実効プラン、customer↔user の一意紐付け
- **注意**: `stripeCustomerId` / `stripeSubscriptionId` / `status` は**フェーズBで削除予定の旧列**（`providerSubscriptionId` / `rawStatus` と同値を二重書き）。本番バックフィル済みかは**不明**

#### `StripeCustomerLink` / `PendingPurchaseIntent`
- 前者は「Customer は作ったが未購読」段階の principal↔customer 一意紐付け（PK が `principalId` の自然キー）
- 後者は Google/Apple の購入 token → principalId の**唯一の解決手段**。**`expiresAt` は掃除の目安であって照合条件ではない**（未消費なら期限切れでも紐付けを許可する）。削除経路は**不明**（retention job が見つからない）

#### `Ambassador` / `AmbassadorInvite`
- `Ambassador` は「行が存在する = PRO 無料」。`Subscription` 行は作らない。有償課金と直交
- `AmbassadorInvite` は招待URLの履歴 + 先着1名の消費記録。`expiresAt` 超過を Cron が一括削除する**一時トークンテーブル**。消えても資格本体は残る

### 2.2 Agency

#### `Agency`
- **役割**: 事務所アカウント。自分では TikTok ID を持たず `AgencyWatch` 経由でのみデータを見る
- **ownership**: ルート。**`User` と FK も relation も無い。** ログイン中の Google メール一致だけで解決する
- 「事務所が存在すること自体が利用許可」なので承認フラグを持たない
- **保存すべきでない**: APIキー平文、TikTok ID そのもの

#### `AgencyWatch`
- **junction table**（`@@unique([agencyId, roomId])`）+ 事務所側の表示用スナップショット
- `room` は **Cascade なしの FK**（部屋は共有資産なので事務所都合で消せない）
- `tiktokUid` が監視対象の指定キー、`tiktokHandle` は**事務所の入力そのまま**（正規化済みハンドルを持つのは `TiktokRoom` だけ）

### 2.3 TikTok identity / 接続

#### `TiktokRoom` — 観測データの帰属先
- **役割**: 1 TikTokアカウント = 1本の LIVE 接続。ギフト・コメント・バトル等**全観測データの帰属先**
- **identity**: **`hostTiktokUid` @unique（NOT NULL）が同一性の定義。** `tiktokHandle` は正規化済みだが同一性キーではなく、**重複行が存在するのは正常**
- **ownership**: `src/lib/tiktok-room.ts`（作成・削除・監視制御）と `src/lib/tiktok-listener.ts`（接続状態列。`persistState()` に一本化）
- **lifecycle**: 全 upsert が `where: { hostTiktokUid }`。物理削除は `deleteTiktokRoomPermanently()` のみ
- **共有される**: 同一 room を複数の `Streamer` と `Agency` が共有する。接続リソースの重複回避と `(roomId, orderId)` unique 違反によるギフト取りこぼし防止のため
- **保存してよい**: 接続に必要な可変状態（deviceId / workerId / proxyKey / listener*系 / unhealthySince / notFoundStreak / monitoringSuspended / monitorUntil / lastWatchInstructedAt / handleStaleAt）
- **保存すべきでない**: 配信者の nickname / avatar（`TikTokUser` / `TiktokAvatarAsset` の責務。実際に列が無い）、個別 Streamer のユーザー設定
- **注意**: `workerId` は hash 初期値にすぎず worker-guardian の移送が上書きする。同一性の正本 `hostTiktokUid` は**接続開始時に1回だけ読み、以後ハンドルから引き直さない**

#### `Streamer` — 所有主張 + 個人設定
- **役割**: sidestage ユーザー（`User`）と TikTok アカウントの紐付け + contribution オーバーレイの設定置き場
- **identity**: `principalId` @unique / `apiKey` @unique / `overlayToken` @unique。**`tiktokUid` は unique ではない**（他アカウントとの重複登録を無条件許可）
- **lifecycle**: 登録時に実在確認応答から `tiktokUid` を取得し、**取れなければ登録を通さない fail-closed**。handle 変更は**同一 tiktokUid の改名のみ許可**（別 uid なら 409）。7日ロック + CAS
- **source of truth**: 「どの User がどの TikTok アカウントを所有主張しているか」と overlay 設定
- **保存すべきでない**: ギフト・観測データ（room 単位で共有されるため）、nickname / avatar
- **`Streamer.tiktokUid` が room と重複しているのは意図的**（room を消しても `resolveRoomForStreamer()` が再作成できるようにするため）

#### `TikTokUser` — 表示名の辞書
- **役割**: `tiktokUid` → `tiktokHandle` / `nickname` の解決表。**表示名の正本**
- **対象は視聴者を含む全 TikTok アカウント。** room でも streamer でもない
- **ownership**: `src/lib/tiktok-user.ts` が唯一の書き手（`tiktok-user.guard.test.ts` が固定）。**呼び出し元の DB 書き込みと同一トランザクション必須**
- **Prisma の relation を1本も持たない**（`tiktokUid` の論理参照で raw JOIN する）
- **保存すべきでない**: avatar URL（署名付きで失効。`TiktokAvatarAsset` の責務）
- 更新は「非nullの値だけ反映する last-write-wins」（null で既知の値を潰さない）
- retention は**不明**（削除経路が見つからない）

#### 3者の責務境界（要点）
- **データは room 単位、設定は Streamer 単位**という非対称が設計の核
- `TikTokUser` だけが handle/nickname を書き換え、他は全部 `tiktokUid` で引く
- 3者間の Prisma relation は `Streamer → TiktokRoom` の1本だけ

#### `RoomMonitorLease`
- **役割（設計上）**: room の監視理由を独立管理する台帳。`monitorUntil` 単一値では EVENT と COLLAB が競合・誤解放するため新設。`@@unique([roomId, reason, referenceId])`、release は必ず reason+referenceId で絞る
- **⚠️ 稼働状況が調査で食い違った。** 一方の調査は `src/lib/room-lease.ts` を書き手として確認し、もう一方は `prisma.roomMonitorLease` の呼び出しが `src` に0件で「未配線」と結論した。**現在の配線状況は不明。触る前に必ず自分で grep して確認すること**
- 同名の TypeScript 型 `RoomMonitorLease`（`src/lib/tiktok-room.ts` の `ensureRoomForEvent` 戻り値型）が存在する。**テーブルと別物**

#### `RoomConnectionInterval`
- 接続区間ログ。バトル確定時の `captureStatus` / `captureCoverage`（区間unionをバトル窓に重ねた被覆率）算出用
- `endedAt: null` は「接続中」だが worker crash で更新が止まりうるので `lastHeartbeatAt` を併用する。**外すと crash 後のバトルが偽の100% coverage になる**

#### `EulerSignUsage` / `ListenerEpoch` / `TiktokRoomAdminAuditLog`
- `EulerSignUsage`: 署名API リクエスト1回 = 1行の実測ログ。**FK を一切張らない**（部屋やイベントが消えても履歴を残す）。`tiktokHandle` は「署名を要求した当時のハンドル」という観測事実で、改名後に過去分が引けなくなるのが正しい意味
- `ListenerEpoch`: fencing 用の**世代番号の採番機**。要件は「後から起動したプロセスほど必ず大きい」だけで壁時計に依存しない。`role` / `workerIndex` は追跡用で判定に使わない
- `TiktokRoomAdminAuditLog`: 管理画面からの不可逆操作の監査ログ。**他3種の監査ログは `AppSetting` に JSON を trim 保存する方式で trim で消えるため、これだけ専用テーブル**。`roomId` は FK を張らない論理参照（削除後は room が無い）。retention は**不明**

### 2.4 観測データと集計

#### `Gift`
- **役割**: ギフト受信明細の生ログ。金銭データ
- **lifecycle**: **受信後90日で削除。** 削除前に必ず `GiftDailyListenerStat` へロールアップ。未確定イベント参加 room の Gift は保護されて消えない
- **保存すべきでない**: **表示名（tiktokHandle / nickname / profileImageUrl）を持たない。** `TikTokUser` と `TiktokAvatarAsset` から読み出し時に順引きする。改名で集計が割れないことが目的
- dedup は `@@unique([roomId, orderId])` と msgId の**5分時間窓 findFirst**。**`msgId` に unique を張らない**（roomId は配信セッションではなく永続的な room.id なので、msgId 再利用で正当なギフトを恒久的に弾く。加えてコンテナ起動時の `db push` が index 作成に失敗して Web が起動しなくなる）

#### `ListenerComment`
- chat の生ログ。**将来の AI コメント傾向分析用**
- **受信30日で自動削除。ロールアップは行わない**（分析要件が未確定な段階で集計テーブルを固定すると要件変更で壊れるため）→ **30日を過ぎたコメントは完全に失われる**
- **dedup の unique 制約なし**（chat 流量が gift より桁違いで、都度 findFirst が書き込み負荷に見合わない。多少の重複は許容）
- `profileImageUrl` を**意図的に持たない**

#### `GiftDailyListenerStat` — 条件付き derived
- `(roomId, dayKey, tiktokUid)` 単位の日次ロールアップ。**長期保持（削除しない）**
- **Gift が生存している90日間は derived、それを過ぎると実質 source of truth。** Gift 削除後は再計算不能
- watermark 方式で、その日の Gift **全件から作り直す**（加算ではない）ので遅延到着・バトル確定後の補正が反映される
- **外してはいけない安全弁2つ**: (1) upsert 対象は「まだ1行も削除されていないことが保証された日」だけ（でないと過少値で上書き）、(2) watermark が削除対象に追いついていなければ Gift を削除しない
- **FK を一切張らない**（「コピーして切り離す」パターン）。表示名・avatar は採らない
- `rowCount`（行数）と `giftCount`（repeatCount 合計）は**意味が違う**

#### `GiftLifetimeStat` — 完全な derived
- `tiktokUid` 単位（room 横断）の全期間累計。`/api/public/login-stats` の全スキャン置き換え専用
- `GiftDailyListenerStat` から毎回 GROUP BY で全件作り直し、消えた tiktokUid は DELETE で掃除する
- **累計の再計算と watermark 前進は同一トランザクション**（分けると「watermark だけ進んで累計が古い」状態が残る）
- `totalDiamonds` は BigInt（全期間・全room 合計で Int を超えうる）

### 2.5 Overlay 設定

`OverlayCoinListSettings` / `OverlayTopGiftSettings` / `OverlayTapListSettings` /
`OverlayLikeContributionSettings` / `OverlayTimerSettings` / `OverlayTimerGiftRule` / `OverlayTimerState`

- **種類ごとに1テーブル。** `Streamer` に列を積み増すと肥大化するため分離した
- いずれも `streamerId` が @id 兼 FK（1 Streamer 1行、Cascade）。**room 単位ではなく Streamer 単位**なので、同じ room を共有する別ユーザーは別設定を持てる
- **保存すべきでない**: 集計値そのもの（Gift から都度組み立てる）、**任意の音源URL**（`endSoundKey` / `countdownSoundKey` はプリセットキー。OBS ブラウザソースに外部URLを無条件 fetch させないため）
- `OverlayTimerGiftRule` の一致キーは **giftId ではなく giftName（trim + 小文字化）**
- `OverlayTimerState` は実行時状態。発火はサーバー setTimeout ではなくクライアント側ローカル計算
- **⚠️ schema.prisma:646-651 は孤児コメント。** 旧 `LikeTally` テーブルの説明が無関係な `OverlayCoinListSettings` の直上に残っている。実体は `src/lib/overlay/like-tally-store.ts` の**プロセス内インメモリ**へ移行済みで、`LikeTally` model は schema に存在しない

### 2.6 Battle

#### 責務境界（最重要）

```
TikTok Webcast → TiktokBattle*（生観測 / source of truth）
                    ├─ (Gift と突き合わせて凍結) → BattleHistory*（確定スナップショット / 非正規化キャッシュ）
                    └─ (event スキーマへ raw SQL でコピー) → DetectedBattle → EventMatchBattleCandidate
```

- **source of truth は `TiktokBattle` 系。** `BattleHistory` 系は `TiktokBattle` + `Gift` + 子観測テーブル群から計算した結果を凍結したもの
- **「ライブ中の一時データ vs 確定履歴」ではない。** `TiktokBattle` は削除されず恒久に残る。区別は「生観測」対「導出済みキャッシュ」
- **`BattleHistory` は正しさの前提ではなく最適化。** 確定に失敗しても読み出しは `TiktokBattle` + `Gift` のライブ集計へフォールバックする
- **ただし90日以降は `BattleHistory` が実質唯一の恒久記録。** `Gift` が消えるため、確定できなかったバトルは復元できない。だから retention が削除前に強制確定する
- **どちらも room 視点。** 両サイド監視時は同じ battleId について room ごとに2行ずつできる
- **イベント（`event` スキーマ）は `BattleHistory` を一切参照しない。** `TiktokBattle` → `DetectedBattle` の独立系統

#### `TiktokBattle` と子テーブル
- `TiktokBattle`: `@@unique([roomId, battleId])`。子テーブルへの FK を**意図的に張らない**（イベント先着で親行が未作成のことがある）。マージはフィールド単位で増える方向のみ
- `TiktokBattleItemUse`: アイテムカード使用の時系列ログ（append only）。dedup は roomId+msgId の5分窓をアプリ側で
- `TiktokBattleBonusMission`: ミッション区間（taskStart→taskSettle→rewardSettle）。**`rewardSum` は observing room ごとの値**
- `TiktokBattleArmiesSnapshot`: **スコアの変化点だけ**を残す時系列ポイント。無変化イベントを入れると行が際限なく膨らむ。**fire-and-forget（失敗は握りつぶす）**
- `TiktokBattleTapPoint`: いいね由来のタップ点。`@@unique([roomId, battleId, tiktokUid])` が「1リスナー1バトル1回」という仕様そのもの。**`tiktokUid` = リスナー、`hostTiktokUid` = タップの宛先の配信者**（混同注意）。`occurredAt` を `@default(now())` にしない
- **retention が存在しない。** 削除は `TiktokRoom` 削除の cascade のみ。無限に増える設計なのか未実装なのかは**不明**

#### `BattleHistory` と子テーブル
- `BattleHistory`: **行の存在自体が「確定済み」フラグ**（専用 boolean を持たない）。`@@unique([roomId, battleId])`。再確定は `sourceUpdatedAt` を使った CAS
- 確定は「1回目計算 → 10秒待ち → 2回目 → 完全一致した場合のみコミット」
- **保存すべきでない**: **avatarUrl**（署名付きで失効。`BattleHistory` 系は意図的に持たない）、`replayReady` のような判定済み boolean（判定は `isReplayable()` 1箇所）
- `BattleHistoryParticipant`: 陣営の正は `teamIndex`（`side` は後方互換で書き続けるだけ）。`isSelf` は tiktokUid 一致で**個人単位に**判定する（陣営単位にするとチームメイトも self になる）。`tiktokHandleSnapshot` / `nicknameSnapshot` はバトル時点で凍結し `TikTokUser` から引き直さない
- `BattleHistoryGiftEvent`: **1ギフト = 1行、集約しない。** 存在理由は「`Gift` が90日で消えるので履歴側は自己完結でなければならない」。`sourceGiftId` は FK なしの文字列参照。**unique 制約が無いのが正しい**（同一送信者の複数回投擲）。`senderGroupId` は単発ギフトにも非ゼロが入りうるので combo 判定に単独で使えない
- `BattleHistoryScorePoint`: **`participantId` ではなく `tiktokUid` で持つ**（participant は再確定のたびに削除・再生成されるため）。**cascade で消えないので明示 deleteMany が要る**
- `BattleTeam`: **`teamIndex` 列を持たない**ので、factions 順に create して生成 id を index へ紐付けている

#### 既知の食い違い（触る前に確認すること）
- **`TiktokBattle.hostProfiles` の nickName**: schema コメントは「nickName は持たない」と書いているが、実装は書き込み・保持・読み出しをしている。**コメントと実装が矛盾。どちらが意図かは不明**
- **`BattleHistoryParticipant.score` と `officialScore`**: schema は「役割が違う」と書くが、実装は**同じ値を代入しているだけ**。読み側は `officialScore ?? score`。将来の分岐意図は**不明**
- `TiktokBattleItemUse.senderProfilePictureUrl` の読み出し先が見つからない（dead column の疑い。断定しない）
- `absorbRooms` は既に廃止済みだが、schema とコメントに言及が残っている（歴史的記述）

### 2.7 Event（`event` スキーマ）

#### 集約構造
`Event` が集約ルート。ほぼ全ての子が `onDelete: Cascade`。例外は
`EventMatch → EventSession` の複合FK `(eventId, sessionId)` が **Restrict**（対戦がぶら下がった日程は削除できない。
だからイベント削除は `EventMatch.deleteMany` を先に実行する）。
`Event.ownerPrincipalId` は `public."User".id` への**論理参照（FKなし）**で、認可は `requireEventOwner()` 1箇所に集約。

#### source of truth と derived の分離（Event ドメインの設計の核）

**「全期間再計算して全置換」が原則。** 編成は「現在の状態」で全期間再計算されるので有効期間を持たない。

| データ | 正本 | 派生（スナップショット） |
| --- | --- | --- |
| 集計区間 | `EventSession.[startAt, endAt)`（半開区間。隙間は集計しない） | `Event.startAt/endAt`（min/max）、`EventMatch.scheduledStartAt/EndAt`（**write-only の legacy**） |
| 出場者の同一性 | `EventParticipant.tiktokUid` | `EventRoomLease.tiktokUid/tiktokHandle` |
| 集計母集団 | `EventParticipant.roomId` → `public.gifts` | — |
| room 監視期限 | `TiktokRoom.monitorUntil`（`max(既存, 要求)`） | `EventRoomLease.monitorUntil`（このイベントの要求値） |
| バトル観測 | `public.tiktok_battles`（`TiktokBattle`） | `DetectedBattle` → `EventMatchBattleCandidate` |
| 実効ゲーム集合 | `EventMatchBattleCandidate.selected`（毎周回計算） | `EventMatch.detected*` 5列（**ミラー列**） |
| 主催者の候補判断 | `EventMatchBattleCandidate.organizerSelected` / `combinedGroupId` | — |
| 対戦の勝敗 | `EventMatch.winnerSideId` / `winnerDecidedBy` / `decidedAt`（`resolveMatchSeries()` に一本化） | — |
| サイド得点 | `public.gifts`（毎回 `scoreSides()` で再計算） | `EventMatchSide.score` / `diamonds` |
| ライフ | `EventMatch`（FINISHED）+ `Event.rules.deathmatch` | `EventLifePoint`（残高）、`EventLifeLedger`（履歴） |
| リスナー貢献 / 順位 | `public.gifts` × 参加者 × 倍率 | `EventContribution` / `EventStanding` |
| 表示名・アイコン | `public.tiktok_users` / `TiktokAvatarAsset` | `EventContribution.listenerTiktokHandle` 等 |

- **`EventLifePoint` と `EventLifeLedger` は「残高と履歴」に見えるが、両方とも同じ `computeLifePoints()` の出力から同時に全置換される。** ledger は残高の由来を追記していく台帳ではない
- `EventLifeLedger.createdAt` は `now()` ではなく**決着時刻**を入れる（再計算しても並びが変わらないように）
- `EventStanding` は**ギフト0件の参加者・チームも0点で必ず載る**。「行がある = 差が付いている」ではない
- `EventContribution` は scope ごとに 200 行で打ち切る。`topParticipantId` / `participantCount` / `breakdown` は **scope=EVENT の行にだけ**入る。`breakdown` の `null` は「内訳非対応時代の行」で `[]` と区別する
- **保存すべきでない**: `EventContribution` にニックネームとアバターURL（読み取り時に解決する）

#### 集計の締切
- `aggregateEvent()` は `finalizedAt IS NULL` のイベントだけを 10秒間隔で回す。増分ではなく**毎回イベント期間の全ギフトを再計算**する（バトル区間が後から確定するため増分では修正できない）
- 打ち切りに `status` を使わない。締切（`endAt` + 1週間）後の集計が成功したら `finalizedAt` を立てる
- 再開は `reopenAggregation()`。対戦の追加・削除・勝敗変更・VOID・参加者の handle 訂正と**同一トランザクション**で呼ぶ規約。**advisory lock を先に取る**
- **締切超過後は `finalizedAt` を戻さず例外**（ギフト明細が90日で消えるため、確定後の再集計は元データを欠いたまま走る）
- `EventMatch.rules.forceFullPeriod` は FINISHED の対戦だけに置ける緊急救済フラグ。検知区間ではなく開催日程まるごとで扱う。**勝敗判定には影響しない**

#### 主要 Entity の補足
- `EventParticipant`: **identity は `tiktokUid`。** 登録ゲートの実在確認応答から取り、取れなければ登録拒否（fail-closed）。`@@unique([eventId, roomId])` は**同じ room の別表記二重登録 = ギフト二重計上の防止**
- `EventRoomLease`: 「このイベントがこの room の監視を要求している」という事実の台帳。実際の監視解除は**トランザクション外のベストエフォート**で、他イベントに未解放 lease があれば解除しない
- `EventMatchSideParticipant`: **純粋な junction table**（id + 2FK のみ）。チーム戦でも「誰が実際に出場するか」はここが持ち、`EventMatchSide.teamId` は陣営を指すだけ
- `EventMultiplier`: **1件のギフトに適用される倍率は必ず1つ**

#### 未使用・dead の疑い（触る前に必ず自分で確認すること）
- **`EventParticipant.principalId`**: 実コードでの読み書きが0件。会員リンク表示は roomId → `Streamer` 経由で解決している。将来用に確保した列なのか実装が別経路へ移った残骸なのかは**不明**
- **`EventParticipant.status`**: `INVITED` / `WITHDRAWN` / `DISQUALIFIED` の書き込みコードが存在しない。書かれるのは default の `ACTIVE` のみ
- **`EventContribution.scope = "MATCH"`**: 書かれも読まれもしない（schema コメントが実装より広い）。対戦単位の貢献は DB に載せないオンデマンド集計
- **`EventLifeLedger`**: 読み出し経路が実装コード上に存在しない（書き込みと削除のみ）
- **`EventMatch.scheduledStartAt` / `scheduledEndAt`**: 書き込み5箇所・読み出し0箇所の legacy dual-write

### 2.8 Asset / Cache / 運用

#### `TiktokAvatarAsset` — キャッシュ（TikTok が正本）
- TikTok アバターを自前ストレージへ WebP 圧縮して恒久保存する。`fetchedAt` から7日超で再取得
- **`roomId` を持たないテナント非依存設計**（tiktokUid はグローバルに一意なので、同じ人物が複数配信者に登場しても1回のダウンロードで済む）。**`kind` も持たない**（主体が tiktokUid 1種類に統一されたため）
- **保存すべきでない**: **TikTok の元 avatar URL**（署名付きで失効する）。読み出しは 24時間 TTL の presigned URL を都度発行する
- `storageKey` は数値以外を弾く固定形式なので、パストラバーサル・キー衝突が構造的に起きない
- GC 経路は**不明**

#### `TiktokGiftCatalog` — キャッシュ（TikTok が正本）
- **`giftId` を PK にしているが identity として信用できない。** 実測で 670件中29の名前が複数 giftId を持ち、giftId 自体もレスポンス内で重複する。**消費側は name で畳む**
- **upsert のみで削除しない**ので、実体は「現在のカタログ」ではなく**「これまでに観測したカタログの和集合」**（A/B や proxy 地域差で一時的に欠けたギフトを消さないため）
- **`name` と `label` は必ず英語版から採る。`labelJa` は表示専用。** LIVE の gift イベントは言語指定と無関係に英語固定なので、一致キーを日本語にすると**例外もログも出ないまま効果音が鳴らなくなる**
- `labelJa` だけ upsert 時 COALESCE で既存値を守る（日本語版の取得は独立に失敗しうる）
- `imageUrl` は avatar と違い署名が付かないので永続化しても腐らない
- `fetchedAt` は create/update **両方で明示更新**する（`@default(now())` は更新時に発火しない）

#### `AppSetting` — 汎用KV（単一 Entity ではない）
`key` が PK の文字列KV。**用途の異なる値が全部同居している**。実測で入っているのは以下。

| 分類 | 例 |
| --- | --- |
| feature flag / 運用スイッチ | `mobileBetaEnabled` `analyticsBetaEnabled` `eventsBetaEnabled` `agencyBetaEnabled`（**fail-closed。"true" のみ有効**）、`anonymousRoomAutoStopEnabled`、各種 `*Disabled` |
| 監査ログ（JSON文字列、trim 保存） | `tiktokLowValueCleanupAuditLog` `workerGuardianAuditLog` ほか |
| watermark / 進捗（derived） | `gift_rollup_watermark_daykey` `gift_retention_deleted_through_daykey` |
| マイグレーション marker | `tiktok-userid-reset:done` ほか |
| secret | `eulerSignApiKey`（**平文**。`Agency.apiKeyHash` がハッシュなのと非対称。理由は**不明**） |

- **βフラグは「FREE の制限を一時解除」するだけでプランは書き換えない**（旧設計で ULTRA 昇格に使った反省）
- **保存すべきでない**: ユーザー単位のデータ、relation を持つべきデータ（key 衝突・型検証が無い）

#### `DbStatsSnapshot`
- 毎朝 JST 6:00 に全テーブルの件数・サイズを記録し、前日比+25%超を通知する異常検知の原本
- **derived ではない**（過去日の行数は後から再計算できない）
- `@@unique([runDate, schemaName, tableName])` が「その日は記録済みか」の判定と再起動時の二重実行防止を兼ねる
- `_prisma_migrations` と自分自身は集計対象から除外する（自己参照ノイズ回避）

### 2.9 desktop（TikEffect）のローカル SQLite

正本は `live-sidestage-desktop/backend/lib/db/store.js`。
バージョン番号を持たず、`CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` 確認つき `ALTER TABLE ... ADD COLUMN` の冪等パッチ方式。
**FK 制約は1つも無い**（論理結合のみ）。

| テーブル | 役割 | 分類 |
| --- | --- | --- |
| `daily_contributors` | 日次貢献者集計（`total_coins` 加算 upsert） | 集計 |
| `raw_gift_events` | ギフト生イベント履歴 + 未処理キュー（`event_key` UNIQUE で冪等挿入、`processed_at IS NULL` を取り出す） | 履歴 |
| `tiktok_gift_catalog` | ギフトカタログ（`name`=英語の一致キー、`name_ja`=表示専用、COALESCE で守る） | キャッシュ |
| `display_state` | グローバル設定 KV | 設定 |
| `broadcaster_state` | 配信者スコープ設定 KV（未設定なら `display_state` へフォールバック） | 設定 |
| `listener_name_overrides` | 手動ニックネーム上書き（表示クエリで COALESCE） | 設定 |

- **identity が analytics と違う。** 保存しているのは `unique_id`（@ハンドル）だけで、数値 userId を列に持たない。`broadcaster_id` も @ハンドル。**PK も集計キーも改名で割れる**
- **`tiktok_gift_catalog` は analytics の `TiktokGiftCatalog` と意味がほぼ同じだがキー設計が違う**（analytics は `giftId` 単一PKで全部屋共有、desktop は `(broadcaster_id, gift_id)` の複合PKで部屋別。部屋固有サブスクギフトの混入回避のため）
- `daily_contributors` は `GiftDailyListenerStat` と役割が同じだが、キーがハンドル、`rowCount`/`giftCount` 相当が無く coins のみ
- `daily_contributors.qualified_at` は `ALTER TABLE` で追加されているが INSERT/UPDATE 文に現れない。**現状書かれていない可能性がある（不明）**

### 2.10 TikRIng（Cloudflare D1）

正本は `TikRIng/migrations/*.sql`（0001 からの連番）。
テーブル: `users` / `frames` / `share_urls` / `frame_goods` / `anonymous_user_numbers` / `frame_views` / `frame_view_events` / `frame_wear_events` / `frame_wears`。
FK は `frames.owner_id → users.id` と各 `frame_* → frames.id`。R2（`profile-frames`）と KV（`SESSIONS`）はスキーマレス。
**本番の実スキーマがマイグレーション連番と一致しているかは未検証（不明）。**

---

## 3. Source of Truth まとめ

| データ | 正本 | 備考 |
| --- | --- | --- |
| principal（人） | `User` | |
| 実効プラン | **単一の正本が存在しない** | `Subscription` 複数行 + `Ambassador` の行の存在 + `AppSetting` のβフラグの合成。`get-user-plan.ts` を通す |
| 課金契約 | **外部 provider（Stripe / Google / Apple）** | `Subscription` はミラー。毎回 retrieve する |
| Stripe customer ↔ principal | `StripeCustomerLink` | `Subscription.stripeCustomerId` は旧列 |
| IdP ↔ User の紐付け | `Account`（`provider` + `providerAccountId`） | |
| TikTok アカウントの同一性 | `TiktokRoom.hostTiktokUid` | `tiktokHandle` は不可 |
| TikTok の表示名 | `TikTokUser` | avatar は持たない |
| TikTok の avatar 画像 | `TiktokAvatarAsset`（実体）／ TikTok（一次） | URL を DB に保存しない |
| 所有主張と overlay 設定 | `Streamer` + `Overlay*Settings` | Streamer 単位。room 単位ではない |
| ギフト明細 | `Gift`（直近90日） → 以後は `GiftDailyListenerStat` | **90日を境に正本が移る** |
| コメント | `ListenerComment`（30日）。以後は**失われる** | 後継の集計が無い |
| 全期間累計 | `GiftDailyListenerStat` | `GiftLifetimeStat` は完全な derived |
| バトルの生観測 | `TiktokBattle` 系 | |
| バトルの確定履歴 | `BattleHistory` 系（derived。ただし90日以降は実質唯一の記録） | |
| イベントの集計区間 | `EventSession` | |
| イベントの採点 | `public.gifts`（毎回再計算） | `EventContribution` / `EventStanding` / `EventMatchSide.score` は全部 derived |
| ギフトカタログ | TikTok（`gift/list/`） | `TiktokGiftCatalog` は和集合キャッシュ |

### 同じ意味の値が複数箇所にある（既知。**このタスクでは移行しない**）

意図が明記されている正当な重複と、旧列として残っているものが混在している。**新しい重複を足す前に、まずここに載っていないか確認すること。**

| 値 | 保存箇所 | 性質 |
| --- | --- | --- |
| `tiktokHandle` | `TikTokUser`(正本) / `TiktokRoom`(正規化済み) / `Streamer`(入力そのまま) / `AgencyWatch`(入力そのまま) / `EventParticipant` / `EventRoomLease` / `TiktokRoomAdminAuditLog` / `EulerSignUsage` / `BattleHistoryParticipant.tiktokHandleSnapshot` / `TiktokBattle.hostDisplayIds` / `EventContribution.listenerTiktokHandle` | **正規化ルールが3種類混在**（正規化済み / 入力そのまま / 観測そのまま）。監査ログ・スナップショット系は「その時点で凍結する」意図が明記された正当な重複 |
| `tiktokUid` | 上記の多くと Gift / ListenerComment / GiftDailyListenerStat / GiftLifetimeStat / TiktokAvatarAsset | **immutable なので重複しても割れない**。`Streamer.tiktokUid` の room との重複だけ「room 再作成のため」と理由が明記 |
| Stripe customer / subscription / status | `StripeCustomerLink` と `Subscription` の旧3列 | **フェーズB で旧列を削除予定**。改善候補 |
| 監視期限 | `TiktokRoom.monitorUntil` / `RoomMonitorLease.expiresAt` / `EventRoomLease.monitorUntil` | 移行期間中の意図的なデュアルライト。ただし `RoomMonitorLease` の配線状況が不明（§2.3） |
| バトルの検知結果 | `EventMatchBattleCandidate` → `EventMatch.detected*` 5列 | コード上「ミラー列」と明記 |
| バトルの生データ | `TiktokBattle` → `DetectedBattle`（raw SQL コピー、列名 `action` → `lastAction`） | 別スキーマへの取り込みコピー |
| ギフト明細 | `Gift` → `BattleHistoryGiftEvent`（丸ごとコピー） | **`Gift` が90日で消えるので履歴側の自己完結が要件**。正当 |
| 対戦の日程 | `EventSession` → `EventMatch.scheduledStartAt/EndAt` | **write-only の legacy**。改善候補 |
| バトルのスコア | `BattleHistoryParticipant.score` と `officialScore` | 同じ値を代入しているだけ。意図**不明** |
| バトルの陣営 | `BattleHistoryParticipant.side`(後方互換) / `teamIndex`(正) / `isSelf`(派生) | 3重 |
| ライフ | `EventLifePoint`(残高) / `EventLifeLedger`(履歴) | 同じ計算結果の2表現。ledger は読み出し経路が無い |

---

## 4. Duplication Rules

**relation 経由で取得できる情報を別 Entity へ重複保存してよいのは、次のどれかに当てはまるときだけ。**

**許される**
1. **時点の凍結が仕様**である（`*Snapshot` 系。バトル時点の handle / nickname、監査ログの handle）。「今の値」を引くと意味が変わるもの
2. **元データが retention で消える**（`Gift` 90日 → `BattleHistoryGiftEvent` / `GiftDailyListenerStat`）
3. **relation を張れない**（別スキーマ、cuid ではない論理参照、削除された行を指す監査ログ）
4. **識別子が immutable**（`tiktokUid`）で、かつ重複によって同一性が割れない
5. **join を外す明確な運用理由がある**（`EventRoomLease` が participant を join せず解除できるようにするため handle を持つ）

**禁止**
- **mutable な値（handle / nickname / avatarUrl）を、凍結の意図なしに複数箇所へ持つ。** 改名で集計が割れる
- **署名付き URL（TikTok の avatarUrl）を DB へ保存する。** 数十時間で失効する
- 集計値を「読み出しが速いから」だけの理由で別テーブルへ持つ
- **重複させたのに再計算経路を用意しない。** 重複を足すなら「どちらが正本か」「ずれたときどう直すか」を必ず計画に書く

---

## 5. Derived Data Rules

**runtime で導出すべき（永続化しない）**
- 既存 relation の join で得られる値
- 判定の結果（`isReplayable()` のような boolean）。**判定ロジックを1箇所に保つため、結果を列にしない**
- 表示名・アバターURL（読み出し時に `TikTokUser` / `TiktokAvatarAsset` から解決する）
- 対戦単位の貢献（`match-contributions.ts` はオンデマンドで DB に載せない）

**cache してよい（元データから無条件に再構築できる）**
- 外部サービスが正本のもの（`TiktokGiftCatalog` / `TiktokAvatarAsset`）
- 再計算が全置換で完結するもの（`GiftLifetimeStat` / `EventContribution` / `EventStanding` / `EventLifePoint`）
- **条件**: (1) 再計算のコードが1箇所にあり、(2) 再計算のトリガが決まっていて、(3) 全置換が同一トランザクションであること

**永続化が必要（後から再計算できない）**
- 観測そのもの（`Gift` / `ListenerComment` / `TiktokBattle*` / `RoomConnectionInterval` / `EulerSignUsage`）
- 時点のスナップショット（`DbStatsSnapshot`。過去日の行数は再現不能）
- 監査ログ（`TiktokRoomAdminAuditLog`）
- ユーザー操作の結果（`OverlayTimerState`、主催者の候補選択 `organizerSelected` / `combinedGroupId`）
- **元データの retention を超えて残す必要があるもの**（`GiftDailyListenerStat` / `BattleHistory` 系）

**判断の分かれ目は「元データの保持期間」。** 90日で消える `Gift` から導かれる値は、90日を過ぎた瞬間に derived ではなくなる。

---

## 6. Entity Boundary（似た Entity の使い分け）

| 迷いやすい組 | 境界 |
| --- | --- |
| `User` / `Streamer` / `Agency` | `User` は認証・課金の主体。`Streamer` は TikTok アカウントの所有主張と個人設定。`Agency` は `User` と FK を持たない別系統（メール一致で解決） |
| `TikTokUser` / `TiktokRoom` / `Streamer` | `TikTokUser` = 表示名の辞書（視聴者含む全員）。`TiktokRoom` = 接続とデータの器（複数 Streamer で共有）。`Streamer` = 所有主張と設定。**データは room 単位、設定は Streamer 単位** |
| `Subscription` / `Ambassador` / `AppSetting` のβフラグ | 有償契約 / 無償 PRO 資格 / 機能単位の一時解放。**3つとも実効プランの一部で、直交している** |
| `TiktokBattle*` / `BattleHistory*` | 生観測 / 確定スナップショット。前者が正本、後者は最適化（ただし90日以降は後者が唯一の記録） |
| `DetectedBattle` / `TiktokBattle` | `event` スキーマへのコピー / 正本。`EventMatchBattleCandidate` へは FK を張らない |
| `EventRoomLease` / `RoomMonitorLease` / `TiktokRoom.monitorUntil` | イベントの要求台帳 / 汎用の理由別台帳（**配線状況不明**） / 実際の期限（`max(既存, 要求)`） |
| `EventTeam` / `EventMatchSide` / `EventMatchSideParticipant` | チームの定義 / 対戦の陣営枠 / **誰が実際に出場するかの junction**。チーム戦でも出場者は junction が持つ |
| `EventLifePoint` / `EventLifeLedger` | 残高 / 履歴。ただし**両方とも同じ計算の出力から同時に全置換される**（追記台帳ではない） |
| `EventContribution` / `EventStanding` | リスナー側の貢献 / 参加者・チーム側の順位。どちらも derived |
| `GiftDailyListenerStat` / `GiftLifetimeStat` | room × 日 × リスナー / リスナーのみ（room 横断・全期間）。後者は前者から完全に再構築できる |
| `TiktokGiftCatalog` / `TiktokAvatarAsset` | どちらも外部が正本のキャッシュだが、前者は「和集合（消さない）」、後者は「7日で再取得」 |
| `AppSetting` / `Overlay*Settings` | グローバルな運用KV / 型付きの Streamer 単位設定。**ユーザー単位のデータを `AppSetting` に入れない** |
| analytics の `TiktokGiftCatalog` / desktop の `tiktok_gift_catalog` | 別アプリの別DB。**キー設計が違う（全部屋共有 vs 部屋別）ので同一視しない** |

---

## 7. このドキュメントで確定できなかったこと

**触る前に必ず自分で実コードを確認すること。ここに載っている「不明」を推測で埋めない。**

1. `RoomMonitorLease` テーブルが実際に配線されているか（調査で結論が割れた）
2. `Session` / `VerificationToken` に実際に行が書かれるか（JWT 戦略下の NextAuth 内部挙動）
3. `PendingPurchaseIntent` の削除経路（retention job が見つからない）
4. `TikTokUser` / `TiktokBattle*` 系 / `DetectedBattle` / `TiktokRoomAdminAuditLog` の retention（削除経路が無い）
5. `TiktokAvatarAsset` の GC 経路とバケット上のオブジェクト掃除
6. `EventParticipant.principalId` / `EventParticipant.status` の非 ACTIVE 値 / `EventContribution.scope="MATCH"` / `EventLifeLedger` の読み出し / `activeLeaseTiktokHandles()` の呼び出し元（いずれも dead の疑い）
7. `TiktokBattle.hostProfiles.nickName` の schema コメントと実装の矛盾、`hostProfiles.avatarUrl` の消費者
8. `BattleHistoryParticipant.score` と `officialScore` を分けている意図
9. `TiktokBattleItemUse.senderProfilePictureUrl` / `BattleTeam.externalTeamId` の読み出し先
10. `Subscription` フェーズB（旧列削除）の本番バックフィル状況
11. `AppSetting.eulerSignApiKey` が平文である理由
12. desktop の `broadcaster_state` / `display_state` に入る state_key の全集合、`daily_contributors.qualified_at` の書き込み箇所
13. TikRIng の D1 本番実スキーマとマイグレーション連番の一致

## 8. 改善候補（**このタスクでは移行しない**。着手時は必ず migration 影響を検討する）

- `Subscription` の旧3列（`stripeCustomerId` / `stripeSubscriptionId` / `status`）の削除（フェーズB）
- `EventMatch.scheduledStartAt` / `scheduledEndAt` の write-only dual-write の廃止
- `BattleHistoryParticipant.side` の廃止（`teamIndex` へ統一）
- `TiktokRoom.monitorUntil` と lease テーブルのデュアルライト解消（`RoomMonitorLease` の配線確認が先）
- dead の疑いがある列（§7-6）の棚卸し（`dead-code-audit` Skill を使う）
- schema コメントと実装の食い違い（§7-7, §7-8、`OverlayCoinListSettings` 直上の孤児コメント）の訂正
