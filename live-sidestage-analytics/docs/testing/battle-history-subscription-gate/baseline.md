---
project: live-sidestage-analytics
feature: battle-history-subscription-gate
last_updated: 2026-09-09
last_risk: HIGH
last_reviewers: review-auto Code Mode(DeepSeek + Codex-terra、共にNO ISSUES) / test-auto TestCase Mode(Codex-terra単体、HIGH×2 + MEDIUM×1検出、全てVALIDとして反映済み)
---

# テストベースライン: battle-history-subscription-gate

誰も購読していないroom(Streamer登録・AgencyWatch登録・specialWatch・monitorUntilのいずれも無い、
コラボ検知由来の匿名監視roomのみ)ではBattleHistory(対戦履歴の確定済みスナップショット)を作らない。
判定は`hasBattleSubscriber()`(`src/lib/battle-subscription.ts`、DBアクセスなしの純粋関数)が行い、
`computeBattleSnapshot()`(`src/lib/battle-history-finalize.ts`)冒頭のガードとして適用される。
`computeBattleSnapshot`は`materializeBattleHistory`(通常経路)・`finalizePendingBattles`
(`gift-retention.ts`、90日削除前の確定)・`scripts/backfill-battle-history.ts`の3経路が共通で呼ぶ
唯一の入口のため、ここ1箇所のガードで全経路をカバーする。`TiktokBattle`(生データ)行自体は
無改修で全room作り続ける(購読なしroomでも作られ続ける)。

`ensureRoomWatchedByAdmin()`(`src/lib/tiktok-room.ts`)は管理者が`/admin/workers`から手動でroomを
追加する経路で、以後常に`specialWatch: true`をセットすることで「購読あり」に固定する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-BHS-001 | 4条件のいずれか1つでもtrueなら購読ありと判定する | `hasBattleSubscriber` | 正常 | streamerCount>0 / watchCount>0 / specialWatch=true / monitorUntil未来 を単独で立てた4パターン | いずれも`true` | `npx vitest run src/lib/battle-subscription.test.ts` | PASS | |
| TC-BHS-001b | Streamer登録があるroomはDB relation経由でcomputeBattleSnapshotが購読ありと判定する | `computeBattleSnapshot`(実DB経路) | 正常/回帰 | Streamer 1件のみ登録したroomで終了済みバトル | `computeBattleSnapshot`が非null | `npx dotenv -e .env.local.test -- vitest run src/lib/battle-history-finalize.integration.test.ts` | PASS | Codex-terra TestCase Modeレビュー指摘(MEDIUM)で追加。純粋関数の単体テストのみでrelation取得(`selfRoom.streamers`)の実経路が未検証だった |
| TC-BHS-001c | AgencyWatch登録があるroomはDB relation経由でcomputeBattleSnapshotが購読ありと判定する | `computeBattleSnapshot`(実DB経路) | 正常/回帰 | AgencyWatch 1件のみ登録したroomで終了済みバトル | `computeBattleSnapshot`が非null | 同上 | PASS | 同上(`selfRoom.watches`) |
| TC-BHS-002 | 4条件すべてfalseなら購読なしと判定する | `hasBattleSubscriber` | 異常/negative | streamerCount=0, watchCount=0, specialWatch=false, monitorUntil=null | `false`(匿名監視roomのみの状態) | 同上 | PASS | |
| TC-BHS-003 | monitorUntilは「未来」だけがtrueで、過去・現在時刻は含まない | `hasBattleSubscriber` | 境界 | monitorUntil=(now-60s) / monitorUntil=now(境界) / monitorUntil=(now+60s) | 過去・境界(now)は`false`、未来のみ`true` | 同上 | PASS | |
| TC-BHS-004 | 複数条件が同時にtrueでもtrue | `hasBattleSubscriber` | 正常 | streamerCount>0 かつ specialWatch=true | `true` | 同上 | PASS | |
| TC-BHS-005 | 購読なしroomはcomputeBattleSnapshotがnullを返し、TiktokBattle行自体は残る | `computeBattleSnapshot`, `materializeBattleHistory` | 正常/回帰 | Streamer/AgencyWatch/specialWatch/monitorUntilいずれも無いroomで終了済みバトル | `computeBattleSnapshot`は`null`、`materializeBattleHistory`は`{finalized:false, reason:"not-ready"}`、`tiktok_battles`行自体は削除されず残る | `npx dotenv -e .env.local.test -- vitest run src/lib/battle-history-finalize.integration.test.ts` | PASS | |
| TC-BHS-006 | ensureRoomWatchedByAdminで追加したroomはspecialWatchが自動セットされ確定される | `ensureRoomWatchedByAdmin`, `computeBattleSnapshot` | 正常/回帰 | 管理者が新規tiktokUidをensureRoomWatchedByAdminで追加、他の購読条件なし | 作成されたroomの`specialWatch===true`。同roomの終了済みバトルはcomputeBattleSnapshotが非null | 同上 | PASS | 既存room(update分岐)側もspecialWatch:trueで上書きされる回帰は本ケースでは未直接検証(TC-BHS-007参照) |
| TC-BHS-007 | ensureRoomWatchedByAdminの既存room更新分岐でもspecialWatchがセットされる | `ensureRoomWatchedByAdmin` | 境界/回帰 | 既にTiktokRoom行が存在するtiktokUidへ再度ensureRoomWatchedByAdminを呼ぶ(update分岐) | 対象roomの`specialWatch===true`に更新される、room行は増えない(同一hostTiktokUidで1件のまま) | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-room.integration.test.ts` | PASS | Codex-terra TestCase Modeレビュー指摘(HIGH)で追加。`describe("ensureRoomWatchedByAdmin")`に新規/既存の両分岐を追加 |
| TC-BHS-008 | monitorUntilが未来のroomは確定される | `computeBattleSnapshot` | 正常/回帰 | monitorUntilのみ未来にセットしたroomで終了済みバトル | `computeBattleSnapshot`が非null | `npx dotenv -e .env.local.test -- vitest run src/lib/battle-history-finalize.integration.test.ts` | PASS | |
| TC-BHS-009 | 購読ありroomの既存確定処理(相手room参照・スコア算出等)に回帰がない | `computeBattleSnapshot`ほか(既存30ケース) | 回帰 | 既存の`battle-history-finalize.integration.test.ts`フィクスチャ(specialWatch:true付与済み) | 既存30ケース全てPASS | 同上 | PASS | 今回のガード追加で既存roomフィクスチャがガードに巻き込まれ意図せずnullを返す事故を発見・修正した経緯あり(specialWatch:true付与) |
| TC-BHS-010 | 購読なしroomの未確定バトルが90日Gift削除処理を永久停止させない(CRITICAL対応) | `finalizePendingBattles`, `countPendingBattles`(`gift-retention.ts`) | 異常/negative | 購読なしroomに保持期限超過の未確定TiktokBattle行がある状態でrunGiftRetentionCycleを実行 | `countPendingBattles`がこの行を数えない(`pending`集計に含まれない)、`applyGiftRetention`のGift削除がskipされない(`skippedReason===null`) | `npm run test:integration -- src/lib/gift-retention.integration.test.ts`(該当describe: 「購読なしroomの未確定バトルはGift削除を止めない」) | PASS | gift-retention baseline側(TC-GR-011)にも同一趣旨のケースを記録 |
| TC-BHS-011 | 購読ありroomの未確定バトルは従来どおりGift削除を止める(既存動作の回帰防止) | 同上 | 回帰 | 購読ありroom(specialWatch:true)に保持期限超過の未確定TiktokBattle行がある状態 | `pending>=1`、`skippedReason`に「未確定バトル」を含む文言、対象Giftの削除が見送られる | 同上 | PASS | gift-retention baseline側(TC-GR-012)と同一 |
| TC-BHS-012 | gift-retention.tsのraw SQL購読条件はStreamer/AgencyWatch/monitorUntil未来の全条件で購読ありと判定する(条件網羅) | `finalizePendingBattles`, `countPendingBattles` | 正常/回帰 | Streamer登録room・AgencyWatch登録room・monitorUntil未来roomの3種、各に保持期限超過の未確定バトルがある状態 | いずれも`pending>=1`、`skippedReason`が非null、対象Giftの削除が見送られる | 同上(該当describe: 「購読条件の網羅(Streamer/AgencyWatch/monitorUntil境界)」) | PASS | Codex-terra TestCase Modeレビュー指摘(HIGH)。specialWatch以外の3条件がraw SQL側で未検証だった(純粋関数`hasBattleSubscriber`とraw SQLは別実装のため、片方のテストがもう片方を保証しない) |
| TC-BHS-013 | monitorUntil===nowの境界はraw SQL条件(`> now`)でも購読なし扱いになる | 同上 | 境界 | monitorUntilをNOWと同時刻にセットしたroomに未確定バトルがある状態 | `skippedReason===null`、対象Giftが削除される | 同上 | PASS | `hasBattleSubscriber`側のTC-BHS-003と対称。raw SQL側の境界を別途固定 |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`(該当: `src/lib/battle-subscription.test.ts`)
- `npm run test:integration`(該当: `src/lib/battle-history-finalize.integration.test.ts`, `src/lib/battle-replay.integration.test.ts`, `src/lib/gift-retention.integration.test.ts`, `src/lib/tiktok-room.integration.test.ts`)

## Out of Scope

- `watchedRoomFilter()`(listenerを繋ぎ続けるか、の別軸の条件)は今回の変更対象外。混同しないための参照コメントのみ`battle-subscription.ts`に記載
- `RoomMonitorLease`のCOLLAB発行(将来monitorUntilへデュアルライトする設計コメントがあるが未実装)。実装されると本ガードが無効化されるリスクをコード内コメントで警告済み(既知の残存リスク、plan参照)
- `hasBattleSubscriber`の入力(`room`)に対する実行時バリデーション。TypeScriptの静的型で保証される前提とし、DeepSeekのLOW指摘を実装レビューで受けて判断済み(plan参照)
