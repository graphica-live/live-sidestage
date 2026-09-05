---
project: live-sidestage-analytics
feature: event-aggregation-deadline
last_updated: 2026-09-06
last_risk: HIGH
last_reviewers: Qwen(独立) + fable-expert(Codex/Gemini quota枯渇のため代理)
---

# テストベースライン: event-aggregation-deadline

イベント集計(`src/event/aggregate.ts`)の締切(`endAt` + `AGGREGATE_GRACE_MS`、現在1週間)後に
`Event.finalizedAt`を立てて以後集計を止める仕組みと、`reopenAggregation()`
(`src/event/reopen-aggregation.ts`)が同じ締切を過ぎたら再集計を拒否するガード。
1週間の猶予拡大に伴い、`event-worker`(10秒間隔)が終了済み・未確定イベントを
毎tick フルスキャン再計算し続けるコスト増を防ぐスロットル
(`aggregationWindow`の`POST_END_AGGREGATE_THROTTLE_MS`)もこの機能に含む。
`aggregateEvent()`本体の集計ロジック(倍率・チーム・順位表等)は対象外
(`docs/testing/event-worker-scheduler/baseline.md`の Out of Scope 参照、集計計算自体は
`aggregate.integration.test.ts`の別describeブロックが担う)。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-EAD-001 | 締切前ならFINISHEDでも集計対象に残る | `aggregationWindow` | 正常 | `status:FINISHED`、`endAt`が締切(1週間)以内 | `aggregationWindow`のwhereに一致する | `npx dotenv -e .env.local.test -- vitest run src/event/aggregate.integration.test.ts` | PASS | |
| TC-EAD-002 | 締切超過後の集計で`finalizedAt`が立ち、以後対象から外れる | `aggregateEvent` + `aggregationWindow` | 正常 | `endAt`が締切超過 | 集計1回成功後`finalizedAt`が非null、以後`aggregationWindow`に一致しない | 同上 | PASS | |
| TC-EAD-003 | ロック取得後に開催準備中へ戻されていたら集計しない | `aggregateEvent` | 異常/negative | 選定後に`status:SCHEDULED`へ変化 | `status:"skipped", reason:"not-due"`、`finalizedAt`は立たない | 同上 | PASS | |
| TC-EAD-004 | 最終集計済み/ARCHIVEDイベントは集計しない | `aggregateEvent` | negative | `finalizedAt`あり / `status:ARCHIVED` | 両方とも`skipped/not-due` | 同上 | PASS | |
| TC-EAD-005 | 開催中(締切前)の集計では`finalizedAt`は立たない | `aggregateEvent` | 正常 | `endAt`が未来 | `finalizedAt`はnullのまま | 同上 | PASS | |
| TC-EAD-006 | 開始前のイベントは集計対象にならない | `aggregationWindow` | 境界 | `startAt`が未来 | whereに一致しない | 同上 | PASS | |
| TC-EAD-007 | 終了済み・締切前でも、スロットル間隔内に再集計済みなら次tickでは対象から外れる | `aggregationWindow`(`POST_END_AGGREGATE_THROTTLE_MS`) | 境界/negative | `endAt`過去(締切前)、`lastAggregatedAt`が現在時刻 | whereに一致しない(この周回はスキップ) | 同上 | PASS | 2026-09-06追加(HIGH#1対応: `AGGREGATE_GRACE_MS`の1時間→1週間延長に伴う10秒間隔フルスキャンのコスト増対策) |
| TC-EAD-008 | 終了済みでもスロットル間隔を過ぎていれば再び対象に入る | `aggregationWindow` | 境界 | `lastAggregatedAt`が`POST_END_AGGREGATE_THROTTLE_MS`超過前 | whereに一致する | 同上 | PASS | 2026-09-06追加 |
| TC-EAD-009 | 開催中(`endAt`が未来)なら直近に集計済みでもスロットルされず毎回対象に入る | `aggregationWindow` | 正常/回帰 | `endAt`が未来、`lastAggregatedAt`が現在時刻 | whereに一致する(スロットルは終了済みイベントにのみ適用) | 同上 | PASS | 2026-09-06追加。開催中イベントの毎tick再計算という既存保証を壊していないことの回帰確認 |
| TC-EAD-010 | 締切前の確定済みイベントは`reopenAggregation()`で再オープンできる | `reopenAggregation` | 正常/回帰 | `finalizedAt`あり、`endAt`+猶予が未来 | `finalizedAt`がnullに戻る | `npx dotenv -e .env.local.test -- vitest run src/event/reopen-aggregation.integration.test.ts` | PASS | |
| TC-EAD-011 | 締切超過後は`reopenAggregation()`が例外を投げ再オープンを拒否する | `reopenAggregation` | 異常/negative | `finalizedAt`あり、`endAt`+猶予(1週間)を超過 | 例外を投げ、`finalizedAt`は変化しない(トランザクション全体ロールバック想定) | 同上 | PASS | |
| TC-EAD-012 | 未確定(`finalizedAt IS NULL`)のイベントは締切超過後もno-op(呼んでも何もしない) | `reopenAggregation` | 境界 | `finalizedAt`がnull、`endAt`+猶予を超過 | 例外を投げない(戻す対象が無い) | 同上 | PASS | |
| TC-EAD-013 | 締切超過エラーはAPI層で409 `AGGREGATION_DEADLINE_PASSED`に変換される | `aggregationDeadlineResponseFor` + 主催者ミューテーション各route | 異常 | `reopenAggregation()`が締切超過例外を投げる状況で各routeを呼ぶ | 409 JSON `{code:"AGGREGATION_DEADLINE_PASSED"}`相当が返る(routeによりエラーメッセージ形式は共通) | 自動テストなし(route層のunit/integrationは未作成) | NOT RUN: `aggregationDeadlineResponseFor`自体の単体ロジックは`src/event/aggregation-deadline-http.ts`に閉じているが、各routeでの結線は手動コードレビューのみ(2026-09-06、`participants/[participantId]/route.ts`のPATCH catchに追加漏れを発見・修正済み(MEDIUM#3)) | 呼び出し元は`events/[id]`, `matches/[matchId]`, `matches/swap`, `participants`, `matches/single`, `matches`, `participants/[participantId]`の7routeファイル。全て`aggregationDeadlineResponseFor`のimportをgrepで確認済み |

## Quality Gate

- `npm run typecheck`
- `npx dotenv -e .env.local.test -- vitest run src/event/aggregate.integration.test.ts`(ローカルDB必須)
- `npx dotenv -e .env.local.test -- vitest run src/event/reopen-aggregation.integration.test.ts`(ローカルDB必須)
- `npx next build`

## Out of Scope

- `aggregateEvent()`本体の集計計算(倍率・チーム・順位表・0点処理等) — `aggregate.integration.test.ts`の別describeが既存カバー、今回未変更
- `event-worker.ts`のtick起動・多重起動防止・shutdown制御 — `docs/testing/event-worker-scheduler/baseline.md`
- バトルトーナメント・デスマッチの検知/勝敗確定ロジック — 本変更は締切とスロットルのみで検知ロジックには触れていない
