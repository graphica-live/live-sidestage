---
project: live-sidestage-analytics
feature: tiktok-id-change-lock
last_updated: 2026-09-11
last_risk: HIGH
last_reviewers: DeepSeek(Code Mode), DeepSeek + Gemini(OpenRouter代理、Code Mode), Codex + DeepSeek(Code Mode、ADMIN_EMAIL例外追加), Codex + DeepSeek(Code Mode + TestCase Mode、UID mismatch一時無効化)
---

# テストベースライン: tiktok-id-change-lock

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

`Streamer.tiktokId`(TikTok ID)をユーザー操作で変更すると、直近の変更から7日間(`TIKTOK_ID_CHANGE_LOCK_DAYS`)
は再変更できない機能。対象は `src/lib/tiktok-id-lock.ts`(判定ロジック)、
`POST /api/verify/generate`(web)、`POST`/`PATCH /api/mobile/streamer`(mobile)。
`Streamer.tiktokIdChangedAt`が変更時刻を保持する。`absorbRooms()`による自動ID合流(別処理、
`src/lib/tiktok-id-migration.ts`)はこのロックの対象外で、このタイムスタンプを更新しない。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-LOCK-001 | 7日未満の変更はロックされる | `checkTiktokIdChangeAllowed` | 境界 | `tiktokIdChangedAt`が7日-1ms前 | `{ok: false, retryAfter}`。`retryAfter = tiktokIdChangedAt + 7日` | `src/lib/tiktok-id-lock.test.ts` | PASS | |
| TC-LOCK-002 | ちょうど7日経過した瞬間は許可する | 同上 | 境界 | `now = tiktokIdChangedAt + 7日` | `{ok: true}` | 同上 | PASS | |
| TC-LOCK-003 | 7日経過直後は許可する | 同上 | 境界 | `now = tiktokIdChangedAt + 7日 + 1秒` | `{ok: true}` | 同上 | PASS | |
| TC-LOCK-004 | `tiktokIdChangedAt`がnull(migration前の既存streamer)なら常に許可する | 同上 | 異常系境界 | `tiktokIdChangedAt: null` | `{ok: true}` | 同上 | PASS | |
| TC-LOCK-005 | 正規化後の値が変わらないなら常に許可する(冪等リトライ) | 同上 | 正常 | `normalizedTiktokId`と`next`が同一 | `{ok: true}`(ロック中でも) | 同上 | PASS | |
| TC-LOCK-006 | 残り日数は切り上げ表示する | `formatTiktokIdLockError` | 境界 | 残り1.5日 | メッセージに「あと2日」、`code: "TIKTOK_ID_CHANGE_LOCKED"`、`retryAfter`はISO8601 | `src/lib/tiktok-id-lock.test.ts` | PASS | 残り1日未満でも最低「あと1日」と表示 |
| TC-LOCK-101 | web: ロック中の変更は409を返しDBを変更しない | `POST /api/verify/generate` | 異常 | 既存streamerの`tiktokIdChangedAt`が1日前、異なるtiktokIdを送信 | 409、`code: "TIKTOK_ID_CHANGE_LOCKED"`、`retryAfter`付き。DBの`tiktokId`は変化なし | `route.integration.test.ts` | PASS | 外部TikTok実在確認は事前チェックでロック検知後スキップされる(モックの呼び出し有無までは検証していない) |
| TC-LOCK-102 | web: 7日経過後の変更は許可されDBが更新される | `POST /api/verify/generate` | 正常 | `tiktokIdChangedAt`が8日前、異なるtiktokIdを送信 | 200、DBの`tiktokId`と`tiktokIdChangedAt`が更新される(`tiktokIdChangedAt`は新しい値) | `route.integration.test.ts` | PASS | |
| TC-LOCK-103 | web: null(migration前)は即座に変更を許可する | `POST /api/verify/generate` | 異常系境界 | `tiktokIdChangedAt: null`の既存streamer | 200、DBが更新される | `route.integration.test.ts` | PASS | |
| TC-LOCK-104 | web: 冪等リトライはロック判定・タイムスタンプ更新をスキップする | `POST /api/verify/generate` | 正常 | ロック中(1日前)、同一tiktokIdを再送 | 200、`tiktokIdChangedAt`は変化しない | `route.integration.test.ts` | PASS | |
| TC-LOCK-105 | web: 新規登録はロック対象外で即座に`tiktokIdChangedAt`がセットされる | `POST /api/verify/generate` | 正常 | 既存streamerが無いユーザーが初回登録 | 200、作成された`tiktokIdChangedAt`がnullでない | `route.integration.test.ts` | PASS | |
| TC-LOCK-201 | mobile PATCH: ロック中の変更は409を返しDBを変更しない | `PATCH /api/mobile/streamer` | 異常 | `tiktokIdChangedAt`が1日前、異なるtiktokIdを送信 | 409、`code: "TIKTOK_ID_CHANGE_LOCKED"`。DBの`tiktokId`・`verified`は変化なし | `route.integration.test.ts` | PASS | |
| TC-LOCK-202 | mobile PATCH: 7日経過後の変更は許可され、旧`verified`がリセットされる | `PATCH /api/mobile/streamer` | 正常 | `tiktokIdChangedAt`が8日前、`verified: true`の状態から異なるtiktokIdを送信 | 200、`tiktokId`・`tiktokIdChangedAt`が更新され、`verified: false`にリセットされる | `route.integration.test.ts` | PASS | 古い`verified`が新しいtiktokIdへ引き継がれる回帰の防止 |
| TC-LOCK-301 | CAS: 楽観的排他により同時書込みの片方は競合として拒否される | `POST /api/verify/generate` / `PATCH /api/mobile/streamer`(`updateMany`のwhere句) | 並行処理 | 同一`tiktokIdChangedAt`を読んだ2リクエストが異なるtiktokIdへ同時に変更しようとする | 1件は200で成功、もう1件は`updateMany`の対象0件により409 `code: "CONFLICT"` | コードレビュー(`updateMany({where: {id, tiktokIdChangedAt: readValue}})`のCAS実装確認。Prisma標準動作でnullも正しく`IS NULL`としてマッチすることをworktree実DBで直接検証済み) | PASS | 実際の同時リクエストによる競合再現はテストでは行わず、CAS実装のレビューとPrisma null-matchの実証で担保 |
| TC-LOCK-401 | 注意書きはsetup画面の確認モーダルにのみ表示され、admin-workers画面には出ない | `TiktokAccountConfirmModal`(`lockNoticeText` prop) | UI | 両画面で確認モーダルを表示 | setup: 「登録後7日間はTikTok IDを変更できません」表示。admin-workers: 非表示 | Playwright(両画面) → `docs/testing/tiktok-account-confirm-modal/baseline.md` TC-TACM-013 | PASS | 同一コンポーネントのテストケースであるため実体は`tiktok-account-confirm-modal`baselineのTC-TACM-013に集約し、ここでは参照のみ(重複管理を避ける) |
| TC-LOCK-501 | web: ADMIN_EMAILのセッションはロック中でも変更を許可し、他の副作用(tiktokIdChangedAt更新・verifiedリセット)は通常経路と同じ | `POST /api/verify/generate` | 例外系 | セッションemail=ADMIN_EMAIL、`tiktokIdChangedAt`が1日前、`verified: true`、異なるtiktokIdを送信 | 200、`tiktokId`・`tiktokIdChangedAt`が更新され`verified: false`にリセットされる | `route.integration.test.ts` | PASS | `isAdminEmail`(`src/lib/admin.ts`)はロック判定`checkTiktokIdChangeAllowed`の呼び出しだけをスキップし、CAS(`updateMany`のwhere句)は素通りする |
| TC-LOCK-502 | mobile PATCH: ADMIN_EMAILのユーザーはロック中でも変更を許可し、他の副作用は通常経路と同じ | `PATCH /api/mobile/streamer` | 例外系 | DB上のuser.email=ADMIN_EMAIL、`tiktokIdChangedAt`が1日前、`verified: true`、異なるtiktokIdを送信 | 200、`tiktokId`・`tiktokIdChangedAt`が更新され`verified: false`にリセットされる | `route.integration.test.ts` | PASS | mobileは(NextAuthセッションでなく)DBの`User.email`列で判定する点がwebと異なる |
| TC-LOCK-503 | `isAdminEmail`は完全一致のみtrue(大文字小文字・前後空白・null/undefinedはfalse) | `isAdminEmail` | 境界 | `ADMIN_EMAIL`と完全一致/大文字化/前後空白/null/undefined/別メール | 完全一致のみtrue | `src/lib/admin.test.ts` | PASS | |
| TC-LOCK-601 | `checkTiktokUidMatch`: exemptがtrueなら常に許可(disabled/実比較を評価しない) | `checkTiktokUidMatch` | 正常 | `opts.exempt: true`、tiktokUid不一致 | `{ok: true}` | `src/lib/tiktok-id-lock.test.ts` | PASS | |
| TC-LOCK-602 | `checkTiktokUidMatch`: 既定(環境変数未設定)はUID不一致でも許可(一時無効化) | 同上 | 正常 | `exempt: false`、`TIKTOK_UID_MISMATCH_CHECK_DISABLED`未設定、tiktokUid不一致 | `{ok: true}` | 同上 | PASS | |
| TC-LOCK-603 | `checkTiktokUidMatch`: `TIKTOK_UID_MISMATCH_CHECK_DISABLED="0"`で有効化時、UID不一致は拒否 | 同上 | 異常 | `exempt: false`、環境変数`"0"`、tiktokUid不一致 | `{ok: false}` | 同上 | PASS | |
| TC-LOCK-604 | `checkTiktokUidMatch`: 有効化時でもUID一致なら許可 | 同上 | 正常 | `exempt: false`、環境変数`"0"`、tiktokUid一致 | `{ok: true}` | 同上 | PASS | |
| TC-LOCK-605 | `isTiktokUidMismatchCheckDisabled`: `"0"`以外(未設定/`"1"`/空文字/空白等)はすべて無効化扱い | `isTiktokUidMismatchCheckDisabled` | 境界 | 環境変数 未設定/`"1"`/`""`/`" "`/`"0"` | `"0"`のみ`false`、他は`true` | 同上 | PASS | 設定ミス(空文字等)で意図せず有効化側へ倒れないことを確認 |
| TC-LOCK-701 | web: チェック有効時(`"0"`)、tiktokUid不一致は409 TIKTOK_UID_MISMATCHで拒否しDBを変更しない | `POST /api/verify/generate` | 異常 | 環境変数`"0"`、実在確認で得たtiktokUidが登録済みと不一致 | 409、`code: "TIKTOK_UID_MISMATCH"`。DBの`tiktokHandle`・`tiktokUid`は変化なし | `route.integration.test.ts:159` | PASS | |
| TC-LOCK-702 | web: 既定(未設定=無効化)状態はtiktokUid不一致でも許可されDBが更新される。ただし`tiktokUid`自体は上書きされない | 同上 | 正常 | 環境変数未設定、tiktokUid不一致 | 200、DBの`tiktokHandle`は新値・`tiktokHandleChangedAt`は更新。`tiktokUid`は登録済みの値のまま不変 | `route.integration.test.ts:179` | PASS | 別アカウントへの付け替え防止を一時的にOFFにする今回の仕様変更の中心ケース。`tiktokUid`不変はDBの物理的な所有根拠を壊さないための契約 |
| TC-LOCK-703 | web: チェック有効時でもADMIN_EMAILはtiktokUid不一致で200許可される | 同上 | 例外系 | 環境変数`"0"`、セッションemail=ADMIN_EMAIL、tiktokUid不一致 | 200、DBの`tiktokHandle`が更新される | `route.integration.test.ts:200` | PASS | 7日ロック免除(TC-LOCK-501)と同じ`lockExempt`をUID mismatch判定にも適用 |
| TC-LOCK-704 | mobile PATCH: チェック有効時(`"0"`)、tiktokUid不一致は409 TIKTOK_UID_MISMATCHで拒否しDBを変更しない | `PATCH /api/mobile/streamer` | 異常 | 環境変数`"0"`、tiktokUid不一致 | 409、`code: "TIKTOK_UID_MISMATCH"`。DBの`tiktokHandle`・`verified`は変化なし | `route.integration.test.ts:127` | PASS | |
| TC-LOCK-705 | mobile PATCH: 既定(未設定=無効化)状態はtiktokUid不一致でも許可されDBが更新される。ただし`tiktokUid`自体は上書きされない | 同上 | 正常 | 環境変数未設定、tiktokUid不一致 | 200、DBの`tiktokHandle`は新値。`tiktokUid`は登録済みの値のまま不変 | `route.integration.test.ts:156` | PASS | |
| TC-LOCK-706 | mobile PATCH: チェック有効時でもADMIN_EMAILはtiktokUid不一致で200許可される | 同上 | 例外系 | 環境変数`"0"`、DB上のuser.email=ADMIN_EMAIL、tiktokUid不一致 | 200、DBの`tiktokHandle`が更新される | `route.integration.test.ts:184` | PASS | TC-LOCK-502(7日ロック免除)と対になる |
| TC-LOCK-707 | web: チェック有効時(`"0"`)でも、tiktokUidが一致(同一アカウントの改名)していれば通常どおり200で許可される | `POST /api/verify/generate` | 正常 | 環境変数`"0"`、実在確認で得たtiktokUidが登録済みと一致 | 200、DBの`tiktokHandle`・`tiktokUid`とも整合して更新 | `route.integration.test.ts` | PASS | チェック有効化時の正常系(一致パス)がexempt/disabledの分岐に紛れて壊れていないことを確認 |
| TC-LOCK-708 | mobile PATCH: チェック有効時(`"0"`)でも、tiktokUidが一致していれば通常どおり200で許可される | `PATCH /api/mobile/streamer` | 正常 | 環境変数`"0"`、tiktokUidが登録済みと一致 | 200、DBの`tiktokHandle`・`tiktokUid`とも整合して更新 | `route.integration.test.ts` | PASS | |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`(`src/lib/tiktok-id-lock.test.ts`を含む)
- `npm run test:integration`(`src/app/api/verify/generate/route.integration.test.ts`、`src/app/api/mobile/streamer/route.integration.test.ts`を含む)

## Out of Scope

- `absorbRooms()`による自動tiktokId書き換えと、ユーザー起点のロックとの相互作用の完全な解消 — 設計上「ユーザー操作でのみ`tiktokIdChangedAt`を更新する」ことで最悪シナリオ(意図しないロック延長)は回避しているが、absorbRoomsがロック中にユーザーの意図したtiktokIdを上書きする可能性自体は既存`absorbRooms`仕様の範囲内として対応していない。詳細: `docs/testing/tiktok-id-change-lock/changes/2026-09-07-bio-auth-removal-and-lock.md`
- `POST /api/mobile/streamer`(新規登録)のロック判定 — 新規登録はロック対象外(TC-LOCK-105相当をmobile側でも踏襲、既存挙動のまま変更なし)
- BIO認証(`/api/verify/check`、`verificationCode`/`verified`列)自体の挙動 — 実装は残すが本機能の対象外。UIからの呼び出し撤去は`docs/testing/tiktok-account-confirm-modal/baseline.md`側で扱う

## TestCaseレビュー

review-auto Code Modeで`--testcase-file docs/testing/tiktok-account-confirm-modal/baseline.md`を渡し同時実施。
DeepSeek(risk=HIGH): finding 5件中、「テスト計画が旧機能(tiktok-account-confirm-modal)用のままで本機能(7日ロック)のケースが0件」がVALID(HIGH)として採用され、本baseline(TC-LOCK-*)の新規作成に反映した。他4件はコード実装済み・実装意図通りでINVALID/ALREADY_HANDLED。
Codex・Gemini(Antigravity)はquota切れのためGemini(OpenRouter経由、`gemini-3.8-flash`、reasoning-effort low)を追加代理として実行。finding 2件(「Prisma `updateMany`のnullフィルタが`IS NULL`として正しくマッチしない」という主張)は、worktree実DBに対する直接検証(`updateMany({where: {tiktokIdChangedAt: null}})`でcount=1を確認)によりPrisma標準動作と矛盾することを実証し、INVALIDと判定した。

2026-09-11: UID mismatchチェック一時無効化の追加時、DeepSeek + Codex(いずれもTestCase Mode、risk=HIGH)を実施。DeepSeekのfinding「チェック有効時(`"0"`)+tiktokUid一致の統合テストが無い」はVALIDとして採用しTC-LOCK-707/708を追加。Codexのfinding「TC-LOCK-702/705の期待結果が`tiktokUid`自体は不変であるべき契約を明記していない」(MEDIUM)もVALIDとして採用し期待結果列を具体化(実装・既存テストは元々`tiktokUid`不変をassert済みで、baselineの記述不足のみが問題だった)。Codexの「フラグ判定に空文字・空白の境界値ケースが無い」(LOW)もVALIDとして採用し単体テスト・TC-LOCK-605へ反映。
