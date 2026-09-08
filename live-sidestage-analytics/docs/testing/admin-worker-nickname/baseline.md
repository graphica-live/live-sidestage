---
project: live-sidestage-analytics
feature: admin-worker-nickname
last_updated: 2026-09-06
last_risk: HIGH
last_reviewers: Qwen(Design Mode)、Qwen(Code Mode)、Qwen(TestCase Mode) ※Codex/Gemini quota切れのためQwen単独で完了扱い(ユーザー承認済み、TestCase Modeも同状態を確認)
---

# テストベースライン: admin-worker-nickname

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

`/admin/workers`（Worker稼働状況）でtiktokId併記のTikTokプロフィール名(nickname)を表示し、nickname/tiktokIdクリックでそのroomIdのanalytics内容（ランキング・履歴・バトル）をadmin専用の新規タブ（`/admin/rooms/[roomId]`）で見られるようにする機能。`TiktokRoom.nickname`列、配信接続時(初回connected)の自動更新、既存分バックフィルスクリプト、admin専用analytics画面・APIを対象とする。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-AWN-001 | 初回connected時にexistenceCheckerがEXISTS+nicknameを返すとTiktokRoom.nicknameが更新される | `tiktok-listener.ts` updateState | 正常 | 新規streamer登録→`startListener`、existenceChecker→EXISTS+nickname | `TiktokRoom.nickname`が取得値に更新される | `npx dotenv -e .env.local.test -- npx vitest run src/lib/tiktok-listener.room.integration.test.ts` | PASS | |
| TC-AWN-002 | EXISTSでもnicknameが無い場合は更新しない | 同上 | negative/境界 | existenceChecker→EXISTS, nickname:null | `TiktokRoom.nickname`はnullのまま(既存値を消さない) | 同上 | PASS | |
| TC-AWN-003 | existenceCheckerがMISSINGを返してもstartListener自体は失敗しない | 同上 | 異常 | existenceChecker→MISSING | `startListener`は例外を投げず、nicknameは更新されない | 同上 | PASS | fire-and-forget、例外はcatchで握りつぶす契約 |
| TC-AWN-004 | 新規登録時(addWatchedRoom)のnickname保存 | `worker-status.ts` addWatchedRoom | 正常 | (別baselineでカバー) | `TiktokRoom.nickname`が保存される | `npx dotenv -e .env.local.test -- npx vitest run src/lib/worker-status.watch.integration.test.ts` | PASS | `docs/testing/admin-workers-watch/baseline.md` TC-AWW-001が実データで検証済み。ここでは重複させず参照のみ |
| TC-AWN-005 | 既存分バックフィルスクリプトのdry-run | `scripts/backfill-room-nicknames.ts` | 正常/境界 | nickname未設定roomが存在、`--apply`無し | 実行時エラーなし、DBを書き換えない、EXISTS/MISSING/inconclusiveの件数が出力される | `npx dotenv -e .env.local.test -- npx tsx scripts/backfill-room-nicknames.ts`(--apply無し) | PASS | worktree専用DBで実行確認済み。TikTok側に実在しないテスト用IDはMISSING分類でスキップされることを確認 |
| TC-AWN-006 | 一覧APIの型・select経路にnicknameが伝播している | `worker-status.ts` AssignedRoom/fetchAssignedRooms/fetchAdminRoomList | 回帰 | 型定義変更後のtypecheck | `nickname: string \| null`を含む型で全消費箇所がコンパイルを通る | `npm run typecheck` | PASS | |
| TC-AWN-007 | UI: admin/workers画面でnicknameが併記され、クリックで`/admin/rooms/[roomId]`が新規タブで開くリンクになる | `src/app/(dashboard)/admin/workers/page.tsx` RoomLabel | UI | nickname付きroom・nickname未取得roomが混在する一覧 | nicknameがある行は「nickname @tiktokId」、無い行は「@tiktokId」のみ表示。両方とも`target="_blank"`の`/admin/rooms/<roomId>`へのリンクになっている | Playwright（headless、実ブラウザ） | PASS | screenshot提示済み |
| TC-AWN-008 | UI: `/admin/rooms/[roomId]`でギフトランキング・履歴・バトル履歴が表示される | `src/app/(dashboard)/admin/rooms/[roomId]/page.tsx`、`AnalyticsView` | UI | admin専用API経由でシードデータ(ギフト2件・バトル1件)を持つroomへ遷移 | ランキング・ギフト履歴・バトル履歴タブが一般ユーザー向け`/analytics`と同じ構成で表示される | Playwright | PASS | screenshot提示済み |
| TC-AWN-009 | admin専用API群は`getAdminSession()`で認可される | `api/admin/rooms/[roomId]/analytics/{gifts,gifts/history,battles}` | 異常/権限差 | admin未ログイン | 未ログインなら401、管理者なら200でroomId直接指定・`verified: true`固定のレスポンスが返る | `npx dotenv -e .env.local.test -- npx vitest run "src/app/api/admin/rooms/[roomId]/analytics/gifts/route.integration.test.ts" "src/app/api/admin/rooms/[roomId]/analytics/gifts/history/route.integration.test.ts" "src/app/api/admin/rooms/[roomId]/analytics/battles/route.integration.test.ts"` | PASS | `admin/tiktok-rooms`等の既存route.integration.test.tsパターンを踏襲。battlesはroom未存在時の404も固定 |

## Quality Gate

- `npm run typecheck`
- `npx next lint`
- `npm run test:unit`
- `npm run test:integration`(ローカルDB必須)

## Out of Scope

- 一般ユーザー向け`/api/analytics/*`・`/analytics`ページ自体の仕様変更（今回は`AnalyticsView`への抽出のみでロジック不変。既存integrationテストの全通過で回帰なしを確認済み）
- `addWatchedRoom`のnickname保存自体の詳細な正常系/異常系ケース — `docs/testing/admin-workers-watch/baseline.md`のTC-AWW-001〜010でカバー済み
- Worker実プロセス(`worker.ts`)経由の実接続確認（今回はモックまたはDB直接シードで検証。実TikTok接続は対象外）
- `backfill-room-nicknames.ts`の並行実行・レート制限ストレステスト — 一回限りの手動実行スクリプトで、既存の登録フロー(`existenceChecker`, `MAX_CONCURRENCY=2`)と枠を共有する直列実行として設計済み(plan記載の意図的な判断)。複数人が同時に実行する運用は想定していない
