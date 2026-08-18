---
name: LiveAnalytics
description: TikTok Live配信のギフト分析＆配信重畳オーバーレイ
colors:
  tiktok-red: "#fe2c55"
  tiktok-red-hover: "#e91e50"
  surface: "#111111"
  panel: "#1a1a1a"
  border: "#2a2a2a"
  text-primary: "#f0f0f0"
  text-white: "#ffffff"
  text-muted: "#9ca3af"
  text-faint: "#6b7280"
  status-success: "#22c55e"
  status-warning: "#eab308"
  status-error: "#ef4444"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  numeric:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.tiktok-red}"
    textColor: "{colors.text-white}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.tiktok-red-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  input-field:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-white}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: LiveAnalytics

## Overview

**Creative North Star: "配信コントロールルーム(Broadcast Control Room)"**

配信者が本番中に一瞬で数値を読み取れることを最優先した、暗室のオペレーション卓のような画面。背景は素材のない漆黒に近いダーク(#111111)で沈み込み、パネルとボーダーだけがわずかに浮いて構造を示す。装飾的な影やグラデーションはほぼ使わず、TikTokブランドのレッド(#fe2c55)だけが「今アクティブなもの・押せるもの・生きているもの」を示す信号として機能する。これは現行実装から抽出した現状の記録であり、恒久的に固定されたブランドではない(名称・配色は将来変更され得ることをプロダクト側で確認済み)。

密度は高め: 1画面にタブ・期間ナビゲーション・フィルタ・テーブルが同時に並び、モバイルでは列を間引いて(`hidden sm:table-cell`等)対応する。派手な演出は配信オーバーレイ側(スクロール演出・見出し背景のグラデーション)に集約し、管理画面本体は徹底して機能本位。

**Key Characteristics:**
- 漆黒ベース+最小限のパネル/ボーダーで構造を示すダークUI
- TikTokレッドは「アクティブ・プライマリアクション」専用、地の色としては使わない
- 数値(コイン数・順位・コード)は等幅フォントで縦に揃える
- 影はほぼ使わず、フローティングするパネル(ドロップダウン等)にだけ影を許可
- 全編日本語UI、絵文字アイコンとインラインSVGアイコンが混在

## Colors

暗いニュートラルの上に、単一のTikTokレッドだけがアクセントとして乗る一色構成。

### Primary
- **TikTok Red** (`#fe2c55`): プライマリボタン、アクティブなタブ/セグメント、フォーカスされた入力欄のボーダー、外部リンクのホバー、認証コード等の強調テキストに使用。画面全体に対しては局所的にしか出現しない。
- **TikTok Red Hover** (`#e91e50`): プライマリボタンのホバー状態。

### Neutral
- **Surface Black** (`#111111`): ページ全体の地の色(`body`背景)。
- **Panel** (`#1a1a1a`): カード、ヘッダー、ドロップダウンパネル、テーブルヘッダーなど「地よりわずかに浮く面」に使用。
- **Border** (`#2a2a2a`): カード・入力欄・テーブル区切り線・ヘッダー下線など、影の代わりに構造を示す唯一の手段。
- **Text Primary** (`#f0f0f0`): 本文の既定文字色。
- **Text White** (`#ffffff`): 見出し・強調テキスト・プライマリボタン文字。
- **Text Muted** (`gray-400` 相当): ラベル、補助情報、非アクティブなタブ文字。
- **Text Faint** (`gray-500` 相当): プレースホルダー、タイムスタンプ、最も優先度の低いメタ情報。

### Status Colors
- **Success** (`green-400/500`): 認証完了、接続中インジケータ。
- **Warning** (`yellow-500`, `animate-pulse`併用): 接続試行中・再接続中インジケータ。
- **Error** (`red-400/500`): エラーメッセージ、接続エラーインジケータ、破壊的な操作(非表示ボタン)のテキスト。

### Named Rules
**The Signal Red Rule.** TikTokレッドは「押せる・今アクティブ・注目してほしい」ことだけを示す信号として使う。装飾目的や地の色としては使用しない。

## Typography

**Font:** システムのUIサンセリフスタック(`next/font`によるWebフォント読み込みはなし。ブラウザ既定のsans-serifをそのまま採用)。
**Numeric/Mono Font:** `font-mono`(等幅) — コイン数、順位、認証コード、APIキー、Overlay URLなど「揃えて読ませたい/コピーさせたい」値専用。

**Character:** 装飾のない実用一辺倒のペアリング。個性は書体ではなく、数値だけを等幅にする使い分けと、絵文字アイコン(💎🎁🎯⚙️)が担う。

### Hierarchy
- **Title** (bold, `text-2xl`): ログイン/セットアップ画面の見出しなど、画面の主題を示す1箇所限定の大見出し。
- **Header Brand** (bold, `text-lg`): ヘッダー内のプロダクト名リンクのみ。
- **Body** (regular, `text-sm`): テーブル本文、ボタン文字、フォーム全般の既定サイズ。
- **Label** (medium, `text-xs`): フォームラベル、テーブルヘッダー、補助説明、ステータステキスト。
- **Micro** (regular, `text-[10px]〜text-[11px]`): オーバーレイ設定の凡例(「遅い/速い」等)、注記。
- **Numeric** (`font-mono`, サイズはコンテキスト依存): コイン数・順位・コード類。桁揃えと視認性を優先。

### Named Rules
**The Mono Numbers Rule.** ユーザーが比較・コピーする数値(コイン数、順位、認証コード、APIキー)は必ず`font-mono`にする。それ以外のテキストにはmonoを使わない。

## Layout

- **コンテナ幅**: ダッシュボード系ページは`max-w-4xl mx-auto`。認証/セットアップ系の単一カードページは`max-w-sm`〜`max-w-md`で画面中央寄せ(`min-h-screen flex items-center justify-center`)。
- **モバイルファースト**: `sm:`/`md:`ブレークポイントで列を段階的に「間引いて隠す」設計(`hidden sm:table-cell`、`hidden md:table-cell`)。横スクロールコンテナ(`overflow-x-auto`)は補助であり主手段ではない。
- **密なフレックス構成**: ヘッダーもツールバーも`flex items-center gap-*`の水平配置が基本。ラップが必要な箇所には`flex-wrap`。
- **スペーシングリズム**: セクション間`space-y-4`、コンパクトな内部余白は`gap-1.5`〜`gap-2`、カード内側は`p-4`が基準。
- **セグメントコントロール**: タブ/期間切替は`bg-panel border border-border rounded-lg p-1`のピル型グループの中に個別ボタンを並べる形で統一。
- **固定ヘッダー**: `sticky top-0 z-10`のダッシュボードヘッダーが常時表示される。

## Elevation & Depth

現状はほぼフラット: カード・ボタン・入力欄はボーダー(`border-border`)のみで区切られ、`box-shadow`を持たない。唯一の例外は、コンテンツの上に浮くポップオーバー/ドロップダウン(オーバーレイ設定パネル、カスタム期間カレンダー、BIO認証ゲートのオーバーレイ)で、これらだけが`shadow-xl`(必要に応じて`backdrop-blur-sm`)を持つ。これは現状観測された実装上の使い分けであり、今後変更を縛る公式ルールとしては固定しない。

### Shadow Vocabulary (observed)
- **Floating panel** (`shadow-xl`): ドロップダウン、ポップオーバー、モーダル的に前面に出るブロックのみ。
- **Blur overlay** (`backdrop-blur-sm` + `bg-panel/90`): 認証待ちのすりガラス演出(`VerifyGate`)。

## Shapes

角丸は要素の階層でおおむね2段階に分かれる。

- **rounded-lg (8px)**: ボタン、入力欄、セグメントコントロール内のピルボタン、ステータス切替ボタンなど「操作可能な小要素」。
- **rounded-xl (12px)**: カード、テーブルの外枠コンテナ、ドロップダウンパネルなど「面としてまとまった大きい単位」。
- **rounded-full**: アバター、ステータスドット。
- 境界線は一貫して`border`(1px, `border-border`)で表現し、影ではなく線で構造を伝える。

## Components

### Buttons
- **Shape:** `rounded-lg`(8px)。
- **Primary (`.btn-primary`):** 背景 TikTok Red、文字白・`font-semibold`、`px-4 py-2`、`disabled:opacity-50`。1画面に主要な決定アクションとして1〜2箇所のみ出現(認証コード発行、確認する、CSV適用など)。
- **Ghost (`.btn-ghost`):** 背景透明、文字`gray-400`、ホバーで文字白+背景`white/5`。ヘッダーのアクション群、テーブル内のアイコンボタンなど「補助的操作」全般に使う既定ボタン。
- **Hover / Focus:** すべて`transition-colors`でフェード。フォーカスリングは明示定義されておらず、入力欄のみ`focus:border-brand/60`でボーダー色を変える形にとどまる。

### Cards / Containers
- **Corner Style:** `rounded-xl`(12px)。
- **Background:** `panel` (#1a1a1a)。
- **Border:** `border-border`(1px)。
- **Shadow Strategy:** なし(静止面)。フローティングする派生要素(ドロップダウン)のみ`shadow-xl`。
- **Internal Padding:** `p-4`が基準。

### Inputs / Fields (`.input-field`)
- **Style:** 背景`panel`、`border-border`、`rounded-lg`、`px-3 py-2`。
- **Focus:** ボーダー色が`border-brand/60`に変化(グロー・アウトラインなし)。
- **Placeholder:** `gray-500`。
- **Disabled/Error:** 明示的なdisabledスタイルは個別要素側の`opacity`制御に依存。エラーメッセージは入力欄の下に`text-red-400 text-sm`で表示。

### Navigation (ヘッダー)
- **Style:** `sticky top-0`、背景`panel`、下ボーダー、`max-w-4xl mx-auto`の内側で左にブランドロゴリンク、右にステータス/アクション群を配置。
- **States:** 通常はゴーストボタン群。ロゴリンクは`hover:opacity-80`のみ。

### Status Indicator (配信接続ステータス)
- 直径小さいドット(`w-2 h-2 rounded-full`)+短いテキスト。connected=緑、connecting/retrying=黄+`animate-pulse`、idle=グレー、error=赤。ヘッダーとポーリング系UIで一貫して使う唯一のステータス表現。

### Segmented Toggle (期間タブ・整列選択など)
- 外枠`bg-panel border border-border rounded-lg p-1`の中に個別ボタン。選択中は`bg-brand text-white`、非選択は`text-gray-400 hover:text-white`。整列/背景選択など2択・3択のトグルは枠線バッジ型(`border-brand text-brand bg-brand/10` vs `border-border text-gray-400`)に統一。

### Data Table
- 外枠`rounded-xl border border-border`+内部`overflow-x-auto`。
- ヘッダー行: `text-xs text-gray-400`、下ボーダー。
- 本文行: `border-b border-border/50`、ホバーで`bg-white/[0.02]`のわずかなハイライト。
- 数値列は右寄せ+`font-mono`。
- 優先度の低い列はブレークポイントで非表示(横スクロールに頼らない)。

## Do's and Don'ts

### Do:
- **Do** TikTokレッドは主要アクション・アクティブ状態・数値の強調にのみ使い、地の色や大面積の塗りには使わない。
- **Do** 比較・コピー対象の数値(コイン数・順位・コード・APIキー)は`font-mono`で統一する。
- **Do** カード/ボタン/入力欄は境界線(ボーダー)で構造を示し、影は浮遊するポップオーバー系要素にのみ使う。
- **Do** モバイル対応は列の間引き(`hidden sm:/md:table-cell`)を主手段にし、横スクロールは補助にとどめる。

### Don't:
- **Don't** ライトテーマを追加しない。`color-scheme: dark`固定であり、現行実装は暗色専用。
- **Don't** カード・ボタンに新しく`box-shadow`を追加しない(フローティング要素以外)。
- **Don't** ブランド名・配色・ロゴをこのファイルの現在値をもって恒久確定事項として扱わない — これは現状実装の記録であり、将来変更され得る前提でPRODUCT.mdに明記済み。
