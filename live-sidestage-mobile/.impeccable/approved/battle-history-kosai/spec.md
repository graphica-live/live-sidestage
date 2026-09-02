# 光彩(Kosai) — バトル履歴タブ 採用spec

採用元: `mobile-kosai-other-tabs.html` 方向A の6枚目の `.phone`(`comp.png`)。
共通トークン・換算規則は `../_kosai-tokens.md` を正本とする。

comp caption:
> バトル履歴 — 全カードを同じ構造(見出し行/スコア行/フッター日時)に統一し高さを固定。
> しきい値トグルとLIVE Sidestage注記を1行に圧縮、カスタム期間チップを追加

## 要素の全列挙(上から)

1. **AppBar**(HomeScreen共通)
2. **セクション見出し「バトル履歴」**: グラデ文字22dp w700、padding 横16dp・上8dp・下2dp
3. **期間フィルタ chip row**: `../_kosai-tokens.md` §5(日/週/月/年/カスタム)
4. **期間ラベル行(◀ ラベル ▶)**: comp未定義 / 既存機能なので残す
5. **注記**「LIVE Sidestage登録後データ」: 10dp sub / padding 横16dp・下8dp
6. **しきい値トグル行**(comp `.threshold-row`)
   - 背景 card / 角丸999 / 枠1dp line / padding 縦6dp・横14dp / 左右margin 16dp / 下8dp
   - 左ラベル「100コイン未満を非表示」11dp w600 ink。**数字はしきい値設定と連動して変わる**
     (設定タブで変更可能。既定100)
   - 右 `Switch`(トラック43×24dp、ON=c2 / OFF=`#E5DFE8`、つまみ白19dp)。**既定ON**
   - 判定: `max(selfScore, opponentScore) < しきい値` のバトルを一覧から隠す。
     どちらか一方でもしきい値以上なら表示する(意味のあるバトルを取りこぼさないため)。
     スコアが両方nullのバトルは**隠さない**(未観測を「小さい」と断定しない)
   - 全件が隠された場合は「しきい値未満のバトルのみです(N件を非表示中)」を
     `EmptyListNotice` 相当で出す(comp未定義。無言で空になる事故を避けるため追加)
7. **`VerifiedLockNotice`** / **`AnalyticsErrorBanner`**(comp未定義 / 既存維持)
8. **バトルカード**(comp `.card.flat.battle-card`、1バトル1枚)
   - 背景 card / 角丸18dp / 枠1dp line / padding 14dp / 左右margin 16dp / カード間 12dp
   - **全カード同じ高さ**: 最小高さ142dp、`Column` の縦方向は
     見出し行 → スコア行 → (余白を吸収する `Spacer`) → フッター行
   - **見出し行**(comp `.battle-head`): 左に陣営数「N vs M」11dp sub、右に勝敗バッジ
     - 勝敗バッジ(comp `.win-badge`): 11dp w800 / 角丸999 / padding 縦4dp・横12dp
       - WIN: 背景 `gradWin`(c3→c2)・白文字
       - LOSE: 背景 card・枠1dp danger・文字 danger
       - DRAW: 背景 card・枠1dp line・文字 sub
       - 進行中: 背景 card・枠1dp c2・文字 c2、ラベル「進行中」
       - 中断: ラベル「中断」、DRAWと同じ見た目
       - スコア不明: バッジを出さない
     - 勝敗判定は `selfScore` と `opponentScore` の数値比較(BigInt)。どちらかがnullなら不明
   - **スコア行**(comp `.score-line`): 中央寄せ、横スクロール可(はみ出す場合のみ)、
     セグメント間に「–」12dp w700 sub(gap 左右8dp)
     - **自陣セグメント**(comp `.score-seg.own`、左側):
       - 上段(横並び、gap 6dp): アバタースタック → スコア
       - アバタースタック(comp `.avatar-stack`): 直径26dp、白2dp枠、2枚目以降は左へ -10dp
         重ねる。自陣は枠色を **c2** にする。最大3枚まで表示
       - スコア: 20dp w800。**自陣が勝っていれば `gradScore`(c1→c3)グラデ文字**、
         負けていれば ink 単色
       - 下段: 自分の表示名 10dp、色 c2 w700、最大幅104dp・1行ellipsis。
         2人以上なら「@id 他N名」
     - **相手セグメント**(右側): 上段の並びを反転(スコア → アバタースタック)。
       アバター枠は白。名前は 10dp sub w400
     - **3陣営以上**(comp `.score-line.many`): 陣営数が3以上のとき、
       アバター 19dp / スコア 13dp / 名前 8dp / セグメント最大幅50dp / gap 6dp へ縮小し
       横に並べる
   - **フッター行**(comp `.battle-foot`): 中央、10dp sub、
     「MM-DD HH:MM 終了」(進行中は「MM-DD HH:MM 開始」)
   - カードタップ → そのバトルの貢献者ボトムシート(既存 `_BattleContributorsSheet`)
9. **「直近分のみ表示」**(comp未定義 / 既存維持): 10dp sub 中央、上下8dp
10. **`EmptyListNotice`**「この期間はバトルがありません」(既存維持)

## データ上の制約(comp と実装のずれ、意図的)

comp の 4陣営カードは4つの独立したスコアを描いているが、サーバー(`GET /api/mobile/battles`)が
返すのは `selfScore` / `opponentScore` の**2値のみ**で、陣営ごとのスコアは存在しない。
API・データ形式は変更しない方針のため、3陣営以上でも**セグメントは自陣/相手陣の2つ**とし、
相手陣のアバタースタックに相手全員を重ねて `.score-line.many` の縮小サイズで描く。
陣営数の表示(「1 vs 1 vs 1」)は `opponentTeam` / `opponent.count` から作る。
comp の「4スコア横並び」は**未実装**として明記する(データ不在。実装漏れではない)。

## 貢献者ボトムシート(既存 / comp未定義)

見出し「このバトルの貢献者」15dp w700、`ListPanel` + `RankingListTile`(貢献タブと同一)。
loading / empty / error は既存のまま維持する。

## 状態

`../_kosai-tokens.md` §6 のとおり。加えて:
- スコアがnull → 「-」表示、勝敗バッジなし
- 相手不明 → 相手名を「対戦相手不明」、アバターはプレースホルダ
- しきい値で全件非表示 → 上記6の専用文言

## 省略の既定

ゼロ。4陣営スコアのみデータ不在により未実装。
