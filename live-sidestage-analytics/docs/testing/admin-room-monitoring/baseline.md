---
project: live-sidestage-analytics
feature: 管理画面からのTikTokRoom監視操作(一時停止/特別監視)
last_updated: 2026-09-07
last_risk: LOW
last_reviewers: DeepSeek
---

# テストベースライン: 管理画面からのTikTokRoom監視操作

`/admin/workers` 管理画面から `PATCH /api/admin/tiktok-rooms` を通じて行う `TiktokRoom` の監視一時停止(`suspend`)・特別監視トグル(`toggle_special_watch`)。実装は [src/lib/tiktok-room.ts](../../../src/lib/tiktok-room.ts) の `suspendRoomMonitoring` / `toggleSpecialWatch`。一時停止(`monitoringSuspended`)は恒久停止ではなく、ログイン等のトリガーで自動的に復帰する既存仕様。特別監視(`specialWatch`)をONにする操作は、対象roomが一時停止中であれば同時に一時停止も解除する(一時停止のままだと`watchedRoomFilter`を満たさず特別監視が実際には機能しないため)。さらに`watchedRoomFilter`([src/lib/watched-room-filter.ts](../../../src/lib/watched-room-filter.ts))は`specialWatch:true`かつ`monitoringSuspended:false`のroomを匿名room自動停止のstale判定と無関係に監視対象とする(一時停止は特別監視より優先)。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-ARM-001 | 管理者が監視を一時停止できる | `suspendRoomMonitoring` / `PATCH action=suspend` | 正常 | 監視中(`monitoringSuspended:false`)のroom | 200、`monitoringSuspended:true`、監査ログ`action:suspend`が1件作成 | `npx dotenv -e .env.local.test -- npx vitest run src/app/api/admin/tiktok-rooms/route.integration.test.ts -t "監視解除すると200"` | PASS | |
| TC-ARM-002 | 一時停止は冪等 | 同上 | 境界 | 既に`monitoringSuspended:true`のroom | 200、`result:"already_suspended"`、監査ログは増えない | 同ファイル `-t "既に監視解除済みでも200"` | PASS | |
| TC-ARM-003 | 存在しないroomは404 | 同上 | 異常 | 存在しないroomId | 404 | 同ファイル `-t "存在しないroomIdなら404"` | PASS | |
| TC-ARM-004 | 特別監視ONで通常roomは一時停止状態に触れない | `toggleSpecialWatch` | 正常 | `specialWatch:false`, `monitoringSuspended:false`のroom | 200、`specialWatch:true`、`monitoringSuspended`は変化なし(`false`のまま)、監査ログ`detail:{specialWatch:true}` | 同ファイル `-t "toggle_special_watchを実行すると特別監視がONになり"` | PASS | |
| TC-ARM-005 | 特別監視ONで一時停止中roomの監視を再開する | `toggleSpecialWatch` | 回帰 | `specialWatch:false`, `monitoringSuspended:true`のroom | 200、`specialWatch:true`かつ`monitoringSuspended:false`に変わる、監査ログ`detail:{specialWatch:true, revivedSuspension:true}` | 同ファイル `-t "監視一時停止中のroomでtoggle_special_watchをONにすると一時停止も解除される"` | PASS | 2026-09-06追加。一時停止中に特別監視ONにしても再開されない不具合の修正 |
| TC-ARM-006 | 特別監視OFFへ戻す操作は一時停止状態を書き戻さない(一時停止していないroom) | `toggleSpecialWatch` | negative | `specialWatch:true`, `monitoringSuspended:false`のroom | 200、`specialWatch:false`。`monitoringSuspended`は変化なし。監査ログ`detail:{specialWatch:false}`(`revivedSuspension`を含まない) | 同ファイル `-t "再度toggle_special_watchを実行すると特別監視がOFFに戻る"` | PASS | |
| TC-ARM-007 | 存在しないroomへの特別監視トグルは404 | `toggleSpecialWatch` | 異常 | 存在しないroomId | 404 | 同ファイル `-t "存在しないroomIdへのtoggle_special_watchは404"` | PASS | |
| TC-ARM-008 | 未ログインは操作不可 | `PATCH /api/admin/tiktok-rooms` | 異常 | 未認証 | 401 | 同ファイル `-t "未ログインなら401"` | PASS | |
| TC-ARM-009 | 一時停止中roomへの新規監視登録(コラボ検知等)は自動的に一時停止を解除する | `reviveSuspendedMonitoring` 経由の各エントリポイント | 回帰 | `monitoringSuspended:true`のroom | `monitoringSuspended:false`に復帰 | `npx dotenv -e .env.local.test -- npx vitest run src/lib/tiktok-room.integration.test.ts -t "監視を復活させる"` | PASS | 特別監視トグルとは独立した既存経路。今回未変更 |
| TC-ARM-010 | 特別監視OFF操作は一時停止中でも一時停止状態を変更しない | `toggleSpecialWatch` | 境界 | `specialWatch:true`, `monitoringSuspended:true`のroom | 200、`specialWatch:false`。`monitoringSuspended`は`true`のまま変化しない。監査ログ`detail:{specialWatch:false}`(`revivedSuspension`を含まない) | 同ファイル `-t "特別監視OFF操作は一時停止中でも一時停止状態を変更しない"` | PASS | 2026-09-06追加。TestCaseレビュー(DeepSeek)指摘で追加 |
| TC-ARM-011 | 特別監視ONでの一時停止解除は監視復帰用フィールドも同時にリセットする(匿名room自動停止のstale判定回避) | `toggleSpecialWatch` | 回帰 | `specialWatch:false`, `monitoringSuspended:true`かつ`lastWatchInstructedAt`・`unhealthySince`・`notFoundStreak`・`notFoundFirstAt`・`lastExistenceCheckAt`・`consecutiveBlockedCount`が残っているroom | 200、`monitoringSuspended:false`に加え`lastWatchInstructedAt`と`lastLowValueCheckAt`が現在時刻に更新され、`unhealthySince:null`・`notFoundStreak:0`・`notFoundFirstAt:null`・`lastExistenceCheckAt:null`・`consecutiveBlockedCount:0`にリセットされる | 同ファイル `-t "一時停止解除時にlastWatchInstructedAtも更新する"` | PASS | 2026-09-06追加、2026-09-07にTestCaseレビュー(DeepSeek)指摘で全リセット対象フィールドの検証へ拡充。特別監視ONで一時停止→監視中表示になってもworkerのlistenerに実際には出てこない不具合の修正(`reviveSuspendedMonitoring`と揃えるまで`monitoringSuspended`のみ戻し、匿名roomの`watchedRoomFilter`stale判定に漏れ続けていた) |
| TC-ARM-012 | 特別監視中の匿名roomは自動停止トグルONでstaleでも監視対象 | `watchedRoomFilter` | 回帰 | `specialWatch:true`, `monitoringSuspended:false`, `lastWatchInstructedAt`がstaleBeforeより前の匿名room | `anonymousStaleBefore`指定でも接続対象(true) | `npx dotenv -e .env.local.test -- npx vitest run src/lib/agency/watched-room.integration.test.ts -t "specialWatch:trueの匿名roomはstaleでも接続対象"` | PASS | 2026-09-07追加。一時停止していない匿名roomを特別監視にしても、staleのままだと`toggleSpecialWatch`が`lastWatchInstructedAt`を更新せず(TC-ARM-011は一時停止中のみ)workerのlistenerに出てこない不具合の修正 |
| TC-ARM-013 | 特別監視でも一時停止中なら監視対象外 | `watchedRoomFilter` | 境界 | `specialWatch:true`, `monitoringSuspended:true`, `lastWatchInstructedAt`がfreshな匿名room | 接続対象外(false) | 同ファイル `-t "specialWatch:trueでもmonitoringSuspended:trueなら接続対象外"` | PASS | 2026-09-07追加。一時停止が特別監視より優先する不変条件の固定 |

## Quality Gate

- `npm run typecheck`
- `npx dotenv -e .env.local.test -- npx vitest run src/app/api/admin/tiktok-rooms/route.integration.test.ts src/lib/tiktok-room.integration.test.ts src/lib/agency/watched-room.integration.test.ts`
- `npx vitest run --exclude "**/*.integration.test.ts"`(プロジェクト全体のunit test回帰)

## Out of Scope

- 完全削除(`deleteTiktokRoomPermanently`)・イベント監視(`monitorUntil`)系の挙動は別機能領域として扱い、本baselineには含めない
