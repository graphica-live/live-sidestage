---
last_updated: 2026-09-11
last_risk: HIGH
last_reviewers: [Code Mode]Codex-terra(medium)+DeepSeek(high)、[TestCase Mode]DeepSeek(high)、2026-09-11 新規実装
---

# ギフト貢献ランキングの公開シェア機能

対象: トークン発行API3経路（`POST /api/analytics/gifts/share`（配信者本人）、
`POST /api/admin/rooms/[roomId]/analytics/gifts/share`（管理者）、
`POST /api/mobile/analytics/gifts/share`（mobile））、公開API `GET /api/public/contribution/[token]`、
公開ページ `src/app/(public)/c/[token]/`（`page.tsx` / `PublicContributionClient.tsx`）、
共有ロジック `src/lib/contribution-share.ts` / `src/lib/share-token.ts`、
`src/middleware.ts` の除外エントリ `c(?:/|$)`、`ShareLinkButton.tsx`（`BattleDetailModal.tsx` の
`ShareButton` を汎用化）。

`/b/<shareToken>`（バトル再生共有）と同じ設計思想（トークン推測困難性のみで保護、noindex、失効なし）を
「期間の定義」（`period`+`date`、または`custom` range）に対して行う。**バトル共有と違い「特定のレコード」
ではなく「期間の定義」を指す**ため専用テーブル`ContributionShareToken`を1つだけ持つ。

実行方法の略記:

- `[unit]` = `npx vitest run src/lib/contribution-share.test.ts`
- `[unit-mw]` = `npx vitest run src/middleware.test.ts`
- `[route]` = `npx vitest run src/app/api/analytics/gifts/share/route.test.ts src/app/api/admin/rooms/\[roomId\]/analytics/gifts/share/route.test.ts src/app/api/public/contribution/\[token\]/route.test.ts`
- `[int]` = `npx dotenv -e .env.local.test -- vitest run "src/app/api/mobile/analytics/gifts/share/route.integration.test.ts"`
- `[pw]` = Playwright スクラッチスクリプト。`npm run dev:local` を起動 → `dev@local.test` でログイン →
  貢献ランキング(期間集計)タブでシェアボタンを押す
- `[anon]` = `[pw]` と同じ構成で、発行された共有URLを別の匿名 browser context（未ログイン）で開く

## テストケース

| # | ケース | 対象 | 種別 | 前提 | 期待結果 | 実行方法 | 結果 | 備考 |
| - | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CS-001 | 配信者本人が期間集計(day/week/month/year)のシェアリンクを発行できる | `POST /api/analytics/gifts/share` | 正常 | ログイン済み配信者 | 200で`{url: "<canonicalOrigin>/c/<48桁トークン>"}` | `[route]` | PASS(2026-09-11、route.test.ts) | オリジンはサーバー側`canonicalOrigin("analytics")` |
| TC-CS-002 | 同一room×同一期間定義への2回目の発行は同一トークンを返す(冪等) | `ensureContributionShareToken` | 回帰 | 同じ`rangeKey`で2回発行 | 2回目もDB書き込みなしで同じtokenを返す | `[unit]` | PASS(2026-09-11、21 tests中) | P2002競合時も再findFirstで同じ値へ収束 |
| TC-CS-003 | customな期間(startDatetime/endDatetime)は366日超・過去1年より前の指定を拒否する | `validateShareRequestBody` | 異常/境界 | (a)366日超 (b)start>=end (c)過去1年より前のstart (d)ISO日時でない値 | 全て400相当のエラーを返す(`ok:false`) | `[unit]` | PASS(2026-09-11) | `MAX_RANGE_DAYS`(366日)は既存`range-limits.ts`と共通 |
| TC-CS-004 | 90日保持期間より古いcustom期間は、queryGiftsへ渡す境界をUTC日境界へ丸める(表示上のdateRangeは元の指定値を保つ) | `queryContributionRankingByShareToken` | 回帰/境界/セキュリティ | 90日超前の時刻指定(`2026-06-01T15:00Z〜2026-06-02T09:00Z`、基準日2026-09-11) | `queryGifts`へ渡る`receivedAt`が`2026-06-01T00:00:00.000Z〜2026-06-02T23:59:59.999Z`(日境界)。返る`payload.dateRange`は元の時刻(`15:00Z`/`09:00Z`)のまま | `[unit]` | PASS(2026-09-11) | code-review(Codex-terra HIGH)指摘の修正。90日超は`queryGifts`が日次ロールアップ(dayKey粒度)へ切替るため、時刻指定のままだと指定時間帯外のデータが公開ランキングへ混入し得た |
| TC-CS-004a | start/endのどちらか一方だけが90日より古い場合、古い側だけ日境界へ丸め、保持期間内側は丸めない | `queryContributionRankingByShareToken` | 境界 | (a)startのみ90日超(end保持期間内) (b)endのみ90日超(start保持期間内) | (a)`gte`のみ日開始(`00:00:00.000Z`)へ丸まり`lte`は元の時刻のまま (b)`lte`のみ日終わり(`23:59:59.999Z`)へ丸まり`gte`は元の時刻のまま | `[unit]` | PASS(2026-09-11、TestCaseレビューDeepSeek指摘で追加) | 実装は`start`/`end`を独立に`< retentionCutoffMs`で判定するため混在時も意図通り動くことを確認 |
| TC-CS-004c | start/endが保持期間境界とちょうど等しい(90日前ちょうど)場合は丸めない | `queryContributionRankingByShareToken` | 境界 | `retentionCutoffMs`と同値の`startDatetime` | 丸めが働かず`gte`/`lte`とも元の時刻のまま渡る | `[unit]` | PASS(2026-09-11、TestCaseレビューDeepSeek指摘で追加) | 判定は`<`(未満)のみで丸めるため、境界値そのものは丸め対象に入らない(意図した挙動) |
| TC-CS-005 | 管理者向け発行エンドポイントは認可・404境界を守る | `POST /api/admin/rooms/[roomId]/analytics/gifts/share` | 異常/認可/境界 | (a)未ログイン (b)存在しないroomId | (a)401 (b)404 | `[route]` | PASS(2026-09-11) | `/api/admin/.../battles/[battleId]/share`と同じ設計 |
| TC-CS-006 | mobile向け発行エンドポイントは認証・room未接続境界を守り、既発行トークンを再利用する | `POST /api/mobile/analytics/gifts/share` | 異常/認可/回帰 | (a)トークン無し (b)room未接続JWT (c)同一期間で2回POST | (a)(b)404、(c)2回目も同じURL | `[int]` | PASS(2026-09-11) | Web版と同じ`ensureContributionShareToken`の冪等性 |
| TC-CS-007 | 存在しないトークンは404。理由コードや「無効なトークン」等の文言を出さない | `/api/public/contribution/[token]` / `/c/[token]` | negative/セキュリティ | 未知の48桁トークンで開く | HTTP 404。レスポンス本文・ページ表示のどちらも実在有無を区別しない | `[route]`, `[anon]` | PASS(2026-09-11、実ブラウザ確認: `UNKNOWN_TOKEN_STATUS 404`) | トークンの実在有無を漏らすと総当たりで判定できる |
| TC-CS-008 | 公開payloadはverified/tiktokUid/tiktokHandleを含まず、nickname/profileImageUrl/集計値のみを返す | `queryContributionRankingByShareToken` | セキュリティ/回帰 | シードの配信者・視聴者データ | レスポンスJSONに`tiktokUid`/`tiktokHandle`/`verified`キーが一切現れない | `[unit]` | PASS(2026-09-11、実ブラウザ確認: 公開ページ本文にニックネームのみ表示、ハンドル非表示) | `GiftAnalyticsUser`を素通しせず`PublicContributionUser`へ明示的にマップし直す設計 |
| TC-CS-009 | 公開ページと公開APIは検索索引の対象にせず、その旨をHTTPヘッダ・meta両方に出す | `generateMetadata` / `/api/public/contribution/[token]` | セキュリティ/回帰 | 公開URLを開いて`<head>`とレスポンスヘッダを見る | `<meta name="robots">`相当が`index:false,follow:false`、APIレスポンスヘッダに`X-Robots-Tag: noindex`と`Cache-Control: private, no-store` | `[route]`, `[anon]` | PASS(2026-09-11、route.test.tsでヘッダ確認済み) | URLを知る人向けであってSEO対象ではない |
| TC-CS-010 | 共有ページと公開APIだけが認証を免除され、似た前置のパスは保護されたまま | `src/middleware.ts` | 回帰/認可/境界 | `/c/abc123` `/c/abc123/` `/api/public/contribution/abc123` / `/billing` `/chat` `/cx` | 前3つは認証なしで通る。後3つは保護されたまま | `[unit-mw]` | PASS(2026-09-11) | 境界`(?:/|$)`を落とすと想定しない前置パスまで公開される |
| TC-CS-011 | シェアボタンは発行したURLをクリップボードへ入れる。非secure contextではURLを選択可能なテキストで出す | `ShareLinkButton` | 正常/異常/境界 | (a)通常環境でシェア (b)`navigator.clipboard`が無い環境 | (a)クリップボードに`<origin>/c/<token>`が入りコピー成功表示 (b)readonly入力欄にURLが出てフォーカスで全選択 | `[pw]` | PASS(2026-09-11、実ブラウザ確認: `SHARE_URL http://localhost:3201/c/<token>`をクリップボードから取得成功) | `BattleDetailModal`の`ShareButton`から抽出した状態機械を流用(既存動作は`docs/testing/battle-replay-share/baseline.md`のTC-BRS-012が保証済み)。(b)はheadless clipboard権限の制約でこのセッションでは実測せず、既存共通ロジックの流用として`[unit]`カバレッジに委ねる |
| TC-CS-012 | 公開ページはURLを知っていればログインなしで開ける | `/c/[token]` | 正常/認可 | 発行済みURLを別の匿名コンテキストで開く | `/login`へリダイレクトされず貢献ランキングが表示される | `[anon]` | PASS(2026-09-11、実ブラウザ確認: `ANON_PUBLIC_URL`が`/c/<token>`のまま、PC幅・390pxスマホ幅とも横スクロール無く表示) | |

## Quality Gate

- `npm run typecheck`（`tsc --noEmit`）→ PASS(2026-09-11)
- `npm run test:unit` → 1592 tests PASS(2026-09-11、TestCaseレビュー反映後の境界ケース追加込み)
- `npm run test:integration` → 960 tests PASS(2026-09-11)

## Out of Scope

- **シェアトークンの失効**。`/b/<shareToken>`と同じ判断で初版に入れない。発行したリンクは残り続ける
- 期間集計そのものの正しさ（`queryGifts`の集計ロジック）は`docs/testing/gift-history-range/baseline.md`等の既存baselineが対象。ここで保証するのは「配信者がリンクを配れること」と「そのリンクを開いた第三者に何が見え、何が見えないか」
- rate limit / brute force対策。既存`/b/<shareToken>`にも同種の対策が無く、一貫性を優先(code-review DeepSeek指摘、既存仕様との一貫性と判断し今回は対応しない)
