---
last_updated: 2026-09-07
last_risk: HIGH
last_reviewers: [deepseek-v4-flash, fable]
---

# バトル再生データ(確定・付加側)

対象: `src/lib/battle-opening-multiplier.ts`, `src/lib/battle-history-finalize.ts`
(`computeBattleSnapshot` / `snapshotsEqual` / `commitBattleSnapshot` / `attachReplayData`),
`prisma/schema.prisma`(`BattleHistoryScorePoint` と `BattleHistory` の `opening*` / `replay*Count`)

再生API・再生UI・シェアリンクは別工程(P4以降)。ここで保証するのは**再生に必要なデータが
確定時に正しく残ること**と、**逆算が誤った倍率を確定として出さないこと**。

実行方法の略記:

- `[unit]` = `npx vitest run src/lib/battle-opening-multiplier.test.ts`
- `[itg]` = `npx dotenv -e .env.local.test -- vitest run src/lib/battle-history-finalize.integration.test.ts`

## テストケース

| # | ケース | 対象 | 種別 | 前提 | 期待結果 | 実行方法 | 結果 | 備考 |
| - | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-BRD-001 | 確定時に自roomの窓内armiesが再生用スコア点へ複製される | `computeBattleSnapshot` | 正常 | 窓内に自分・相手のarmiesがある終了済みバトル | `scorePoints` が `windowStart` からの `offsetMs` 付きで作られ、全anchor分が入る | `[itg]` | PASS | 相手roomのarmiesは読まない(自roomのarmiesに全anchorのスコアが載る) |
| TC-BRD-002 | participantとして確定しないanchorIdと窓外のarmiesは捨て、窓の両端は含める | `computeBattleSnapshot` | 異常/境界 | 参加者に無いanchorIdの点、バトル終了後の点、窓の開始ちょうど・終了ちょうどの点を混ぜる | 前2つは `scorePoints` に含まれない。両端はそれぞれ `offsetMs` 0 と窓長で含まれる | `[itg]` | PASS | |
| TC-BRD-003 | `replayScorePointCount` / `replayGiftEventCount` が実際の行数と一致する | `commitBattleSnapshot` | 正常 | スコア点2件・ギフト1件のバトルを確定 | 両列がそれぞれ 2 / 1、`battle_history_score_points` も2行 | `[itg]` | PASS | 再生可否は件数から `isReplayable()` が判定する(P4) |
| TC-BRD-004 | 再確定してもスコア点が重複しない | `commitBattleSnapshot` | 回帰/冪等 | 同じバトルを2回 `materializeBattleHistory` | 行数・件数列とも変わらない | `[itg]` | PASS | scorePointはparticipantにぶら下がらないのでcascadeでは消えない。明示deleteが要る |
| TC-BRD-005 | armiesが同一時刻で複数anchor分届いても確定が `unstable` にならない | `snapshotsEqual` | 回帰 | 1イベントで全anchorを同一 `occurredAt` で保存(本番の常態)し、スコア点の並びを入れ替える | 安定性判定はanchorIdごとの最終スコアで行い、配列の並び順に依存しない | `[itg]` | PASS | 「配列末尾1点」比較だと同着の返却順が入れ替わるだけで偽の不一致になり、再生データが永久に付かない |
| TC-BRD-006 | 同一anchor・同一時刻のarmiesは後勝ちで1点へ畳む | `computeBattleSnapshot` / `attachReplayData` | 境界/回帰 | 同じ `(anchorId, occurredAt)` のarmiesを2行 | `scorePoints` は1点、`replayScorePointCount` は1。attach 後も1行のまま | `[itg]` | PASS | armies行数と再生の点数がずれる唯一の経路。畳み込みが確定側とattach側の2箇所にあるので両方を通す |
| TC-BRD-007 | スコア点が分割単位(1000)を超えても全件保存される | `commitBattleSnapshot` | 境界 | 窓内にスコア点1001件 | `battle_history_score_points` が1001行、`replayScorePointCount` も1001、最終点の `offsetMs` が保たれる | `[itg]` | PASS | 4コラボ×250イベントで到達する。分割ループのoff-by-oneは1000件以下では出ない |
| TC-BRD-008 | クリーンな候補が2件以上そろえば倍率を `measured` で確定する | `inferOpeningMultiplier` | 正常 | 区間内ギフトがちょうど1件・100ダイヤ以上・`multiplierType=0`・ボーナス区間外の候補が2件 | `multiplier` が 1/2/3 のいずれかで `confidence: "measured"`、`basisGiftId` は最初の候補 | `[unit]` | PASS | 赤帯を出してよいのは measured だけ(P5) |
| TC-BRD-009 | 逆算の結果が確定行・付加後の行の両方へ保存される | `computeBattleSnapshot` / `commitBattleSnapshot` / `attachReplayData` | 正常 | selfへ1000ダイヤ・`multiplierType=0` のギフトを +3s / +13s、self armies を 0/2000/4000、相手anchorのarmiesも混ぜる | `openingMultiplier=2` / `confidence="measured"` / `openingMultiplierBasisGiftId` が +3s の `Gift.id`。`openingWindow*` は null。attach 後も同値 | `[itg]` | PASS | `giftEvents → OpeningGift` の写像(`sourceGiftId`・`multiplierType`・自陣営フィルタ)を固定する唯一のケース |
| TC-BRD-010 | 倍率なし(1)と判定不能(null)を混同しない | `inferOpeningMultiplier` | 境界 | ratio=1 のクリーン候補が2件 | `multiplier: 1` / `measured`(null にしない) | `[unit]` | PASS | |
| TC-BRD-011 | 候補が1件だけなら `inferred` に留める | `inferOpeningMultiplier` | 境界 | クリーン候補1件 | `confidence: "inferred"` | `[unit]` | PASS | |
| TC-BRD-012 | 倍率刻印が未観測(`multiplierType: null`)の候補は `measured` へ上げない | `inferOpeningMultiplier` | 境界/回帰 | 候補2件だが両方 `multiplierType: null` | `confidence: "inferred"` 止まり | `[unit]` | PASS | P2デプロイ前のGiftは全てnull。TOP_2/TOP_3ブースター(x2)を除外できず ratio=2 が「初ギフト2倍」に化ける |
| TC-BRD-013 | 切り分け不能な候補は採用しない | `inferOpeningMultiplier` | 異常 | 区間内ギフト2件 / 100ダイヤ未満 / グローブcrit(`multiplierType=1`) / ボーナス報酬区間と重なる | いずれも `unknown` / `multiplier: null` | `[unit]` | PASS | 取りこぼしてよい代わりに誤確定を出さない方針 |
| TC-BRD-014 | 比が整数から離れる・4倍以上・候補どうしが食い違う場合は採用しない | `inferOpeningMultiplier` | 境界/異常 | ratio=2.5 / ratio=4 / 候補間で2と3 | いずれも `unknown` | `[unit]` | PASS | 許容は `\|ratio - round\| <= 0.02` かつ round ∈ {1,2,3} |
| TC-BRD-015 | スコア点の直前(lag未満)に届いたギフトは、その区間も次の区間も候補にしない | `inferOpeningMultiplier` | 境界/回帰 | ギフトが終端スコア点の1.5秒未満前 | `unknown`(反映先が t[i] か t[i+1] か決められないため両区間を除外) | `[unit]` | PASS | armies=サーバー受信時刻 / Gift=TikTok createTime で時刻基準が違う |
| TC-BRD-016 | 1件のギフトを隣接する2区間へ二重に割り当てない | `inferOpeningMultiplier` | 境界/回帰 | スコア点の間隔が lag(1.5秒)より短い | 候補は1件だけ成立し `inferred`(両区間で「ちょうど1件」が成立しない) | `[unit]` | PASS | 素朴な `(t[i-1]-lag, t[i]]` の重ね合わせだと誤成立する |
| TC-BRD-017 | 候補区間(60秒)より後のギフト・スコア点なし・ギフトなしは判定しない | `inferOpeningMultiplier` | 境界/データ欠損 | ギフトが窓外 / `scorePoints` 空 / `gifts` 空 | いずれも `unknown` | `[unit]` | PASS | |
| TC-BRD-018 | `windowStart` が推定(配信途中から接続)なら逆算しない | `inferOpeningMultiplier` / `computeBattleSnapshot` | 境界/回帰 | `TiktokBattle.startedAtEstimated = true`。TC-BRD-009 と同じギフト・armies | `openingMultiplier` は null / `confidence: "unknown"`。スコア点の複製自体は行われる | `[unit]` / `[itg]` | PASS | バトル中盤の通常ギフトを「倍率なしと判定できた」にしない |
| TC-BRD-019 | 倍率区間の開始・終了は仮定値から埋めない | `inferOpeningMultiplier` / `commitBattleSnapshot` | negative | 逆算が成功したケースと、確定済み行の列 | 関数の戻り値・DB列とも `openingWindowStartedAt` / `openingWindowEndedAt` は null | `[unit]` / `[itg]` | PASS | 60秒は未確定の仮定値。ここから残り秒数を出して画面に見せない |
| TC-BRD-020 | 候補が0件でも確定自体は行う | `computeBattleSnapshot` / `commitBattleSnapshot` | 正常/データ欠損 | 小粒ギフトしかないバトル | 確定は成功し、`openingMultiplierConfidence = "unknown"` が保存される | `[itg]` | PASS | 逆算結果は再生可否に影響させない |
| TC-BRD-021 | `attachReplayData` は既存の participants / giftEvents / 確定時刻を変えない | `attachReplayData` | 正常/回帰 | 確定済みバトルへ後からarmiesが揃った状態 | スコア点と `replay*Count` / opening列だけが更新され、participant・giftEventの行IDと `finalizedAt` は不変 | `[itg]` | PASS | 全置換(`--force`)は旧room削除で消えたarmies等により確定済みデータを劣化させうるので使わない |
| TC-BRD-022 | `attachReplayData` を2回流してもスコア点が重複しない | `attachReplayData` | 冪等 | 同じ `battleHistoryId` へ2回実行 | 行数・戻り値とも同じ | `[itg]` | PASS | 途中失敗しても「付加済み/未付加の混在」にしかならない |
| TC-BRD-023 | `attachReplayData` は `TiktokBattle` 行が消えていても付加でき、倍率は判定しない | `attachReplayData` | 異常/データ欠損 | 確定後に `TiktokBattle` を削除してから実行 | スコア点の付加は成功し、`openingMultiplier` は null / `confidence: "unknown"` | `[itg]` | PASS | `startedAtEstimated` が引けない＝窓の開始を信用できないため |
| TC-BRD-024 | 対象の `BattleHistory` 行が無ければ書かずに `not-found` を返す | `attachReplayData` | 異常 | 存在しないid | `{ attached: false, reason: "not-found" }`。FK違反で落ちない | `[itg]` | PASS | tx冒頭の行ロック `updateMany` の `count === 0`(findUniqueとロックの間に消えた場合)はコードレビューのみでテスト未到達 |
| TC-BRD-025 | 自roomの `hostUserId` が未解決なら付加を見送る | `attachReplayData` | 異常/データ欠損 | `TiktokRoom.hostUserId` を null にしてから実行 | `{ attached: false, reason: "self-host-unresolved" }`。スコア点は0行のまま | `[itg]` | PASS | 現行コードパスでは到達しない(hostUserIdはfill-onceでnullへ戻らない)が、防御的分岐が生きていることを固定する |
| TC-BRD-026 | schema変更に対応する migration ファイルがある | `prisma/migrations/` | 回帰 | 新テーブル・新列の追加 | 差分出力が `20260907000000_add_battle_replay_data/migration.sql` と一致し、DROP を含まない | `git show HEAD:live-sidestage-analytics/prisma/schema.prisma > <scratch>/old.prisma` → `npx prisma migrate diff --from-schema-datamodel <scratch>/old.prisma --to-schema-datamodel prisma/schema.prisma --script` | PASS | 本番は `db push` 運用で実行されない。履歴ドキュメントとして残す |

## Quality Gate

- `npm run typecheck`(`tsc --noEmit`)
- `npm run test:unit`
- `npm run db:push:local`(integration の前提。ローカルPostgresへスキーマ反映)
- `npx dotenv -e .env.local.test -- vitest run src/lib/battle-history-finalize.integration.test.ts`

## Out of Scope

- 再生API(`/api/analytics/battles/{battleId}/replay`)・再生UI・シェアリンク(P4〜P6)
- `scripts/attach-replay-data.ts` のバッチ制御(id カーソル・`--dry-run` / `--force`・件数集計)。
  `attachReplayData` の薄いラッパであり、本番DBに対する実行はユーザーの明示指示があってから行う
- `attachReplayData` と `commitBattleSnapshot` の並行実行。attach は armies / giftEvents / participants を
  トランザクションの外で読んでから行ロックを取るので、直列化されるのは書き込みだけ。
  読み元が同じ `Gift` / armies なので実害は無いが、暗黙の保証にはしない
- 実データでの逆算精度。倍率の正解ラベルがTikTokから配信されないため、`measured` の当否は
  本番のarmies/giftsを手で突き合わせる以外に確かめる手段が無い
- armies の保持期間ジョブ(現状 `tiktok_battle_armies_snapshots` に retention は無い)
