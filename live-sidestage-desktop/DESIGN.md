---
name: TikEffect
description: TikTok Live配信者向けのローカル完結型オーバーレイ演出ツール
colors:
  bg-base: "#dfe6f0"
  panel: "rgba(248, 250, 252, 0.86)"
  panel-strong: "rgba(255, 255, 255, 0.92)"
  line: "rgba(33, 45, 69, 0.12)"
  line-strong: "rgba(33, 45, 69, 0.18)"
  text: "#0f172a"
  muted: "#5b6880"
  accent: "#ef4444"
  accent-strong: "#dc2626"
  accent-soft: "rgba(239, 68, 68, 0.12)"
  sidebar-bg-start: "#101826"
  sidebar-bg-end: "#1c2740"
  ok: "#166534"
  warn: "#9a3412"
  error: "#b42318"
typography:
  body:
    fontFamily: "Bahnschrift, Yu Gothic UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  headline:
    fontFamily: "Bahnschrift, Yu Gothic UI, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.08
  title:
    fontFamily: "Bahnschrift, Yu Gothic UI, sans-serif"
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.2
  label:
    fontFamily: "Consolas, Bahnschrift, sans-serif"
    fontSize: "13px"
    fontWeight: 600
rounded:
  sm: "8px"
  md: "9px"
  card: "14px"
  panel: "16px"
  pill: "999px"
spacing:
  sm: "8px"
  md: "14px"
  lg: "18px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: "rgba(255, 255, 255, 0.72)"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "9px 16px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "24px"
  card:
    backgroundColor: "#ffffff"
    rounded: "{rounded.card}"
    padding: "20px"
---

# Design System: TikEffect

## Overview

**Creative North Star: "配信のコントロールルーム"**

TikEffectのControl画面(管理UI)は、配信を裏で操作する司令室の性格を持つ。左側の紺のサイドバーが操縦席のように常駐し、右側のライトなパネル群がその日の状況(接続状態・ギフト・コメント)を淡々と表示する。装飾より判読性を優先し、危険や成功を伝える色(赤・緑・オレンジ)だけがアクセントとして光る。既知の視覚的リジェクトはない — Controlは実務的な画面であり続けることが確認済みの方針。

配信画面に表示される「ウィジェット」は、この司令室とは別の位置づけを持つ。ウィジェットはOBS等のブラウザソースとして視聴者の目に触れる演出そのものであり、配信者がフォント・配色を自分の配信の世界観に合わせて選べる、意図的にオープンなテーマシステムとして設計されている(詳細はComponents > Widget Overlaysを参照)。

**Key Characteristics:**
- Controlはニュートラルな寒色グレー背景に、警告・成功・強調のときだけ暖色(赤〜オレンジ)が灯る
- 静止状態はほぼフラット。hover/focusでのみ軽く浮き上がり、操作可能性を伝える
- パネル・カードの角は指先で押せそうな柔らかい丸み(14〜16px)を持つが、ボタンや入力欄はもう少し締まった丸み(8〜9px)
- ウィジェット側は固定デザインを持たず、配信者が選んだフォント・色がそのままシステムの見た目になる

## Colors

Controlのパレットは「警告シグナルとしての暖色」を基調に、それ以外は寒色系グレーに徹する構成。

### Primary
- **アラートレッド** (`#ef4444` / hover `#dc2626`): プライマリボタン、選択中のタブ、強い強調が必要な操作。Control全体で最も使用箇所を絞っている色

### Neutral
- **フロストブルーグレー** (`#dfe6f0`〜`#cfd9e6` のグラデーション): アプリ全体の背景
- **クラウドパネル** (`rgba(248, 250, 252, 0.86)`): パネル・モーダルの背景
- **インクネイビー** (`#0f172a`): 本文テキスト
- **スレートミュート** (`#5b6880`): 補助テキスト・ラベル
- **ヘアラインブルー** (`rgba(33, 45, 69, 0.12)`): ボーダー・区切り線
- **コックピットネイビー** (`#101826` → `#1c2740` のグラデーション): サイドバー専用の濃紺。Control全体で唯一の常時濃色エリア

### Semantic
- **成功グリーン** (`#166534` / ダーク時 `#86efac`): 接続成功・完了ステータス
- **警告アンバー** (`#9a3412` / ダーク時 `#fdba74`): 注意・レート制限などの警告
- **エラーレッド** (`#b42318` / ダーク時 `#fca5a5`): 失敗・エラーステータス

### Named Rules
**The Warm Signal Rule.** 暖色(赤〜オレンジ)はプライマリ操作・ステータス伝達のためだけに使う。画面の大部分は寒色グレーのニュートラルに任せ、暖色の希少性そのものが「ここに注目」の合図になる。

**The Theme-Preset Rule.** Controlはダーク/ゴールド/クリームなど複数のテーマプリセット(`admin-theme-presets.css`)を持ち、`:root`の同名カスタムプロパティを丸ごと差し替える形で切り替わる。新しいプリセットを足すときも、ここに列挙したトークン名(`--bg`, `--panel`, `--accent`など)をすべて再定義することで既存コンポーネントがそのまま追従する。

## Typography

**Body Font:** Bahnschrift (with Yu Gothic UI, sans-serif)
**Label/Mono Font:** Consolas (with Bahnschrift, sans-serif) — ログ・タイムスタンプなど機械的な情報に限定

**Character:** BahnschriftはWindows標準の可変幅ゴシックで、飾り気のない実務的な印象を保つ。見出しも本文も同じファミリーを太さだけで書き分け、コントロールパネルらしい一貫性を優先している。

### Hierarchy
- **Headline** (700, 34px, line-height 1.08): 画面タイトル(h1)
- **Title** (700, 21px, line-height 1.2): セクション見出し(h2)
- **Body** (400, 14px, line-height 1.5): 通常の本文・ラベル
- **Subtext** (400, 14px, line-height 1.7, `var(--muted)`): 補足説明文
- **Label** (600, 13px, Consolas系): ステータスチップ・タイムスタンプなど機械可読的な短い情報

### Named Rules
**The One-Family Rule.** Control画面は原則Bahnschrift/Yu Gothic UI一本で統一し、装飾フォントを持ち込まない。表現力が必要な場面(配信演出)はウィジェット側のテーマシステムに譲る。

## Layout

Control画面は「固定サイドバー + スクロール可能なコンテンツ」の2カラムgrid(`grid-template-columns: minmax(200px, 13vw) minmax(0, 1fr)`)を基本形とする。サイドバーは常時濃紺、コンテンツ側はパネル(`.panel`)を縦に積んだ構成で、パネル間のリズムは18〜24pxのgapに統一されている。

背景はどのページも単色ではなく、radial/linearグラデーションを重ねて奥行きを出す(例: `radial-gradient(circle at top left, ...) , linear-gradient(135deg, #eef3f8 0%, #dce5f0 50%, #cfd9e6 100%)`)。パネル内部のグリッド(`.grid`, `.jar-pair`)は`repeat(auto-fit, minmax(480px, 1fr))`のような可変列で、ウィンドウ幅に応じてカードが折り返す。

## Elevation & Depth

**控えめなソフトフォーカス**が基本方針。静止状態のパネル・カード・ボタンはほぼフラットに近い薄い影(あっても`inset`程度)しか持たず、hover/focus時にだけ影が強まり`translateY(-1px)`でわずかに持ち上がる。常時強い影が乗っている面は存在しない。

### Shadow Vocabulary
- **panel-rest** (`box-shadow: 0 22px 50px rgba(15, 23, 42, 0.16)`): アプリシェル全体を包む最外周の柔らかい影
- **panel-inner** (`box-shadow: 0 10px 24px rgba(24, 37, 58, 0.12)`): 個別パネルの基本影
- **card-rest** (`box-shadow: 0 2px 12px rgba(24, 37, 58, 0.10), 0 1px 3px rgba(24, 37, 58, 0.06)`): カードの基本影
- **button-hover** (`box-shadow: 0 4px 14px rgba(24, 37, 58, 0.10), 0 1px 4px rgba(24, 37, 58, 0.06)`): 汎用ボタンのhover影
- **button-primary-hover** (`box-shadow: 0 4px 16px rgba(194, 65, 12, 0.34)`): プライマリボタンのhover影。アクセント色を帯びる
- **focus-ring** (`box-shadow: 0 0 0 3px var(--button-focus-ring)`): キーボードフォーカス時のアウトライン代替

### Named Rules
**The Rest-Flat Rule.** 何も操作されていない状態のコンポーネントは影を持たない、または最小限のinset影に留める。影が濃くなるのは常にユーザーの操作(hover/focus/active)への応答であり、常設の装飾として使わない。

## Shapes

角丸は用途ごとに明確な段階を持つ: ボタン・入力欄は締まった8〜9px、カードはやや柔らかい14px、パネル・アプリシェルは最も柔らかい16px、チップやpill状の要素(`.day-pill`, `.chip`)は完全な999px。直角(0px)のコンポーネントはControl側には存在しない。境界線はほぼ全て1px、色は`rgba(33, 45, 69, 0.12)`前後の低コントラストなヘアラインで、面の区切りを主張しすぎない。

## Components

### Buttons
- **Shape:** 角丸9px (`--button-radius`)、内側パディング`9px 16px`
- **Primary:** `linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)`背景、白文字。hoverでグラデーションが一段暗くなり、影が`rgba(194, 65, 12, 0.24)`→`0.34`に強まる
- **Hover / Focus:** `translateY(-1px)`で持ち上がり、`transform`/`background`/`box-shadow`が110msでtransitionする。focus-visible時は3pxのアクセントリングが乗る
- **Ghost / Secondary:** 半透明の白背景(`rgba(255,255,255,0.72)`)、hoverで不透明度が上がる。境界線のみで存在を示す控えめな見た目
- **Icon-only:** 34×34px、角丸8pxの正方形。用途別に色分け(編集=ブルー系、危険操作=レッド系)

### Cards / Panels
- **Corner Style:** カード14px、パネル16px
- **Background:** パネルは半透明の`--panel`、カードは不透明白
- **Shadow Strategy:** Elevation & Depthのpanel-rest / card-restを参照。常設は薄く、hoverはほぼ持たない(カードは操作対象ではなく情報表示が主)
- **Border:** 1pxの低コントラストヘアライン(`--line`)

### Inputs / Fields
- **Style:** `--surface-soft`背景、`--line`境界線、角丸はボタンと同系統
- **Focus:** ボタンと共通のアクセントリング(`box-shadow: 0 0 0 3px accentの透過色`)
- **Placeholder:** さらに薄いグレー(`#7f8ea3`)で本文と明確に区別

### Status Chips
- **Style:** `.status` / `.chip`は角丸pill寄りの小さな面。成功/警告/エラーで背景・文字・境界線の3点が同時に色付く(例: 成功は`rgba(21,128,61,0.18)`背景+`#86efac`文字+緑系境界)
- **State:** 中間色は使わず、成功・警告・エラー・中立の4値のみ

### Widget Overlays (Signature Component)
配信画面に重ねる「ウィジェット」(`backend/public/widgets/*.html`)はControlとは異なる設計原則を持つ、この製品最大の特徴的コンポーネント。

- **透明キャンバス:** `html, body { background: transparent }`が絶対の前提。OBS等のブラウザソースとして配信映像に自然に重なるための必須条件で、プレビュー用途のときだけJSでdarkグラデーション背景を後付けする
- **配信者定義のテーマ変数:** 文字色・縁取り色・フォントファミリー・サイズはすべて`--title-color`, `--stroke-color`, `--widget-font-family`のようなCSSカスタムプロパティとして公開され、配信者が管理画面から差し替える。ハードコードされた「TikEffectらしい見た目」は意図的に存在しない
- **フォントの選択肢:** Google FontsからM+PLUS+Rounded+1c、Zen Kaku Gothic New、Yuji Syuku、Dela Gothic Oneなど20種類以上の和文フォントを`@import`し、ポップ〜筆文字〜ゴシックまで幅広い演出トーンを配信者が選べる
- **視認性のための縁取り:** 配信映像上での可読性を確保するため、テキストには`-webkit-text-stroke`による太い縁取り(3〜5px)を標準で持つ。これは装飾ではなく実用上の可読性要件

## Do's and Don'ts

### Do:
- **Do** Control画面の新規ボタン・入力欄は`admin-buttons.css`の共有トークン(`--button-radius`, `--accent`など)経由でスタイルし、ページ単体でボタンの見た目を再定義しない
- **Do** 影はhover/focusの応答としてのみ強める(Rest-Flat Rule)
- **Do** ウィジェットの新しいテキスト要素には`-webkit-text-stroke`などの縁取りを付け、配信映像上での可読性を確保する
- **Do** ウィジェットの色・フォントは必ずCSSカスタムプロパティとして公開し、配信者が設定画面から変更できる状態を保つ

### Don't:
- **Don't** ウィジェットに固定の「ブランドらしい」配色・フォントをハードコードしない。ウィジェットの見た目は配信者が選ぶものであり、TikEffect側が決め打ちしない
- **Don't** Controlのパネル・カードに常時強い影やグロー装飾を追加しない。静的な画面に持続的な派手さは要らない
- **Don't** ウィジェットの`html, body`から`background: transparent`を外さない。配信ソフト側での合成が壊れる
- **Don't** Control側にウィジェット側の表現的フォント(丸ゴシック・筆文字系)を持ち込まない。実務画面と演出画面のトーンは分離したまま保つ
