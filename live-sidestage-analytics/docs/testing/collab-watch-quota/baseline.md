---
project: live-sidestage-analytics
feature: コラボ相手監視プラン枠
last_updated: 2026-09-13
last_risk: HIGH
last_reviewers: Gemini 3.7 Flash, Codex-terra
---

# コラボ相手監視（FREE枠）

## Out of Scope

- モバイルUIの枠表示・案内文言
- PRO/ULTRA の課金購入フロー自体

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CWQ-001 | FREEは1コラボセッションで新規相手3人まで | `collab-watch-quota.ts` / `watchDiscoveredRooms` | 正常 | FREE principal・当日初回コラボ・相手4人検知 | 新規監視追加は3人まで。4人目はスキップ | `npx vitest run src/lib/plan/collab-watch-quota.test.ts` | PASS | |
| TC-CWQ-002 | 継続中セッションはCollabSource基準で相手数を数える | `resolveSessionOpponentUids` | 境界 | activeLinkあり・lastCollabSourceは別roomに上書き済み | 残枠はactiveLinkの相手数から計算。3人超の新規追加不可 | 同上 + code-review指摘反映 | PASS | |
| TC-CWQ-003 | 本日セッション終了後は新規コラボ不可 | `resolveCollabWatchQuota` | negative | activeLink=0・当日lastCollabSource済み | remainingNewOpponents=0 | 同上 | PASS | |
| TC-CWQ-004 | PRO以上は制限なし | `worker.collabOpponentWatch` | 正常 | PRO entitlement | unlimited・全相手通過 | `npx vitest run src/lib/plan/features.test.ts` | PASS | |
| TC-CWQ-005 | コラボキック既存挙動維持 | `tiktok-listener.collab-kick.integration.test.ts` | 回帰 | quotaモックで無制限 | 即キック・二重接続防止は従来どおり | `npx dotenv -e .env.local.test --override -- vitest run src/lib/tiktok-listener.collab-kick.integration.test.ts` | PASS | |
