---
project: live-sidestage-analytics
feature: tiktok-super-fan-discrimination
last_updated: 2026-09-13
last_risk: LOW
last_reviewers: Gemini 3.7 Flash (code-review)
---

# テストベースライン: TikTok スーパーファン判別

probe 実測に基づき SF/NSF を `userIdentity.isSubscriberOfAnchor` + `portraitTag`、
SF 入室は `WebcastBarrageMessage` の `displayType` で解決し、
`chat:comment` / `chat:gift` の optional `isSuperFan` と `chat:superFanJoin` でモバイルへ配信する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-TSF-001 | SF コメント payload を true と判定 | `resolveSuperFanStatus` | 正常 | `isSubscriberOfAnchor: true` + `subForMo` tag | `true` | `npx vitest run src/lib/super-fan-status.test.ts` | PASS | |
| TC-TSF-002 | NSF コメント payload を false と判定 | 同上 | 正常 | `isSubscriberOfAnchor: false` + `notSub` tag | `false` | 同上 | PASS | |
| TC-TSF-003 | 判別不能時は undefined | 同上 | 境界 | portraitTag 欠落または flat `isSubscriber` のみ | `undefined` | 同上 | PASS | |
| TC-TSF-004 | SF 入室 displayType を検出 | `isSuperFanBarrageDisplayType` | 正常 | `ttlive_superFan_commentNotif_superFanJoined` | `true` | 同上 | PASS | |
| TC-TSF-005 | FC 入室のみは SF 扱いしない | 同上 | negative | `pm_mt_fan_live_join` | `false` | 同上 | PASS | |
| TC-TSF-006 | barrage schema から user_id を抽出 | `resolveSuperFanJoinUserId` | 正常 | `user_id=123` を含む schema | `"123"` | 同上 | PASS | |
| TC-WWP-010 | watchPatterns snapshot が import graph と一致 | CLI mock snapshot | 回帰 | 本番相当 snapshot(71項目) | exit 0、`All checks passed` | `npx vitest run scripts/worker-watch-patterns/cli.test.ts` | PASS | `super-fan-status.ts` 追加反映済み |
