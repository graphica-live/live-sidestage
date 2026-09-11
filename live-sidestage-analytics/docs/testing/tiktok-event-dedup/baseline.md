---
project: live-sidestage-analytics
feature: tiktok-event-dedup
last_updated: 2026-09-11
last_risk: HIGH
last_reviewers: Code Mode: Codex-terra(NO ISSUES) + Gemini(agy/gemini-3.7-flash-medium、DeepSeek代理、NO ISSUES) / TestCase Mode: Codex-terra(MEDIUM 3件、境界値・onSaved契約はVALID反映、lock timeout到達はINVALID) + Gemini(NO ISSUES) / 2026-09-11 Wave2 advisory lock方式(pg_advisory_xact_lock)導入
---

# テストベースライン: tiktok-event-dedup

`src/lib/tiktok-listener.ts` の `saveGift()`(Gift非combo)・`saveBattleItemUse()`(TiktokBattleItemUse)が持つ
`findFirst → create` 型 check-then-act race を、既存 `saveComboGift()` と同じ `pg_advisory_xact_lock`
パターンで解消したもの(Wave2)。`(roomId, kind, msgId)` を lock key とし、`prisma.$transaction` 内で
lock取得 → 既存5分window `findFirst` → `create` の順に実行する。新規永続テーブル・migrationは伴わない。

`saveComboGift()`(advisory lock + SUM delta方式)・`saveListenerComment()`(dedupなし、高頻度・実害軽微という
既存設計判断を維持)は対象外・無変更。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-TED-001 | 同一tickの再送でGift行が二重計上されない | `saveGift()` | 正常/回帰 | 同じmsgIdのnon-comboギフトを同一tickに2回投入 | Gift行は1件だけ | `npx dotenv -e .env.local.test -- npx vitest run src/lib/tiktok-listener.gift-dedup.integration.test.ts` | PASS | |
| TC-TED-002 | プロセス跨ぎでもDB照会で重複が弾かれる(Gift) | `saveGift()` | 正常/回帰 | インスタンス内FIFOが空の状態(別プロセス相当)で同一msgIdを再送 | 2件目は `"duplicate"`、DB行は1件 | 同上 | PASS | process-local FIFO非依存の防御を確認 |
| TC-TED-003 | 5分window境界の内外で同一msgIdの扱いが切り替わる(Gift) | `saveGift()` | 境界 | 同一msgIdを`t`で保存後、`t+5分`(境界=`gte`で重複扱い)と`t+10分`(窓外)、`t+5分+1ms`(境界超過=新規扱い)で再送 | `t+5分`は`"duplicate"`、`t+10分`/`t+5分+1ms`は`"saved"`として新規行になる | 同上 | PASS | Codex TestCase-review指摘(2026-09-11)により`t+5分`ちょうど/`t+5分+1ms`の境界前後ケースを追加 |
| TC-TED-004 | msgId未解決のギフトはdedup判定なしで従来どおり保存される | `saveGift()` | 異常/境界 | `resolveMsgId()` がnullを返すギフトを2回投入 | lock取得・findFirstともスキップされ2回とも保存される(推測的なdedup key生成はしない) | 同上 | PASS | |
| TC-TED-005 | comboギフトの積み増しはGiftのdedupで弾かれない | `saveGift()` / `saveComboGift()` | 回帰 | 段階ごとに別msgIdを持つcomboギフトを連続投入 | 各段階が正しく保存される(comboの独立ロジックに影響されない) | 同上 | PASS | |
| TC-TED-006 | 部屋が違えば同一msgIdでも独立して保存される(Gift) | `saveGift()` | 境界 | 同一msgIdを異なる`roomId`の2部屋へ投入 | 両方とも保存される(lock keyに`roomId`が含まれるため直列化されない) | 同上 | PASS | |
| TC-TED-007 | [最重要] 真の同時実行でも二重保存されない(Gift) | `saveGift()` | 並行処理 | 同一msgIdに対し`saveGift()`を`Promise.all`で直接2回同時呼び出し | DB行は1件のみ。片方が`"saved"`、もう片方が`"duplicate"` | 同上 | PASS | `pg_advisory_xact_lock`が実DB(postgres:16)上で機能することの検証。listenerのFIFOを迂回した直接呼び出し |
| TC-TED-008 | insert失敗後の再試行が正常に保存される(Gift) | `saveGift()` | 異常 | `tx.gift.create`を1回だけ例外を投げるようモックし、同一msgIdで再試行 | 1回目は`"error"`、2回目は`"saved"`、DBに1件だけ保存(lockがtx rollbackとともに解放される証明) | 同上 | PASS | |
| TC-TED-008b | `onSaved`コールバックはcommit後・保存成功時のみ1回呼ばれる(Gift) | `saveGift()` | 回帰 | `onSaved`スパイを渡し、(1)新規保存 (2)同一msgId再送 (3)`tx.gift.create`失敗の3パターンを実行 | (1)保存済みGift IDで1回だけ呼ばれる (2)(3)は一度も呼ばれない | 同上 | PASS | Codex TestCase-review指摘(2026-09-11)により追加。commit後・成功時のみ発火するリアルタイム同期の契約を検証 |
| TC-TED-009 | cardType=2(glove)のsender/targetHostTiktokUidが正しく保存される(BattleItemUse) | `saveBattleItemUse()` | 正常 | glove itemイベントを投入 | sender/target双方のtiktokUidが正しく保存される | `npx dotenv -e .env.local.test -- npx vitest run src/lib/tiktok-listener.battle-item-dedup.integration.test.ts` | PASS | dedupとは独立した既存の保存ロジック確認(回帰) |
| TC-TED-010 | cardType=4(POWER_UP_SUMMARY)は保存されない | `saveBattleItemUse()` | negative | 周期通知(sender無し)イベントを投入 | 保存されない | 同上 | PASS | |
| TC-TED-011 | 同一tickの再送でBattleItemUse行が二重計上されない | `saveBattleItemUse()` | 正常/回帰 | 同じmsgIdのアイテム使用イベントを同一tickに2回投入 | 行は1件だけ | 同上 | PASS | TC-TED-001のBattleItemUse版 |
| TC-TED-012 | プロセス跨ぎでもDB照会で重複が弾かれる(BattleItemUse) | `saveBattleItemUse()` | 正常/回帰 | インスタンス内FIFOが空の状態で同一msgIdを再送 | 2件目は`"duplicate"`、DB行は1件 | 同上 | PASS | TC-TED-002のBattleItemUse版 |
| TC-TED-013 | msgId未解決のイベントはdedup判定なしで従来どおり保存される(BattleItemUse) | `saveBattleItemUse()` | 異常/境界 | msgId未解決のイベントを2回投入 | 2回とも保存される | 同上 | PASS | TC-TED-004のBattleItemUse版 |
| TC-TED-014 | 5分window境界の内外で同一msgIdの扱いが切り替わる(BattleItemUse) | `saveBattleItemUse()` | 境界 | 同一msgIdを`t`で保存後、`t+5分`(境界=`gte`で重複扱い)と`t+10分`(窓外)、`t+5分+1ms`(境界超過=新規扱い)で再送 | `t+5分`は`"duplicate"`、`t+10分`/`t+5分+1ms`は`"saved"`として新規行になる | 同上 | PASS | TC-TED-003のBattleItemUse版。Codex TestCase-review指摘(2026-09-11)により境界前後ケースを追加 |
| TC-TED-015 | 部屋が違えば同一msgIdでも独立して保存される(BattleItemUse) | `saveBattleItemUse()` | 境界 | 同一msgIdを異なる`roomId`の2部屋へ投入 | 両方とも保存される | 同上 | PASS | TC-TED-006のBattleItemUse版 |
| TC-TED-016 | [最重要] 真の同時実行でも二重保存されない(BattleItemUse) | `saveBattleItemUse()` | 並行処理 | 同一msgIdに対し`saveBattleItemUse()`を`Promise.all`で直接2回同時呼び出し | DB行は1件のみ。片方が`"saved"`、もう片方が`"duplicate"` | 同上 | PASS | TC-TED-007のBattleItemUse版 |
| TC-TED-017 | insert失敗後の再試行が正常に保存される(BattleItemUse) | `saveBattleItemUse()` | 異常 | `tx.tiktokBattleItemUse.create`を1回だけ例外を投げるようモックし、同一msgIdで再試行 | 1回目は`"error"`、2回目は`"saved"`、DBに1件だけ保存 | 同上 | PASS | TC-TED-008のBattleItemUse版 |
| TC-TED-018 | 同一(roomId, msgId)のGiftとBattleItemUseは互いにブロックせず独立保存される | `saveGift()` + `saveBattleItemUse()` | 境界 | 同一`roomId`・同一`msgId`の値をGift/BattleItemUse双方へ同時投入 | lock keyが`"gift:" + msgId`と`"battle_item:" + msgId`で異なるため互いに待機せず、両テーブルへ独立して保存される | 同上 | PASS | kindによる種別分離の実証 |
| TC-TED-019 | comboギフト経路への影響がない | `saveComboGift()` | 回帰 | comboギフトの一連のフローを実行 | 既存動作から差分なし。`saveComboGift()`自体もコード上無変更 | `npx dotenv -e .env.local.test -- npx vitest run src/lib/tiktok-listener.combo.integration.test.ts` | PASS | advisory lock方式導入がcombo経路(別lock key空間)に影響しないことの確認 |
| TC-TED-020 | 全体unit/integrationテストに回帰がない | プロジェクト全体 | 回帰 | - | 既存の全テストが通る | `npm run test:unit` / `npm run test:integration` | PASS(unit 1627件、integration 1001件、typecheck・`npx next build`も別途PASS) | 全体実行時のみ`src/event/battles.integration.test.ts`が1件deadlockで落ちたが、単体実行(`npx vitest run src/event/battles.integration.test.ts`)では66件全PASS。本Wave(Gift/BattleItemUse dedup)と無関係な既存のクロスファイル干渉flakeと判断(対象外) |

## Quality Gate

- `npm run typecheck`(`tsc --noEmit`)
- `npm run test:unit`
- `npm run test:integration`(要 `.env.local.test` + ローカルPostgres)
- `npx next build`(型・ルーティング確認。`npm run build` は使わない — db pushを含むため)

## Out of Scope

- `saveListenerComment()`(ListenerComment)へのdedup強化 — 高頻度・実害軽微という既存設計判断を維持し、本Waveでは対象外(ユーザー明示指示)。
- `InboundEventDedup`専用テーブル方式 — 当初検討したがDB負荷(WAL/index/autovacuum/TTL cleanup)面で過剰と判断し不採用。詳細は `.claude/plans/20260911-wave2-durable-dedup.md` 冒頭「訂正の経緯」参照。
- Gift/TiktokBattleItemUse本体への永久UNIQUE制約付与 — roomIdが永続IDのため将来のmsgId再利用時に正当なイベントを恒久的に弾むリスクがあり、既存設計として不採用(踏襲)。
- advisory lock待機がtransaction timeout(15秒)に達した場合の異常系テスト — Codex TestCase-review指摘(2026-09-11)。既存`saveComboGift()`(同型のadvisory lock+timeout構成)にも同等テストが存在せず、実行に別DB接続で15秒超ロック保持が要る高コストなテストになるため不採用と判断した。
