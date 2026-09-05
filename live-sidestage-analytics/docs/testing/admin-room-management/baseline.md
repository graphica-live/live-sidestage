---
project: live-sidestage-analytics
feature: admin-room-management
last_updated: 2026-09-06
last_risk: HIGH
last_reviewers: Qwen+Fable（Codex/Gemini quota切れ、review-auto Code Modeと同判断でFable代理）
---

# テストベースライン: admin-room-management

`/admin/workers` 管理画面の監視対象(TiktokRoom)一覧。完全削除(`deleteTiktokRoomPermanently`)・監視解除(`suspendRoomMonitoring`)・週間EulerStream署名消費数表示(`fetchAdminRoomList`)・tiktokId/最終接続時刻/週間署名消費数ソート(`sortAssignedRooms`)を提供する。削除は不可逆、監視解除は自動復活しうる一時停止。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-AD-001 | 完全削除でカスケード削除+AgencyWatch削除まで成功。監査ログdetailが投入値と一致 | `deleteTiktokRoomPermanently` | 正常 | Gift2件/BattleHistory1件/Streamer1件/AgencyWatch1件を持つroom | 全てroomId基準でcount:0、Streamerのみ残りroomId:null、監査ログ1件(`action:"delete"`, `tiktokId`, `operatorEmail`, `detail.{streamerCount,watchCount,agencyIds,giftCount,battleHistoryCount}`が投入値と一致) | `src/lib/tiktok-room.integration.test.ts` "Gift/BattleHistory等をカスケード削除し、AgencyWatchも削除して成功する。監査ログdetailは投入値と一致する" | PASS | Fable finding反映(旧テストはAgencyWatchのみでGift/BattleHistoryが未投入、detailも一部しか未検証だった) |
| TC-AD-002 | 監視解除(一時停止)は恒久停止でなく、既知4経路(ログイン系セッション検証/OBSオーバーレイアクセス/resolveRoomForStreamer/コラボ検知)いずれでも自動復活する | `reviveSuspendedMonitoring` / `resolveRoomForStreamer` / `ensureRoomWatchedForCollab` / `reviveSuspendedMonitoringForRoom` | 回帰 | `monitoringSuspended:true`のroomへ各経路をそれぞれ発火 | いずれの経路でも`monitoringSuspended:false`へ復帰する | `mark-last-active.integration.test.ts` "monitoringSuspended:trueなRoomをfalseへ戻し...", "...via-user..."、`tiktok-room.integration.test.ts` "監視停止(monitoringSuspended:true)されたRoomへ新規登録すると監視を復活させる"、`tiktok-room.collab.integration.test.ts` "休止中(monitoringSuspended: true)の部屋はONへ書き換える(resumed: true)" | PASS | Fable finding反映(4経路中1経路のみの参照だったのを全経路の既存テストへ拡張。新規テスト追加はせず既存回帰カバレッジを参照統合) |
| TC-AD-003 | 存在しないroomIdの削除 | `deleteTiktokRoomPermanently` | 異常 | 未知のroomId | `"not_found"` | `tiktok-room.integration.test.ts` "存在しないroomIdでnot_foundを返す"（deleteブロック） | PASS | |
| TC-AD-004 | 未finalizeイベント参加部屋の削除拒否 | `deleteTiktokRoomPermanently` | 異常 | 未finalizeイベントの`EventParticipant`が参照するroom | `"event_active"`、削除しない | `tiktok-room.integration.test.ts` "未finalizeイベントのEventParticipantが参照する部屋はevent_activeを返し削除しない" | PASS | |
| TC-AD-005 | 未releaseの`EventRoomLease`保持部屋の削除拒否 | `deleteTiktokRoomPermanently` | 異常 | `releasedAt:null`のEventRoomLeaseが参照するroom | `"event_active"`、削除しない | `tiktok-room.integration.test.ts` "未releaseのEventRoomLeaseが参照する部屋もevent_activeを返し削除しない" | PASS | |
| TC-AD-006 | finalize済みイベント参照のみなら孤児化を許容し削除成功 | `deleteTiktokRoomPermanently` | 境界 | finalize済みEventParticipantのみ参照 | 削除成功、`EventParticipant.roomId`は孤児として残る | `tiktok-room.integration.test.ts` "finalize済みイベントのEventParticipantのみが残る場合は孤児化を許容し削除が成功する" | PASS | |
| TC-AD-007 | 監視解除(一時停止)で監査ログ1件 | `suspendRoomMonitoring` | 正常 | 監視中room | `monitoringSuspended:true`・戻り値`"suspended"`・監査ログ+1 | `tiktok-room.integration.test.ts` "監視中の部屋を一時停止し、監査ログを1件残す" | PASS | |
| TC-AD-008 | 既に一時停止中の冪等性 | `suspendRoomMonitoring` | 境界 | 既に`monitoringSuspended:true` | `"already_suspended"`、監査ログ増えない | `tiktok-room.integration.test.ts` "既に一時停止中なら already_suspended を返し、監査ログを増やさない(冪等)" | PASS | |
| TC-AD-009 | 存在しないroomIdの監視解除 | `suspendRoomMonitoring` | 異常 | 未知のroomId | `"not_found"` | `tiktok-room.integration.test.ts` "存在しないroomIdでnot_foundを返す"（suspendブロック） | PASS | |
| TC-AD-010 | 監視解除済み部屋は`fetchAssignedRooms()`の一覧から消える(既存仕様、回帰確認) | `fetchAssignedRooms` | 回帰 | AgencyWatch/monitorUntilが無い`monitoringSuspended:true`のroom | 一覧に含まれない | `worker-status.integration.test.ts` "monitoringSuspendedされ他の条件も満たさない部屋(監視期限切れ・登録なし)は拾わない" | PASS | |
| TC-AD-010b | AgencyWatchがある部屋は監視解除しても`fetchAssignedRooms()`に残り続ける(接続が止まらない) | `fetchAssignedRooms` | 回帰 | `monitoringSuspended:true`+AgencyWatch付きroom | 一覧に含まれる | `worker-status.integration.test.ts` "AgencyWatchがある部屋はmonitoringSuspended:trueでも一覧に残る(監視解除が事務所監視で無効化される既存仕様)" | PASS | Fable finding反映(確認文言「AgencyWatch/イベント監視で無効化されうる」の裏付けが無かった) |
| TC-AD-011 | 管理画面一覧は監視解除済み部屋も拾う(fetchAssignedRoomsとの差分) | `fetchAdminRoomList` | 正常 | 上と同条件のidleRoom | 一覧に含まれる（watchedRoomFilterを迂回） | `worker-status.integration.test.ts` "watchedRoomFilter()を通さないため、monitoringSuspended:trueでAgencyWatch/monitorUntilも無い部屋(idleRoom)も一覧に含まれる" | PASS | |
| TC-AD-012 | workerId未割当の部屋は管理画面一覧に出ない | `fetchAdminRoomList` | negative | `workerId:null`のeventRoom | 一覧に含まれない | `worker-status.integration.test.ts` "workerId未割当の部屋(eventRoom、workerId:null)は含まれない(where: workerId not null)" | PASS | |
| TC-AD-013 | 週間署名消費オプション未指定時はnull | `fetchAdminRoomList` / `fetchAssignedRooms` | 正常 | `includeWeeklyEulerUsage`省略 | `weeklyEulerSignUsageCount:null`（0件と区別） | `worker-status.integration.test.ts` "includeWeeklyEulerUsage未指定時はweeklyEulerSignUsageCountがnull", "オプション未指定時は weeklyEulerSignUsageCount が null(既存呼び出し元の無改修動作)" | PASS | |
| TC-AD-014 | 週間署名消費0件は0（nullでない） | `fetchAdminRoomList` | 境界 | `includeWeeklyEulerUsage:true`、消費0件 | `weeklyEulerSignUsageCount:0` | `worker-status.integration.test.ts` "includeWeeklyEulerUsage:trueかつ署名消費0件ならweeklyEulerSignUsageCountは0(nullでない)" | PASS | |
| TC-AD-015 | 週間集計の7日境界(ちょうど7日前を含む)、outcome問わず(success/failed)合算 | `fetchAdminRoomList` | 境界 | 直近3日前(success)+ちょうど7日前(success)+8日前(success)+3日前(failed) | ちょうど7日前・3日前(success/failed問わず)の3件を計上、8日前の1件は含まない | `worker-status.integration.test.ts` "includeWeeklyEulerUsage:trueで直近7日以内(ちょうど7日前を含む)の署名消費を成功/失敗問わず数え、8日前の消費は含めない" | PASS | Fable finding反映(outcome:"failed"未検証・ちょうど7日前の境界未検証だった) |
| TC-AD-015b | `fetchAdminRoomList`はlistenerUpdatedAt降順、nullは末尾 | `fetchAdminRoomList` | 境界 | listenerUpdatedAtが新しい/古い/null(未接続)の3room | 新しい→古い→nullの順で並ぶ | `worker-status.integration.test.ts` "listenerUpdatedAtの降順で並び、nullの部屋は末尾に来る" | PASS | Fable finding反映(orderByのnulls:"last"がテストされていなかった) |
| TC-AD-016 | 未ログインでのDELETE拒否 | `DELETE /api/admin/tiktok-rooms` | 異常 | セッションなし | 401 | `route.integration.test.ts` "未ログインなら401"（DELETEブロック） | PASS | |
| TC-AD-017 | 管理者以外でのDELETE拒否 | `DELETE /api/admin/tiktok-rooms` | 異常 | ADMIN_EMAIL以外でログイン | 401 | `route.integration.test.ts` "管理者以外なら401" | PASS | |
| TC-AD-018 | 管理者によるDELETE成功 | `DELETE /api/admin/tiktok-rooms` | 正常 | 管理者セッション+存在するroomId | 200 | `route.integration.test.ts` "管理者が存在するroomIdを削除すると200" | PASS | |
| TC-AD-019 | 存在しないroomIdのDELETEは404 | `DELETE /api/admin/tiktok-rooms` | 異常 | 未知のroomId | 404 | `route.integration.test.ts` "存在しないroomIdなら404" | PASS | |
| TC-AD-020 | idクエリ欠如は400 | `DELETE /api/admin/tiktok-rooms` | 異常 | `id`クエリなし | 400 | `route.integration.test.ts` "idクエリが無ければ400" | PASS | |
| TC-AD-031 | 未finalizeイベント参加部屋のDELETEは409+固定文言 | `DELETE /api/admin/tiktok-rooms` | 異常 | 未finalizeイベントの`EventParticipant`が参照するroomId | 409、`error:"開催中イベントの参加部屋のため削除できません"`、room削除されない | `route.integration.test.ts` "未finalizeイベントの参加部屋なら409(event_active)で削除しない" | PASS | Qwen finding反映(API契約はlib層のevent_active確認だけでは保証されない) |
| TC-AD-021 | 未ログインでのPATCH拒否 | `PATCH /api/admin/tiktok-rooms` | 異常 | セッションなし | 401 | `route.integration.test.ts` "未ログインなら401"（PATCHブロック） | PASS | |
| TC-AD-022 | 管理者によるPATCH監視解除成功 | `PATCH /api/admin/tiktok-rooms` | 正常 | 管理者セッション、`action:"suspend"` | 200 | `route.integration.test.ts` "管理者が監視解除すると200" | PASS | |
| TC-AD-023 | 既に監視解除済みPATCHも200(冪等) | `PATCH /api/admin/tiktok-rooms` | 境界 | 既に`monitoringSuspended:true` | 200（`already_suspended`） | `route.integration.test.ts` "既に監視解除済みでも200(already_suspended)" | PASS | |
| TC-AD-024 | 存在しないroomIdのPATCHは404 | `PATCH /api/admin/tiktok-rooms` | 異常 | 未知のroomId | 404 | `route.integration.test.ts` "存在しないroomIdなら404"（PATCHブロック） | PASS | |
| TC-AD-025 | action不正値・id欠落・非JSON bodyはいずれも400 | `PATCH /api/admin/tiktok-rooms` | 異常 | `action:"suspend"`以外／`id`欠落／JSONでないbody | 400 | `route.integration.test.ts` "actionがsuspend以外なら400", "idが無ければ400", "bodyがJSONでなければ400" | PASS | Fable finding反映(action不正のみで id欠落・非JSON bodyが未検証だった) |
| TC-AD-026 | tiktokId昇順/降順ソート | `sortAssignedRooms` | 正常 | 複数room、key:"tiktokId" | 指定方向にソート | `sort-rooms.test.ts` "tiktokIdの昇順に並べる", "tiktokIdの降順に並べる" | PASS | |
| TC-AD-027 | listenerUpdatedAtのnullは常に末尾固定 | `sortAssignedRooms` | 境界 | nullを含むlistenerUpdatedAt | 昇順・降順どちらでもnullは末尾 | `sort-rooms.test.ts` "listenerUpdatedAtのnullは昇順・降順どちらでも末尾に固定される" | PASS | |
| TC-AD-028 | weeklyEulerSignUsageCountソート、nullは末尾固定 | `sortAssignedRooms` | 境界 | nullを含む週間消費数 | 昇順・降順どちらでもnullは末尾 | `sort-rooms.test.ts` "weeklyEulerSignUsageCountの昇順に並べ、nullは末尾に固定される", "...の降順に並べ、nullは末尾に固定される" | PASS | |
| TC-AD-029 | ソート関数は元配列を破壊しない | `sortAssignedRooms` | negative | 任意room配列 | 呼び出し前後で元配列の参照・内容が変わらない | `sort-rooms.test.ts` "元の配列を破壊しない" | PASS | |
| TC-AD-030 | `/admin/workers`画面で監視対象一覧テーブル・ソート可能ヘッダー・監視解除/完全削除ボタン・確認文言が表示され、ボタン押下で確認ダイアログが出る。承認時は実際にPATCH/DELETEが実行され行の表示が変わる。キャンセル時はAPIへ送信しない。モバイル幅でも崩れない | 画面 `admin/workers/page.tsx` | UI | 管理者ログイン後`/admin/workers`表示、「監視解除」「完全削除」ボタンをクリック（キャンセル/承認両方）、375px幅で再表示 | テーブル・週間署名消費列（注記付き）・ソート矢印・「監視解除」「完全削除」ボタンが表示される。各ボタン押下で`confirm()`ダイアログが表示され、規定の警告文言（自動復活経路・Streamer残存等）を含む。キャンセル時は`/api/admin/tiktok-rooms`へリクエストが飛ばない。承認時: 監視解除は行の監視状態表示が「一時停止中」に変わり監視解除ボタンがdisabledになる、完全削除は該当行が一覧から消える。375px幅でも横スクロールなく主要列が読める | Playwright（headless→screenshot、`dialog`イベントで`confirm()`文言・`accept`/`dismiss`両方、`page.on("request")`でAPI未送信を確認、承認後の行テキスト・disabled状態を確認） | PASS | Qwen finding反映(表示確認だけでなく押下動作まで検証)。使い捨てroom(`shotadminroom4susp`/`shotadminroom5del`)で承認動作を実行し確認後に確認済み |
| TC-AD-032 | `GET /api/admin/workers`のレスポンスに`adminRoomList`が含まれ、workerId割当済みroomの`weeklyEulerSignUsageCount`が数値で返る | `GET /api/admin/workers` | 正常 | 管理者セッション+workerId割当済みroom | `adminRoomList`は配列で対象roomを含み、`weeklyEulerSignUsageCount`はnumber型 | `src/app/api/admin/workers/route.integration.test.ts` "adminRoomListにworkerId割当済みroomが含まれ、weeklyEulerSignUsageCountが数値で返る" | PASS | Fable finding反映(差分で追加したadminRoomList契約が全く検証されていなかった) |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npx next build`（`npm run build`は`prisma db push --accept-data-loss`を含むため使用禁止。型・ルーティングのみ確認）

## Out of Scope

- 恒久停止化(自動復活を防ぐ排他制御の新設): plan時点でユーザー判断によりスコープ外と確定済み。UI文言での注記のみ
- `advisory lock`取得失敗時(`lock_unavailable`)の実動作確認: 同時実行を意図的に起こす統合テストのハーネスが無く、コードレビュー(review-auto Code Mode)でのロジック照合のみ。将来ハーネスが整えば追加
- transactionタイムアウト(60秒)の実測: 通常のテストDBでは大量Gift行を用意しないと再現しない。`absorbRooms()`と同一実装であることの照合のみ
- `fetchAdminRoomList`の`take: ADMIN_ROOM_LIST_LIMIT(1000)`打ち切り自体の実測: 1000件超のroom投入が必要で統合テストとして重い。順序保証(TC-AD-015b)のみ確認
- `GET /api/admin/workers`で`fetchAdminRoomList`が例外送出した場合のフォールバック(空配列+console.error)確認: 部分モックのコストに見合わないと判断(Fable finding、severity MEDIUM)。`fetchAssignedRooms`の`dbError`と異なり`adminRoomList`側は失敗時に「0件」と「取得失敗」がUI上区別できない設計だが、既存の`dbError`パターンから意図的に外れているわけではなく実装のtry/catch自体は目視確認済み。UI改修(専用エラーフラグ追加)は今回のタスクの範囲外の設計変更になるため見送り
