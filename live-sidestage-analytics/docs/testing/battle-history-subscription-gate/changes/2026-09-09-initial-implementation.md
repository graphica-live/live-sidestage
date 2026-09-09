date: 2026-09-09
feature: battle-history-subscription-gate

## change summary

誰も購読していないroom(Streamer登録・AgencyWatch登録・specialWatch・monitorUntilのいずれも無い、
コラボ検知由来の匿名監視roomのみ)のBattleHistory(対戦履歴の確定済みスナップショット)生成を止める。
`TiktokBattle`(生データ)は無改修で全room作り続ける。ガードは`computeBattleSnapshot()`
(`battle-history-finalize.ts`)冒頭の1箇所に置き、`materializeBattleHistory`/
`gift-retention.ts`の`finalizePendingBattles`/`scripts/backfill-battle-history.ts`の
全経路をカバーする。

risk: HIGH(HARD)

## reason

`gift-retention.ts`の`applyGiftRetention`は未確定`TiktokBattle`行が1件でもあるとGift削除処理
(90日保持期限)を全roomに対して丸ごとスキップする安全ゲートを持つ。今回のガードで購読なしroomの
`TiktokBattle`行が恒久的に「未確定」のまま残る設計にしたため、対策なしではGift削除処理が永久停止
しうるCRITICAL問題だった。

## 設計の変遷(重要)

1. 初版: `TiktokBattle`行そのものを購読なしroomで作らない設計(`recordBattleEvent()`入口でゲート)。
   review-auto Design Mode 1巡目(Codex-luna + Opus)でCRITICAL 1件・HIGH 4件を検出(相手room参照の
   破壊、room横断読み取り3箇所の劣化、管理者追加roomの誤判定、30秒キャッシュとDBの鮮度乖離)。
   → ゲート対象を`TiktokBattle`から`BattleHistory`確定処理へ移す設計へ転換。
2. 転換後版: ゲートを`computeBattleSnapshot`冒頭へ移し、`watchSource===null`を5条件目として追加。
   review-auto Design Mode 2巡目(DeepSeek + Codex、確認目的)でCRITICAL 1件・HIGH 1件を検出。
   - CRITICAL(Codex + 自己発見が一致): 上記のGift削除永久停止問題。
   - HIGH(DeepSeek + Codex): `watchSource`は「最初に発見された経路」の記録であって「現在の購読状態」
     ではなく、双方向の誤判定が起きる(管理者手動追加後も"購読なし"に誤判定される/Streamer解除後も
     "購読あり"に恒久的に誤判定される)。
   → `watchSource`条件を撤回し4条件(Streamer/AgencyWatch/specialWatch/monitorUntil)へ回帰。
     `ensureRoomWatchedByAdmin`が管理者手動追加時に`specialWatch: true`を自動セットするよう変更。
     `gift-retention.ts`の`finalizePendingBattles`/`countPendingBattles`のraw SQLへ購読条件の
     EXISTS副問い合わせを追加してCRITICALに対応。
3. 実装後、review-auto Code Mode(DeepSeek + Codex-terra、並列)を実施。両者ともNO ISSUES。
4. test-auto TestCase Mode(Codex-terra単体、Risk=HIGH×HARDのマトリクス指定)でHIGH 2件・MEDIUM 1件
   を検出(下記「VALIDだったfinding」参照)。

## affected baseline cases

- `docs/testing/battle-history-subscription-gate/baseline.md`: 新規作成。TC-BHS-001〜013
  (うちTC-BHS-001b/c, 007, 012, 013はTestCase Modeレビュー後の追加)
- `docs/testing/gift-retention/baseline.md`: TC-GR-011〜014を追加(011/012は初版、013/014は
  TestCase Modeレビュー後の追加)

## reviewers

- review-auto Design Mode 1巡目: Codex-luna + Opus(並列)
- review-auto Design Mode 2巡目: DeepSeek + Codex(並列、確認目的)
- review-auto Code Mode: DeepSeek + Codex-terra(並列)。共にNO ISSUES
- test-auto TestCase Mode: Codex-terra単体(HIGH×HARDマトリクス指定)

## important findings と VALID/INVALID判定

### Design Mode(plan段階で全て反映済み、詳細はplanファイル参照)

- CRITICAL(Opus): `computeBattleSnapshot`が相手roomの`TiktokBattle`行を読む設計を、初版の
  「TiktokBattle行を作らない」ゲートが壊す → VALID、ゲート対象をBattleHistory確定処理へ移して解消
- HIGH×3(Opus/Codex-luna): room横断読み取り3箇所の劣化・管理者追加room誤判定・キャッシュ鮮度 → VALID
- CRITICAL(Codex + 自己発見): gift-retention.tsのGift削除永久停止 → VALID、raw SQLへ購読条件追加
- HIGH(DeepSeek + Codex): watchSource条件の双方向誤判定 → VALID、条件撤回・4条件へ回帰

### TestCase Mode(今回のセッションで反映)

- HIGH: `ensureRoomWatchedByAdmin`の既存room更新分岐(update)にspecialWatch:true自動セットの
  専用テストが無かった → VALID。`tiktok-room.integration.test.ts`へ
  `describe("ensureRoomWatchedByAdmin")`を新規追加(update/create両分岐)
- HIGH: `gift-retention.ts`のraw SQL購読条件フィルタがspecialWatchケースでしか検証されておらず、
  Streamer/AgencyWatch/monitorUntil未来の3条件、およびmonitorUntil===nowの境界が未検証 → VALID。
  `gift-retention.integration.test.ts`へ`describe("購読条件の網羅(...)")`を新規追加
- MEDIUM: `computeBattleSnapshot`がStreamer/AgencyWatch relation経由で購読ありと判定する
  integrationケースが無く(specialWatch/monitorUntilの実経路のみ検証済み)、純粋関数の単体テスト
  だけでは`selfRoom.streamers`/`selfRoom.watches`のrelation取得自体の回帰を検出できない → VALID。
  `battle-history-finalize.integration.test.ts`へStreamer/AgencyWatch経由の2ケースを追加

## verification

- `npm run typecheck`: PASS
- `npm run test:unit`: 1488件 PASS
- `npm run test:integration`: 905件 PASS(TestCase Mode対応前は899件。今回3ファイルへ計6件追加)
- 既存room fixtureへの回帰(既存正常系がガードに巻き込まれてnullを返す事故)を自己発見・修正済み
  (`battle-history-finalize.integration.test.ts`と`battle-replay.integration.test.ts`の
  既存room作成へ`specialWatch: true`付与)

## remaining risks

- `RoomMonitorLease`のCOLLAB発行(将来monitorUntilへデュアルライトする設計コメントがあるが現状未実装)
  が実装されると、コラボ検知由来roomも`monitorUntil`を持つようになり本ガードが静かに無効化されうる
  (Opus finding7、LOW相当、`battle-subscription.ts`のJSDocに警告済み)
- `tiktok-room.integration.test.ts`のTC-BHS-007追加テストは今回新設した`describe`ブロックのみで、
  既存の`resolveRoomForStreamer`系テストとの相互作用は確認済みだが、`ensureRoomWatchedByAdmin`自体の
  他の呼び出し元(管理画面API)からの統合テストは対象外(単体呼び出しの検証に留まる)
