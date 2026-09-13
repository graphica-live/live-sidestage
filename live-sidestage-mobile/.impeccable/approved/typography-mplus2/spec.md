# タイポグラフィ — M PLUS 2 一本化（採用）

採用元: 書体10案の比較 案8。
`comp.png` は案8選択時のフォンモック＋ウェルカム／ボタン／ダーク見出し。
レイアウト・色・角丸・情報密度は既存光彩（`home-screen-kosai` ほか）を維持する。この契約が変えるのは書体ファミリーと見出しウェイトだけ。

変更履歴: 2026-09-13 初回凍結。Zen Maru Gothic + Zen Kaku Gothic New を M PLUS 2 1ファミリーへ置換。

## 色（既存光彩・変更なし）

| トークン | hex | 用途 |
|---|---|---|
| bg | `#FAF7F5` | 画面背景 |
| card | `#FFFFFF` | カード・リスト |
| ink | `#2A2130` | 主要文字 |
| sub | `#7C7286` | 補助文字 |
| line | `#EFE6E9` | 罫線 |
| c1 | `#FF7A59` | グラデ コーラル |
| c2 | `#9B6BFF` | グラデ バイオレット / コイン単色 |
| c3 | `#2FC6A0` | グラデ ミント / 接続ドット |
| dark bg | `#17151A` | ダーク背景 |
| dark ink | `#F1EDF5` | ダーク主要文字 |
| dark sub | `#A79FB0` | ダーク補助文字 |

## タイポグラフィ（この契約の本体）

ファミリーは **M PLUS 2 のみ**（`GoogleFonts.mPlus2`）。見出しと本文で別ファミリーを持たない。

| 役割 | ファミリー | サイズ | weight | 行間 | 字間 | Material role |
|---|---|---|---|---|---|---|
| Display（ウェルカムアプリ名） | M PLUS 2 | 28dp | 800 | 1.2 | 0 | titleLarge 相当を 28dp に上書き |
| Tab Title（グラデ文字） | M PLUS 2 | 22dp | 800 | 1.2 | 0 | titleLarge |
| AppBar タイトル | M PLUS 2 | titleLarge 既定 | 800 | テーマ既定 | 0 | titleLarge |
| Primary button | M PLUS 2 | 17dp | 800 | テーマ既定 | 0.2 | titleMedium 上書き |
| Body | M PLUS 2 | 16dp | 400 | Material bodyLarge 既定 | 0 | bodyLarge / bodyMedium |
| ニックネーム | M PLUS 2 | 13.5dp | 400 | 1.0（1行省略） | 0 | bodyMedium |
| Data コイン行 | M PLUS 2 | 13dp | 700 | 1.0 | 0 | labelLarge 相当。色 `#9B6BFF` |
| 合計コイン | M PLUS 2 | 25dp | 800 | 1.15 | -0.01em | グラデ文字 |
| Chip | M PLUS 2 | 11dp | 700 | 1.0 | 0 | labelSmall |
| Label 補助 | M PLUS 2 | 12–13dp | 400 | 1.3 | 0 | labelMedium。色 sub |
| Caption エラー | M PLUS 2 | 11dp | 400 | 1.3 | 0 | labelSmall。色 error |
| ナビラベル | M PLUS 2 | 9–12dp（NavigationBar 既定） | 500–700 | 1.0 | 0 | **見出し用 800 を載せない** |

数字は `FontFeature.tabularFigures()` をテーマの body/label に付ける。付けられない環境では実機で桁揺れが無いことを確認する。

## 余白・サイズ・角丸

既存 `home-screen-kosai/spec.md` を継承する。この変更で動かさない。

- カード角丸 18dp、chip/メダル/アバター 999
- リスト行 padding 上下 12dp・左右 16dp、gap 11dp
- アバター 30×30dp、メダル 26dp
- タッチ領域: 開始ボタン高さ 48dp、リスト行 44dp 以上（既存）

## 情報密度

貢献タブ代表: 期間chip 3、サマリー 1、ランキング行 4（1行あたり 順位・アバター・名前・コイン）。区切りは行間 1px `#EFE6E9`。行のカード化はしない。

## 視覚階層

1. サマリー合計 25dp w800 グラデ
2. タブ見出し 22dp w800 グラデ
3. 行内コイン 13dp w700 `#9B6BFF`
4. 本文・補助

## 要素・挙動インベントリ

このサーフェスは書体差し替えであり、画面構造は既存ホーム（貢献タブ代表）と同じ。

### 要素の全列挙
- AppBar: `@tiktokId`、プランバッジ
- ステータスバー: 接続ドット + 「接続中」
- タブ見出し「貢献」グラデ文字
- サブ「今日のギフト貢献ランキング」
- 期間chip: 今日 / 7日 / 30日
- サマリー: 「合計コイン · 12人」+ `12,480`
- ランキング行: 順位メダル、アバター、ニックネーム、コイン
- ボトムナビ 6タブ（TTS / 音 / 貢献 / ギフト / バトル / 設定）
- ウェルカム標本: 「LIVE Sidestage」28dp グラデ
- 開始ボタン標本: 「読み上げを開始」
- ダーク標本: 見出し「貢献」

### 画像素材
なし — 書体比較が目的。アイコンは既存 Material Icons / 既存アバター実装。

### インタラクション
既存どおり。期間chip・行タップ・ナビ切替。この契約では新規ジェスチャを追加しない。

### 状態
loading / empty / error は既存画面の未定義または既存実装を維持。フォント変更で新しい空状態を作らない。

## 構造対応表（Gate 3）

| comp の領域 | comp の構造 | 実装で使うもの | 既存で足りるか |
|---|---|---|---|
| アプリ全体の文字 | M PLUS 2 1ファミリー、見出し 800 / 本文 400–700 | `buildAppTheme` の `GoogleFonts.mPlus2TextTheme` | 足りる。`zenMaruGothic` / `zenKakuGothicNew` を差し替える |
| タブ見出し | 22dp w800 グラデ | 既存 `GradientText` + `titleLarge` | 足りる。weight を 700→800 |
| ボタン | 17dp w800 | 既存 `filledButtonTheme` | 足りる。display も同じファミリー |
| リスト行 | 名前 13.5 / コイン 13 w700 | 既存 `RankingListTile` | 足りる。テーマ継承 |
| ナビラベル | 本文ファミリーの細字 | `NavigationBar` 既定 | 見出しロールをナビに流さない |

実装順序: タイポ（ファミリーと weight）→ 既存の余白・角丸・色は触らない。

## 未解決
- M PLUS 2 可変フォントを `google_fonts` 6.2.1 がネットワーク取得する現行方式を維持する。アセット同梱はこの契約に含めない（初回オフラインはシステムフォールバックの既存仕様）。
- ダーク実機の細さ補正（本文を 500 にするか）は Pixel 実機確認後。仮置きは 400 のまま。
- 既存各画面 spec に残る「Zen Maru / Zen Kaku」表記はファミリー名だけ追従更新する。サイズ数値は変えない。
