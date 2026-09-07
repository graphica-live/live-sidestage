# battle-replay — 視覚契約(凍結)

- surface: `battle-replay`（`BattleDetailModal` の `mode: "replay"`）
- comp: [comp.png](comp.png)（1280px viewport / deviceScaleFactor 2 / dark / reduced-motion）
- comp のソース: `.impeccable/mocks/decision/battle-replay-options.html`（採用構成の `section.option`。**案Aは廃止済み**）
- 継承元の凍結契約: `.impeccable/approved/battle-detail-contributors/spec.md`（陣営色の生HEX・`font-mono`・`bg-panel` / `border-white/10` / `rounded-xl`）
- 凍結日: 2026-09-07（再凍結）
- 変更履歴: 2026-09-07 初回凍結 → 同日、ユーザー指示により再凍結。**相手陣営もスライドイン**（セル内レーン化）/ 相手カードはリスナー名なし / 右側の枠は右→左スライドイン・色帯も右 / カード背景は内容長ぶん / 配信者プロフは縦中央維持 / コンボの `×N` をオドメーター / 貢献者ボードに FLIP / 貢献値に 🪙 と省略表記 / 上位3人へ順位バッジ / 見出し右端に「上位 ➡」/ 貢献者アイコンにもリップル / 案A廃止

comp は5バリアントを含む。**5つすべてが契約対象**。
`B-4`(4コラボ) / `B-3`(3コラボ) / `B-2`(2コラボ=1vs1) / `B-22`(2vs2チーム戦) / `B-13`(1vs3チーム戦)

**この文書の数値は実装契約。** 既存コンポーネント・保守性・工数を理由に丸めない。基準を下げられるのはユーザーの明示承認のみで、実装難易度は承認ではない。

---

## 1. 全体構造（縦の積み順）

上から順に、**固定でこの順序**。要素を入れ替えない。

1. `modal-bar` — タイトル / 日時・尺 / 「貢献者一覧へ戻る」
2. `scorebar` — 陣営セグメント + 中央の経過時間チップ
3. `grid` — 配信者枠（陣営数で割り方が変わる）。ギフトカードはこの中
4. `band` — 赤帯（倍率・ボーナス区間。無い時間帯は行ごと出さない）
5. `instruments` — 「この時点の貢献者」ボード
6. `controls` — 再生・シーク・速度（**パネル地の実バー。ステージへ被せない**）
7. 補助行 — シェア / 注記チップ

## 2. カラー（実測 HEX）

### 陣営色（`assignFactionColors` の出力をそのまま使う。サーバーは色を返さない）

| 役割 | HEX | 用途 |
| --- | --- | --- |
| 自陣営 | `#fe4d4d` | スコアバー左端 / 自枠のカード色帯 / 自枠リップル / シークの tick |
| 相手1（バトルスコア降順） | `#4d9fff` | 同上（相手枠） |
| 相手2 | `#ffa64d` | 同上 |
| 相手3 | `#b98aff` | 同上 |
| gold | `#f5c451` | `×N` / 1位の枠線・順位バッジ / WIN バッジ / グローブ(×6) |

### ステージ面（常時ダーク固定。テーマ追従させない）

`--stage: #0d0f13` / `--stage-2: #15181e` / `--stage-line: rgba(255,255,255,0.12)` / `--stage-text: #f3f4f7` / `--stage-muted: #9aa1b0`

その他: 枠下端のグラデーション `linear-gradient(180deg, rgba(13,15,19,0) 42%, rgba(13,15,19,0.85) 100%)` / カード背景（左入り）`linear-gradient(90deg, rgba(6,8,12,0.9), rgba(6,8,12,0.55))`・（右入り）`270deg` の同値 / 名前チップ `rgba(6,8,12,0.7)` / 経過時間チップ `rgba(6,8,12,0.82)` / 赤帯 `linear-gradient(90deg,#d81f36,#ff4d5e)` 文字 `#fff` / リスナーアイコン 地 `#2b303a` 文字 `#cfd4de` / グローブ `#fe4d4d`（`multiplierValue` 5）・`#f5c451`（6）。

ステージ外（モーダル外殻・貢献者ボード・コントロール）は `globals.css` のトークンに従う。

## 3. タイポ

数値は**必ず** `--mono`（`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`）。それ以外は `--sans`。

| 要素 | size | weight | 備考 |
| --- | --- | --- | --- |
| モーダルタイトル | 13px | 600 | `--strong` |
| モーダル副題（日時・尺） | 11px | — | mono / `--muted` |
| 戻るボタン | 12px | — | `--muted` |
| スコアバーの数値 | 11px | 700 | mono / 文字色 `#0d0f13` |
| 経過時間チップ | 11px | — | mono / `letter-spacing: 0.04em` |
| 配信者イニシャル | 34px（`.lg` 44px / 1vs3相手枠 27px） | 700 | `#fff` |
| 個人スコア | 15px | 700 | mono / `text-shadow: 0 1px 3px rgba(0,0,0,0.6)` |
| 順位・WIN バッジ（枠） | 10px | 700 | mono / 文字色 `#0d0f13` |
| 名前チップ | 11px | — | `#e8eaef` |
| カード: リスナー名 | 11px（`.sm` 10px / `.lg` 12px / セル内1行 9px） | — | `#fff` |
| カード: ギフト名 | 10px（`.sm` 9px / `.op` 9px） | — | `--stage-muted`（`.op` とセル内1行は `#dfe3ea`） |
| カード: `×N` | 12px（`.sm` 11px / `.lg` 14px / `.op` 10px / セル内1行 10px） | 700 | mono / gold |
| 赤帯 | 12px | 700 | 残り秒数のみ mono |
| コントロールの時刻・速度 | 11px | — | mono / `tabular-nums` |
| 見出し「この時点の貢献者」 | 10px | 600 | `letter-spacing: 0.1em` / uppercase / `--muted` |
| 貢献値 | 10px | 600 | mono / `tabular-nums` / `--strong` |
| 順位バッジ（貢献者） | 8px | 700 | mono / `line-height: 11px` |

## 4. レイアウトと寸法

### 4.1 モーダル外殻

`border-radius: 12px` / `border: 1px solid var(--border)` / 背景 `var(--panel)` / `overflow: hidden`。
ヘッダ `padding: 10px 14px`、下に `1px solid var(--row-border)`。戻るボタン `padding: 3px 9px` / `radius 8px`。

### 4.2 スコアバー

高さ **26px**。セグメント幅 = スコア比。セグメント内 `padding: 0 7px`、左端は左寄せ・右端は右寄せ。境目 `inset 1px 0 0 rgba(0,0,0,0.35)`。
経過時間チップは絶対配置で中央（`padding: 2px 9px` / `radius 999px`）。

### 4.3 陣営グリッド（**縦横比は実バトル画面の実測。計器のために縮めない**）

| 構成 | grid | セルの aspect-ratio |
| --- | --- | --- |
| 1vs1 (`duo`) | 2列 | `0.55` |
| 4コラボ (`quad`) | 2×2 | `1.09` |
| 3コラボ (`trio`) | 2列2行、左セルが `grid-row: 1 / span 2` | 左 `auto`（全高）/ 右 `1.09` |
| 2vs2 (`team22`) | 2×2、`column-gap: 4px` | `1.09` |
| 1vs3 (`one3`) | 2列3行、左セルが `grid-row: 1 / span 3`、`column-gap: 4px` | 左 `auto` / 右 `1.5` |

セル間の線は `gap: 1px` + 親背景 `--stage-line`。**チーム戦だけ列の境目を `column-gap: 4px`** にしてチームを割る。

配信者ブロックは**常にセルの縦中央**。アイコン 96px（`.lg` 128px / 1vs3 の相手枠 76px）・`border: 3px solid rgba(255,255,255,0.8)`・`radius 999px`、アイコンと個人スコアの間 `gap: 7px`。**枠には常に個人スコアを出す。**
順位バッジ `left: 7px; bottom: 7px` / 名前チップ `right: 7px; bottom: 7px`（`max-width: 62%` / `radius 999px` / `padding: 2px 9px`）/ WIN バッジ `right: 7px; top: 7px`。
順位バッジは**3陣営以上の個人戦のみ**。1vs1 とチーム戦は WIN バッジを使う。
**画面右側の枠だけ**名前チップを `left: 7px`、順位バッジを `right: 7px; top: 7px` へ入れ替える（右下がカードで埋まるため）。

### 4.4 ギフトスライドインカード

**1vs1（`duo`）はステージ全幅の2段レーン、3人以上のコラボとチーム戦はセル内レーン。** どちらも自陣・相手陣の**両方**にカードを出す。

- 全幅レーン（1vs1）: `bottom: 14px` / `padding: 0 10px` / 段間 `gap: 7px`、段内は左右に振り分け、同一側の縦積みは `gap: 4px`。上段=少額（`.sm`）、下段=高額（`.lg`）
- セル内レーン: `bottom: 26px` / `padding: 0 6px` / `gap: 4px`。**背景はカード内容の長さぶんだけ**（`align-items: flex-start`、右列は `flex-end`）。枠幅いっぱいに伸ばさない
- **縦が足りないセル**（`quad` 全セル / `team22` 全セル / `trio` の右2枠 / `one3` の相手3枠）は、配信者ブロックを中央に保ったまま、カードを**下端の1行**（`bottom: 7px` / `max-width: 58%`）へ寄せ、名前チップと同じ行に並べる。カードは1行構成（`.txt` を `flex-direction: row` にしてリスナー名とギフト名を横並び）

カード本体: `radius 4px 999px 999px 4px`（右入りは `999px 4px 4px 999px`）/ 左（右入りは右）に**3px の陣営色帯**（`.lg` は 4px）/ `padding: 4px 10px 4px 6px`（`.sm` `2px 8px 2px 5px` / `.lg` `6px 12px 6px 7px` / `.op` `2px 7px 2px 4px` / セル内1行 `1px 6px 1px 3px`）/ 要素間 `gap: 7px`（セル内1行は 5px）。
`max-width`: 通常 260px / `.sm` 216px / `.lg` 292px / `.op` 168px / `.op.lg` 216px / セル内 `100%`。
リスナーアイコン 24px（`.sm` 19px / `.lg` 28px / `.op` 16px / `.op.lg` 22px / セル内1行 15px）。ギフト画像 20px（`.sm` 16px / `.lg` 24px / `.op` 14px / `.op.lg` 19px / セル内1行 13px）`radius 4px`。グローブ 15px（`.lg` 18px / `.op` 12px / `.op.lg` 15px / セル内1行 11px）。

**相手陣営のカード（`.op`）は自分より一回り小さく、リスナー名を出さない**（アイコン + ギフト名 + `×N` のみ）。1vs1 だけは左右等寸で、相手側もリスナー名を出す。

同一側の同時表示は最大5本、超過時は新しい方を優先。滞留は `REPLAY_BAR_LIFETIME_MS`（4000ms）。

### 4.5 赤帯

`padding: 5px 12px` / `gap: 10px` / 中央寄せ。ステージ直下・貢献者ボードの上。
`showCountdown` のときだけ「残り{n}秒」。**`opening` は `confidence === "measured"` のときだけ帯にする**（`inferred` はチップ止まり）。

### 4.6 コントロール（パネル地の実バー。ステージへ被せない）

`padding: 9px 12px` / `gap: 10px` / 上に `1px solid var(--row-border)` / 背景 `var(--panel)`。
再生ボタン 30px 円（`var(--accent)` / 文字 `var(--on-accent)`）。先頭へ戻るボタンは ghost（枠 `var(--border)`）。
シークバー: 高さ 4px / `radius 999px` / 地 `var(--border)` / fill `var(--accent)` / つまみ 11px 円。**スコアが動いた時刻に `--fc-self` の tick**（幅 2px・高さ 8px・`top: -2px`）。
速度チップ `padding: 1px 7px` / `radius 6px` / 枠 `var(--border)`。無風スキップのトグルも同じ寸法で、ON のとき地 `var(--accent)` / 文字 `var(--on-accent)`、OFF のとき枠 `var(--border)` / 文字 `var(--muted)`。
シークバーの左は**経過時間** `mm:ss`、右は**残り時間** `-mm:ss`（**尺の固定表示ではない**）。無風スキップ中の残り時間は `animate-pulse`（`motion-reduce` で停止）。

### 4.7 貢献者ボード

`.inst` は `padding: 10px 12px` / `gap: 7px`、上に `1px solid var(--row-border)`。
見出しは1行で、左に「この時点の貢献者」、**右端に「上位 ➡」**（`justify-content: space-between`）。
ボードは `flex-direction: row-reverse`（**右端が1位**）、`gap: 9px 11px`、折り返しあり。
1人ぶん（`.fan`）は幅 **48px**・縦積み・`gap: 3px`。アイコン 30px 円（地 `#2b303a` / 文字 `#cfd4de` / 11px 700 / `border: 2px solid transparent`、**1位のみ枠 gold**）。
貢献値は `.amt`（10px mono）で、**数字の頭に 🪙**（`::before` / 9px / `margin-right: 2px`）。
**上位3人はアイコン上端に重なる順位バッジ**（`top: -9px` / 中央寄せ / 高さ 13px / `min-width: 13px` / `padding: 0 3px` / `radius 999px` / `border: 1px solid var(--stage)` / 文字 `#0d0f13`）。1位 `#f5c451` / 2位 `#c9cedb` / 3位 `#cf8f5a`。

## 5. 数値の省略表記（貢献値。**切り捨て。四捨五入しない**）

| 範囲 | 表記 | 例 |
| --- | --- | --- |
| < 1,000 | そのまま | `0` `380` |
| 1,000〜9,999 | k + 小数第1位 | `1.2k` `9.9k` |
| 10,000〜999,999 | k + 小数なし | `31k` `412k` |
| 1,000,000〜9,999,999 | M + 小数第1位 | `1.8M` |
| 10,000,000〜 | M + 小数なし | `12M` |

**生値が正本、表示は省略表記。** 並べ替え・比較は生値で行い、表示テキストを読み取って計算しない。
スコアバーと個人スコアは**省略しない**（TikTok 公式スコアをそのまま出す）。

## 6. モーション

| 名前 | 対象 | 仕様 |
| --- | --- | --- |
| スライドイン | ギフトカード | 420ms `cubic-bezier(0.16,0.9,0.35,1)`。**画面左側の枠は左外（`translateX(-24px)`）から、右側の枠は右外（`+24px`）から**。opacity 0→1 |
| リップル（配信者） | 配信者アイコン | リング2枚（2px 陣営色）、1100ms `cubic-bezier(0.16,0.9,0.35,1)` infinite、2枚目は `320ms` 遅延。`scale(1)`→`scale(var(--ripple))`・opacity 0.85→0。`--ripple` はそのギフトのスコア加算値から決まる最大倍率 |
| リップル（貢献者） | 貢献者ボードのアイコン | **そのリスナーのカードが出ている間だけ**、配信者と同じ2枚リング（`inset: -2px`）。倍率はコイン額から `1.5 + min(1, log10(coins)/6) * 1.3` → 1.5〜2.8。色は貢献先の陣営色 |
| オドメーター | コンボの `×N` | 高さ 1em の窓に 1..N の数字リールを縦送り。`translateY(0)` → `translateY(calc(var(--n) * -1em))`、`steps(N)` は inline。**畳み込み後の最終値をいきなり出さず、コンボの刻み（`repeatCount` の階段）に合わせて上がる** |
| FLIP | 貢献者ボードの順位入れ替え | 変更前の `getBoundingClientRect()` を採り、DOM を並べ替え、差分を `transform` で打ち消してから 0 へ戻す。`transition: transform 420ms cubic-bezier(0.2,0.8,0.2,1)` |
| 新規出現 | 新しい貢献者 | 420ms、`opacity 0 / translateY(7px) scale(0.82)` → 等倍 |

`prefers-reduced-motion: reduce`: スライドインはフェードのみ / リップルは拡大せず `scale(1.25)` の明滅 / オドメーターは送らず最終値 / FLIP と新規出現は無効。

## 7. 要素・挙動インベントリ（**省略の既定はゼロ**）

### 7.1 要素

| 要素 | 役割 | データ出典 |
| --- | --- | --- |
| モーダルタイトル | `{自分} vs {相手}` / `{自分} × N人バトル` | `teams[].participants[].displayName` |
| 副題 | 開始日時 ・ 尺 | `startedAt` / `durationMs` |
| 「貢献者一覧へ戻る」 | `mode: "replay"` → `"list"` | — |
| スコアバー セグメント | 陣営ごとの現在スコアと比率 | `scorePoints`（`t <= elapsedMs` の最後の点。**補間しない**） |
| 経過時間チップ | `mm:ss` | `elapsedMs` |
| 配信者枠 | 陣営色グラデ地 + アイコン + 個人スコア | `teams[].participants[]`（`avatarUrl` は署名付き） |
| 順位バッジ（枠） | 3陣営以上の個人戦のみ | `scorePoints` の順位 |
| WIN バッジ | 勝ち陣営（`resolveWinningTeamIndex` と同じ判定） | `teams[].officialScore` |
| 名前チップ | 配信者の表示名 | `participants[].displayName` |
| ギフトカード | リスナーアイコン / リスナー名 / ギフト名 / ギフト画像 / `×N` / グローブ | `giftEvents` + `senders` + `gifts` |
| 赤帯 | 倍率区間・ボーナスミッション | `segments`（`startMs <= elapsedMs < endMs`。重複時は `opening` 優先） |
| コントロール | 再生・一時停止 / シーク / 速度 1x・2x・4x / 無風スキップ ON・OFF / 先頭へ | — |
| 経過時間・残り時間 | 左 `mm:ss` / 右 `-mm:ss` | `elapsedMs` / `durationMs - elapsedMs` |
| シークの tick | スコアが動いた時刻 | `scorePoints[].t` |
| 貢献者ボード | 上位貢献者のアイコン + 🪙貢献値 + 順位バッジ | `giftEvents` の `elapsedMs` までの累計。**`isSelf` の anchor 宛だけを集計する**（実バトル画面の下段も自分への貢献者一覧。個人の `isSelf` が1件も無い古い行は自陣営全員へフォールバック） |
| 「上位 ➡」 | 並びの向きの明示 | — |
| シェアボタン | 現在のモードの共有URLを発行 | P6 |
| 注記チップ | 「相手陣営のギフト明細は記録されていません」 | `opponentGiftsMissing` |
| 注記チップ | 「初回ボーナス倍率: 記録なし」/「×2（推定）」 | `segments[].confidence` |

### 7.2 インタラクション

- 再生/一時停止トグル。シークはドラッグ中だけ clock からの反映を止める。速度は 1x → 2x → 4x の巡回で、**CSS keyframe の duration は `--replay-speed` で割る**
- **再生開始時の既定は 4x + 無風スキップ ON。** 無風スキップはギフトカードが1枚も出ていない 8 秒以上の区間を選んだ速度の 4 倍で流し、次のカードの 1 秒前で等速へ戻す。**赤帯が出ている区間は飛ばさない**。この追加倍率は速度チップの表示に混ぜない（表示はユーザーが選んだ速度のみ）
- 配信者枠の並びは**自分（`isSelf`）が常に左上**。並べ替えはサーバー側（`anchors` の添字が `scorePoints` / `giftEvents` と共通のため）
- 「貢献者一覧へ戻る」で `mode: "list"`。**Esc は再生中でも `list` へ戻す**（モーダルを閉じない）
- 再生ボタンは再生不可バトルで `aria-disabled` + `title`（非表示にしない）
- カードとリップルはポインタを受けない（`pointer-events: none`）

### 7.3 状態

| 状態 | 表示 |
| --- | --- |
| loading | ステージ枠を保ったままスケルトン。レイアウトを飛ばさない |
| 再生不可 | ボタン無効 + 理由文（`ReplayUnavailableReason` の辞書） |
| 相手ギフト0件 | 自陣側のカードのみ + 注記チップ。**再生自体は可能** |
| `truncated` | 「後半のギフト明細は省略されています」の注記 |
| 貢献者0人 | ボードの領域は残し「まだ貢献者がいません」 |
| 長いリスナー名 / 配信者名 | 1行省略（`text-overflow: ellipsis`）。カードを縦に伸ばさない |
| 貢献者が多い | ボードは折り返し。上位6人まで |
| error | モーダル内にエラーと再試行 |

### 7.4 画像素材

**生成素材なし。** 配信者・リスナーのアイコンは実 TikTok アバター（`resolveAvatarUrls`）、ギフト画像は `TiktokGiftCatalog` を `giftId` で引く、グローブは自前の単色 SVG を CSS `mask` で着色（`--glove`）。ステージ枠は陣営色グラデーションで、**保存していない配信映像を絵で偽装しない**。

## 8. 未解決

1. **`ReplayGiftEvent` にコンボのグループキー（`k`）が無い。** 同一送信者・同一ギフトの連続イベントを別コンボと区別できず、オドメーターの刻みが誤って繋がりうる。`saveComboGift()` は groupId ごとの差分を別行で残しているので復元可能。**契約への追加が要る**
2. **`ReplayGiftEvent` に `multiplierValue` が無い**（グローブ ×5 / ×6 の出し分け不能）。P2 で `Gift` へ保存済みなので契約へ足すだけ
3. `ReplayGiftEvent.c` が差分か累計か未確認。`battle-history.ts` の `giftEvents` 構築を読んで確定する
4. 貢献者ボードの上限6人は暫定。実データの分布を見て決める
5. 貢献者リップルの色（貢献先の陣営色）は、`giftEvents[].a` から陣営を引ける前提。1人が複数陣営へ投げた場合の扱いは未定義
6. 音は出さない（ユーザー判断）
