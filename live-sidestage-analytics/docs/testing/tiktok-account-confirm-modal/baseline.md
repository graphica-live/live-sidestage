---
project: live-sidestage-analytics
feature: tiktok-account-confirm-modal
last_updated: 2026-09-07
last_risk: HIGH
last_reviewers: DeepSeek(Code Mode)
---

# テストベースライン: tiktok-account-confirm-modal

TikTok ID登録(setup画面の初回登録 / admin-workers画面の監視対象追加)を「入力→即登録」から
「入力→サーバがTikTok実在確認(nickname/avatar/BIO/フォロー数/フォロワー数取得)→確認モーダル表示→
ユーザーの確定操作→初めて登録」の2段階へ変更した機能。共通コンポーネント
`src/components/TiktokAccountConfirmModal.tsx`、プレビュー専用API
(`POST /api/verify/preview`, `POST /api/admin/workers/watch/preview`。いずれもDB書き込みなし)、
共通エラーコード変換 `formatExistenceGateError()`(`src/lib/tiktok-existence.ts`)を対象とする。
デザイン契約: `.impeccable/approved/tiktok-account-confirm-modal/`(comp.png / spec.md)。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-TACM-001 | フォーマット不正はモーダルを出さず即エラー | `POST /api/verify/preview` / `.../watch/preview`、`previewTiktokAccount` | 異常/境界 | `bad id!!`のような不正文字を含む入力 | モーダル非表示。フォーム側に日本語メッセージ+`(INVALID_FORMAT)`表示。既存の登録API(`/api/verify/generate`, `/api/admin/workers/watch`)は呼ばれない | Playwright（setup / admin-workers 両画面、dev-login） + `previewTiktokAccount`単体テスト(`tiktok-existence.test.ts`、実在確認自体を呼ばないことを検証) | PASS | |
| TC-TACM-002 | 未登録IDはモーダルを出さず即エラー | 同上 | 異常 | TikTok上に実在しないID(24文字以内) | モーダル非表示。フォーム側に日本語メッセージ+`(USER_NOT_FOUND)`表示 | Playwright + `previewTiktokAccount`単体テスト(MISSING→USER_NOT_FOUND) | PASS | テストIDは`isValidNormalizedTiktokId`の上限(24文字)以内であること — 超えると先にINVALID_FORMATになる |
| TC-TACM-003 | レート制限・タイムアウト等はUNVERIFIEDとして拒否 | `requireExistingTiktokAccount` 経由 | 異常 | サーキットブレーカー開放中 / 外部リクエストタイムアウト | `(CHECK_UNVERIFIED)`、登録は行われない(fail-closed) | 既存の `tiktok-existence.test.ts` 単体テスト | PASS | UI経由の実地再現は行わず、既存fail-closedゲートのユニットテストで担保 |
| TC-TACM-004 | 実在アカウントは確認モーダルを表示する | 両画面 | 正常 | 実在するTikTok ID(例: ayane_0327) | モーダルにアバター/nickname/`@handle`/フォロー数/フォロワー数(3桁カンマ区切り)/BIO(2行clamp)/確認文言/キャンセル・登録するボタンを表示 | Playwright | PASS | |
| TC-TACM-005 | BIOが空文字の場合はBIO要素を描画しない | モーダル | 境界 | `data.user.signature`が空文字 | BIO領域が表示されずレイアウトが詰まる(空行を残さない) | コードレビュー(`preview.signature`の truthy チェック) + 実データでの目視確認 | PASS | 今回のテストアカウントはBIOありのため空文字ケースは実データで再現できず、コードパスの確認に留める |
| TC-TACM-006 | 「キャンセル」でモーダルを閉じ登録しない | 両画面 | UI | 確認モーダル表示中に「キャンセル」押下 | モーダルが閉じる。確定API(`/api/verify/generate` 等)は呼ばれない。入力欄の値は保持される | Playwright | PASS | |
| TC-TACM-007 | Escキーでモーダルを閉じ登録しない | 両画面 | UI | 確認モーダル表示中にEscキー | モーダルが閉じる。確定APIは呼ばれない | Playwright(admin-workers画面で確認) | PASS | |
| TC-TACM-008 | 「登録する」で確定し既存の登録APIを実行する | 両画面 | 正常 | 確認モーダル表示中に「登録する」押下 | setup: `/api/verify/generate`が呼ばれ認証コード発行画面へ遷移。admin: `/api/admin/workers/watch`が呼ばれ一覧が更新される | Playwright | PASS | |
| TC-TACM-009 | プレビューAPIはDBへ一切書き込まない | `previewTiktokAccount` / preview route | 正常 | 実在するIDでpreview呼び出し | `Streamer.tiktokId`・`TiktokRoom`等に副作用が発生しない(確定APIを呼ぶまでDB状態が変わらない) | コードレビュー(previewエンドポイントの実装がDBアクセスを含まないことを確認) + review-auto Code Modeでの重点確認項目 | PASS | |
| TC-TACM-010 | preview/確定エンドポイントとも認証必須 | `POST /api/verify/preview` / `POST /api/admin/workers/watch/preview` | 異常 | 未ログイン(session無し) | 401(setup側)、admin側は`getAdminSession()`ガード | コードレビュー(`getServerSession`/`getAdminSession`呼び出し確認、既存確定APIと同じガード) | PASS | |
| TC-TACM-011 | Visual QA: comp.pngとの照合 | モーダルUI全体 | UI | 実データ(ayane_0327)でモーダル表示、幅1280pxで撮影 | 構造・余白・タイポ・角丸・情報密度・要素インベントリが一致。色のみDESIGN.md記載値(#fe2c55)と実装(`--accent`実測indigo)に乖離があるが、既存`.btn-primary`踏襲でありDESIGN.md側の陳腐化と判断(DESIGN.mdへ注記追加済み) | visual-qa Compare Mode | PASS | 判定根拠: 構造/余白/タイポ/密度/要素インベントリ完全一致、色のみ既存コンポーネント踏襲によるDESIGN.md陳腐化 |
| TC-TACM-012 | 確定APIが失敗した場合、admin/setup両方でモーダルを閉じてエラー表示する | 両画面のhandleConfirm* | 異常/回帰 | 確認モーダル表示中に確定API(`/api/verify/generate`または`/api/admin/workers/watch`)が非200を返す | モーダルが閉じ、フォーム側にエラーメッセージを表示する。入力欄の値は保持される | ユニット/コードレビュー(`handleConfirmAdd`/`handleConfirmRegister`の実装確認) | PASS | TestCaseレビュー(DeepSeek)で発覚: 修正前はadmin側のみエラー時に`setConfirmPreview(null)`を呼ばずモーダルが開いたままだった(setup側は元から閉じる実装)。`admin/workers/page.tsx`の`handleConfirmAdd`を修正し両画面で統一 |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`（`src/lib/tiktok-profile.test.ts`の`extractVerifiedAccountPreview`、`src/lib/tiktok-existence.test.ts`の`previewTiktokAccount`/`formatExistenceGateError`を含む1431件）

## TestCaseレビュー

DeepSeek(TestCase Mode、risk=HIGH。Codex/Geminiはreview-auto Code Mode時点で利用不能だったためユーザー指示によりDeepSeekのみで実施、同一セッション内の継続)。
finding 7件、実コード照合の結果全件VALID。うち2件(HIGH: `extractVerifiedAccountPreview`/`previewTiktokAccount`の単体テスト欠如)はテスト追加、1件(MEDIUM: admin側の確認失敗時にモーダルが閉じない回帰)はコード修正(TC-TACM-012として追加)。
残り4件(MEDIUM: 確定API自体のエラーコードテスト欠如、LOW×3: 認証/DB非書き込み/loading状態がコードレビュー止まり)は指摘として妥当だが、本プロジェクトの既存慣習(route.ts自体は単体テスト化せずコードレビュー+Playwrightでカバー。`admin-workers-watch`のTC-AWW-008も同方針)に合わせ、追加テスト化は見送った。

## Out of Scope

- TikTok実在確認そのもののfail-closedロジック・サーキットブレーカー・キャッシュTTL — `tiktok-listener-connection`等の既存baseline対象、今回は変更していない
- `admin-workers-watch`のDB層(`addWatchedRoom`)の挙動そのもの — 変更していないため`docs/testing/admin-workers-watch/baseline.md`のTC-AWW-001〜008を参照
