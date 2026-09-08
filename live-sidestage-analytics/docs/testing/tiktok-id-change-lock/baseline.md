---
project: live-sidestage-analytics
feature: tiktok-id-change-lock
last_updated: 2026-09-08
last_risk: HIGH
last_reviewers: DeepSeek(Code Mode), DeepSeek + Gemini(OpenRouter代理、Code Mode), Codex + DeepSeek(Code Mode、ADMIN_EMAIL例外追加)
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
