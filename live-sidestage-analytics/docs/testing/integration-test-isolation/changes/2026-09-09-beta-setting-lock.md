---
date: 2026-09-09
feature: integration test isolation (analyticsBetaEnabled 排他制御)
risk: HIGH
reviewers: DeepSeek V4 Flash (Code Mode), Codex-terra (Code Mode, HIGH×MODERATE)
---

## 変更概要

`AppSetting.analyticsBetaEnabled` の単一行を並列プロセスの integration テスト5ファイル
(`battles` / `gift-history` / `gifts/breakdown` / `ranking` / `me` の各 `route.integration.test.ts`)
が読み書きし、双方向の非決定的失敗を起こしていた（`me` 側が一時的に `true` にする間に他4ファイルが
`false` 前提で走る窓）。今回の Dockerfile 変更とは無関係の既存バグ。

`src/lib/__fixtures__/beta-setting-lock.ts` を新設し、プロセス間ディレクトリロック
（`mkdirSync` の atomicity + owner token `randomUUID()` + heartbeat `utimesSync` 3秒毎 + stale 判定15秒）で
5ファイルの実行を直列化した。`acquireBetaSettingLock()`（`beforeAll`/`afterAll` で保持）と
`withBetaSettingLock()`（1テスト内で完結する短時間保持）の2つの API を用意。

## 経緯・reviewer の重要指摘

- 初版は `beforeEach` でのタイミング変更のみで対応を試みたが、3連続実行の2回目で**逆方向**の新規 flaky が
  発生し、タイミング調整だけでは競合窓が消えないと判明。プロセス間ロックへ方針転換
- ロック初版（owner 検証・heartbeat なし、stale 判定60秒固定）に対し、review-auto Code Mode（HIGH×MODERATE）で
  DeepSeek・Codex-terra を実施
  - **DeepSeek: 2件 VALID** — `release()` 内の `await` 取りこぼし、ロック取得失敗時のエラー握り潰し
  - **Codex-terra: 2件 VALID**
    1. stale 判定が `mkdirSync` 後に更新されない `mtimeMs` だけを見ており、保持プロセスの生存確認が無いため
       正常な長時間保持のロックも奪われうる（実コード照合で確認: 実際に owner 確認なしで削除していた）
    2. `gifts/breakdown/route.integration.test.ts` が `analyticsBetaEnabled` を書き込む5番目のファイルだが、
       新設ロックの保護対象に含まれていなかった（`grep` で無保護を確認）
- 両モデルの指摘を反映し、owner token + heartbeat 方式へ全面書き換え、`gifts/breakdown` にもロックを適用

## 検証

- `npx tsc --noEmit`: PASS
- `npm run test:integration` を計8回連続実行。β関連の flaky 再現は0回（894 PASS が7回、1回のみ
  `tiktok-low-value-cleanup.integration.test.ts` で無関係の既知 cross-file flaky が発生 — β設定と無関係、
  memory `analytics-worker-status-integration-flake` と同種のため未対応）

## 残存リスク

- `STALE_MS`（15秒）はテストスイートの1テスト実行時間を大きく超える前提。将来 `beforeAll` 内の処理が
  極端に重くなった場合は heartbeat 間隔（3秒）とのマージンを見直す
