# 光彩(Kosai) 他画面展開 — 共通トークンと comp→実装 換算規則

採用元: `mobile-kosai-other-tabs.html` の `方向A — 光彩 Full(修正版)` セクション。
各surfaceの `comp.png` は同HTMLの該当 `.phone` 要素(264×560px)をPlaywrightで切り出したもの。
方向B・ボタンラボは不採用。

## 1. 換算規則(comp px → Flutter dp)

compのフォンは幅264px(内側 `.scr` の内容幅220px)で、Pixel 7a(411dp幅・内容幅379dp)より
小さく描かれている。承認済みの `home-screen-kosai` 実装がすでに採っている比率へ合わせる。

| 種別 | 換算 | 根拠 |
|---|---|---|
| 角丸・枠線幅 | ×1.0 | `home-screen-kosai/spec.md` が18px→18dp、2px枠→2dpで確定済み |
| 本文・ラベルの文字 | ×1.2(0.5dp丸め) | comp `.r-name` 11px → 承認実装のニックネーム13.5dp |
| セクション見出し | 22dp固定 | 承認実装のタブ見出し(22dp)と同一階層。comp `.sec-title` 15pxに相当 |
| 余白・パディング | ×1.2(2dp丸め) | comp `.row-item` padding 11/12px → 承認実装 12/16dp |
| アイコン・アバター | ×1.15 | comp `.r-icon` 26px → 承認実装 30dp |
| 影(blur/offset/spread) | ×1.0 | 承認実装の `ListPanel` が comp値をそのまま使用 |

## 2. カラートークン(ライト)

| トークン | hex | 用途 |
|---|---|---|
| bg | `#FAF7F5` | 画面背景 |
| card | `#FFFFFF` | カード・パネル・chip背景 |
| ink | `#2A2130` | 主要文字 |
| sub | `#7C7286` | 補助文字・注記 |
| line | `#EFE6E9` | 罫線・chip枠(1dp) |
| divider | `#F1EBEE` | パネル内の行区切り(1dp) |
| track | `#E5DFE8` | スイッチOFF・スライダー非活性・メーターOFF |
| danger | `#E24B4B` | 削除・ログアウト・LOSE |
| c1 | `#FF7A59` | 装飾グラデーション コーラル |
| c2 | `#9B6BFF` | 装飾グラデーション バイオレット / アクセント単色 |
| c3 | `#2FC6A0` | 装飾グラデーション ミント |

ダーク(既存テーマ準拠): bg `#17151A` / card `#1F1B24` / ink `#F1EDF5` / sub `#A79FB0` /
line `#332C3B`。**compはライトのみ。ダークのグラデーション3色はライトと同一を保持する
(`home-screen-kosai/spec.md` 未解決事項2の仮置きを継続)。**

グラデーション定義:

- `gradBadge` = c1→c2、90deg(`Alignment.centerLeft`→`centerRight`)
- `gradRing` = c1→c2、135deg(`topLeft`→`bottomRight`)
- `gradBorder` = c1→c2→c3、120deg(`Alignment(-0.7,-0.7)`→`(0.7,0.7)`)
- `gradScore` = c1→c3、90deg(バトルスコア用、comp `.team-score.grad`)
- `gradWin` = c3→c2、90deg(comp `.win-badge.grad`)

## 3. タイポグラフィ

| 役割 | フォント | サイズ/weight |
|---|---|---|
| セクション見出し(グラデ文字) | Zen Maru Gothic | 22dp / w700 |
| プライマリボタン | Zen Maru Gothic | 17dp / w800 |
| リスト行タイトル | Zen Kaku Gothic New | 13.5dp / w700 |
| リスト行サブ | Zen Kaku Gothic New | 11.5dp / w400 |
| 設定行ラベル | Zen Kaku Gothic New | 13.5dp / w500 |
| 設定行の値 | Zen Kaku Gothic New | 13.5dp / w700(色 c2) |
| chip | Zen Kaku Gothic New | 11dp / w700 |
| 注記(`.note`) | Zen Kaku Gothic New | 10dp / w400(色 sub) |
| バッジ(FREE/WIN等) | Zen Kaku Gothic New | 11dp / w800 |

数字はカンマ区切り(`formatWithCommas`)。

## 4. 形状・共通部品

| 部品 | 数値 |
|---|---|
| パネル/カード角丸 | 18dp |
| 二重枠グラデーションカード | 外20dp / 枠2dp / 内18dp / 内padding 16dp |
| chip・バッジ・メダル・アバター・pillボタン | 999dp(Stadium) |
| ステータスバー角丸 | 14dp |
| dangerボタン角丸 | 14dp |
| ボトムシート上角丸 | 20dp |
| パネル影 | `rgba(155,107,255,.12)` blur22 / offset(0,8) / spread -18 |
| プライマリボタン影 | `c2 @0.55` blur22 / offset(0,10) / spread -10 |
| 拡張FAB影 | `c2 @0.55` blur24 / offset(0,12) / spread -8 |
| ステータスバー影 | `c2 @0.35` blur16 / offset(0,6) / spread -12 |
| 画面横padding | 16dp |

### 共通ボタン(comp「ボタンラボ」は不採用だが方向Aの各画面内で使われている形)

- **Primary(グラデーションpill)**: 全幅 / 縦padding 18dp / 角丸999 / 文字白17dp w800 /
  背景 `gradBadge` / 上記プライマリ影。無効時は不透明度0.45。
- **Secondary(アウトラインpill)**: 縦padding 14dp / 角丸999 / 背景 card / 文字 c2 15dp w800 /
  枠 1.5dp c2。
- **Danger**: 縦padding 14dp / 角丸14dp / 背景 card / 文字 danger 14dp w700 / 枠1.5dp danger。
- **Text**: 縦padding 12dp / 文字 sub 14dp w600。
- **拡張FAB**: 角丸999 / padding 縦16dp・横22dp / 背景 `gradRing` / 文字白15dp w800 /
  先頭に「＋」19dp。

## 5. 期間フィルタ chip row(ギフト履歴・バトル履歴・貢献で共通)

comp `.chip-row` を正とする。既存 `PeriodSelectorBar` の**API・状態遷移ロジックは一切変えず、
描画のみ** SegmentedButton から chip row へ差し替える。

- 行: 横スクロール(スクロールバー非表示) / chip間 gap 6dp / 上下padding 0 / 画面横padding 16dp
- chip: padding 縦6dp・横12dp / 角丸999 / 文字11dp w700
  - 非選択: 背景 card / 枠1dp line / 文字 ink
  - 選択中: 背景 `gradBadge` / 枠なし / 文字白
  - ロック中(FREEの月・年): 文字の後ろに 🔒 相当の `Icons.lock_outline` 12dp。**押下は禁止せず
    アップグレード導線を出す**(既存挙動を維持)
  - カスタム: 破線枠1dp line / 文字 sub。適用中は選択中と同じ `gradBadge`
- chip rowの下に、既存の「◀ 期間ラベル ▶」行を残す(**comp未定義。既存機能なので削らない**)。
  ラベルは13.5dp w600 中央、◀/▶は `IconButton` 20dp sub色。

## 6. 状態(全surface共通)

- **loading**: comp未定義。既存の `CircularProgressIndicator`(アクセント c2)を維持。
- **empty**: comp未定義。既存 `EmptyListNotice` の文言・配置を維持。
- **error**: comp未定義。既存 `AnalyticsErrorBanner`(赤・12dp)を維持。
- **verified=false**: comp未定義。既存 `VerifiedLockNotice` を維持。
- **無効(disabled)**: comp未定義。不透明度0.45で示し、**押下自体は禁止しない**(既存の
  「onPressedをnullにしない」方針を維持し、理由をスナックバーで伝える)。
