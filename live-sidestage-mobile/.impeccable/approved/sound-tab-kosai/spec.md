# 光彩(Kosai) — サウンドタブ 採用spec

採用元: `mobile-kosai-other-tabs.html` 方向A の2枚目の `.phone`(`comp.png` に切り出し済み)。
共通トークン・換算規則は `../_kosai-tokens.md` を正本とし、ここでは差分だけ書く。

comp caption:
> サウンド — 独自の開始/停止・ステータスを復元。セット内容は選択中chipから吹き出しが伸びる形で
> 囲い、行ごとに音量メーター(5段階)+個別ON/OFFスイッチを復元。「音を追加」は右下に大きく固定表示

## 要素の全列挙(上から)

1. **AppBar**(HomeScreen共通): `@tiktokId` 左 / プランバッジ右(`gradBadge` pill、11dp w800、
   padding 縦4dp・横12dp)
2. **ステータスバー**(comp `.status.deco`)
   - 背景 card / 角丸14dp / padding 縦11dp・横14dp / 左右margin 16dp / 上margin 10dp
   - 枠線なし。影 `c2 @0.35` blur16 offset(0,6) spread -12
   - 右上に装飾円: 直径60dp、`gradBorder`、不透明度0.14、`top:-18dp right:-14dp`、
     カード角丸でクリップ
   - ドット: 直径10dp・円形・状態色(接続=`#4CAF50` / 停止=`#9E9E9E` / 警告=`#FF9800` /
     エラー=`danger`)。**Signal-Only Color Rule を維持し装飾グラデーションは使わない**
   - ラベル: 13dp w600 ink、ドットとのgap 8dp
   - notice(TikTok側事情)は 12dp sub、上6dp。errorsは 12dp danger、各上6dp。
     いずれも `SelectableText` のまま(問い合わせ用にコピーできる既存仕様を維持)
3. **`ConfigTooNewBanner`**(comp未定義 / 既存維持)
4. **「現在のセット：◯◯」の明示行**(comp未定義 / 既存維持)。13dp w700 c2、padding 横16dp・上12dp
5. **開始/停止ボタン**(comp `.btn-primary-grad`)
   - 全幅 / 左右margin 16dp / 上12dp 下14dp
   - 縦padding 18dp / 角丸999 / 背景 `gradBadge` / 文字白17dp w800 / プライマリ影
   - ラベル: 停止中「▶ 効果音を開始」/ 開始中「■ 効果音を停止」。開始中は背景を
     **danger単色**にする(状態伝達。comp未定義だが既存仕様を維持)
   - busy中はラベル位置に18dpの `CircularProgressIndicator`(strokeWidth 2、白)
6. **直近ギフト行 / overflow行**(comp未定義 / 既存維持)。12dp sub、overflowはorange
7. **セクション見出し「効果音セット」**: グラデ文字22dp w700、padding 横16dp・上16dp・下8dp
8. **セットchip row**(comp `.chip-row`)
   - 横スクロール / 画面横padding 16dp / chip間 8dp
   - chip: padding 縦6dp・横12dp / 角丸999 / 文字11dp w700
     - 選択中: `gradBadge` 背景・白文字・枠なし
     - 非選択: card 背景・1dp line 枠・ink 文字
     - ロック中(開始中)の非選択chipは不透明度0.45
   - 末尾に「＋追加」chip: 破線1dp line 枠 / 文字 sub / 上限到達時は不透明度0.45
   - chip1つの最大幅140dp、超過はellipsis(既存仕様を維持)
9. **吹き出しノッチ**(comp `.bubble::before`)
   - 選択中chipの直下・chip中央に、幅18dp・高さ7dpの三角形。色は card(パネル上端と同色)
   - 非選択chipも同じ高さを確保して行高を固定(既存 `_SetTabNotch` の仕様を維持)
10. **セット内容パネル**(comp `.panel.soft.bubble`)
    - 背景 card / 角丸18dp / 左右margin 16dp / 下margin 16dp / 枠線なし
    - 影: `rgba(155,107,255,.12)` blur22 offset(0,8) spread -18
    - 見出し(comp `.bubble-label`): 「「◯◯」セットの内容」12dp w700 sub、
      padding 上12dp・横14dp・下2dp
    - 右端に「…」セット操作 `IconButton`(comp未定義 / 既存維持。開始中は非表示)
11. **ギフト行**(comp `.row-item`、複数)
    - padding 縦13dp・横14dp / 行間は 1dp divider(`#F1EBEE`)のみ、最終行は線なし
    - 左: ギフト画像 30×30dp、角丸9dp、背景 `#F4EFEC`(既存 `GiftThumbnail`)
    - gap 12dp
    - 中央(縦積み、gap 1dp):
      - ギフト名 13.5dp w700 ink(日本語化は既存 `GiftNameJa.display`)
      - 音源名 11.5dp sub、1行ellipsis
      - 音量メーター(comp `.vmeter`): 上4dp、5本、幅3dp、間隔2dp、角丸1.5dp、
        高さ 4/6/8/11/11dp、ON=c2 / OFF=`#E5DFE8`
    - 右: `Switch`(comp `.switch`) トラック幅43dp・高さ24dp・角丸999、
      ON=c2 / OFF=`#E5DFE8`、つまみ白19dp、枠線なし
    - 行タップでギフト編集画面へ。開始中はスナックバーで停止を促す(既存維持)
    - 空のとき: 「まだ何も登録されていません。/「音を追加」からギフトと音を選んでください。」
      12dp sub 中央(既存文言を維持)
12. **拡張FAB「＋音を追加」**(comp `.fab-ext`)
    - 画面右下固定(`Scaffold.floatingActionButton`)、右16dp・下16dp
    - padding 縦16dp・横22dp / 角丸999 / 背景 `gradRing`(135deg c1→c2)
    - 文字白15dp w800、先頭に「＋」19dp、gap 8dp
    - 影 `c2 @0.55` blur24 offset(0,12) spread -8
    - リストの下端に 84dp の逃げ余白を取り、最終行がFABに隠れないようにする
    - 開始中・FREE上限到達時は不透明度0.45。**押下は禁止せず**理由をスナックバーで出す

## インタラクション

- 開始/停止トグル → `onToggle`(既存)
- セットchipタップ → セット切替。開始中は「セットを変更するには停止してください」
- セットchip長押し / 「…」 → セット操作ボタムシート(名前変更・複製・並び替え・削除)。既存維持
- 「＋追加」chip → 新規セット作成ダイアログ。既存維持
- ギフト行タップ → `GiftSoundEditScreen`
- 行のスイッチ → `enabled` 切替(開始中は無効)
- 拡張FAB → `GiftSoundEditScreen`(新規)

## 状態

- loading: このタブは非同期取得を持たない → 該当なし
- empty(セットに音が0件): 上記11の空文言
- error: `FeatureStatusBar` の errors 行で表示(comp未定義 / 既存維持)
- 開始中(ロック): 非選択chipとFABを不透明度0.45、「…」を非表示。画面全体はグレーアウトしない
- 設定が未来バージョン: `ConfigTooNewBanner` + 開始ボタン無効(既存維持)

## 省略の既定

ゼロ。comp未定義として上に列挙した既存要素(直近ギフト、overflow件数、現在のセット明示行、
セット操作メニュー、ConfigTooNewBanner)はすべて残す。
