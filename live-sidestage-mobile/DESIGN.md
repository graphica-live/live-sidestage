---
name: LIVE Sidestage
description: 上品さと高揚感を両立させる、光彩(グラデーション)のアプリ
colors:
  accent-light: "#9B6BFF"
  accent-dark: "#9B6BFF"
  kosai-coral: "#FF7A59"
  kosai-violet: "#9B6BFF"
  kosai-mint: "#2FC6A0"
  bg-light: "#FAF7F5"
  bg-dark: "#17151A"
  card-light: "#FFFFFF"
  card-dark: "#1F1B24"
  ink-light: "#2A2130"
  ink-dark: "#F1EDF5"
  sub-light: "#7C7286"
  sub-dark: "#A79FB0"
  line-light: "#EFE6E9"
  line-dark: "#332C3B"
  status-connected: "#4CAF50"
  status-connecting: "#FF9800"
  status-error-light: "#E24B4B"
  status-error-dark: "#FF5C5C"
  status-neutral: "#9E9E9E"
  on-danger: "#FFFFFF"
typography:
  display:
    fontFamily: "Zen Maru Gothic, ui-sans-serif, sans-serif"
    fontWeight: 700
  body:
    fontFamily: "Zen Kaku Gothic New, ui-sans-serif, sans-serif"
    fontSize: "16px"
    fontWeight: 400
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "#FFFFFF"
    padding: "16px 24px"
  button-danger:
    backgroundColor: "{colors.status-error-light}"
    textColor: "{colors.on-danger}"
    padding: "14px 24px"
---

# Design System: LIVE Sidestage

## Overview

**Creative North Star: "光彩(Kosai)"**

LIVE Sidestageは、上品さと高揚感を両立させる世界観に刷新した(2026-09、Mixer Consoleから移行)。「配信機材」「ゲーム」といった題材モチーフから離れ、洗練されたプロダクトとしての品位を余白・タイポグラフィ・階調で語る一方、ギフトが届く瞬間の高揚感を装飾グラデーション(コーラル→バイオレット→ミント)で表現する。いわゆるネオン・ダークグラスのようなサイバー系表現(AI生成UIで陳腐化しているパターン)は意図的に避け、白地を基調にした軽やかな配色を採る。

**Key Characteristics:**
- 独自トークンは`main.dart`の`_buildTheme()`1箇所(バイオレットaccent・Zen Maru Gothic/Zen Kaku Gothic New・カード角丸18px)に集約
- 装飾グラデーション3色(コーラル `#FF7A59` / バイオレット `#9B6BFF` / ミント `#2FC6A0`)は`widgets/gradient_kit.dart`の`KosaiPalette`に集約し、バッジ・見出し文字・カード枠・メダル・アバター枠にのみ使う
- 状態伝達色(接続・読み上げ・エラー)は装飾グラデーションとは別レイヤーとして扱い、既存のSignal-Only Color Rule(green/orange/red/grey)を維持する
- ホームは6タブのボトムナビ(TTS / サウンド / 設定 / 貢献 / ギフト履歴 / バトル履歴)。各タブの中身は単一目的の縦積みを保つ
- カード類は角丸18px、chip/バッジ/メダル/アバターは999(完全円形)。Mixer Console期の直線的な8px角丸から、より柔らかい大きめの角丸へ移行

## Colors

ライト/ダーク双方を同格で作る。背景・カード・文字色はテーマごとに別トークンを持ち、accent(バイオレット)・amber・errorの3色だけライト/ダークで明度違いの対を持つ。状態伝達の信号色はこれと独立。

### Primary
- **Violet Accent** (`#9B6BFF`、ライト/ダーク共通): `main.dart`の`_buildTheme()`でColorSchemeの`primary`へ直接指定する固定値。FilledButton・アクティブなNavigationBarアイコン・スライダー・コイン数値がこのロールを直接使う。
- **装飾グラデーション3色**(コーラル `#FF7A59` / バイオレット `#9B6BFF` / ミント `#2FC6A0`): `widgets/gradient_kit.dart`の`KosaiPalette`に集約。プランバッジ・タブ見出し文字・サマリーカード合計値・カード外枠・1〜3位メダル・アバター枠にのみ使う装飾専用の色で、状態伝達色とは別レイヤー。単色のアクセント(`colorScheme.primary`)とも別物として扱い、混同しない。
- **Background / Card / Ink / Sub / Line** はいずれも承認済みcomp(`.impeccable/approved/home-screen-kosai/`)の実測hexをそのまま`_buildTheme()`へハードコードしている(light: bg `#FAF7F5` / card `#FFFFFF` / ink `#2A2130` / sub `#7C7286` / line `#EFE6E9`、dark: bg `#17151A` / card `#1F1B24` / ink `#F1EDF5` / sub `#A79FB0` / line `#332C3B`)。ダーク値はcompに無いため実装時の仮置き(未解決事項として`spec.md`に記載済み、実機確認後に調整の可能性あり)。
- **`ColorScheme.fromSeed`任せにしない。** fromSeedのトーンパレット生成はseed色の彩度・明度を自動シフトするため、背景・カード・アクセントの主要トークンはfromSeedの出力に依存せず、compの数値を直接`ColorScheme.copyWith`で上書きする(Card Deck期からの既存方針を継続)。
- 2026-09にLED Green+Amber(Mixer Console)からバイオレット単色accent+装飾グラデーション3色(光彩)へ変更。「配信機材」というモチーフを離れ、上品さと高揚感を両立させる方向へ転換した。
- 状態伝達色(接続・読み上げ・エラー)は既存のSignal-Only Color Ruleを維持し、装飾グラデーションへ統合しない(下記Named Rules参照)。

### Neutral / Status(実装上はNeutralではなく状態伝達色)
- **Connected Green** (`#4CAF50` / `Colors.green`): Socket.IO接続が確立し、コメント受信可能な状態。LEDドットはダークテーマでのみ`boxShadow`で発光させる(ライトの筐体上では発光が目立ちすぎるため)。
- **Connecting Orange** (`#FF9800` / `Colors.orange`): 接続試行中の一時状態。
- **Error Red** (light `#E24B4B` / dark `#FF5C5C` / `colorScheme.error`): 切断エラー、読み上げエラー、および「読み上げ停止」ボタンの背景(危険なアクションであることを示す)。固定の`Colors.red`直書きではなく`colorScheme.error`/`onError`経由に統一する(2026-09、ダークで発光色と衝突しない明度を個別に持たせるため)。
- **Muted Grey** (`#9E9E9E` / `Colors.grey`): 切断状態、補助テキスト(VOICEVOX準備中、話者名表示など)、二次的な説明文。

### Named Rules
**The Signal-Only Color Rule.** Green/Orange/Red/Greyの4色は状態伝達のためだけに存在する。装飾目的でこれらの色を使わない。新しいUI要素の色分けが必要になった場合も、まず「これは状態を示しているか」を自問すること。

**例外: TTSタブの読み上げ中ハイライト。** `colorScheme.primaryContainer`を薄く敷いて「今読み上げ中のコメント」を示す(`tts_tab.dart`)。4色の状態色そのものではないが、装飾ではなく状態伝達の用途に限定した例外として認める。

## Typography

**Display Font:** Zen Maru Gothic(`google_fonts`パッケージ、フォールバック sans-serif、bold 700)
**Body Font:** Zen Kaku Gothic New(`google_fonts`パッケージ)

**Character:** 2026-09にSpace Grotesk/IBM Plex Sans/Space Monoの3書体構成(Mixer Console)から、Zen Maru Gothic(見出し)+Zen Kaku Gothic New(本文・データ表示すべて)の2書体構成(光彩)へ変更。丸みのある見出し書体で柔らかさ・親しみやすさを出しつつ、本文は引き締まったゴシックで可読性を保つ。等幅のデータ専用書体は廃止し、コイン数等の数値も本文書体で統一する(桁揃えは`tabular-nums`相当の効果を持つフォント機能に依存せず、数値の並びが乱れないことを実機で確認する)。サイズ階層はMaterial3 TextThemeのロール名に準拠する。TTFはアセット同梱せず`google_fonts`が初回起動時にネットワーク取得してキャッシュする(オフライン初回起動時はシステムフォールバック書体になる)。

### Hierarchy
- **Display** (Zen Maru Gothic bold 700, 28px, line-height 1.2): アプリ名の表示。ウェルカム画面のみで使用される唯一の大型見出し。
- **Tab Title** (Zen Maru Gothic bold 700, 22px、グラデーション文字): 各タブの見出し(例:「貢献」)。`widgets/gradient_kit.dart`の`GradientText`を使う。
- **Body** (Zen Kaku Gothic New regular 400, 16px、Material3 bodyLarge/bodyMedium相当): ボタンラベル、フォームラベル、コメント本文・ニックネームなど、画面の大半のテキスト。
- **Data** (Zen Kaku Gothic New 700, 13px): コイン数・ランキング順位・日付など、桁を揃えたい数値表示。合計値のみ25px/800でグラデーション文字。
- **Label** (Zen Kaku Gothic New regular 400, 12〜13px, grey): 補助的な状態テキスト(「ランダムボイス」ラベル、「VOICEVOX準備中…」、話者名表示)。
- **Caption** (Zen Kaku Gothic New regular 400, 11px, error色): エラーメッセージの縮小表示(接続エラー詳細など、スペースが限られる箇所)。

### Named Rules
**The One Title Rule.** 28px boldの大型見出しはウェルカム画面のアプリ名一箇所のみに予約されている。他画面で見出しサイズを増やして視覚的な重みを作らない。

## Layout

アプリ全体の遷移はAuthGateによる状態駆動(未ログイン→オンボーディング→ホーム)。ホーム画面のみ、Material3 `NavigationBar`による6タブ構成(TTS / サウンド / 設定 / 貢献 / ギフト履歴 / バトル履歴)を持つ。

ホームのシェルは「AppBar → 接続ステータスバー → 開始/停止ボタン → `IndexedStack`(6タブ) → NavigationBar」の縦積み。`IndexedStack`にしているのは、タブを切り替えてもコメントリストのスクロール位置と`ScrollController`を失わないため。Foreground Serviceからの状態受信(`addTaskDataCallback`)もシェルに集約し、タブ側は表示だけを担う。

**貢献/ギフト履歴/バトル履歴の3タブはanalyticsサーバーへのプル型API呼び出しを行うタブで、TTS/サウンド/設定とは性質が異なる。** `IndexedStack`は全タブを起動時に同時マウントするため、`active`(自分が選択中のタブか)が最初に`true`になった時点で1回だけ読み込む。TikTok ID変更時に旧IDのデータを見せ続けないよう、`ValueKey(tiktokId)`をこの3タブに付けてStateごと作り直している。

タブより深い階層(ギフトと音の編集、外部サイト検索)は`Navigator.push`のフルスクリーンページとして積む。ボトムナビはホーム階層にのみ存在し、pushしたページには出ない。

**TTSタブとサウンドタブは運用画面、設定タブは設定画面。** 前者は配信中に見る場所なので、状態表示・開始/停止・一覧だけを置き、設定項目は置かない。ランダムボイス・ボイスの選択・読み上げ音量・効果音の全体音量はすべて設定タブにある。同じ設定を運用画面にも出すと二重になり、どちらが効いているのか分からなくなる(実際、ランダムボイスと読み上げ音量は一時期TTSタブと設定タブの両方にあった)。運用中に触りたい音量も、ボトムナビ1タップで届く設定タブに置けば足りる。

**設定項目を「開始しているか」で無効化しない。** `AppConfig.ttsEnabled` と `SoundConfig.enabled` は機能のON/OFF設定ではなく**開始しているかの記録**なので、これで`disabled`にすると「一度開始しないと設定できない」画面になる(実際、ボイス選択を足すまでランダムボイスと読み上げ音量が停止中は触れなかった)。停止中の変更は永続化されて次の起動時に読まれ、運用中の変更も背景Isolateへ届く。止めてよいのは開始/停止の遷移中(`busy`)だけで、これは「設定を保存 → サービス起動」の途中に挟まった変更が背景へ渡らないため。

サウンドタブは「ギフト → 音」の平坦な1階層リスト。カテゴリ・トリガー・音源ライブラリという中間階層は持たない。編集画面も「ギフトを選ぶ」「音を選ぶ」の2行と音量スライダーだけで、条件を組み立てるフォームにはしない。**配信中に片手で触る道具なので、設定の階層を増やさないことを機能追加より優先する。**

各タブおよび各ページの中身は従来どおり単一目的の縦積み(`Column`/`ListView`/`Padding`)で、パディングは8/16/24/32pxの4段階に収まっている。タブレット・横画面・レスポンシブ分岐は未実装で、Android電話サイズの縦持ちのみを前提にしている。TTSタブのコメントリストは新着下寄せで自動スクロールする。

## Elevation & Depth

光彩でも、要素をカードへ分離して積む構成自体は維持する。`main.dart`の`_buildTheme()`が`CardThemeData`(elevation 0、角丸18、`line`トークン色の1px枠線、`surfaceTintColor: transparent`)を全域へ適用し、個々の画面はカスタムShadowを手打ちしない(テーマ1箇所への集約を保つ)。唯一の例外は`widgets/gradient_kit.dart`の`GradientBorderCard`(サマリーカード用の二重枠構造)と`ListPanel`(リスト全体の淡い浮き影)で、これらはグラデーション枠や意図的な浮遊感を表現するためテーマの単純な1px枠では再現できず、個別にdecorationを持つ。

### Named Rules
**The Kosai Softness Rule(旧: Mixer Panel Rule / Card Deck Rule).** 深度・角丸は`main.dart`の`CardThemeData`1箇所を基本に由来する。個々の画面・Widgetで独自のBoxShadowを追加するのは、`GradientBorderCard`のようにグラデーション自体が視覚的な主役になる箇所に限る。角の丸みは18pxを基本とし、chip/バッジ/メダル/アバターは999(完全円形)。Mixer Console期の直線的な8pxから、柔らかく浮くような大きめの角丸へ移行した。

## Shapes

`main.dart`の`_buildTheme()`がCard(角丸18+line色の1px枠線)・ListTile(角丸18)・Chip(スタジアム形)・FilledButton(角丸18)の形状をテーマ側で一括指定する。角丸を8→18へ拡大したのはMixer Console期の直線的な機材パネル感を捨て、白磁のような柔らかさを狙ったため。Chipはスタジアム形(角丸最大)を維持。バッジ・メダル・アバターは`BoxShape.circle`の完全円形で、いずれも`widgets/gradient_kit.dart`のグラデーション実装。TextFormField・AlertDialog・Switchは Material3 のデフォルト形状のまま(個別のオーバーライドは無い)。

## Components

### Buttons
- **Shape:** `_buildTheme()`の`filledButtonTheme`で角丸18に統一(Material3デフォルトのpill型から変更、`radius`定数をCard等と共有)。
- **Primary:** `FilledButton`/`FilledButton.icon`。読み上げ開始・ログイン・連携する・変更する、など画面の主アクションに使用。縦paddingは12〜14px程度。
- **Danger variant:** 読み上げ停止ボタンのみ`backgroundColor: colorScheme.error`で上書きされる(`Colors.red`直書きは廃止、2026-09)。危険/停止アクション専用。ボタン内の`CircularProgressIndicator`もこの状態では`onError`を使い、`onPrimary`固定にしない――ダークテーマのLED Green primaryは`onPrimary`が暗色になるため、停止中はエラー色に合わせた明るい色を明示的に選ぶ。
- **Secondary / Text:** `TextButton`(ダイアログの「キャンセル」、AppBarの「保存」)。`OutlinedButton.icon`は編集画面の「テスト再生」のみ――主アクション(保存)と競合させずに、副次的で非破壊な確認操作であることを示す。
- **FAB:** `FloatingActionButton.extended`(サウンドタブの「追加」)。リストへ要素を足す操作にのみ使う。

### Navigation

- **Bottom Nav:** Material3 `NavigationBar`。TTS(`Icons.record_voice_over`) / サウンド(`Icons.music_note`) / 設定(`Icons.settings`) / 貢献(`Icons.emoji_events`) / ギフト(`Icons.card_giftcard`) / バトル(`Icons.bolt`)の6タブ固定。元は「タブは増やさない前提」で3タブ固定としていたが、2026-08にanalyticsの貢献/ギフト履歴/バトル履歴をネイティブUIで見せる要望に応じ、例外的に3タブ追加した。ラベルは幅の都合で短縮形にしている(正式名称はタブ内見出しで示す)。今後さらに増やす際は、この例外を重ねてよいかを再検討すること。
- **Deeper pages:** タブから`Navigator.push`する全画面ページ(ギフトと音の編集、外部サイト検索)。戻る導線は標準AppBarのback。

### Selection Controls

- **SwitchListTile:** ON/OFFに使う(効果音全体、1行ごとの有効/無効)。
- **Slider:** 0-100の音量のみ。`divisions: 20`で5刻みに丸め、指先で狙える粒度にする。全体音量は`onChangeEnd`で確定する(ドラッグ中に永続化すると1回の操作で数十回の書き込みが走る)。
- **SegmentedButton / CheckboxListTile:** 現在は使っていない。排他的で選択肢が2〜3個の切替が必要になったら`SegmentedButton`を、複数選択が必要になったら`CheckboxListTile`を使う。

### Grouping

- **Section header:** 設定タブ・編集画面の見出しは12px bold + primary色の`Padding`。`Divider`ではなくこの見出しで区切る。
- **ExpansionTile:** 現在は使っていない。リストが階層を持つときにだけ検討する。

### Menus / Sheets

- **BottomSheet:** 選択肢が3つ程度でそれぞれ別のフローへ入る分岐(端末内/効果音ラボ/MyInstants)と、一覧から1件選ぶピッカー(ギフト選択)に使う。
- **PopupMenuButton:** リスト項目の副次操作。現在は使っていない。

### Picker (BottomSheet)

ギフト選択のような「候補一覧から1件選ぶ」ピッカーは次の形に揃える。

- **高さ:** `(画面高 - キーボード高) * 0.85` を上限にする。固定高にすると入力中に画面からはみ出す。リストは`Flexible`に入れ、絞り込みで件数が変わっても高さが跳ねないようにする。
- **検索:** 未入力なら全件。入力のたびにローカルで即時絞り込む(候補は最大1000件だが`ListView.builder`は遅延生成なのでサーバーへ問い合わせ直さない)。`autofocus`はしない――未入力の全件を見たいときにキーボードが一覧を半分隠すため。クリアボタンは入力があるときだけ出す。
- **絞り込み:** 数値の範囲指定は`ChoiceChip`の横スクロール(コイン帯 すべて/1〜9/10〜49/50〜99/100〜199/200〜499/500〜999/1000〜4999/5000〜9999/10000以上)。数値入力欄にするとキーボードが検索欄と競合する。**刻みは候補の分布に合わせる**――等間隔にすると、候補が密集する帯(安いギフト)で1つのチップに大半が残り、絞り込みとして機能しない。**候補が値ではなく範囲を持つ場合、絞り込みは範囲の重なりで判定する**(下限だけ・上限だけを見ると価格違いのある候補が帯から漏れる)。選択中のチップをもう一度タップすると、そのコイン帯内の並び順が昇順⇔降順に切り替わる(帯を切り替えたときは常に昇順から始まる)。
- **ブロックワード:** ギフト名(`name`/`label`/`labelJa`)に卑猥語が含まれる候補は一覧・検索のどちらにも出さない(`isBlockedGift`、`lib/screens/gift_sound_edit_screen.dart`)。判定はひらがな・カタカナの違いを無視する。TikTok の gift API には「隠すべきギフトか」を示すフィールドが無いため、名前ベースの部分一致で弾いている。
- **値に幅があるなら幅のまま見せる:** 同じギフト名でコイン数が違うことがあるので、`1〜1800コイン`のように範囲で出す。片方だけを単一値として出すと、ユーザーが誤った前提で設定する(「大物ギフト用」に仕込んだ音が安い方でも鳴る)。
- **既知/未知の印:** 「自分が受け取ったことがある」候補には`Icons.check_circle`をprimary色で付け、先頭に寄せる。印が無い行でも`SizedBox(width: 24)`で枠を確保し、タイトルの左端を揃える。
- **自由入力:** 候補一覧は網羅ではないので、**入力文字列をそのまま採用する導線を残す**。ただし常設ではなく、入力があって完全一致が一覧に出ていないときだけ行として出す(同じ意味の導線を2つ並べない)。
- **空状態を区別する:** 「候補がそもそも無い」と「絞り込みに掛からなかった」を別の文言にし、後者には絞り込み解除を添える。

### Dialogs
- **Style:** 標準`AlertDialog`。タイトル+フォーム1項目+キャンセル/確定の2ボタン、という最小構成を守る(TikTok ID変更)。
- **Destructive:** 削除確認のみ確定ボタンを`backgroundColor: Colors.red`で上書きする。本文には何が消えるかを具体名で書く(「「rose」の設定を削除します。」)。

### Inputs / Fields
- **Style:** 標準`TextFormField`、ラベルのみのシンプルな`InputDecoration`(枠線色・アイコン等のカスタムなし)。
- **Error / Validation:** `validator`によるインライン必須チェックのみ(空欄エラー)。

### List Items
- **Style:** コメント表示に標準`ListTile`を使用。`CircleAvatar`(プロフィール画像 or 人型アイコンのフォールバック)+ニックネーム(title)+コメント本文(subtitle)。1pxの`Divider`で区切る。

### Ranking List(貢献タブ・バトル履歴貢献者展開共通、2026-09改訂)
- **Style:** `RankingListTile`(`lib/screens/widgets/ranking_list_tile.dart`)が貢献タブとバトル履歴タブの貢献者展開(`showModalBottomSheet`)の両方で共有される(サーバー側が同じ形状のデータを返すため)。**行そのものの見た目(`Card`の枠・サイズ・コイン数のフォントサイズ)は順位によらず統一する。** 一時期、上位3人だけ表彰台レイアウト(`RankingPodium`)へ切り出す案を実装したが、通常リストとの視覚差が大きすぎるとして撤回し、この統一形へ戻した。
- **順位バッジ:** 1〜3位だけ、行頭の順位数字を`widgets/gradient_kit.dart`の`GradientMedal`(丸・白文字、1位=c1→c2、2位=c2→c3、3位=c3→c1のグラデーション、3位のみopacity .85)にする。4位以下はプレーンな数字テキストのまま。装飾グラデーションであり、Signal-Only Color Ruleの対象(green/orange/red/grey)には含まれない。
- アバターは`GradientRing`(c1→c2の1.5pxグラデーション枠)で囲む。
- コイン数は`🪙3,613`のようにカンマ区切りで表示する(`diamond_format.dart`の`formatDiamonds()`)。フォントはw700/13px・色は`KosaiPalette.c2`単色(グラデーションではない)。
- バトル履歴タブの貢献者展開でも同じ`RankingListTile`が使われる。両画面とも「ギフト貢献ランキング」という同一文脈のため共有している。

### Status Bar(Signature Component)
- **Description:** ホーム画面上部に常駐する接続状態バー。背景は状態色を`withValues(alpha: 0.12)`で薄く敷き、状態色の小さな円形ドット+ラベルテキストを横並びに配置。エラー時のみ詳細メッセージを右側に省略表示で追加する。このアプリで最もアプリらしい、独自に設計された唯一のコンポーネント。
- **LED発光(2026-09追加):** ドットは`Container`+`BoxDecoration`で描き、ダークテーマのときだけ`boxShadow`(同色・alpha 0.7・blurRadius 8)を足して発光させる。ライトの筐体上では発光が目立ちすぎるため、ライトテーマでは`boxShadow`を付けない。「機材のLED」という北極星を最も具体的に体現する箇所。

### Switch
- **Style:** 標準`Switch`(ランダムボイスON/OFF)。VOICEVOX初期化完了前は同サイズの空`SizedBox`を代わりに表示し、無効状態のSwitchを一切マウントしない(既知のFlutter描画バグの回避策)。

## Do's and Don'ts

### Do:
- **Do** 状態色(green/orange/red/grey)は接続・読み上げ・エラー状態の伝達にのみ使う。
- **Do** 主要アクションは`FilledButton`、破壊的/停止アクションのみ赤背景でオーバーライドする。
- **Do** Material3のロールトークン・tonal elevationに任せ、固定hexやカスタムshadowを増やさない。
- **Do** 新しい画面も各ページ内は「単一目的の縦積み」構造を踏襲する。深い階層が要るときは原則ボトムナビを増やさず`Navigator.push`で積む(2026-08の貢献/ギフト履歴/バトル履歴タブ追加は例外的にボトムナビを増やした判断で、今後の追加はまず`Navigator.push`を検討する)。
- **Do** 破壊的操作(削除)は必ず`AlertDialog`で確認し、失われるものを具体的に書く。

### Don't:
- **Don't** iOS由来のコンポーネント(Cupertinoスイッチ・ダイアログ等)を混在させない。Material3コンポーネントのみを使う。
- **Don't** 装飾目的で新しい色を追加しない。状態を表さない色は原則Material3のロールトークン(surface/onSurface等)から取る。
- **Don't** ライト/ダークどちらかだけを検証して終えない。`main.dart`の`_buildTheme(Brightness)`はライト/ダーク双方を同格で分岐する設計(2026-09〜)。片方専用の決め打ち値(`Colors.red`直書き等)を新設しない――必ず`colorScheme`経由でテーマに応じて解決させる。
- **Don't** タブレット・横画面・レスポンシブ分岐は未検証。対応するまでは固定幅前提のレイアウトを増やさない。
- **Don't** ボトムナビのタブを安易に増やさない。2026-08に貢献/ギフト履歴/バトル履歴の3タブを例外的に追加して6タブになったが、これは「タブは増やさない」原則からの明示的な逸脱であり通例ではない。さらに増やしたくなったら、まず既存6タブのいずれかの配下へpushできないかを疑う。
- **Don't** 設定項目をTTSタブ・サウンドタブへ置かない。設定は設定タブへ集約する(Layout参照)。運用画面に置きたくなったら、それが本当に「今の状態」ではなく「設定」なのかをまず疑う。
- **Don't** サウンド設定に中間階層(カテゴリ、トリガー、共有音源ライブラリ)を戻さない。desktop(TikEffect)には全部あるが、モバイルは配信中に片手で触る道具なので「ギフト → 音」の1階層に閉じる。条件を増やしたくなったら、まず既存の1行で表現できないかを疑う。
