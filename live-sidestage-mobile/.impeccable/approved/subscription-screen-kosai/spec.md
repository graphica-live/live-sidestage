# 光彩(Kosai) — 課金画面(SubscriptionScreen) 採用spec

採用元: `mobile-kosai-other-tabs.html` 方向A の8枚目の `.phone`(`comp.png`)。
共通トークン・換算規則は `../_kosai-tokens.md` を正本とする。

comp caption:
> 課金画面 — 未着手だった画面。ULTRAだけ貢献タブと同じ二重枠グラデーションカードにして
> 視覚的な優先度を上げる(「おすすめ」等のバッジは付けない)

## レイアウト

- `AppBar`(戻る矢印のみ。**タイトル文字は置かない** — 見出しは本文側のグラデ文字で出す)
- 本文 `ListView`、padding 横16dp・上8dp・下24dp

| # | 要素 | 仕様 |
|---|---|---|
| 1 | 見出し「プランを選択」 | グラデ文字(`gradBadge`)Zen Maru Gothic 22dp w700 / 下12dp |
| 2 | Google Play接続エラー(あるときのみ) | 13dp danger / 下12dp |
| 3 | FREEカード | 白カード |
| 4 | 余白 | 12dp |
| 5 | PROカード | 白カード + **1.5dp c2 枠** |
| 6 | 余白 | 12dp |
| 7 | ULTRAカード | **二重枠グラデーションカード** |
| 8 | 「購入を復元」 | 12dp sub / 下線 / 中央 / 上24dp |
| 9 | 処理中インジケータ | 上16dp / 中央 / c2 |

## カード共通(comp `.card.flat` / `.card.grad-border`)

- 白カード: 背景 card / 角丸18dp / padding 16dp / 枠1dp line(PROのみ 1.5dp c2)
- ULTRA: 外角丸20dp / 枠2dp `gradBorder` / 内角丸18dp / 内padding 16dp

内部(上から):

1. **ヘッダ行**(両端寄せ、下8dp)
   - 左: プラン名 15dp w800
     - FREE: ink 単色
     - PRO: **c2 単色**
     - ULTRA: **`gradScore`(c1→c3)グラデ文字**
   - 左の続き: 「現在のプラン」バッジ(該当プランのみ、gap 8dp)
     - 11dp w800 c2 / 背景 `c2 @0.12` / 角丸999 / padding 縦3dp・横10dp
     - **これは現在の状態表示であり、「おすすめ」等の販促バッジは一切置かない**
   - 右: 価格 12dp w700 ink(FREEは「無料」を sub 12dp)
2. **特典リスト**(comp の「✓ …」)
   - 1項目ずつ `Icons.check` 15dp c2 + gap 6dp + テキスト 11.5dp sub、行間 lineHeight 1.7、
     項目間 4dp
3. **アクションボタン**(押せるときのみ、上10dp)
   - PRO: Secondary アウトラインpill。全幅 / 縦padding 11dp / 角丸999 / 枠1.5dp c2 /
     文字 c2 13dp w800
   - ULTRA: Primary グラデーションpill。全幅 / 縦padding 12dp / 角丸999 / `gradBadge` /
     文字白 13.5dp w800 / プライマリ影
   - FREE: ボタンなし
4. **変更不可の案内**(comp未定義 / 既存維持、上10dp)
   - 「プラン変更は現在準備中です。…」11.5dp sub

## 特典テキスト

既存の `_freePlanBenefits` / `_paidPlanBenefits` の文言を**変更しない**。
comp の短い文言は表現上の省略であり、実際の機能一覧を削らない。

## インタラクション

- PRO / ULTRA の「このプランへ変更」→ `billing.buy(product)`。既存のガード
  (同一プラン中・有料プラン保持中・処理中・productDetails重複時のfail-closed)をすべて維持
- 「購入を復元」→ `billing.restore()`
- 購入結果はスナックバー(既存)

## 状態

- **非Android**: 「プランのご購入は現在Android版のみでご利用いただけます。」の1画面
  (既存維持)。この画面もAppBar+本文の光彩トークンへ揃える
- **billingUnavailable**: 上記2のエラー行
- **busy**: すべてのボタンを無効化(不透明度0.45)+ 下部にインジケータ
- **価格未取得**: 「—」(既存維持)
- comp未定義: loading/empty → 該当なし

## 省略の既定

ゼロ。既存の全ロジック・全文言を残す。追加するのは視覚仕様のみ。
