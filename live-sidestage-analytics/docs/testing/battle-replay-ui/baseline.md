---
last_updated: 2026-09-09
last_risk: LOW
last_reviewers: [Code Mode]DeepSeek単独、[TestCase Mode]DeepSeek単独、2026-09-09 常設WINバッジの終了前誤表示バグ修正時
---

# バトル再生UI

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

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
| TC-BRU-060 | 常設 WIN バッジはバトル終了前(`elapsedMs < durationMs`)は出ない | `ReplayCell` の `battleEnded` | 回帰/境界 | 勝者側セルを再生開始直後(`elapsedMs=0`)へシーク | `.replay-win` が DOM に無い。終了(`elapsedMs>=durationMs`)後は表示される | `[pw]` | PASS | `isWinner` はスコア確定時点で静的に決まるため、終了判定を欠くと再生開始直後から WIN が出る |
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
| TC-BRU-037 | ボーナスタイムの帯に残り秒数が出る | `ReplayBand` | 正常 | ボーナス区間 150,000〜180,000ms のバトルを 160,000ms へシーク | 帯が `ボーナス×3倍 残り 20秒` を表示する | `[pw]` | PASS | 終了時刻は TikTok の実測値なので残り秒数を出してよい |
| TC-BRU-038 | 貢献者ボードは自分(`isSelf`)への貢献だけを集計する | `contributorsAt` | 回帰 | 相手側へ 9999 ダイヤ・自分へ 100 ダイヤ | 相手陣営の送信者がボードに出ない（自分への送信者のみ） | `[unit]` / `[pw]` | PASS | 全 anchor を合算すると相手の貢献者一覧が出る（実バトル画面の下段は自分への一覧） |
| TC-BRU-044 | `selfAnchorIndexes` は participant.isSelf を優先し、無いときは team.isSelf へフォールバックする | `selfAnchorIndexes` | 正常/回帰/データ欠損 | ①自陣営が `teams[1]` ②participant.isSelf が全件 false で team.isSelf のみ true | ①`anchors` の通し添字 `{1}` ②自陣営全員の添字を返し、ボードが空にならない | `[unit]` | PASS | 空集合を返すと貢献者ボードが無言で空になる |
| TC-BRU-039 | 自分の枠が常に左上に来る | `battle-replay.ts` の `buildPayload` / `ReplayStage` | 回帰/境界 | チーム内で `position 0` が相手、`position 1` が自分の 2vs2 | 先頭セルが自分。`anchors` の添字と `scorePoints` / `giftEvents` の `a` の対応が崩れない | `[unit]` / `[pw]` | PASS | 並べ替えはサーバー側で行う（添字の正本が `anchors` のため） |
| TC-BRU-040 | 再生開始時の既定は 4倍速 + 自動早送り ON | `useReplayClock` / `ReplayControls` | 正常 | 再生画面へ入った直後 | 速度チップが `4×`、無風トグルが ON 表示（`aria-pressed="true"`） | `[pw]` | PASS | 5分バトルを等倍で見るのは長い（ユーザー指示） |
| TC-BRU-041 | 無風区間は自動で早送りされ、赤帯の区間は飛ばさない | `quietRangesOf` / `isQuietAt` | 正常/境界 | ギフトが 5 秒以上途切れる区間、および赤帯と重なる無風区間 | 5秒以上の切れ目だけが無風。次のカードの1秒前で解除。赤帯の区間は無風から除外される。5分・ギフト167〜398件のバトルで無風が尺の 9〜15% を占める（8秒判定では 0〜7% しか出ず体感できなかった）。ローカルシードの `quiet` バトル（開始 3 分ギフト 0 件）では 1,000 / 60,000 / 120,000 / 175,000ms が無風、190,000ms は通常 | `[unit]` `[pw]` | PASS | 帯を飛ばすと「初めてのギフト×N」を見逃す |
| TC-BRU-042 | 自動早送りを OFF にすると等速に戻り、位置は飛ばない | `useReplayClock` | 状態遷移/回帰 | 無風区間の再生中にトグルを OFF | トグル直前と直後に読んだ経過時間の差が 200ms 未満（基準点の張り直し誤差のみ）。以後の 1 秒あたりの進みが速度チップの倍率と一致する | `[pw]` | PASS | 倍率が変わる瞬間に基準点を張り直さないと位置が飛ぶ |
| TC-BRU-043 | 残り時間は視覚表示せず、シークバーの `aria-valuetext` で読み上げられる | `ReplayControls` | 正常/回帰/アクセシビリティ | 再生中の任意の位置 | 画面上に `-mm:ss` の可視ラベルは無い（シークバー幅を確保するため撤去、2026-09-08）。シークバー(`input[type=range]`)の `aria-valuetext` が `残りmm:ss` を返す | `[pw]` | PASS(2026-09-08、`aria-valuetext` 実測) | 削除前は可視ラベルのみで、スクリーンリーダー利用者への代替手段が無かった（review-auto DeepSeek指摘） |
| TC-BRU-045 | スコアバーのセグメント幅は即時切り替えではなくアニメーションで伸び縮みする | `ReplayScoreBar` / `.replay-seg` | 正常/境界/回帰 | ①4倍速で再生中 ②シークバーのつまみを掴んで移動 | ①スコアが動いた直後、セグメント幅が中間値を経て新しい比率へ到達する（補間時間は 420ms を実効速度で割った値） ②掴んでいる間は補間 0ms で即時追従し、つまみが幅の追従を待たない | `[pw]` | PASS（1倍速で 127.5→210→285→347→394→429→455→468px の7フレーム補間を実測。scrub 中 `0s` / 解放後 `0.42s`） | 補間時間を速度で割らないと 16 倍速で常に追いつかず、表示と実スコアがずれる |
| TC-BRU-048 | 自動早送り中は速度チップが実効倍率を出す | `ReplayControls` | 正常/状態遷移 | 4倍速 + Auto ON で、無風区間 / 通常区間へシーク | 無風区間ではチップが `16×`（速度 × ブースト4）になり、点滅とアクセント色で強調される。通常区間では `4×` と既定色に戻る。`prefers-reduced-motion: reduce` では点滅が止まる（`animation-name: none`）が、倍率の表示自体は残る | `[pw]` | PASS（無風=`16×` / 通常=`4×` / reduced-motion で `animation-name: none`） | 無風区間は5〜10秒と短く、残り時間の点滅だけでは早送りが効いたか判らない |
| TC-BRU-047 | ステージ中央の時計は残り時間のカウントダウン | `ReplayScoreBar` | 正常/境界 | 5分バトルの先頭 / 再生位置 30 秒 / 末尾 | 先頭で `05:00`、30 秒地点で `04:30`、末尾で `00:00`（`00:00` 開始のカウントアップではない）。末尾到達後も表示は `00:00` に留まり、`durationMs` を超えて負値・経過表示にならない | `[pw]` | PASS(2026-09-08、末尾超過シークでも `00:00` クランプを実測) | 実バトル画面と同じ向き。尺を超えても負値にしない |
| TC-BRU-046 | `prefers-reduced-motion: reduce` ではスコアバーが補間せず即座に新しい幅になる | `.replay-seg` の `@media (prefers-reduced-motion: reduce)` | 異常系/回帰 | `reducedMotion: "reduce"` のブラウザコンテキストで再生 | セグメントの `transition-property` が `none`。幅の変化が中間値を経ず1フレームで到達する | `[pw]` | PASS（`transition-property=none`、幅の観測値が 400ms 間 1 種類のみ） | 補間時間は速度連動のインライン値なので、ここを止めるのは CSS の media query 側だけ |
| TC-BRU-049 | ギフトカードのギフト画像に背景色を敷かない | `.replay-thumb` | 正常/回帰 | 画像付きギフトのカードが出ている位置へシーク | `img.replay-thumb` の `background-image` が `none` / `background-color` が透明で、`object-fit: contain`。画像が取れないときのプレースホルダ（`span.replay-thumb`）にだけ面が出る | `[pw]` | PASS（`bgImage=none` / `bgColor=rgba(0,0,0,0)` / `object-fit=contain`） | 透過PNGの下にオレンジのグラデーションを敷いていて絵が読めなかった |
| TC-BRU-050 | 10,000コイン以上のギフトは配信者枠いっぱいの画像で演出する | `bigGiftsByAnchor` / `.replay-biggift` | 正常/境界/異常系 | ①該当ギフトの発生位置へシーク ②`BIG_GIFT_DURATION_MS` を過ぎた位置 ③1,000コイン未満のギフト ④カード表示上限を超えた枠 | ①枠の 88% までギフト画像が出て揺れ、配信者アイコンが `opacity: 0` で隠れる。演出の尺は再生速度で割られる ②演出が消えて配信者アイコンが戻る ③演出を出さない ④上限で押し出されても演出は出る | `[pw]` `[unit]` | PASS（実測: 画像幅 = セル幅の 0.738、`.replay-cell--biggift` あり、`.replay-host` の `opacity=0`、尺+4000ms で要素数 0。境界・上限は unit で固定） | ギフト画像が無いギフトでは演出を出さない（アイコンだけ消えるのを防ぐ） |
| TC-BRU-055 | 1,000〜9,999コインのギフトは半分の大きさで演出し、配信者アイコンを隠さない | `bigGiftTierOf` / `.replay-biggift--mid` | 正常/境界 | ①該当ギフトの発生位置へシーク ②999コインのギフト ③同じ枠で 10,000コイン以上と重なった位置、およびその逆順 | ①枠の 44%（10,000コイン以上の半分）でギフト画像が出て揺れ、配信者アイコンは見えたまま。出入りと尺は 10,000コイン以上と同じ ②演出を出さない ③どちらの順でも 10,000コイン以上の演出が表示され、配信者アイコンが隠れる | `[pw]` `[unit]` | PASS（実測: mid の画像幅 = セル幅の 0.351 で big の 0.738 の約半分、`.replay-cell--biggift` なし・`.replay-host` の `opacity=1`、尺+4000ms で要素数 0。999コイン境界と段の優先は unit で固定） | 額の段が上のギフトを、後から来た下の段のギフトが押しのけないこと |
| TC-BRU-052 | 大ギフト演出の出入りは一時停止・シークでも再生位置に従う | `bigGiftPhase` / `.replay-biggift` | 異常系/回帰 | 一時停止したまま演出の区間へシークし、実時間で 2.5 秒待つ。さらに区間の後半・区間外へシーク | 待っても演出は消えず、`opacity` が再生位置に応じた値のまま（立ち上がり 0.26 → 後半 0.12 と単調減少）。区間を出ると要素ごと消え、配信者アイコンが戻る | `[pw]` | PASS（一時停止2.5秒後 `opacity=0.257` / +3000ms `0.121` / +3600ms 要素数 0） | CSS アニメは実時間で走り切るため、一時停止中に `opacity: 0` の演出が残り配信者アイコンだけ消えていた |
| TC-BRU-051 | 自動早送り中はステージ上部の時計チップも点滅する | `ReplayScoreBar` / `.replay-clock--boost` | 正常/状態遷移 | 無風区間 / 通常区間へシーク。`prefers-reduced-motion: reduce` でも確認 | 無風区間では時計が `--replay-gold`（`rgb(245,196,81)`）の文字色 + 同色 1px の内側リングになり `replay-clock-blink` で点滅する。通常区間では既定の白に戻り `animation-name: none`。reduced-motion では点滅しないが色は残る | `[pw]` | PASS（無風で `replay-clock--boost` / `rgb(245,196,81)` / 点滅、通常で `none`、reduced-motion で `animation-name: none`） | 時計だけ速く進むので、色が変わらないと早送り中か判らない |
| TC-BRU-053 | 残り時間の時計はスコアバーと重ならない | `.replay-clock` / `.replay-scorebar` | 正常/回帰 | 再生を開始して一時停止し、時計・スコアバー・各セグメントの矩形を測る | 時計の上端がスコアバーの下端より下にあり、どのセグメントとも矩形が交差しない。時計自体は読める | `[pw]` | PASS（実測: バー下端 143 / 時計 149〜169.5、`overlapBar=false` / `overlapSeg=false`） | 以前はバー中央に重ねていてスコア数値と時計が互いに潰し合っていた |
| TC-BRU-054 | 1vs1 の配信者アイコンは左右等寸 | `buildStageLayout` / `.replay-avatar--lg` | 正常/回帰 | 1vs1 のバトルと 4コラボのバトルをそれぞれ再生し、各セルのアイコンの実寸を測る | 1vs1 は左右とも 128px。4コラボは全枠 96px。3コラボ・1vs3 は自陣のみ 128px（相手枠は縦が狭いため） | `[pw]` `[unit]` | PASS（実測: 1vs1 = 128/128、4コラボ = 96×4。variant ごとの `largeAvatar` は unit で固定） | 以前は 1vs1 でも自分だけ 128px で、枠の広さが同じなのに非対称に見えていた |
| TC-BRU-056 | バトル終了時、時計は `00:00` のまま点滅して終了をひと目で示す | `ReplayScoreBar` | 正常/回帰 | 末尾へシーク | `.replay-clock` に `replay-clock--ended` が付与され点滅する。表示文字列は `00:00` のまま | `[pw]` | PASS(2026-09-08 実測) | 即座停止だけでは「終わって止まった」のか「固まった」のか見分けが付かなかった(ユーザー指摘) |
| TC-BRU-057 | 終了直後、勝者側に大きく WIN が出てから常設の小バッジ位置へ移動・縮小する | `ReplayCell` の `winRevealPhase` | 正常/回帰/境界 | 勝者側セルを末尾直前からシークし、200ms刻みで観測 | 終了(`elapsedMs>=durationMs`)から900msで中央に出現(opacity/scaleが単調増加)、続く650msで右上の常設バッジ位置へ移動しながら縮小、以後は既存の小さい `.replay-win` バッジのみに収束する。一時停止・シークでも同じ計算式で位置が決まる（`elapsedMs` の純関数） | `[pw]` | PASS(2026-09-08 実測: 中央 opacity 0.12→0.86 / 移動後 top 48%→12%, left 51%→88%, scale 0.98→0.47) | ひっそり小バッジが出るだけでは勝敗が分かりにくいというユーザー指摘への対応 |
| TC-BRU-058 | 演出計算用の経過時間は末尾超過後も進み続けるが、時計・シークバー等の表示は `durationMs` でクランプされる | `BattleReplayView` の `displayElapsedMs` | 境界/回帰 | 末尾到達後(`END_FADE_MS` 猶予中)の任意の時点 | `ReplayCell` 等の演出計算には生の `elapsedMs`(`durationMs` 超過値)が渡り自然消滅を計算できる一方、時計・シークバーの表示は `durationMs` を超えない | `[pw]` | PASS(2026-09-08、TC-BRU-047/056の実測がこの分離の裏付け) | 表示専用のクランプが無いと時計が `00:00` を超えて表示されてしまう |
| TC-BRU-059 | 終了間際に発生した大ギフト演出・カード・リップルは、終了後も自然に消滅する（残留しない） | `useReplayClock` の `END_FADE_MS` | 境界/回帰 | 終了直前(リップルが表示中の位置)へシークし、猶予期間(4200ms超)だけ実時間で待つ | 大ギフト演出・カード・リップル(`.replay-ring`)が猶予期間中に自然消滅し、要素数が0になる。演出が終了の瞬間の見た目のまま固まらない | `[pw]` | PASS(2026-09-08 実測: シーク直後 `ringCount:3` → 7秒後 `ringCount:0, bigGiftCount:0`) | 即座停止(旧実装)では末尾間際の演出が消滅計算を完了できず画面に残り続けていた(ユーザー指摘) |
| TC-BRU-023 | 実装が凍結済みの視覚契約から外れていない | 再生画面全体 | 視覚契約 | `comp.png` と同条件(1280px / dark / reduced-motion) | 領域ごとに `spec.md` の数値と一致。要素・挙動インベントリに欠落なし。`MAJOR` ゼロ | `[vqa]` | PASS | ユーザー指示で契約側を更新した5点（カードのギフト画像の背景撤去 / 大ギフト演出 / 時計の点滅 / 時計をバー直下へ / 1vs1 のアイコン 128px）は `comp.png` より `spec.md` 本文が優先。初回は MAJOR 2件(ヘッダの表題・副題が契約と別物 / 順位バッジと WIN バッジの振り分け違反)を修正して再撮影。MINOR 1件(1vs1 で長いギフト名のとき全幅レーンのカードが名前チップへわずかに掛かる。CSS は spec どおりでデータ依存)は残置。色トークンだけ反映され余白・タイポ・密度が既定へ丸まる乖離を明示的に疑う |

## Quality Gate

`npm run typecheck` / `npm run test:unit` / `npx next build`（`npm run build` は `prisma db push` を伴うので使わない）。

## Out of Scope

- シェアボタン・公開ページ `/b/[token]`（`docs/testing/battle-replay-share/baseline.md` が対象）
- `useReplayClock` の hook 単体テスト。このリポジトリに React コンポーネント/hook のテスト基盤
  （jsdom・testing-library）が無く、この差分で依存を足す判断はしていない。時計の挙動は TC-BRU-005 /
  TC-BRU-006 の実ブラウザ操作で担保する
