---
project: live-sidestage-analytics
feature: tiktok-listener-connection
last_updated: 2026-09-12
last_risk: MEDIUM
last_reviewers: Gemini 3.7 Flash(medium、TestCase+Code両方でNO ISSUES) / Codex(terra、medium、Code) — 2026-09-12 worker2 P2025クラッシュ修正。CodexがHIGH×2(scheduleReconnectのcatchが再試行を予約せずroomをサイレント無期限停止させる、TC-TLC-011にその回復検証が無い)・MEDIUM×1(resolveProxyForRoomのTOCTOU経路が未検証)を指摘、全てVALIDと確認し修正・テスト追加済み
---

# テストベースライン: tiktok-listener-connection

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

`src/lib/tiktok-listener.ts` のTikTok Webcast接続ライフサイクル(接続確立・切断・watchdogによる強制再接続・指数バックオフ・オフライン判定)。Euler署名は有料/rate-limitedな外部署名サービスで、`conn.connect()`呼び出しごとに消費する。無駄な消費を避けることが本機能の重要な保証事項。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-TLC-001 | api-live/user/room/がオフライン(status=4)を報告するroomはEuler署名を消費せず再接続待機へ倒れる | `connectAndAttach()` / `isReportedOfflineByApiLive()` | 正常 | `conn.webClient.fetchRoomInfoFromApiLive`が`{data:{liveRoom:{status:4}}}`を返す | `conn.connect()`が呼ばれない(`connectCalls===0`)。`listenerReason==="user_offline"`が永続化される | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.offline-precheck.integration.test.ts` | PASS | Fable指摘(HIGH: 自動テスト不在)を受け専用モック接続で自動テスト化 |
| TC-TLC-002 | api-live/user/room/がオンライン(status!=4)を報告するroomは通常のconnect()フローへ進む | `isReportedOfflineByApiLive()` | 正常 | `roomData.data.liveRoom.status`が2(オンライン) | `conn.connect()`が呼ばれる(`connectCalls===1`) | 同上(TC-TLC-002) | PASS | |
| TC-TLC-002b | `data.user.id`を取れない応答は**検証不能**として接続しない(fail-closed) | `precheckApiLive()` | 境界 | `roomData.data`が`{}`(liveRoom・userキー無し) | `conn.connect()`が呼ばれない(`connectCalls===0`) | 同上(TC-TLC-002b) | PASS | **2026-09 の識別子統一で fail-open から反転した。** 旧仕様は「判定不能ならconnect()へ進む」だったが、同一性検証を素通りすると別人の配信へ接続してA の room へ書き込む経路が残る(plan §6 の`unverifiable`) |
| TC-TLC-002c | api-liveが別人のuidを返したら接続せず`handleStaleAt`を立てる | `precheckApiLive()` | 異常/セキュリティ | room の`hostTiktokUid`=A、api-liveの`data.user.id`=B。`TIKTOK_UID_MISMATCH_CHECK_DISABLED="0"`を明示設定(チェック有効) | `conn.connect()`が呼ばれない。`TiktokRoom.handleStaleAt`が立ち、`listenerReason==="handle_mismatch"` | 同上(TC-TLC-002c) | PASS | ハンドル再利用による第三者取り違えの防止。room の一意キーを`tiktokHandle`から`hostTiktokUid`へ移したことの接続側の対 |
| TC-TLC-002d | `TIKTOK_UID_MISMATCH_CHECK_DISABLED`が既定(未設定)のとき、api-liveが別人のuidを返しても凍結せず接続する | `connectInstance()` | 異常/運用 | room の`hostTiktokUid`=A、api-liveの`data.user.id`=B。`TIKTOK_UID_MISMATCH_CHECK_DISABLED`未設定(既定=無効化) | `conn.connect()`が呼ばれる(`connectCalls===1`)。`TiktokRoom.handleStaleAt`は`null`のまま | 同上(TC-TLC-002d) | PASS | テスト運用中の一時的な全体OFF機構(2026-09-11)。`tiktok-id-lock.ts`の既存フラグをconnectInstance()のmismatch分岐にも適用 |
| TC-TLC-003 | api-live/user/room/呼び出しが例外(HTTPエラー等)を投げた場合、**接続せず**バックオフ再試行する | `precheckApiLive()` | 異常 | `fetchRoomInfoFromApiLive`がreject | `console.warn`ログを出しつつ`conn.connect()`を呼ばない。`listenerReason==="uid_unverifiable"`で再接続予約 | 同上(TC-TLC-003) | PASS | **2026-09 の識別子統一で fail-open から反転した。**api-liveがタイムアウト/レート制限/応答形式変更になったとき、旧仕様は照合を素通りしてconnect()していた。恒久停止にはせずバックオフ再試行に留める |
| TC-TLC-004 | 事前チェックのHTTP待機中に`stopListener()`が呼ばれても、待機完了後に`conn.connect()`もEuler消費も発生しない | `connectAndAttach()` | 異常/negative | `isReportedOfflineByApiLive()`のawait中に`stopListener()`が呼ばれ、その後status:4の応答が届く | `connectCalls===0`。`updateState`/`conn.connect()`/`scheduleReconnect`のいずれも走らない | 同上(TC-TLC-004) | PASS | Fable指摘(race condition)により判定結果に関わらずawait直後に共通ガードを通すよう実装修正済み。テスト側の固定20ms待ちがフルintegrationスイート並列実行時に不安定だったため`vi.waitFor`ポーリングへ修正、以後test:integration全体で708/708安定PASSを確認 |
| TC-TLC-005 | watchdog強制再接続の指数バックオフ数式(数値計算)が回帰していない | `nextReconnectBackoffMs()` | 回帰 | failureCount 1,2,3,10 | 1回目≈BASE_MS、2倍/4倍に伸長、MAX_MSで頭打ち、jitterで揺らぐ | `npx vitest run src/lib/tiktok-listener.backoff.test.ts` | PASS | 5 tests pass |
| TC-TLC-006 | watchdog無応答検知(60秒無イベント)の強制再接続とそのバックオフが回帰していない | `checkWatchdogs()` | 回帰 | MockConnection使用、無応答60秒超過を複数回シミュレート。リセットはlikeとchatの両方 | 初回は即発火、バックオフ窓内は`skipping forced reconnect`警告でスキップ、窓超過後に再発火。like受信でもchat保存ハンドラ経由でもバックオフリセット | `npx dotenv -e .env.local.test --override -- vitest run src/lib/tiktok-listener.watchdog.integration.test.ts` | PASS | 5 tests pass。chatは専用`conn.on("chat", markAlive)`ではなく保存ハンドラ先頭の`markAlive()`で生存更新する |
| TC-TLC-007 | 再接続バックオフ・room状態遷移・ブロック検知の統合的な既存挙動が回帰していない | `connectInstance` / `scheduleReconnect` / room状態管理 | 回帰 | 既存integrationスイート | 全ケースPASS | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.reconnect-backoff.integration.test.ts src/lib/tiktok-listener.room.integration.test.ts src/lib/tiktok-listener.unhealthy.integration.test.ts src/lib/tiktok-listener.blocked-attempt.integration.test.ts` | PASS | 28 tests pass。TC-TLC-006と同じ理由で事前チェックはcatch分岐のみ通過 |
| TC-TLC-008 | プロジェクト全体のunit/integrationテストが今回の変更で壊れていない | 全体 | 回帰 | - | 既知の不安定要因(下記備考)を除き全PASS | `npm run test:unit`、`npx dotenv -e .env.local.test -- vitest run`(除外なし) | PASS | 2026-09-11実測: unit 116 files/1554 tests、全体(integration込み) 217 files/2501 tests、いずれも全PASS(既知のクロスファイル干渉[[analytics-vitest-cross-file-interference]]は今回再現せず) |
| TC-TLC-009 | watchdog強制再接続がゾンビroomを掴んだ場合も、事前チェックがconn.connect()を止める(本修正が解決する実際のシナリオ) | `checkWatchdogs()` → `connectInstance()` → `isReportedOfflineByApiLive()` | 回帰/正常 | 初回オンライン接続成功後、無応答60秒超過。watchdog発火時点でapi-live/user/room/がstatus:4を返す | watchdogが生成した2本目の接続で`connectCalls===0`、`listenerReason==="user_offline"` | `npx dotenv -e .env.local.test --override -- vitest run src/lib/tiktok-listener.offline-precheck.integration.test.ts` | PASS | Fable指摘(LOW: シナリオ結合ケース不在)を受け追加 |
| TC-TLC-010 | 輸送フレーム(websocketData/msgDetect)だけでは生存更新せずwatchdog強制再接続が発動する | `checkWatchdogs()` | 異常/境界/negative | 接続後50秒で`conn.fire("websocketData")`と`conn.fire("msgDetect")`のみ | 61秒時点で`MockConnection.instances`が2本。輸送フレームが markAlive すると発火しない | `npx dotenv -e .env.local.test --override -- vitest run src/lib/tiktok-listener.watchdog.integration.test.ts` | PASS | Gemini TestCase指摘。hb/ack/プローブでゾンビを隠さない |
| TC-TLC-011 | 再接続待機中にroom行がDBから削除されても、scheduleReconnectのコールバックがunhandled rejectionでプロセスをクラッシュさせない | `scheduleReconnect()` | 異常/回帰 | disconnected発火でバックオフ再接続をスケジュール後、待機中に`TiktokRoom`行を削除(worker2実クラッシュのTOCTOU再現) | `process`の`unhandledRejection`が0件のまま再接続コールバックの発火猶予を経過する | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.reconnect-backoff.integration.test.ts` | PASS | 2026-09-12 worker2クラッシュ(P2025)の再発防止。原因は`connectInstance()`のtry/finally(catch無し)を`await`する`setTimeout`コールバックが無防備だったこと。`resolveProxyForRoom()`の同型バグも同時修正 |
| TC-TLC-011b | 再接続時に`connectInstance()`が失敗しても(一時的なDB障害相当)、自動的に次のリトライが予約されlistenerが無期限停止しない | `scheduleReconnect()` | 異常/回帰 | room削除でconnectInstance失敗を誘発→reconnectFailureCountの増加を確認→同じidでroom行を復元 | 失敗のたびに`reconnectFailureCount`が増えバックオフ付きで再試行が続く。room復元後の次のリトライで接続が成功する | 同上(TC-TLC-011) | PASS | code-review Codex指摘(HIGH)。当初の`scheduleReconnect`のcatchはconsole.errorのみで再試行を予約せず、クラッシュは防いだがroomがサイレントに無期限停止する新しい退行があった。catch節から`scheduleReconnect(roomId, "connect_failed")`を呼ぶよう修正 |
| TC-TLC-012 | `findUnique`と`updateMany`の間にroom行が削除されてもdeviceId解決は例外を投げない(P2025回避)が、room自体が最初から存在しない場合は例外を投げて区別する | `getOrCreateDeviceId()` | 異常/境界/negative | 既存deviceId返却/新規生成/`findUnique`後の削除でupdateManyが0件更新/`findUnique`が最初からnull、の4パターン | 既存deviceIdはDBへ書き込まず返す。新規は19桁数字を生成しupdateManyで保存。TOCTOU(0件更新)は例外を投げず生成したdeviceIdを返す。room自体が存在しない場合は`updateMany`を呼ばず例外を投げる | `npx vitest run src/lib/device-id.test.ts` | PASS | 4 tests pass。当初`findUnique`のnullチェックを省いたため「存在しないroomへのstartListenerは例外になる」という既存仕様(TC-TLC-007の`tiktok-listener.room.integration.test.ts`)を壊す回帰があり、test-auto実行中に発覚し修正 |
| TC-TLC-013 | `resolveProxyForRoom()`の`findUnique`と`updateMany`の間にroom行が削除されても例外を投げない。room自体が存在しない場合は例外を投げて区別する | `resolveProxyForRoom()` | 異常/境界/negative | proxyKey未設定の新規割当/TOCTOU(updateManyが0件更新)/`findUnique`が最初からnull、の3パターン | 新規割当はハッシュ由来のindexをupdateManyで保存し返す。TOCTOUは例外を投げず選択したproxyを返す。room自体が存在しない場合は例外を投げる | `npx vitest run src/lib/tiktok-listener.resolve-proxy.test.ts` | PASS | 3 tests pass。code-review Codex指摘(MEDIUM)。TC-TLC-011はgetOrCreateDeviceId()が先に失敗するためresolveProxyForRoom()側のTOCTOUに到達せず未検証だった点を単体テストで直接カバー |

## Quality Gate

- `npm run typecheck` — PASS(エラーなし)
- `npm run test:unit` — PASS(128 files / 1682 tests)
- `npx dotenv -e .env.local.test -- vitest run`(全体) — PASS(235 files / 2705 tests、2026-09-12実測)

## Out of Scope

- **api-live/user/room/呼び出しにタイムアウト機構が無い点**: `conn.connect()`自体のHTTP呼び出しにも同様にタイムアウトが無く、今回の事前チェックはこの既存の制約をもう1箇所増やすに留まる(新規リグレッションではない)。無応答のroomは`checkWatchdogs()`が`status!=="connected"`のroomをスキップするため、事前チェックが無期限に待つ間はwatchdogによる救済も効かない。将来的な改善候補(`Promise.race`によるタイムアウト境界の追加)としてFableが指摘済みだが、本修正のスコープ外
- **rate-limit/403でapi-liveが弾かれるケースの効果限界**: プロキシがブロックされている等でapi-live/user/room/自体が失敗する場合、本修正は無力化され旧来の`fetchRoomInfoOnConnect`任せの挙動に戻る(=Euler署名を消費してから失敗する)。本番の`EulerSignUsage`件数推移で別途観測する運用事項であり、単体/統合テストの対象外
