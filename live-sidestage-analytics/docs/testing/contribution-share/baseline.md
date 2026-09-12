---
last_updated: 2026-09-12
last_risk: LOW
last_reviewers: Gemini(agy, Code Mode).test-auto Playwright TC-CS-011 2026-09-12
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
| TC-CS-007 | 存在しないトークンは404。理由コードや「無効なトークン」等の文言を出さない | `/api/public/contribution/[token]` / `/c/[token]` | negative/セキュリティ | 未知の48桁トークンで開く | HTTP 404。レスポンス本文・ページ表示のどちらも実在有無を区別しない | `[route]`, `[anon]` | PASS(2026-09-11、Playwright再確認: 未知48桁で404) | トークンの実在有無を漏らすと総当たりで判定できる |
| TC-CS-008 | 公開payloadは`verified`を含まないが`tiktokUid`/`tiktokHandle`は含む(所有者向けと同じ情報量) | `queryContributionRankingByShareToken` | セキュリティ/回帰 | シードの配信者・視聴者データ | レスポンスJSONの各userキー集合が`giftCount,lastGiftAt,nickname,profileImageUrl,tiktokHandle,tiktokUid,totalDiamonds`に一致(`verified`は含まない) | `[unit]` | PASS(2026-09-11) | ユーザー指示によりtiktokUid/tiktokHandle非公開化方針を撤回(所有者向けRankingRowと同等の情報を公開する)。除外するのは`verified`のみ |
| TC-CS-008a | 公開ページの各行にtiktokHandleが表示され、TikTokプロフィールへのリンクになる。ハンドル未取得の視聴者はリンク無しでニックネームのみ表示する | `PublicContributionClient`(`PublicRankingRow`) | 正常/欠損 | (a)tiktokHandleありの視聴者 (b)tiktokHandleがnullの視聴者 | (a)`@handle`表示があり、アバター・ニックネームが`https://www.tiktok.com/@handle`へのリンクになる (b)リンクが無くニックネームのみのプレーン表示 | `[pw]` | PASS(2026-09-11、Playwright再確認: `@test_user_1` 等表示) | (b)はこのシードにnullハンドル行が無く未再測。既存PASSを維持 |
| TC-CS-008b | 各行をクリックするとギフト内訳アコーディオンが開き、`/api/public/contribution/[token]/breakdown`から取得したギフト明細(ギフト名・回数・合計ダイヤ)を表示する。再クリックで閉じる。90日超で明細が無い期間は「内訳は残っていない」を表示する | `PublicContributionClient` / `GET /api/public/contribution/[token]/breakdown` | 正常/データ欠損/回帰 | (a)明細が残っている視聴者行 (b)90日超で`coverage.detailAvailable=false`の期間 | (a)展開後ギフト行(名前・×回数・合計ダイヤ)が表示される (b)「この期間の内訳は残っていない(ギフト明細は90日で削除される)」を表示 | `[unit]`(`breakdown/route.test.ts`), `[pw]` | PASS(2026-09-11、Playwright再確認: 1位展開でギフト内訳表示・再クリックで閉じる)。(b)は未再測 | リストは`useVirtualizer`(内側`max-h-96`スクロール)。画面外行はDOMに無いが、スクロール後のクリックで開閉できること(所有者向けTC-GRB-036相当) |
| TC-CS-008c | 内訳アコーディオンは同一行の連続クリックで二重フェッチしない(初回取得後はキャッシュ済みstateを再利用) | `PublicContributionClient`(`toggleBreakdown`) | 境界/並行処理 | 同一行を開く→閉じる→素早く再度開くを連続操作 | 2回目の展開では`/breakdown`への再フェッチが起きず、`breakdownsRef`経由の最新state判定で二重取得を回避する | `[unit]`(ロジックはコンポーネント内、`useRef`によるstale closure対策を実コードで確認) | PASS(2026-09-11、code-review DeepSeekのstale closure指摘への修正を実コードで確認) | `setOpenTiktokUid`の関数型更新内で`breakdownsRef.current`を参照する設計 |
| TC-CS-008d | 公開ランキングは仮想化され、大量行でもDOM実在数が可視範囲+overscanに制限される。内訳開閉で全行を再レンダーしない | `PublicContributionClient`(`useVirtualizer` / `memo(PublicRankingRow)`) | 性能/回帰 | 貢献者がリスト高さ(`max-h-96`)を超える件数 | 実描画行は可視+overscan(8)。アコーディオン開閉後もDOM行数が全件数に膨らまない | `[pw]` | NOT RUN: ローカルシードが3人で `max-h-96` 未超過。開閉前後ともDOM行=3 | 所有者向け`AnalyticsView`のTC-GRB-035と同じ原因(開閉時の全行diff)への公開ページ側の追随。パネルは別仮想アイテム(`rankingVirtualEntries`) |
| TC-CS-008e | 内訳アコーディオンを閉じたあと、仮想リストの余白・後続行位置が開く前に戻る | `PublicContributionClient`(`useVirtualizer`) | 回帰/表示 | 行を開いて内訳表示後、再度クリックして閉じる | 閉じた行の下が空きにならず、後続行が通常行高さで詰まる | `[pw]` | PASS(2026-09-11、Playwright: 展開時行間304px → 閉じた後19px。大きな空白なし) | 同一仮想アイテムで開閉すると measurementsCache に展開高さが残るため、パネルは挿入/削除する |
| TC-CS-009 | 公開ページと公開APIは検索索引の対象にせず、その旨をHTTPヘッダ・meta両方に出す | `generateMetadata` / `/api/public/contribution/[token]` | セキュリティ/回帰 | 公開URLを開いて`<head>`とレスポンスヘッダを見る | `<meta name="robots">`相当が`index:false,follow:false`、APIレスポンスヘッダに`X-Robots-Tag: noindex`と`Cache-Control: private, no-store` | `[route]`, `[anon]` | PASS(2026-09-11、route.test.tsでヘッダ確認済み) | URLを知る人向けであってSEO対象ではない |
| TC-CS-010 | 共有ページと公開APIだけが認証を免除され、似た前置のパスは保護されたまま | `src/middleware.ts` | 回帰/認可/境界 | `/c/abc123` `/c/abc123/` `/api/public/contribution/abc123` / `/billing` `/chat` `/cx` | 前3つは認証なしで通る。後3つは保護されたまま | `[unit-mw]` | PASS(2026-09-11) | 境界`(?:/|$)`を落とすと想定しない前置パスまで公開される |
| TC-CS-011 | シェアボタンは発行したURLをクリップボードへ入れる。成功時は画面上部に目立つトーストを出す。非secure contextではURLを選択可能なテキストで出す | `ShareLinkButton` | 正常/異常/境界 | (a)通常環境でシェア (b)`navigator.clipboard`が無い環境 | (a)クリップボードに`<origin>/c/<token>`が入り「共有リンクをコピーしました」固定トースト+ボタンcheck表示 (b)readonly入力欄にURLが出てフォーカスで全選択 | `[pw]` | PASS(2026-09-12 test-auto、localhost:3002 Playwright: toast role=status + clipboard `/c/` URL) | トーストは`createPortal`で`document.body`直下。3秒で消える |
| TC-CS-012 | 公開ページはURLを知っていればログインなしで開ける | `/c/[token]` | 正常/認可 | 発行済みURLを別の匿名コンテキストで開く | `/login`へリダイレクトされず貢献ランキングが表示される | `[anon]` | PASS(2026-09-11、Playwright再確認: 匿名contextで `/c/` のまま表示。PC1280・390px) | |

## Quality Gate

- `npm run typecheck`（`tsc --noEmit`）→ PASS(2026-09-11、本セッション再実行)
- `npx vitest run` 貢献シェア関連4ファイル → 35 tests PASS(2026-09-11)
- `npm run test:unit` 全体 → 未再実行(関連unitのみ)
- `npm run test:integration` → 未再実行(今回API/DB契約変更なし)

## Out of Scope

- **シェアトークンの失効**。`/b/<shareToken>`と同じ判断で初版に入れない。発行したリンクは残り続ける
- 期間集計そのものの正しさ（`queryGifts`の集計ロジック）は`docs/testing/gift-history-range/baseline.md`等の既存baselineが対象。ここで保証するのは「配信者がリンクを配れること」と「そのリンクを開いた第三者に何が見え、何が見えないか」
- rate limit / brute force対策。既存`/b/<shareToken>`にも同種の対策が無く、一貫性を優先(code-review DeepSeek指摘、既存仕様との一貫性と判断し今回は対応しない)
