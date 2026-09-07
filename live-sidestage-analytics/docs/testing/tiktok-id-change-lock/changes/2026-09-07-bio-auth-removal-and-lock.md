## date
2026-09-07

## feature
tiktok-id-change-lock（新規） / tiktok-account-confirm-modal（BIO認証UI撤去による更新）

## change summary
- BIO認証(bio貼付コード確認)をsetup画面のUIから撤去(`code_issued`/`verifying`ステップ、`handleVerify`関数を削除)。`/api/verify/check`・`verificationCode`/`verified`列自体は実装を残す。
- `Streamer.tiktokIdChangedAt`(新規カラム)を追加し、TikTok ID変更を7日間ロックする機能を追加(`src/lib/tiktok-id-lock.ts`)。web `POST /api/verify/generate`・mobile `PATCH /api/mobile/streamer`の両経路にCAS(楽観的排他)付きで実装。
- `TiktokAccountConfirmModal`に`lockNoticeText` propを追加し、setup画面の確認モーダルにのみ「登録後7日間はTikTok IDを変更できません」を表示。

## risk
HIGH（認証フロー変更 + DBスキーマ変更 + 複数APIの検証ロジック変更）

## reason
BIO認証は既にどの機能の前提にもなっておらず(`verified`列は撤去済みのVerifyGate等でしか参照されていなかった)、UI上だけ残っていた実装のない認証体験を撤去する要求。TikTok IDの無制限な変更は、absorbRoomsによる自動マージ処理と組み合わさると意図しない配信者間のギフトデータ移動を誘発しうるため、7日クールダウンで抑止する。

## affected baseline cases
- `docs/testing/tiktok-id-change-lock/baseline.md`（新規、TC-LOCK-001〜401）
- `docs/testing/tiktok-account-confirm-modal/baseline.md`（TC-TACM-008更新、TC-TACM-013新規追加）

## reviewers
- Design Mode: Codex + DeepSeek（実装計画`plan-tiktok-id-lock.md`に対して。finding 8件、うちHIGH 3件・MEDIUM 4件・schema comment 1件、全件反映）
- Code Mode: DeepSeek（finding 5件、VALID 1・INVALID 3・ALREADY_HANDLED 1）+ Gemini(OpenRouter代理、`gemini-3.8-flash`、reasoning-effort low)（finding 2件、両方INVALID）。Codex・Gemini(Antigravity)はいずれもquota切れで利用不能だった。

## important findings

### Design Mode（採用・実装済み）
1. **absorbRooms()との競合(HIGH)**: `absorbRooms()`(自動ID合流、`src/lib/tiktok-id-migration.ts`)は対象streamerのtiktokIdを一括で書き換える。もし`tiktokIdChangedAt`をabsorb発火時にも更新すると、「ユーザー起点でない新しいロック開始時刻が付き、ユーザーが7日間身動きできなくなる」という最悪シナリオが起きる。対応: **absorbRooms自体は変更せず、`tiktokIdChangedAt`はユーザー操作による変更(web `/api/verify/generate`・mobile PATCH)でのみ更新する**設計にした。absorbによる書き換えはこのタイムスタンプに一切触れない。
   - 残存リスク(スコープ外として許容): ロック中にユーザーが意図したtiktokIdが無関係な自動マージで上書きされる可能性自体は、既存absorbRooms仕様の範囲内の話であり対応していない。absorbRoomsの大改修は本タスクの範囲を超えると判断。
2. **レース条件(HIGH)**: read→判定→writeが非atomicだと同時リクエストがロック判定を両方通過しうる。対応: `updateMany`のwhere句に読み取り時点の`tiktokIdChangedAt`を条件に含めるCAS(楽観的排他)を必須にした。既存パターン(`src/lib/worker-status.ts`)を踏襲。
3. **注意書き文言と初回登録の矛盾(HIGH)**: 「登録後7日間変更できません」という文言に対し、初回登録時にロックを開始しない実装だと矛盾する。対応: 新規作成時にも`tiktokIdChangedAt`を現在時刻にセットする方針にした。

### Code Mode
- VALID(HIGH、DeepSeek): テスト計画が旧機能(`tiktok-account-confirm-modal`)用のままで、本機能(7日ロック・CAS・BIO撤去)のテストケースが0件。→ 本changesの元になった`tiktok-id-change-lock/baseline.md`を新規作成し対応。
- INVALID(Gemini、OpenRouter代理、reasoning-effort low): 「Prisma `updateMany`のwhereに`tiktokIdChangedAt: null`を渡すと`IS NULL`として正しくマッチせず、既存streamer(migration前、null)は永久に409になる」という指摘。**実際にworktree環境の実DBへ検証スクリプトを流し、`updateMany({where: {id, tiktokIdChangedAt: null}})`が`count: 1`で正しくマッチすることを実証した。** Prismaの`null`フィルタは`undefined`(条件無視)とは異なり明示的に`IS NULL`へコンパイルされるという公式仕様どおりの挙動であり、この指摘は誤り。reasoning-effort lowでの生成が誤検知の一因と考えられる(review-autoの既定はhigh。今回はCodex/Antigravity不可の緊急代理としてlowを使った)。
- ALREADY_HANDLED(DeepSeek): 「`checkTiktokIdChangeAllowed`が`tiktokIdChangedAt: null`を安全に処理するか不明」という指摘2件は、実装時点で`if (!current.tiktokIdChangedAt) return {ok: true}`として既に対応済み。
- INVALID(DeepSeek): 「TikEffect APIキーカードの削除がproduct説明に無い」は、review-auto投入時のコンテキストに含めていなかっただけで、別タスクとして既にDeepSeek review済み(findings 0件)の意図した変更。

## VALID・INVALIDの重要判断
上記「important findings」に集約。特筆すべきは、reasoning-effort lowのモデル出力を鵜呑みにせず**実DBでの直接検証によって反証した**点(review-autoの「レビュー結果より実コードと検証結果を優先する」原則の実践例)。

## verification
- `npm run typecheck`: PASS
- `npm run test:unit`: 1451件 PASS（新規`src/lib/tiktok-id-lock.test.ts` 7件を含む）
- `npm run test:integration`: 855件 PASS（新規`src/app/api/verify/generate/route.integration.test.ts` 5件、`src/app/api/mobile/streamer/route.integration.test.ts` 2件を含む）
- Playwright実ブラウザ確認: setup画面のBIO認証UI撤去後の表示、確認モーダルの`lockNoticeText`表示を確認（詳細は最終報告のArtifact参照）

## remaining risks
- absorbRoomsとロックの相互作用(上記「残存リスク」参照)は本タスクのスコープ外として明示的に許容。将来absorbRooms自体を改修する際は、このタイムスタンプへの影響を再検討すること。
- CAS競合(TC-LOCK-301)は実際の同時リクエストによる再現テストは行っておらず、コードレビューとPrisma標準動作の実証に留まる。
