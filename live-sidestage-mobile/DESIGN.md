---
name: Live Sidestage
description: TikTok Liveのコメントを画面を見ずに聞ける、静かな副操縦士アプリ
colors:
  seed-deep-purple: "#673AB7"
  status-connected: "#4CAF50"
  status-connecting: "#FF9800"
  status-error: "#F44336"
  status-neutral: "#9E9E9E"
  on-danger: "#FFFFFF"
typography:
  title:
    fontFamily: "Roboto, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
  label:
    fontFamily: "Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  caption:
    fontFamily: "Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 400
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.seed-deep-purple}"
    textColor: "#FFFFFF"
    padding: "16px 24px"
  button-danger:
    backgroundColor: "{colors.status-error}"
    textColor: "{colors.on-danger}"
    padding: "14px 24px"
---

# Design System: Live Sidestage

## Overview

**Creative North Star: "The Silent Co-Pilot"**

Live Sidestageは、配信者が画面を見なくても信頼して任せられる道具として存在する。配信の主役は配信者自身とコメントであり、UIはその邪魔をしない。装飾はほとんど無く、Flutter Material3のデフォルト挙動をそのまま採用している。唯一UIが積極的に発言するのは「今どういう状態か」を伝える時――接続中/接続済み/切断/エラーを色付きドットとテキストで即座に示す瞬間だけであり、それ以外の場面では静かに背景へ徹する。

現状これは意図的にミニマルへ振り切ったデザインシステムというより、機能実装を優先した結果として「Material3をほぼ素のまま使う」状態にある。今後の一般公開に向けては、この北極星(静かな信頼性)を保ったまま、ブランドとしての意図的な選択(seedカラーの再検討、ダークテーマ対応など)を積み増していくのが自然な発展方向。

**Key Characteristics:**
- Material3のColorScheme/TextThemeにほぼ全面依存し、独自トークンをほとんど持たない
- 状態(接続・読み上げ・エラー)を色で即座に伝える、機能的な色使い
- ホームは3タブのボトムナビ(TTS / サウンド / 設定)。各タブの中身は単一目的の縦積みを保つ
- 装飾的なshadow・アニメーション・カスタムフォントは無い

## Colors

パレットは実質、Material3のseedカラー1色と、状態伝達のための4つの信号色のみで構成される。

### Primary
- **Deep Purple Seed** (`#673AB7`): `ThemeData(colorSchemeSeed: Colors.deepPurple, useMaterial3: true)`で指定されるシード色。ここから`ColorScheme.fromSeed`がprimary/on-primary/surface等のロールトークンを自動生成する。個々のロールの正確な値はランタイム計算に委ねられており、コード上に固定hexとして明示的なオーバーライドは無い。FilledButton(読み上げ開始ボタン等)がこのprimaryロールを直接使う唯一の目立つ箇所。

### Neutral / Status(実装上はNeutralではなく状態伝達色)
- **Connected Green** (`#4CAF50` / `Colors.green`): Socket.IO接続が確立し、コメント受信可能な状態。
- **Connecting Orange** (`#FF9800` / `Colors.orange`): 接続試行中の一時状態。
- **Error Red** (`#F44336` / `Colors.red`): 切断エラー、読み上げエラー、および「読み上げ停止」ボタンの背景(危険なアクションであることを示す)。
- **Muted Grey** (`#9E9E9E` / `Colors.grey`): 切断状態、補助テキスト(VOICEVOX準備中、話者名表示など)、二次的な説明文。

### Named Rules
**The Signal-Only Color Rule.** Green/Orange/Red/Greyの4色は状態伝達のためだけに存在する。装飾目的でこれらの色を使わない。新しいUI要素の色分けが必要になった場合も、まず「これは状態を示しているか」を自問すること。

## Typography

**Display/Title Font:** Roboto (Material3標準、フォールバック sans-serif)
**Body Font:** Roboto (Material3標準TextTheme、明示的な上書き無し)

**Character:** Material3デフォルトのRoboto一本に依存し、独自のタイプフェイスやカスタムスケールは持たない。サイズの手打ちも最小限(ウェルカム画面のアプリ名タイトルのみ)。

### Hierarchy
- **Title** (bold 700, 28px, line-height 1.2): アプリ名の表示。ウェルカム画面のみで使用される唯一の大型見出し。
- **Body** (regular 400, 16px、Material3 bodyLarge/bodyMedium相当): ボタンラベル、フォームラベル、コメント本文・ニックネームなど、画面の大半のテキスト。
- **Label** (regular 400, 12〜13px, grey): 補助的な状態テキスト(「ランダムボイス」ラベル、「VOICEVOX準備中…」、話者名表示)。
- **Caption** (regular 400, 11px, red): エラーメッセージの縮小表示(接続エラー詳細など、スペースが限られる箇所)。

### Named Rules
**The One Title Rule.** 28px boldの大型タイトルはウェルカム画面のアプリ名一箇所のみに予約されている。他画面で見出しサイズを増やして視覚的な重みを作らない。

## Layout

アプリ全体の遷移はAuthGateによる状態駆動(未ログイン→オンボーディング→ホーム)。ホーム画面のみ、Material3 `NavigationBar`による3タブ構成(TTS / サウンド / 設定)を持つ。

ホームのシェルは「AppBar → 接続ステータスバー → 開始/停止ボタン → `IndexedStack`(3タブ) → NavigationBar」の縦積み。`IndexedStack`にしているのは、タブを切り替えてもコメントリストのスクロール位置と`ScrollController`を失わないため。Foreground Serviceからの状態受信(`addTaskDataCallback`)もシェルに集約し、タブ側は表示だけを担う。

タブより深い階層(音源ライブラリ、外部サイト検索、トリガー編集)は`Navigator.push`のフルスクリーンページとして積む。ボトムナビはホーム階層にのみ存在し、pushしたページには出ない。

各タブおよび各ページの中身は従来どおり単一目的の縦積み(`Column`/`ListView`/`Padding`)で、パディングは8/16/24/32pxの4段階に収まっている。タブレット・横画面・レスポンシブ分岐は未実装で、Android電話サイズの縦持ちのみを前提にしている。TTSタブのコメントリストは新着下寄せで自動スクロールする。

## Elevation & Depth

恣意的なdrop shadowは無い。AppBarやFilledButtonなど、Material3コンポーネントの標準tonal elevationにそのまま依存している。カスタムShadow定義・独自の浮遊感演出は無し。

### Named Rules
**The Flat-By-Default Rule.** 深度はMaterial3のロールトークン(tonal elevation)にのみ由来する。カスタムBoxShadowや手動elevation値を追加しない。

## Shapes

FilledButton・TextFormField・AlertDialog・Switchはすべて Material3 のデフォルト角丸・形状をそのまま使用しており、`shape:`や`BorderRadius`によるオーバーライドはコード中に存在しない。独自の角丸スケールは無い。

## Components

### Buttons
- **Shape:** Material3 FilledButtonのデフォルト形状(pill型、明示的なradius指定なし)。
- **Primary:** `FilledButton`/`FilledButton.icon`。読み上げ開始・ログイン・連携する・変更する、など画面の主アクションに使用。縦paddingは12〜14px程度。
- **Danger variant:** 読み上げ停止ボタンのみ`backgroundColor: Colors.red`で上書きされる。危険/停止アクション専用。
- **Secondary / Text:** `TextButton`(ダイアログの「キャンセル」、AppBarの「保存」)。`OutlinedButton.icon`はトリガー編集画面の「テスト発火」のみ――主アクション(保存)と競合させずに、副次的で非破壊な確認操作であることを示す。
- **FAB:** `FloatingActionButton.extended`(サウンドタブ・音源ライブラリの「追加」)。リストへ要素を足す操作にのみ使う。

### Navigation

- **Bottom Nav:** Material3 `NavigationBar`。TTS(`Icons.record_voice_over`) / サウンド(`Icons.music_note`) / 設定(`Icons.settings`)の3タブ固定。タブは増やさない前提で設計している。
- **Deeper pages:** タブから`Navigator.push`する全画面ページ(音源ライブラリ、外部サイト検索、トリガー編集)。戻る導線は標準AppBarのback。

### Selection Controls

- **SegmentedButton:** 排他的で選択肢が2〜3個の切替(イベント種別 ギフト/コメント/フォロー、再生モード 全部順に/1つランダム、コメント一致 すべて/完全一致)に使う。ドロップダウンより現在値が読み取りやすいため。4個以上になる場合は`DropdownButtonFormField`(カテゴリ選択)に切り替える。
- **SwitchListTile / CheckboxListTile:** ON/OFFは`SwitchListTile`、複数選択(トリガーに紐づける音源)は`CheckboxListTile`。
- **Slider:** 0-100の音量のみ。`divisions: 20`で5刻みに丸め、指先で狙える粒度にする。

### Grouping

- **ExpansionTile:** サウンドタブのカテゴリ。既定で展開しておき、trailingにカテゴリ一括ON/OFFの`Switch`と`PopupMenuButton`(名前変更・削除)を並べる。
- **Section header:** 設定タブ・トリガー編集画面の見出しは12px bold + primary色の`Padding`。`Divider`ではなくこの見出しで区切る。

### Menus / Sheets

- **PopupMenuButton:** リスト項目の副次操作(削除、名前変更、音量変更)。
- **BottomSheet:** 「追加」FABの分岐(カテゴリ/トリガー、端末内/効果音ラボ/MyInstants)。選択肢が3つ程度で、それぞれが別のフローへ入る場合に使う。

### Dialogs
- **Style:** 標準`AlertDialog`。タイトル+フォーム1項目+キャンセル/確定の2ボタン、という最小構成を守る(TikTok ID変更、カテゴリ名、対象ユーザー、音量)。
- **Destructive:** 削除確認のみ確定ボタンを`backgroundColor: Colors.red`で上書きする。本文には影響範囲を数字で書く(「N件のトリガーから参照が外れます」)。

### Inputs / Fields
- **Style:** 標準`TextFormField`、ラベルのみのシンプルな`InputDecoration`(枠線色・アイコン等のカスタムなし)。
- **Error / Validation:** `validator`によるインライン必須チェックのみ(空欄エラー)。

### List Items
- **Style:** コメント表示に標準`ListTile`を使用。`CircleAvatar`(プロフィール画像 or 人型アイコンのフォールバック)+ニックネーム(title)+コメント本文(subtitle)。1pxの`Divider`で区切る。

### Status Bar(Signature Component)
- **Description:** ホーム画面上部に常駐する接続状態バー。背景は状態色を`withValues(alpha: 0.12)`で薄く敷き、状態色の小さな`Icon(Icons.circle)`ドット+ラベルテキストを横並びに配置。エラー時のみ詳細メッセージを右側に省略表示で追加する。このアプリで最もアプリらしい、独自に設計された唯一のコンポーネント。

### Switch
- **Style:** 標準`Switch`(ランダムボイスON/OFF)。VOICEVOX初期化完了前は同サイズの空`SizedBox`を代わりに表示し、無効状態のSwitchを一切マウントしない(既知のFlutter描画バグの回避策)。

## Do's and Don'ts

### Do:
- **Do** 状態色(green/orange/red/grey)は接続・読み上げ・エラー状態の伝達にのみ使う。
- **Do** 主要アクションは`FilledButton`、破壊的/停止アクションのみ赤背景でオーバーライドする。
- **Do** Material3のロールトークン・tonal elevationに任せ、固定hexやカスタムshadowを増やさない。
- **Do** 新しい画面も各ページ内は「単一目的の縦積み」構造を踏襲する。深い階層が要るときはボトムナビを増やさず`Navigator.push`で積む。
- **Do** 破壊的操作(削除)は必ず`AlertDialog`で確認し、失われるものを具体的に書く。

### Don't:
- **Don't** iOS由来のコンポーネント(Cupertinoスイッチ・ダイアログ等)を混在させない。Material3コンポーネントのみを使う。
- **Don't** 装飾目的で新しい色を追加しない。状態を表さない色は原則Material3のロールトークン(surface/onSurface等)から取る。
- **Don't** ダークテーマは現状未対応(`ThemeData`に`darkTheme`指定なし)。対応するまでは、ダーク前提の配色決め打ちを行わない。
- **Don't** タブレット・横画面・レスポンシブ分岐は未検証。対応するまでは固定幅前提のレイアウトを増やさない。
- **Don't** ボトムナビのタブを4つ以上に増やさない。機能が増える場合は既存3タブのいずれかの配下へpushする。
