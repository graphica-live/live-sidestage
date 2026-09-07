---
last_updated: 2026-09-07
last_risk: HIGH
last_reviewers: [deepseek-v4-flash, fable]
---

# バトル再生UI

対象: `src/components/analytics/battle-replay/`（`BattleReplayView` / `ReplayStage` / `ReplayCell` /
`ReplayGiftCard` / `ReplayOdometer` / `ReplayScoreBar` / `ReplayBand` / `ReplayContributorBoard` /
`ReplayControls` / `useReplayClock` / 純関数 `replay-select` `replay-layout` `replay-format` `replay-color`）、
`src/components/analytics/BattleDetailModal.tsx` の `mode: "list" | "replay"`、
`src/components/analytics/battle-colors.ts`、`src/app/globals.css` の `.replay-*`。

ペイロードを**作る側**は `docs/testing/battle-replay-api/baseline.md`、
**確定時に残す側**は `docs/testing/battle-replay-data/baseline.md`。
ここで保証するのは**受け取ったペイロードが画面としてどう見えるか・どう操作できるか**。

視覚契約は `.impeccable/approved/battle-replay/spec.md` + `comp.png`（凍結済み）。

実行方法の略記:

- `[unit]` = `npx vitest run src/components/analytics/battle-replay/replay-select.test.ts`
- `[color]` = `npx vitest run src/components/analytics/battle-colors.test.ts`
- `[pw]` = Playwright スクラッチスクリプト（`.cjs`、`playwright` を絶対パスで require）。
  `npm run dev:local` を `PORT=3100` で起動し、`/analytics` のバトル履歴タブからモーダルを開いて操作する。
  前提コマンドは `docker compose up -d db` → `npm run db:push:local` → `npm run seed:local` →
  `npm run seed:battle-replay:local`（シードは `seed-replay-quad` / `seed-replay-duo` /
  `seed-replay-oneside` / `seed-replay-noscore` の4本。最後の1本だけ `replay.available: false`）
- `[inject]` = `[pw]` と同じ構成で、`page.route()` により `/api/analytics/battles/*/replay` の応答を
  差し替える（HTTP 500 / `version` 不一致 / `truncated` / 陣営構成の合成）。シードでは作れない状態を再現する
- `[vqa]` = `visual-qa` Compare Mode（`comp.png` と同条件 = 1280px / dark / reduced-motion で撮って領域ごとに照合）

## テストケース

| # | ケース | 対象 | 種別 | 前提 | 期待結果 | 実行方法 | 結果 | 備考 |
| - | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-BRU-001 | 再生可能なバトルは再生ボタンが押せ、押すと再生画面へ入る | `BattleDetailModal` | 正常 | 確定済み・スコア点ありのバトル | ボタン活性。押下でステージ・コントロール・貢献者ボードが出る | `[pw]` | PASS | |
| TC-BRU-002 | 再生不可バトルはボタンを無効化し、理由文を画面に出す（非表示にしない） | `BattleDetailModal` | 異常 | `replay.available: false` のバトル | `aria-disabled` かつ理由文が可視。`aria-describedby` で結びつく | `[pw]` | PASS | `title` だけだとスクリーンリーダー・タッチで読めない |
| TC-BRU-003 | 再生モードでは VSカードと貢献者一覧が消え、戻るボタンで元へ戻る | `BattleDetailModal` | 正常/状態遷移 | 再生モード中 | 再生中は貢献者一覧が DOM に無い。戻ると再生画面が消え一覧が戻る | `[pw]` | PASS | 隠れた列を30Hzで再描画させないための構造 |
| TC-BRU-004 | Esc は再生中ならモーダルを閉じず一覧モードへ戻す | `BattleDetailModal` | 境界/回帰 | 再生モード中 / 一覧モード中 | 再生中の Esc は一覧へ。一覧での Esc はモーダルを閉じる | `[pw]` | PASS | 一段で閉じると再生位置が失われる |
| TC-BRU-005 | 再生・一時停止・シーク・速度変更で経過時間が期待どおり動く | `useReplayClock` / `ReplayControls` | 正常 | 再生画面 | 再生で経過時間が進む / 一時停止で止まる / シークで即その位置 / 2x で約2倍速 / 先頭へで 00:00 | `[pw]` | PASS | 描画は `elapsedMs` の純関数で累積状態を持たない |
| TC-BRU-006 | シーク操作中は時計側の反映を止め、離したら必ず再開する | `ReplayControls` | 回帰 | 再生中にシークつまみを掴んだまま外へ離す | つまみの位置が時計に奪われない。ポインタが外れても「再生中なのに進まない」状態にならない | `[pw]` | PASS | `pointercancel` / `lostpointercapture` / `blur` の解除経路 |
| TC-BRU-007 | スコアバーは補間せず、`t <= elapsedMs` の最後の点をそのまま出す | `scoresAt` | 正常/境界 | 点が 0ms / 10,000ms / 20,000ms | 9,999ms では前の点。15,000ms で更新。末尾以降は最終値 | `[unit]` | PASS | 公式スコアは階段関数 |
| TC-BRU-008 | 貢献値は切り捨てで省略表記する。表記の切り替え境界を取り違えない | `formatShortAmount` | 境界 | 0 / 999 / 1000 / 1299 / 9999 / 10000 / 31999 / 999999 / 1000000 / 1899999 / 10000000 / 12999999 | `0` `999` `1.0k` `1.2k` `9.9k` `10k` `31k` `999k` `1.0M` `1.8M` `10M` `12M` | `[unit]` | PASS | 四捨五入しない。並べ替え・比較は生値で行う |
| TC-BRU-009 | 経過時間は `mm:ss`。負値・NaN は `00:00` へ丸める | `formatClock` | 異常/境界 | -5 / NaN / 172,000 | `00:00` `00:00` `02:52` | `[unit]` | PASS | |
| TC-BRU-010 | 同じコンボのイベントは1枚のカードへ畳み、連打数とダイヤを足す | `buildCards` | 正常 | 同一 `k` が2件 + 別イベント1件 | 2枚。畳んだ側は `count: 3` / `diamonds: 30` / コンボ区間長を保持 | `[unit]` | PASS | 鍵はサーバー側の `anchor|sender|giftId|groupId` |
| TC-BRU-011 | オドメーターはコンボの刻みに合わせて上がり、単発は最初から最終値 | `comboCountAt` | 正常/境界 | コンボ(1→3) と単発(×5) | コンボは 1 → 3 → 4 と進む。単発は t=0 から 5 | `[unit]` | PASS | 畳み込み後の最終値をいきなり出さない |
| TC-BRU-012 | 表示時間(4000ms)を過ぎたカードは消える。出現・消滅の境界ちょうど | `cardsAt` | 境界 | 出現1000ms のカード | 999ms で0枚 / 1000ms で1枚 / 5000ms で0枚 | `[unit]` | PASS | |
| TC-BRU-013 | 貢献者は金額降順に並び、まだ到達していないコンボ分を加算しない | `contributorsAt` | 正常/回帰 | コンボ2回 + 単発 | t=0 は単発の送信者が1位。t=2000 でコンボ側が 200 で1位 | `[unit]` | PASS | 未来のギフトを先取りすると順位が破綻する |
| TC-BRU-014 | 貢献者ボードは順位が入れ替わっても全員が別々の位置に見える | `ReplayContributorBoard` | 回帰 | 6人が入れ替わりながら投げるシード | 再生中どの時点でも貢献者が1人へ潰れない。各アイコンの座標が重ならない | `[pw]` | PASS | FLIP の基準を transform 込みの矩形で採ると毎フレーム差分が積み上がり全員が1点へ収束する |
| TC-BRU-015 | 赤帯は該当区間だけ出て、重複時は `opening` を優先する | `segmentAt` | 境界 | opening(0-48s) と bonus(0-60s) | 10,000ms は opening / 50,000ms は bonus / 90,000ms は帯なし | `[unit]` | PASS | 帯が無い時間帯は行ごと出さない |
| TC-BRU-016 | 陣営構成ごとにステージの割り方が変わる（5バリアント） | `buildStageLayout` | 正常 | 1vs1 / 3コラボ / 4コラボ / 2vs2 / 1vs3 | `duo`(全幅レーン) / `trio` / `quad` / `team22` / `one3`。左右の振り分けと相手カード縮小が構成ごとに一致 | `[unit]` | PASS | comp の5バリアントすべてが契約対象 |
| TC-BRU-017 | 自陣が `teams` の先頭でなくても自分が左枠・大アイコンになる | `buildStageLayout` | 回帰 | `teams[0].isSelf === false` の 1vs1 | 先頭セルが自陣。`right: false` / `largeAvatar: true` | `[unit]` | PASS | 配列の並びに依存すると、順序が変わった瞬間に自分が右枠へ回り気づけない |
| TC-BRU-018 | WIN バッジは陣営の公式スコアで決め、同点・スコア未確定では出さない | `resolveWinningTeamIndex` / `ReplayStage` | 回帰/境界 | 陣営スコア 5000 vs 9000 / 同点 / 確定陣営1つ以下 | 最大スコアの陣営のみ WIN。同点と確定2陣営未満は null。再生画面でも最終スコア最大の枠にだけ出る | `[color]` / `[pw]` | PASS | 個人スコア基準にすると「負け陣営の最多貢献メンバー」に WIN が付き、一覧・詳細モーダルと食い違う |
| TC-BRU-019 | 陣営色は自陣=赤固定、相手はバトルスコア降順で青→橙→紫 | `assignFactionColors` | 回帰 | 自陣 + 相手3(うち1つはスコア null) | 自陣 `#fe4d4d`。相手はスコア降順に `#4d9fff` `#ffa64d` `#b98aff`。スコア null は最後尾 | `[color]` | PASS | 一覧・詳細モーダルと同じ関数を通ることが色一致の唯一の根拠。サーバーは色を返さない |
| TC-BRU-020 | 相手陣営のギフト明細が無くても再生でき、注記が出る | `BattleReplayView` | データ欠損 | `opponentGiftsMissing: true` のバトル | 自陣側のカードだけ流れ、注記チップが可視。再生自体は止まらない | `[pw]` | PASS | 相手room未監視のバトルが多数を占める |
| TC-BRU-021 | 貢献者がまだ0人の時点でもボードの領域は残る | `ReplayContributorBoard` | empty state | 再生位置 t=0 | ボードの高さが保たれ、空文言が出る。下のコントロールが上下に飛ばない | `[pw]` | PASS | |
| TC-BRU-022 | PC幅・スマホ幅のどちらでも横スクロールが発生しない | 再生画面全体 | デバイス差/境界 | 1280px / 640px / 639px / 375px | いずれも `document.scrollingElement` の横スクロールが無く、ステージ・コントロール・貢献者ボードが画面内に収まる | `[pw]` | PASS | 640px が既存レイアウトの breakpoint |
| TC-BRU-035 | 枠のバッジは陣営構成で振り分ける（3陣営以上=順位 / 1vs1・チーム戦=WIN） | `ReplayStage` / `ReplayCell` | 回帰/境界 | 4コラボ(3陣営以上) / 1vs1 / 2vs2 | 3陣営以上は順位バッジのみで WIN なし。1vs1・チーム戦は WIN のみで順位バッジなし | `[pw]` / `[inject]` | PASS | チーム戦で個人順位を出すと「勝ち陣営の下位メンバー」に負けの見た目が付く |
| TC-BRU-036 | 再生モードのヘッダはバトル名と開始日時・尺を出す | `BattleDetailModal` / `replayTitleOf` | 正常/境界 | 1vs1 / 3人以上 / 陣営未解決 | `{自分} vs {相手}` / `{自分} × N人バトル` / 自分の名前のみ。副題は開始日時 ・ `mm:ss` の尺 | `[unit]` / `[pw]` | PASS | 尺はペイロードを読むまで判らないので再生画面から1回だけ受け取る |
| TC-BRU-024 | 貢献者アイコンにもコイン額連動のリップルが出る | `ReplayContributorBoard` | 正常 | ギフト着弾直後の貢献者 | 着弾中の貢献者にリップル要素が付き、額が大きいほど倍率(`--replay-ripple`)が大きい | `[pw]` / `[unit]` | PASS | 配信者アイコンと同じ演出をユーザーが明示指定 |
| TC-BRU-025 | 30Hz の再描画中もフォーカスとシーク操作を奪わない | `BattleReplayView` | 回帰 | 再生中に速度ボタンへフォーカス | 毎フレームの再描画後もフォーカスが body へ戻らない。連続クリックが取りこぼされない | `[pw]` | PASS | 再生状態を親へ持ち上げると起きる |
| TC-BRU-026 | バトル一覧の定期ポーリングで再生モードが解除されない | `BattleDetailModal` | 回帰 | 再生モードのまま一覧の再取得が走る時間だけ待つ | 再生画面のまま。再生位置が先頭へ戻らない | `[pw]` | PASS | 一覧の再取得でモーダルの state を作り直すと落ちる |
| TC-BRU-027 | 別のバトルを開くと必ず一覧モードから始まる | `BattleDetailModal` | 状態遷移 | 再生モードで閉じ、別のバトルを開く | 直前のモードを引き継がず貢献者一覧が出る | `[pw]` | PASS | モードがバトルをまたいで残ると別バトルの再生に見える |
| TC-BRU-028 | 再生データの取得失敗時はステージの高さを保ったままエラー文と再試行を出す | `BattleReplayView` | 異常 | `/replay` が HTTP 500 | エラー文と「再試行」が可視。ステージ高さが保たれる。再試行で再生画面が出る | `[inject]` | PASS | 高さが潰れると下のコントロールが飛ぶ |
| TC-BRU-029 | ペイロードの `version` が想定と違うときは再生画面を描かない | `BattleReplayView` | 異常/境界 | `version: 999` | 再読み込みを促す文言のみ。ステージ・コントロールは出さない | `[inject]` | PASS | 古いクライアントが新形式を誤って描くのを防ぐ |
| TC-BRU-030 | `truncated` と初回ボーナス推定は注記チップで出し、推定は赤帯にしない | `BattleReplayView` / `isBandSegment` | データ欠損/境界 | `truncated: true` かつ `opening.confidence: "inferred"` | 省略の注記と「(推定)」チップが可視。赤帯は出ない | `[inject]` / `[unit]` | PASS | 推定を事実として見せない（設計レビュー F5-3） |
| TC-BRU-031 | シードに無い陣営構成(3コラボ / 2vs2 / 1vs3)でもステージが崩れない | `ReplayStage` | 正常/デバイス差 | ペイロードの `teams` を各構成へ差し替え | グリッドが `trio` / `team22` / `one3` になり、セル数が参加者数と一致する | `[inject]` | PASS | シードは 1vs1 / 4コラボしか持たない |
| TC-BRU-032 | 表示上限(各サイド5枚・貢献者6人)を超えても新しい方が残る | `cardsByAnchor` / `contributorsAt` | 境界 | 同時に7枚・8人 | カードは各アンカー5枚まで、貢献者は6人まで。切り捨てるのは古い方・下位の方 | `[unit]` | PASS | 上限が無いとステージが溢れる |
| TC-BRU-033 | カードの太さはダイヤ額で決まり、アイコンは名前の頭文字で代替する | `cardSizeOf` / `initialOf` | 境界 | 99 / 100 / 999 / 1000 ダイヤ、アバターなしの送信者 | `sm` / `md` / `md` / `lg`。アバターが無ければ頭文字1字 | `[unit]` | PASS | comp の上段(小額)・下段(高額)の作り分け |
| TC-BRU-034 | ギフトが1件も無いペイロードでも再生できる | `buildCards` ほか純関数 | empty state | `giftEvents: []` | カード0枚・貢献者0人で例外を出さない。スコアバーと帯は通常どおり | `[unit]` | PASS | 相手room未監視かつ自陣も無記録のバトル |
| TC-BRU-023 | 実装が凍結済みの視覚契約から外れていない | 再生画面全体 | 視覚契約 | `comp.png` と同条件(1280px / dark / reduced-motion) | 領域ごとに `spec.md` の数値と一致。要素・挙動インベントリに欠落なし。`MAJOR` ゼロ | `[vqa]` | FAIL→修正→PASS | MAJOR 2件(ヘッダの表題・副題が契約と別物 / 順位バッジと WIN バッジの振り分け違反)を修正して再撮影。MINOR 1件(1vs1 で長いギフト名のとき全幅レーンのカードが名前チップへわずかに掛かる。CSS は spec どおりでデータ依存)は残置。色トークンだけ反映され余白・タイポ・密度が既定へ丸まる乖離を明示的に疑う |

## Quality Gate

`npm run typecheck` / `npm run test:unit` / `npx next build`（`npm run build` は `prisma db push` を伴うので使わない）。

## Out of Scope

- シェアボタン・公開ページ（P6。この差分に実装が無い）
- `useReplayClock` の hook 単体テスト。このリポジトリに React コンポーネント/hook のテスト基盤
  （jsdom・testing-library）が無く、この差分で依存を足す判断はしていない。時計の挙動は TC-BRU-005 /
  TC-BRU-006 の実ブラウザ操作で担保する
