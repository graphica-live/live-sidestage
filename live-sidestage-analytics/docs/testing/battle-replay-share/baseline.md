---
last_updated: 2026-09-10
last_risk: LOW
last_reviewers: [Code Mode]DeepSeek(high)、2026-09-10 共有ボタンアイコン化・位置変更・再生ボタン円形化
---

# バトル再生の共有リンク

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

対象: 公開ページ `src/app/(public)/b/[token]/`（`page.tsx` / `PublicBattleClient.tsx`）、
`src/middleware.ts` の除外エントリ `b(?:/|$)`、`src/components/analytics/BattleDetailModal.tsx` の `ShareButton`、
`src/components/analytics/battle-replay/replay-select.ts` の `teamTotalsOf`、
`src/app/api/mobile/analytics/battles/[battleId]/share/route.ts`(mobile向けshare token発行API)。

**トークン発行・公開APIそのもの**（`ensureShareToken` / `GET /api/public/battles/[token]/replay` /
`POST /api/analytics/battles/[battleId]/share`）は `docs/testing/battle-replay-api/baseline.md`（TC-BRA-028〜032・036）。
**再生画面の中身**は `docs/testing/battle-replay-ui/baseline.md`。
ここで保証するのは**「配信者がリンクを配れること」と「そのリンクを開いた第三者に何が見え、何が見えないか」**。

リンクを知っていれば誰でも開ける（ログイン不要・失効なし）という仕様上、
**リスナー・配信者の TikTok ハンドルが公開面へ出ないこと**が最重要の保証事項。

実行方法の略記:

- `[unit]` = `npx vitest run src/components/analytics/battle-replay/replay-select.test.ts`
- `[mw]` = `npx vitest run src/middleware.test.ts`
- `[pw]` = Playwright スクラッチスクリプト（`.cjs`、`playwright` を絶対パスで require）。
  `npm run dev:local` を `PORT=3200 NEXTAUTH_URL=http://localhost:3200 ANALYTICS_ORIGIN=http://localhost:3200` で起動し、
  `dev@local.test` でログイン → 期間セレクタを「月」→「バトル履歴」タブ → 行をクリックしてモーダルを開く。
  前提は `docker compose up -d db` → `npm run db:push:local` → `npm run seed:local` → `npm run seed:battle-replay:local`
- `[anon]` = `[pw]` と同じ構成で、**共有URLを別の匿名 browser context（未ログイン）で開く**。
  シェア機能の唯一の実効的検証なので、同一 context の遷移で代替しない
- `[admin]` = `[pw]` と同じ構成を `graphicatestlive@gmail.com`（`ADMIN_EMAIL`）でログインし、
  `/admin/workers` → `/admin/rooms/<roomId>` のバトル履歴からモーダルを開く

## テストケース

| # | ケース | 対象 | 種別 | 前提 | 期待結果 | 実行方法 | 結果 | 備考 |
| - | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-BRS-001 | 貢献者一覧モードのシェアボタンは、その表示状態を指す共有URLを発行してクリップボードへ入れる | `ShareButton` | 正常 | 確定済みバトルのモーダル（一覧モード） | クリップボードが `<origin>/b/<48桁トークン>?v=list`。ボタンはモーダル右上(閉じるボタンのすぐ左)に矢印アイコン(SVG)のみで文字ラベル無しで表示され、コピー成功後も見た目は変わらず `aria-label`/`title` が「コピーした」に変わる | `[pw]` | PASS(2026-09-10、`http://127.0.0.1:3200/b/fab90486…f60fa5?v=list`、share response 200) | オリジンはサーバー側の `canonicalOrigin("analytics")`。`window.location.origin` を使うと別ホスト発行でずれる |
| TC-BRS-002 | 再生モードのシェアボタンは再生状態を指す共有URLを発行する | `ShareButton` | 正常 | 同じバトルを再生モードにしてシェア | クリップボードが同じトークンで `?v=replay`。**トークンは一覧モードのときと同一**（表示状態はクエリで表す）。ボタンは一覧モードと同じモーダル右上の位置に固定表示される（list/replay 共通コンテナ） | `[pw]` | PASS(2026-09-10、モーダル右上に矢印アイコンのみ表示、41-replay-mode-modal.pngで確認) | 表示状態をトークンへ埋めると同一バトルで2トークンになり管理が壊れる |
| TC-BRS-021 | 一覧モードでコピー済み(`copied`)状態にした後、再生モードへ切り替えると共有ボタンの状態がリセットされる | `ShareButton` / `BattleDetailModal` | 回帰/状態遷移 | 一覧モードでシェアして `copied` 状態にしてから「バトルを再生」で再生モードへ切替 | 再生モードの共有ボタンは `idle` 状態（`aria-label`/`title` が「共有リンクをコピー」）で表示され、`copied` の見た目を引き継がない | `[pw]` | PASS(2026-09-10、replay mode idle share button count 1) | list/replay 両モードで同一位置にボタンを固定表示する構造にしたため、`ShareButton` に `key={mode}` を付けて mode 切替のたびに再マウントし内部 state をリセットする(code-review MEDIUM finding対応) |
| TC-BRS-003 | 共有URLは未ログインの第三者がログインを求められずに開ける | `/b/[token]` / `middleware` | 正常/認可 | 発行済みURLを**別の匿名コンテキスト**で開く | `/login` へリダイレクトされず、`/b/<token>` のまま再生画面が出る | `[anon]` | PASS（`ANON_REPLAY_PATH /b/…` `?v=replay`） | 除外 matcher に `b(?:/|$)` が無いとここで落ちる |
| TC-BRS-004 | 公開ページのタブ切替は表示中のモードをURLへ反映する | `PublicBattleClient` | 状態遷移 | 再生タブで開いた状態から「貢献者一覧」を押す | URLの検索文字列が `?v=list` へ変わる。ページ全体の再読み込みは起きない | `[anon]` | PASS（`AFTER_TAB ?v=list`） | `useSearchParams` は使わない（overlay で本番だけ壊れた経緯）。書き戻しは `window.history.replaceState` |
| TC-BRS-005 | `?v=list` を直接開くと貢献者一覧タブが選択済みで表示される | `/b/[token]` | 正常/境界 | `?v=list` のURLへ直接アクセス | 「貢献者一覧」タブが選択状態（`aria-pressed="true"`）。`?v` 未指定・不明値は再生タブ | `[anon]` | PASS（`DIRECT_LIST_ACTIVE true`） | 受け口はサーバーコンポーネントの `searchParams` |
| TC-BRS-006 | 存在しないトークンは 404。トークンの実在有無を区別しない | `/b/[token]` | negative/セキュリティ | 48桁の未知トークンで開く | HTTP 404。理由コードや「無効なトークン」等の文言を出さない | `[anon]` | PASS（`UNKNOWN_TOKEN_STATUS 404`） | 「未確定だから見られない」と「そんなトークンは無い」を出し分けると総当たりで実在を判定できる |
| TC-BRS-007 | 共有ページと公開APIだけが認証を免除され、似た前置のパスは保護されたまま | `src/middleware.ts` | 回帰/認可/境界 | `/b/abc123` `/b/abc123/` `/api/public/battles/abc123/replay` / `/billing` `/battle` `/bx` | 前3つは認証なしで通る。後3つは保護されたまま | `[mw]` | PASS（19 tests） | 境界 `(?:/|$)` を落とすと**課金ページ `/billing` が公開される**。matcher 文字列を直接評価して固定している |
| TC-BRS-008 | 公開面には配信者・リスナーどちらの TikTok ハンドル文字列も出ない | `/b/[token]` / `api/public/.../replay` | セキュリティ/回帰 | シードの `local_test_streamer` 等を持つバトルを公開URLで開く | ページHTML・APIレスポンスの本文にハンドル文字列が現れない。`participants[].uniqueId` と `senders[].u` は値が `null`。`roomId` / `battleHistoryId` / `sourceGiftId` / `streamerId` / `captureCoverage` / `captureStatus` / `sourceUpdatedAt` のキーも無い | `[anon]` | PASS（ハンドル3種すべて不出現、禁止キー7種すべて不出現、`uniqueId` はキーのみ残り値 `null`） | ハンドルはリスナー個人のプロフィールへ直リンクできる識別子 |
| TC-BRS-018 | 公開ページはリスナー・配信者のアバター画像を通常どおり表示する | `/b/[token]` | 正常 | アバター保存済みのリスナーが投げているバトルを公開URLで開く | `senders[].a` が非nullの署名付きURLで、貢献者一覧・再生画面のアイコンに実画像が出る（頭文字フォールバックにならない） | `[anon]` | PASS(2026-09-08) | 配信者の明示判断でリスナーアバター非表示の制約を撤回(2026-09-08)。アバターURLのオブジェクトキーにハンドルが含まれる点は把握済みでの判断。ハンドル文字列自体(`senders[].u`)は引き続き `null` |
| TC-BRS-009 | 公開ページは検索索引の対象にせず、参照元も渡さない | `generateMetadata` | セキュリティ/回帰 | 公開URLを開いて `<head>` を読む | `robots` が `noindex, nofollow`、`referrer` が `same-origin` | `[anon]` | PASS（`noindex, nofollow` / `same-origin`） | URLを知る人向けであってSEO対象ではない。HTTPヘッダ側は TC-BRA-032 |
| TC-BRS-010 | 共有ページのタイトルとOGPがバトル名になる | `generateMetadata` / `replayTitleOf` | 正常 | 2陣営のバトル | `<title>` が `{自分} vs {相手} \| LIVE Sidestage`、`og:title` が `{自分} vs {相手}` | `[anon]` | PASS（`配信者 vs 配信者 \| LIVE Sidestage` / `配信者 vs 配信者`） | 表示名はニックネームのみ（ハンドルを含まない） |
| TC-BRS-011 | 貢献者一覧タブはバトル全体を陣営ごとに合算し、金額降順で並べる | `teamTotalsOf` | 正常/境界/empty state | 複数陣営・複数送信者 / ギフト明細0件の陣営 / 複数人コラボの陣営 | 陣営ごとに送信者を合算し降順。同額は送信者添字順。明細0件の陣営も行が残る（`observedCoins: 0`）。複数人コラボの陣営名は参加者名を ` / ` で連結 | `[unit]` | PASS（35 tests） | 再生画面の貢献者ボード（`contributorsAt`）と違い、時刻で切らず自陣営に限定もしない（第三者向けの全体像） |
| TC-BRS-012 | クリップボードが使えない環境ではURLを選択可能なテキストで出す | `ShareButton` | 異常/境界 | `navigator.clipboard` が無い状態でシェアを押す | 読み取り専用の入力欄に共有URLが出てフォーカスで全選択される。黙って失敗しない | `[pw]` | PASS（`readonly` の入力欄に `?v=list` 付きURL） | 非 secure context（`http://` の実機確認など）で起きる |
| TC-BRS-013 | 管理者向けのバトル詳細でも配信者本人と同じシェアボタンが使え、発行したリンクは第三者が本人発行時と同じように開ける | `BattleDetailModal` / `ShareButton` | 正常/認可/回帰 | `/admin/rooms/<roomId>` のバトル履歴からモーダルを開く | 一覧モードで押すと `<origin>/b/<48桁トークン>?v=list` がクリップボードに入りボタン文言が「リンクをコピーした」へ変わる(TC-BRS-001と同形式)。再生モードで押すと同一トークンで `?v=replay`(TC-BRS-002と同形式)。**このトークンは本人が同じバトルで発行した場合と同一の値**(`ensureShareToken(roomId, battleId)` を共有するため)。発行したURLを別の匿名 context で開くと `/login` へ飛ばされず両モードとも再生できる(TC-BRS-003相当) | `[admin]` | PASS(2026-09-09、`?v=list`トークン一致・匿名open成功) | 2026-09-09: 発行APIが `/api/admin/rooms/[roomId]/analytics/battles/[battleId]/share` に新設され、以前の「adminには出さない」仕様を反転した。認可・404/401・冪等性の保証は `docs/testing/battle-replay-api/baseline.md` の TC-BRA-040。ShareButtonのHTTPエラー時のerror state表示は本変更で新設したものではなく既存ロジック(このbaselineに未収載の既存カバレッジギャップ、今回のスコープ外) |
| TC-BRS-014 | 公開ページはスマホ幅でも横スクロールしない | `PublicBattleClient` | デバイス差/境界 | 390px 幅で `?v=list` を開く | `document.documentElement` の横スクロールが発生しない | `[anon]` | PASS（`SP_H_OVERFLOW false`） | 共有先はモバイルで開かれる前提 |
| TC-BRS-015 | mobile向けshare routeは`ensureShareToken`の既存仕様(適格性未判定)をそのまま踏襲し、常にトークンを発行する | `POST /api/mobile/analytics/battles/[battleId]/share` | 正常 | 正しいroomのbattleId(再生可否を問わない) | 200で`{url: "<origin>/b/<48桁トークン>"}`を返す。再生不可バトルでもここでは404にしない(404は`/b/[token]`アクセス時) | `npx dotenv -e .env.local.test -- vitest run "src/app/api/mobile/analytics/battles/[battleId]/share/route.integration.test.ts"` | PASS(2026-09-08) | Web版`POST /api/analytics/battles/[battleId]/share`と同じ設計 |
| TC-BRS-016 | mobile向けshare routeは認証・所有者境界を守る | 同上route | 異常/認可/境界 | (a)トークン無し (b)room未接続JWT (c)別roomにのみ存在するbattleId (d)存在しないbattleId | (a)401でtoken発行なし (b)(c)(d)いずれも404 | 同上コマンド | PASS(2026-09-08) | (c)は所有者境界(Codex Design Review medium effortの指摘で追加) |
| TC-BRS-017 | mobile向けshare routeは既発行tokenを再利用する | 同上route | 回帰 | 同じbattleIdへ2回POST | 2回目も同じURLを返す(新規token発行しない) | 同上コマンド | PASS(2026-09-08) | Web版と同じ`ensureShareToken`の冪等性 |
| TC-BRS-019 | 公開ページヘッダーのコピーボタンはシェアアイコンで表示され、コピー成功でチェックアイコンへ変わる | `PublicBattleClient` の `CopyLinkButton` | 正常 | `/b/[token]` を開いてボタンを押す | 押す前は共有(share)アイコンかつ `aria-label="リンクをコピー"`。押すとクリップボードへURLが入り、アイコンがチェックへ変わり `aria-label="コピーした"` に。2秒後に共有アイコンへ戻る | `[anon]` | PASS(2026-09-08) | クリップボード不可時のテキスト入力フォールバックは TC-BRS-012 と共通ロジック |
| TC-BRS-020 | 公開ページのモード切替タブは、配信者ページの再生ボタンと同じ見た目を使う(シェアボタンの有無だけが差) | `PublicBattleClient` の `ReplayTab` | 正常/回帰 | `/b/[token]` を開き、選択中/非選択のタブそれぞれを見る | 「バトルを再生」タブは選択中のとき配信者ページの再生ボタンと同じ円形+大きい▶アイコンになる(`aria-label="バトルを再生"`)。非選択タブは枠線+ミュートテキストの小さいボタン(`▶ バトルを再生`の文言)。選択の切替はこれまでどおりクリックで即時反映され、URLの `?v=` も連動する | `[anon]` | PASS(2026-09-10、42/43番スクショで非選択・選択中両状態を実機確認) | ユーザー指示「公開ページと自分のページでシェアボタンの有無以外で差を出さないで」への対応。2026-09-10、配信者ページの再生ボタンが円形+大アイコン+下ラベルへ変更されたのに合わせ、公開ページの選択中タブも同じ円形+アイコンへ追従(ユーザー確認済み)。配信者ページは常時タブ形式ではなく片方向ボタン+下ラベルのため、タブ構造自体(非選択タブの見た目・ラベル配置)は据え置き |

## Quality Gate

- `npm run typecheck`（`tsc --noEmit`）→ PASS(2026-09-10、共有ボタンアイコン化・位置変更・再生ボタン円形化)
- `npm run test:unit` → 1520 tests PASS(2026-09-10)
- `npm run test:integration` → 919 tests PASS(2026-09-10)
- `npx next build`（`npm run build` は `prisma db push --accept-data-loss` を伴うので使わない）→ NOT RUN(2026-09-10、typecheck + 実ブラウザ確認で代替。前回2026-09-09はNOT RUN、2026-09-08はPASS)

## Out of Scope

- **シェアトークンの失効**。初版に入れない判断（列 `shareToken` / `shareTokenIssuedAt` だけ先に持ち、
  `DELETE .../share` は後から足せる形にしてある）。発行したリンクは残り続ける
- トークン発行の冪等性・並行発行・公開APIのステータスとヘッダ（`docs/testing/battle-replay-api/baseline.md` の
  TC-BRA-028〜032・036 が対象）
- 再生画面そのものの挙動（`docs/testing/battle-replay-ui/baseline.md`）。公開ページは `ReplayPlayer` を
  そのまま再利用しており、再生ロジックは共通
- `window.history.replaceState` が履歴を積まないことの確認（ブラウザ標準の挙動。今回は実測していない）
