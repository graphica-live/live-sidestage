---
name: LIVE Sidestage
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

# Design System: LIVE Sidestage

## Overview

**Creative North Star: "The Silent Co-Pilot"**

LIVE Sidestageは、配信者が画面を見なくても信頼して任せられる道具として存在する。配信の主役は配信者自身とコメントであり、UIはその邪魔をしない。装飾はほとんど無く、Flutter Material3のデフォルト挙動をそのまま採用している。唯一UIが積極的に発言するのは「今どういう状態か」を伝える時――接続中/接続済み/切断/エラーを色付きドットとテキストで即座に示す瞬間だけであり、それ以外の場面では静かに背景へ徹する。

現状これは意図的にミニマルへ振り切ったデザインシステムというより、機能実装を優先した結果として「Material3をほぼ素のまま使う」状態にある。今後の一般公開に向けては、この北極星(静かな信頼性)を保ったまま、ブランドとしての意図的な選択(seedカラーの再検討、ダークテーマ対応など)を積み増していくのが自然な発展方向。

**Key Characteristics:**
- Material3のColorScheme/TextThemeにほぼ全面依存し、独自トークンは`main.dart`の`_buildTheme()`1箇所(タンジェリンseed・IBM Plex Mono・CardThemeData)に集約
- 状態(接続・読み上げ・エラー)を色で即座に伝える、機能的な色使い
- ホームは6タブのボトムナビ(TTS / サウンド / 設定 / 貢献 / ギフト履歴 / バトル履歴)。各タブの中身は単一目的の縦積みを保つ
- Card Deck構成: 要素はカードへ分離して積む(2026-09〜)。装飾アニメーションは無し

## Colors

パレットは実質、Material3のseedカラー1色と、状態伝達のための4つの信号色のみで構成される。

### Primary
- **Tangerine Seed** (`#D9591F`): `ColorScheme.fromSeed(seedColor: ...)`(`main.dart`の`_buildTheme()`)で指定されるシード色。ここから`ColorScheme.fromSeed`がprimary/on-primary/surface等のロールトークンを自動生成する。個々のロールの正確な値はランタイム計算に委ねられており、コード上に固定hexとして明示的なオーバーライドは無い。FilledButton(読み上げ開始ボタン等)・NavigationBarの選択インジケータ・Cardの縁がこのprimaryロールを直接使う。
- 2026-09にDeep Purple(`#673AB7`)から変更(Card Deckリブランディング)。中性色寄りのブロンズ/鈍青は「性別記号・年代感が乗りやすい」と判断し不採用、彩度のはっきりした暖色を採用した。
- ランキング上位3件の強調枠線など、状態伝達以外のアクセント表現にも`colorScheme.primary`を直接再利用してよい(Signal-Only Color Ruleの対象はgreen/orange/red/greyの4色のみ)。

### Neutral / Status(実装上はNeutralではなく状態伝達色)
- **Connected Green** (`#4CAF50` / `Colors.green`): Socket.IO接続が確立し、コメント受信可能な状態。
- **Connecting Orange** (`#FF9800` / `Colors.orange`): 接続試行中の一時状態。
- **Error Red** (`#F44336` / `Colors.red`): 切断エラー、読み上げエラー、および「読み上げ停止」ボタンの背景(危険なアクションであることを示す)。
- **Muted Grey** (`#9E9E9E` / `Colors.grey`): 切断状態、補助テキスト(VOICEVOX準備中、話者名表示など)、二次的な説明文。

### Named Rules
**The Signal-Only Color Rule.** Green/Orange/Red/Greyの4色は状態伝達のためだけに存在する。装飾目的でこれらの色を使わない。新しいUI要素の色分けが必要になった場合も、まず「これは状態を示しているか」を自問すること。

**例外: TTSタブの読み上げ中ハイライト。** `colorScheme.primaryContainer`を薄く敷いて「今読み上げ中のコメント」を示す(`tts_tab.dart`)。4色の状態色そのものではないが、装飾ではなく状態伝達の用途に限定した例外として認める。

## Typography

**Display/Title Font:** IBM Plex Mono (`google_fonts`パッケージ、フォールバック monospace)
**Body Font:** IBM Plex Mono (`GoogleFonts.ibmPlexMonoTextTheme`でMaterial3 TextTheme全体を上書き)

**Character:** 2026-09にRoboto一本からIBM Plex Mono一本へ変更(Card Deckリブランディング)。等幅書体をアプリ全域に適用する明示判断で、独自のカスタムスケールは持たない(サイズ階層はMaterial3 TextThemeのロール名に準拠)。TTFはアセット同梱せず`google_fonts`が初回起動時にネットワーク取得してキャッシュする(オフライン初回起動時はシステムフォールバック書体になる)。

### Hierarchy
- **Title** (bold 700, 28px, line-height 1.2): アプリ名の表示。ウェルカム画面のみで使用される唯一の大型見出し。
- **Body** (regular 400, 16px、Material3 bodyLarge/bodyMedium相当): ボタンラベル、フォームラベル、コメント本文・ニックネームなど、画面の大半のテキスト。
- **Label** (regular 400, 12〜13px, grey): 補助的な状態テキスト(「ランダムボイス」ラベル、「VOICEVOX準備中…」、話者名表示)。
- **Caption** (regular 400, 11px, red): エラーメッセージの縮小表示(接続エラー詳細など、スペースが限られる箇所)。

### Named Rules
**The One Title Rule.** 28px boldの大型タイトルはウェルカム画面のアプリ名一箇所のみに予約されている。他画面で見出しサイズを増やして視覚的な重みを作らない。

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

2026-09のCard Deckリブランディングで、要素をカードへ分離して積む構成に変更した。`main.dart`の`_buildTheme()`が`CardThemeData`(elevation 2、角丸18、タンジェリンを薄めた`shadowColor`)を全域へ適用し、個々の画面はカスタムShadowを手打ちしない(テーマ1箇所への集約を保つ)。

### Named Rules
**The Card Deck Rule(旧: Flat-By-Default Rule).** 深度は`main.dart`の`CardThemeData`1箇所にのみ由来する。個々の画面・Widgetで独自のBoxShadowや手動elevation値を追加しない(テーマの一括変更で全画面に反映される状態を維持する)。

## Shapes

FilledButton・TextFormField・AlertDialog・Switchはすべて Material3 のデフォルト角丸・形状をそのまま使用しており、`shape:`や`BorderRadius`によるオーバーライドはコード中に存在しない。独自の角丸スケールは無い。

## Components

### Buttons
- **Shape:** Material3 FilledButtonのデフォルト形状(pill型、明示的なradius指定なし)。
- **Primary:** `FilledButton`/`FilledButton.icon`。読み上げ開始・ログイン・連携する・変更する、など画面の主アクションに使用。縦paddingは12〜14px程度。
- **Danger variant:** 読み上げ停止ボタンのみ`backgroundColor: Colors.red`で上書きされる。危険/停止アクション専用。
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

### Ranking List(貢献タブ・バトル履歴貢献者展開共通)
- **Style:** `RankingListTile`(`lib/screens/widgets/ranking_list_tile.dart`)が貢献タブとバトル履歴タブの貢献者展開(`showModalBottomSheet`)の両方で共有される(サーバー側が同じ形状のデータを返すため)。
- **上位3件の強調(2026-09〜):** 1〜3位は`colorScheme.primary`の1.5px枠線(通常はテーマの`line`色1px)と、一段階大きいテキストロール(ニックネーム=`titleLarge`相当、コイン数=18→20px)で目立たせる。新規の色・アイコン(トロフィー等)は追加しない。Cardの`elevation`・`surfaceTintColor`はテーマの`CardThemeData`から一切変更せず(Card Deck Rule)、変えるのは枠線色とテキストサイズのみ。
- バトル履歴タブの貢献者展開でも同じ強調が自動適用される。両画面とも「ギフト貢献ランキング」という同一文脈のため意図した挙動であり、オプトアウトの仕組みは持たない。

### Status Bar(Signature Component)
- **Description:** ホーム画面上部に常駐する接続状態バー。背景は状態色を`withValues(alpha: 0.12)`で薄く敷き、状態色の小さな`Icon(Icons.circle)`ドット+ラベルテキストを横並びに配置。エラー時のみ詳細メッセージを右側に省略表示で追加する。このアプリで最もアプリらしい、独自に設計された唯一のコンポーネント。

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
- **Don't** ダークテーマは現状未対応(`ThemeData`に`darkTheme`指定なし)。対応するまでは、ダーク前提の配色決め打ちを行わない。
- **Don't** タブレット・横画面・レスポンシブ分岐は未検証。対応するまでは固定幅前提のレイアウトを増やさない。
- **Don't** ボトムナビのタブを安易に増やさない。2026-08に貢献/ギフト履歴/バトル履歴の3タブを例外的に追加して6タブになったが、これは「タブは増やさない」原則からの明示的な逸脱であり通例ではない。さらに増やしたくなったら、まず既存6タブのいずれかの配下へpushできないかを疑う。
- **Don't** 設定項目をTTSタブ・サウンドタブへ置かない。設定は設定タブへ集約する(Layout参照)。運用画面に置きたくなったら、それが本当に「今の状態」ではなく「設定」なのかをまず疑う。
- **Don't** サウンド設定に中間階層(カテゴリ、トリガー、共有音源ライブラリ)を戻さない。desktop(TikEffect)には全部あるが、モバイルは配信中に片手で触る道具なので「ギフト → 音」の1階層に閉じる。条件を増やしたくなったら、まず既存の1行で表現できないかを疑う。
