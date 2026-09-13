---
project: live-sidestage-analytics
feature: web-ranking-perf
last_updated: 2026-09-13
last_risk: HIGH
last_reviewers: Gemini 3.7 Flash + Codex-terra
---

# テストベースライン: web 貢献ランキング高速化

Web（配信者 `/analytics` と admin room）の「ユーザー別コイン数」を、モバイル貢献タブと同じ方針で軽くする。無限スクロールは対象外（クライアント側ソート・絞り込み・CSVのため全件 JSON は維持。DOM は既存の window virtualizer）。

- 日付ナビ（period+date）は `preferRollup`（watermark 完了日は `GiftDailyListenerStat`、当日は Gift）
- custom 時刻範囲はロールアップしない
- ランキング GET はアバター署名を待たない。`POST .../gifts/avatars` で後埋め（room に実在する uid だけ）
- 画面は期間キーのメモリキャッシュ + 隣接期間 prefetch。ヒット時は先に出してから refresh

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-WRP-001 | uids パース | `parseRankingAvatarUids` | 境界 | 正常配列 / 欠落 / 空文字 / 201件 | 正常は ok、不正は error | `npx vitest run src/lib/gift-ranking-avatars.test.ts` | PASS | |
| TC-WRP-002 | キャッシュ鍵・アバターマージ・prefetch日付 | `ranking-list-cache.ts` | 正常 | apiBase違い、custom、chunk、隣接日 | admin room が衝突しない。今日の翌日は prefetch しない | `npx vitest run src/components/analytics/ranking-list-cache.test.ts` | PASS | |
| TC-WRP-003 | カレンダーGETは rollup・アバター省略 | `GET /api/analytics/gifts` | 契約 | session あり period=day | `queryGifts` 第5引数が `CALENDAR_RANKING_QUERY_OPTIONS` | `npx vitest run src/app/api/analytics/gifts/route.test.ts` | PASS | |
| TC-WRP-004 | custom GET は rollup しない | 同上 | 契約 | startDatetime+endDatetime | `CUSTOM_RANGE_RANKING_QUERY_OPTIONS` | 同上 | PASS | |
| TC-WRP-005 | 未ログインGETは401 | 同上 | 認可 | session null | 401、queryGifts 非呼び出し | 同上 | PASS | |
| TC-WRP-006 | avatars POST 認可と room スコープ | `POST /api/analytics/gifts/avatars` | 認可 | 無session / roomなし / 不正uids / 正常 | 401 / 空配列 / 400 / loadRankingAvatars(roomId) | `npx vitest run src/app/api/analytics/gifts/avatars/route.test.ts` | PASS | |
| TC-WRP-007 | モバイルavatarsリファクタ回帰 | `POST /api/mobile/analytics/ranking/avatars` | 回帰 | 既存 integration | 401・未登録空・不正uids・空uids | `npx dotenv -e .env.local.test -- vitest run src/app/api/mobile/analytics/ranking/avatars/route.integration.test.ts` | PASS | ローカルDB |
| TC-WRP-008 | admin gifts GET 認可回帰 | `GET /api/admin/rooms/:id/analytics/gifts` | 回帰 | 既存 integration | 401 / 200 verified | `npx dotenv -e .env.local.test -- vitest run src/app/api/admin/rooms/[roomId]/analytics/gifts/route.integration.test.ts` | PASS | ローカルDB |
| TC-WRP-009 | typecheck | 変更ファイル | 回帰 | worktree | エラーなし | `npx tsc --noEmit` | PASS | |

| TC-WRP-010 | admin avatars POST 認可 | POST /api/admin/rooms/[roomId]/analytics/gifts/avatars | 認可 | 無session / 正常 | 401 / loadRankingAvatars(roomId) | 
px vitest run src/app/api/admin/rooms/[roomId]/analytics/gifts/avatars/route.test.ts | PASS | Gemini指摘 |
| TC-WRP-011 | admin GET の query options | GET /api/admin/rooms/[roomId]/analytics/gifts | 契約 | calendar / custom | CALENDAR / CUSTOM options | 
px vitest run src/app/api/admin/rooms/[roomId]/analytics/gifts/route.test.ts | PASS | Codex指摘 |
| TC-WRP-012 | avatars の room 越境防止 | loadRankingAvatars | 認可 | room にある uid と無い uid | resolveAvatarUrls は room 内 uid だけ | 
px vitest run src/lib/gift-ranking-avatars.scope.test.ts | PASS | Codex指摘 |
| TC-WRP-013 | 日付切替の silent 応答競合 | AnalyticsView fetchData | 異常 | A→B→A の遅延 silent | 世代不一致なら適用しない | コードレビュー後に gen チェックを silent にも適用 | NOT RUN: 実ブラウザ未実施 | Codex VALID |

## Out of Scope

- 無限スクロール / ranking `limit`+`offset`（Web のソート・検索・CSV）
- 公開シェアページ `PublicContributionClient`
- 内訳 `gift-breakdown` の preferRollup 化
- OBS 貢献オーバーレイ
