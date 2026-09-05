---
project: live-sidestage-analytics
feature: tiktok-listener-connection
last_updated: 2026-09-05
last_risk: HIGH
last_reviewers: Codex(不可,quota切れ)+Fable+Qwen(不可,信頼性疑義)
---

# テストベースライン: tiktok-listener-connection

`src/lib/tiktok-listener.ts` のTikTok Webcast接続ライフサイクル(接続確立・切断・watchdogによる強制再接続・指数バックオフ・オフライン判定)。Euler署名は有料/rate-limitedな外部署名サービスで、`conn.connect()`呼び出しごとに消費する。無駄な消費を避けることが本機能の重要な保証事項。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-TLC-001 | api-live/user/room/がオフライン(status=4)を報告するroomはEuler署名を消費せず再接続待機へ倒れる | `connectAndAttach()` / `isReportedOfflineByApiLive()` | 正常 | `conn.webClient.fetchRoomInfoFromApiLive`が`{data:{liveRoom:{status:4}}}`を返す | `conn.connect()`が呼ばれない(`connectCalls===0`)。`listenerReason==="user_offline"`が永続化される | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.offline-precheck.integration.test.ts` | PASS | Fable指摘(HIGH: 自動テスト不在)を受け専用モック接続で自動テスト化 |
| TC-TLC-002 | api-live/user/room/がオンライン(status!=4)を報告するroomは通常のconnect()フローへ進む | `isReportedOfflineByApiLive()` | 正常 | `roomData.data.liveRoom.status`が2(オンライン) | `conn.connect()`が呼ばれる(`connectCalls===1`) | 同上(TC-TLC-002) | PASS | |
| TC-TLC-002b | liveRoomフィールド自体が欠損する応答は判定不能としてconnect()フローへ進む | `isReportedOfflineByApiLive()` | 境界 | `roomData.data`が`{}`(liveRoomキー無し) | `conn.connect()`が呼ばれる(`connectCalls===1`) | 同上(TC-TLC-002b) | PASS | |
| TC-TLC-003 | api-live/user/room/呼び出しが例外(HTTPエラー等)を投げた場合、オンライン扱いにフェイルセーフする | `isReportedOfflineByApiLive()` | 異常 | `fetchRoomInfoFromApiLive`がreject | `console.warn`ログを出しつつ`conn.connect()`を呼ぶ(無言で握り潰さない) | 同上(TC-TLC-003) | PASS | Fable指摘によりタイムアウト前提の記述を削除(接続層にタイムアウト機構なし、無応答時は無期限に待つ既存の`conn.connect()`と同じ制約。Out of Scope参照) |
| TC-TLC-004 | 事前チェックのHTTP待機中に`stopListener()`が呼ばれても、待機完了後に`conn.connect()`もEuler消費も発生しない | `connectAndAttach()` | 異常/negative | `isReportedOfflineByApiLive()`のawait中に`stopListener()`が呼ばれ、その後status:4の応答が届く | `connectCalls===0`。`updateState`/`conn.connect()`/`scheduleReconnect`のいずれも走らない | 同上(TC-TLC-004) | PASS | Fable指摘(race condition)により判定結果に関わらずawait直後に共通ガードを通すよう実装修正済み。テスト側の固定20ms待ちがフルintegrationスイート並列実行時に不安定だったため`vi.waitFor`ポーリングへ修正、以後test:integration全体で708/708安定PASSを確認 |
| TC-TLC-005 | watchdog強制再接続の指数バックオフ数式(数値計算)が回帰していない | `nextReconnectBackoffMs()` | 回帰 | failureCount 1,2,3,10 | 1回目≈BASE_MS、2倍/4倍に伸長、MAX_MSで頭打ち、jitterで揺らぐ | `npx vitest run src/lib/tiktok-listener.backoff.test.ts` | PASS | 5 tests pass |
| TC-TLC-006 | watchdog無応答検知(60秒無イベント)の強制再接続とそのバックオフが回帰していない | `checkWatchdogs()` | 回帰 | MockConnection使用、無応答60秒超過を複数回シミュレート | 初回は即発火、バックオフ窓内は`skipping forced reconnect`警告でスキップ、窓超過後に再発火。実イベント受信でバックオフリセット | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.watchdog.integration.test.ts` | PASS | 3 tests pass。DB必須。**このファイルのMockConnectionにはwebClientが無いため、今回追加した事前チェックは毎回catch分岐(フェイルセーフ)を通る**(Fable指摘MEDIUM)。オンライン経路の再接続そのものはTC-TLC-002・009が別途カバーする |
| TC-TLC-007 | 再接続バックオフ・room状態遷移・ブロック検知の統合的な既存挙動が回帰していない | `connectInstance` / `scheduleReconnect` / room状態管理 | 回帰 | 既存integrationスイート | 全ケースPASS | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.reconnect-backoff.integration.test.ts src/lib/tiktok-listener.room.integration.test.ts src/lib/tiktok-listener.unhealthy.integration.test.ts src/lib/tiktok-listener.blocked-attempt.integration.test.ts` | PASS | 28 tests pass。TC-TLC-006と同じ理由で事前チェックはcatch分岐のみ通過 |
| TC-TLC-008 | プロジェクト全体のunit/integrationテストが今回の変更で壊れていない | 全体 | 回帰 | - | 既知の不安定要因(下記備考)を除き全PASS | `npm run test:unit`、`npx dotenv -e .env.local.test -- vitest run`(除外なし) | PASS | unit: 1227/1227。全体実行では`route.integration.test.ts`(listener-status)に加え、本ファイル(offline-precheck)のTC-TLC-001/004/009も稀に失敗することを確認したが、いずれも**単独実行では複数回連続PASS**(offline-precheckは3回連続6/6 PASS)。既知のクロスファイル干渉([[analytics-vitest-cross-file-interference]]、DBを共有する複数integrationファイルの並列実行由来)であり、今回の変更ロジック自体の欠陥ではないと判断 |
| TC-TLC-009 | watchdog強制再接続がゾンビroomを掴んだ場合も、事前チェックがconn.connect()を止める(本修正が解決する実際のシナリオ) | `checkWatchdogs()` → `connectInstance()` → `isReportedOfflineByApiLive()` | 回帰/正常 | 初回オンライン接続成功後、無応答60秒超過。watchdog発火時点でapi-live/user/room/がstatus:4を返す | watchdogが生成した2本目の接続で`connectCalls===0`、`listenerReason==="user_offline"` | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.offline-precheck.integration.test.ts` | PASS | Fable指摘(LOW: シナリオ結合ケース不在)を受け追加 |

## Quality Gate

- `npm run typecheck` — PASS(エラーなし)
- `npm run test:unit` — PASS(85 files / 1227 tests)
- `npx dotenv -e .env.local.test -- vitest run`(全体) — 1928/1929 PASS(既知の不安定1件、備考参照)

## Out of Scope

- **api-live/user/room/呼び出しにタイムアウト機構が無い点**: `conn.connect()`自体のHTTP呼び出しにも同様にタイムアウトが無く、今回の事前チェックはこの既存の制約をもう1箇所増やすに留まる(新規リグレッションではない)。無応答のroomは`checkWatchdogs()`が`status!=="connected"`のroomをスキップするため、事前チェックが無期限に待つ間はwatchdogによる救済も効かない。将来的な改善候補(`Promise.race`によるタイムアウト境界の追加)としてFableが指摘済みだが、本修正のスコープ外
- **rate-limit/403でapi-liveが弾かれるケースの効果限界**: プロキシがブロックされている等でapi-live/user/room/自体が失敗する場合、本修正は無力化され旧来の`fetchRoomInfoOnConnect`任せの挙動に戻る(=Euler署名を消費してから失敗する)。本番の`EulerSignUsage`件数推移で別途観測する運用事項であり、単体/統合テストの対象外
