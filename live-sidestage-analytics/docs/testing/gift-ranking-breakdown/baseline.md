---
last_updated: 2026-09-07
last_risk: LOW
last_reviewers: [deepseek-v4-flash]
---

# 貢献ランキングのギフト内訳展開

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

対象: 貢献ランキングタブ（UI文言「ユーザー別コイン数」、`viewMode="ranking"`）の行を開いて、
そのユーザーが投げたギフトの名前別内訳を出す機能。

- 取得: `src/lib/gift-breakdown.ts`（`queryGiftBreakdown` / 純関数 `resolveBreakdownWindow`）
- API: `src/app/api/analytics/gifts/breakdown/route.ts`（配信者本人）と
  `src/app/api/admin/rooms/[roomId]/analytics/gifts/breakdown/route.ts`（管理者）
- UI: `src/components/analytics/AnalyticsView.tsx` の ranking テーブル（`GiftBreakdownPanel` ほか）、
  `src/app/globals.css` の `.breakdown-enter`

保持期間の分割ロジック（`planSplit` / `narrowToRawWindow` / ロールアップの読み出し境界）そのものは
`docs/testing/gift-retention/baseline.md` が保証する。ここで保証するのは
**内訳をどの範囲で出せるか・出せない期間をどう見せるか・画面としてどう操作できるか**。

視覚契約は `.impeccable/approved/analytics-ranking-breakdown/spec.md` + `comp.png`（凍結済み）。

実行方法の略記:

- `[unit]` = `npx vitest run src/lib/gift-breakdown.test.ts`
- `[itest]` = `npx dotenv -e .env.local.test -- vitest run src/lib/gift-breakdown.integration.test.ts`
  （前提: `docker compose up -d db` → `npm run db:push:local`）
- `[pw]` = Playwright スクラッチスクリプト（`.cjs`、`playwright` を絶対パスで require）。
  `npm run dev:local` を `PORT=3111` で起動し、`/analytics` の「ユーザー別コイン数」タブを操作する。
  前提は `npm run db:push:local` → `npm run seed:local`
- `[inject]` = `[pw]` と同じ構成で、`page.route()` により `/api/analytics/gifts/breakdown` の応答を
  差し替える（HTTP 500 / `coverage.detailAvailable: false` / `gifts: []` / 遅延）。シードでは作れない状態を再現する
- `[vqa]` = `visual-qa` Compare Mode（`comp.png` と同条件 = 1000px / light・dark で撮り、
  展開パネルの computed value を `spec.md` の数値と突き合わせる）

## テストケース

| # | ケース | 対象 | 種別 | 前提 | 期待結果 | 実行方法 | 結果 | 備考 |
| - | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-GRB-001 | ギフト名ごとに回数とコイン数を合算し、コイン数の降順で返す | `queryGiftBreakdown` | 正常 | 同一 giftId の行が複数 + 別 giftId | 同一 giftId は1行に畳まれ `repeatCount` / `totalDiamonds` が合算される。並びは `totalDiamonds` 降順 | `[itest]` | PASS | 一覧の合計コイン数と内訳の合計が一致することが利用者の期待 |
| TC-GRB-002 | 他ユーザーのギフトが内訳に混ざらない | `queryGiftBreakdown` | 回帰 | 同一 room に別 `uniqueId` の行がある | 指定ユーザーの giftId のみ返る。別ユーザーで引くとそのユーザーの分だけ返る | `[itest]` | PASS | 内訳は個人の送信履歴なので混入は情報漏えい |
| TC-GRB-003 | 期間外のギフトを含めない。0件と「明細が残っていない」を区別する | `queryGiftBreakdown` | 境界 | 範囲外の日にだけギフトがある | `gifts` は空、合計は0。ただし `coverage.detailAvailable` は `true` | `[itest]` | PASS | 0件と「保持期間外で読めない」を同じ見た目にすると原因が判らない |
| TC-GRB-004 | ギフト名はカタログの日本語名があればそれを出す | `queryGiftBreakdown` | 正常 | `TiktokGiftCatalog.labelJa` があるギフト | 受信時の英語名でなく `labelJa` が返る | `[itest]` | PASS | 日本語は表示専用。一致判定・集計キーは受信名のまま |
| TC-GRB-005 | 範囲が丸ごと保持期間内なら明細を全期間ぶん返す | `resolveBreakdownWindow` | 正常 | `planSplit` が `raw` | 範囲を狭めない。`detailAvailable: true` / `partial: false` | `[unit]` | PASS | |
| TC-GRB-006 | 範囲が保持境界をまたぐときは読める側だけへ絞り、絞ったことを示す | `resolveBreakdownWindow` | 境界 | 範囲の始点がカットオフより古く終点が新しい | 下限をカットオフへ引き上げる。`partial: true` / `rawFrom` にカットオフ日 | `[unit]` | PASS | 黙って一部だけ出すと「内訳の合計が合わない」と誤解される |
| TC-GRB-007 | 範囲全体が保持期間より古いときは明細なしとして返す（エラーにしない） | `resolveBreakdownWindow` | 異常/境界 | `dayKey` 範囲の終端 < カットオフ | クエリを投げず `detailAvailable: false` / `gifts` 空 | `[unit]` | PASS | ロールアップにはギフト名別の粒度が無い |
| TC-GRB-008 | `receivedAt` 指定でも、範囲全体が古ければ明細なしになる | `resolveBreakdownWindow` | 回帰/境界 | `receivedAt` 範囲の終端 < カットオフ | `detailAvailable: false`。「0件」で返さない | `[unit]` | PASS | `narrowToRawWindow` は `receivedAt` 指定では null を返さないので、そのままだと0件に化ける |
| TC-GRB-009 | 配信者本人の API は自分の room の内訳しか返さない | `/api/analytics/gifts/breakdown` | 認可 | ログイン済み配信者 | セッションから引いた `roomId` で集計する。URL から roomId を受け取らない | `[pw]` | PASS | roomId を受け付けると他配信者の内訳が読める |
| TC-GRB-010 | `uniqueId` が無いリクエストは 400 で返す | 両 API | 異常 | `uniqueId` を付けずに GET | HTTP 400。room 全体の内訳を返さない | `[pw]` | PASS | |
| TC-GRB-028 | 期間クエリは片側だけ・解釈できない日時を 400 で弾く | `parseBreakdownRange` | 異常/境界 | `startDatetime` のみ / `endDatetime` のみ / `2026-13-01` のような日時 | いずれも 400。黙って `period`/`date` の結果を返さない。Invalid Date を Prisma へ渡さない | `[unit]` | PASS | 片側だけを period へ落とすと、依頼した範囲と違う集計を「成功」として返す |
| TC-GRB-011 | 管理者 API は管理者セッションを要求し、URL の roomId を対象にする | `/api/admin/rooms/[roomId]/.../breakdown` | 認可 | 管理者セッションあり / なし | 管理者は指定 room の内訳を取得できる。非管理者は拒否される | `[pw]` | NOT RUN: ローカルに管理者アカウントのシードが無く、非管理者での拒否のみ実ブラウザで確認。集計本体は TC-GRB-001〜008 と共通の `queryGiftBreakdown` | 認可の実体は既存 `getAdminSession()` で、この差分で変更していない |
| TC-GRB-012 | 行をクリック/タップすると内訳が開き、もう一度で閉じる | `AnalyticsView` | 正常 | ランキングに行がある | 行直下に内訳パネルが出る。再クリックで消える | `[pw]` | PASS | |
| TC-GRB-013 | 同時に開くのは1行だけ | `AnalyticsView` | 状態遷移 | 1行開いた状態で別行をクリック | 開いている行は常に1つ（`aria-expanded="true"` が1個） | `[pw]` | PASS | 複数開くとランキングが読めなくなる |
| TC-GRB-014 | 行内の TikTok プロフィールリンクを押しても展開しない | `AnalyticsView` | 回帰 | 行が閉じた状態でリンクをクリック | 展開は起きない（`aria-expanded="true"` が0のまま） | `[pw]` | PASS | 行全体をトリガにすると、行内リンクが必ず巻き込まれる |
| TC-GRB-015 | キーボードだけで開閉できる | チェブロンボタン | アクセシビリティ | チェブロンへフォーカス | 実 `<button>` で `Enter` / `Space` が効く。`aria-expanded` / `aria-controls` がパネルを指す | `[pw]` | PASS | `<tr>` に `role="button"` を付けると行内リンクが入れ子の対話要素になる |
| TC-GRB-016 | 2回目以降の展開では再取得しない | `AnalyticsView` | 正常 | 同じ行を開く→閉じる→また開く | 2回目はネットワークリクエストが発生せず即描画 | `[pw]` | PASS | |
| TC-GRB-017 | 期間・範囲を変えるとキャッシュを捨て、開いていた行も閉じる | `AnalyticsView` | 状態遷移/回帰 | 行を開いたまま日付や期間種別を変更 | 内訳は閉じ、次に開いたとき新しい期間で取り直す | `[pw]` | PASS | 期間をまたいでキャッシュを使うと別期間の内訳が出る |
| TC-GRB-026 | 配信中の自動更新でランキングが変わったら、開いている内訳も追随する | `AnalyticsView` | 回帰 | 行を開いたまま15秒周期の自動更新が走る | 開いている行の内訳を取り直す。スケルトンへ戻さず表示を保ったまま差し替える。閉じている行のキャッシュは捨てる | `[pw]` | PASS | 追随しないと、行のコイン数と内訳の合計が配信中ずっと食い違う |
| TC-GRB-027 | 期間を往復（A→B→A）しても、遅れて届いた古い応答が新しい応答を上書きしない | `AnalyticsView` | 回帰/境界 | 1本目を6秒遅延させ、期間を往復して2本目（0.3秒）を投げる | 画面に残るのは常に2本目。1本目の到着で内容が巻き戻らない | `[inject]` | FAIL→修正→PASS | 期間の鍵は往復で同じ値に戻るため、鍵だけでは追い越しを検出できない。ユーザーごとの連番はスコープ変更でリセットしてはならない（リセットして一度 FAIL した） |
| TC-GRB-018 | 取得中はスケルトンを出し、パネルの高さを保つ | `GiftBreakdownPanel` | loading | 応答を遅延させる | スケルトン3本が出る。スピナーは使わない。下の行が上下に飛ばない | `[inject]` | PASS | |
| TC-GRB-019 | 明細が残っていない期間は理由文を出す（エラー表示にしない） | `GiftBreakdownPanel` | データ欠損 | `coverage.detailAvailable: false` | 「この期間の内訳は残っていません」と保持期間の説明が出る。再試行ボタンは出さない | `[inject]` | PASS | 90日超の期間は仕様どおりの状態であってエラーではない |
| TC-GRB-020 | 明細は読めたが0件の期間は空状態の文言を出す | `GiftBreakdownPanel` | empty state | `gifts: []` かつ `detailAvailable: true` | 「この期間の内訳はありません」1行。TC-GRB-019 と別の文言 | `[inject]` | PASS | |
| TC-GRB-021 | 取得失敗時はエラー文と再試行を出し、再試行で復帰する | `GiftBreakdownPanel` | 異常 | API が HTTP 500 | エラー文 + 再試行ボタン。押すと再取得する | `[inject]` | PASS | |
| TC-GRB-022 | 一部期間しか明細が無いときはその旨を注記する | `GiftBreakdownPanel` | 境界 | `coverage.partial: true` / `rawFrom` あり | ギフト一覧に加えて「YYYY-MM-DD 以降のみ」が出る | `[inject]` | PASS | 合計が一覧の値と合わない理由を画面で説明する |
| TC-GRB-023 | ギフト画像が無いギフトでも壊れた画像を出さない | `GiftBreakdownPanel` | データ欠損 | `giftPictureUrl: null` | 同サイズのプレースホルダ矩形になり、壊れ画像アイコンが出ない | `[inject]` | PASS | |
| TC-GRB-024 | PC幅・スマホ幅のどちらでも横スクロールが発生しない | 内訳パネル | デバイス差 | 1000px / 390px | 1000px・390px とも1カラム固定。どちらも横スクロールなし | `[pw]` | PASS | 2026-09-07: ユーザー指摘によりレイアウトを2カラム(sm以上)→1カラム固定へ変更。breakpoint分岐は廃止 |
| TC-GRB-025 | 実装が凍結済みの視覚契約から外れていない | ranking テーブル + 内訳パネル | 視覚契約 | `comp.png` と同条件（1000px / light・dark） | 余白・タイポ・色・角丸・情報密度が `spec.md` の数値と一致。要素・挙動インベントリに欠落なし。`MAJOR` ゼロ | `[vqa]` | FAIL→修正→PASS | MINOR 2件（スケルトンがパネル幅いっぱいで縞に見える / 再試行ボタンの padding が契約超過）を修正して再撮影。色トークンだけ反映され余白・タイポ・密度が既定へ丸まる乖離を明示的に疑った。2026-09-07: ユーザーフィードバックで要約行削除・1カラム固定へ`spec.md`側を更新(明示承認)、再照合PASS |
| TC-GRB-029 | 見出し右の要約「N種類・M回・X」を表示しない | `GiftBreakdownPanel` | 回帰 | 展開状態 | パネル見出しは「ギフト内訳」のみ。件数・回数・合計コインの要約テキストは出ない | `[pw]` | PASS | 2026-09-07追加。要約は一覧の合計コイン数と重複情報で、ユーザーから不要指摘 |

## Quality Gate

`npm run typecheck` / `npm run test:unit` / `npm run test:integration`。
`npm run build` は `prisma db push` を伴うのでローカル検証には使わない。
このプロジェクトに `lint` スクリプトは無い（`next lint` は設定が無く対話プロンプトになる）。

## Out of Scope

- 管理画面で対象 room を切り替えたときのスコープ判定。取得スコープ鍵に `apiBase` を含めて
  旧room の応答を捨てるようにしてあるが、ローカルに管理者アカウントのシードが無く実ブラウザで再現できていない
  （TC-GRB-011 と同じ理由）

- 内訳の CSV エクスポートへの反映（この差分に実装が無い。`spec.md` でも「未定義」として凍結）
- 内訳パネル内での並び替え・フィルタ（同上）
- ギフト種類が極端に多い場合のスクロール/省略挙動（`spec.md` で「全件表示」と決めたのみで上限を設けていない）
- `GiftDailyListenerStat` からギフト名別の内訳を復元すること（ロールアップに粒度が無く、
  スキーマ変更なしには不可能。保持期間の仕様自体は `docs/testing/gift-retention/baseline.md`）
