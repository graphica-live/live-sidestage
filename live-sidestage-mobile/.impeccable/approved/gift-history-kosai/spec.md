# 光彩(Kosai) — ギフト履歴タブ 採用spec

採用元: `mobile-kosai-other-tabs.html` 方向A の5枚目の `.phone`(`comp.png`)。
共通トークン・換算規則は `../_kosai-tokens.md` を正本とする。

comp caption:
> ギフト履歴 — 期間フィルタ+登録後データ注記を復元。🎁は廃止し、右にコイン数(上)/時刻(下)を縦積み

## 要素の全列挙(上から)

1. **AppBar**(HomeScreen共通、`@tiktokId` + プランバッジ)
2. **セクション見出し「ギフト履歴」**: グラデ文字22dp w700、padding 横16dp・上8dp・下2dp
   - 直下にサブタイトル「受け取ったギフトの履歴」11dp sub(comp未定義。貢献タブの
     見出し+サブタイトル構成に揃えるため追加)
3. **期間フィルタ chip row**: `../_kosai-tokens.md` §5 のとおり(日/週/月/年/カスタム)
4. **期間ラベル行(◀ ラベル ▶)**: comp未定義 / 既存機能なので残す。§5のとおり
5. **`VerifiedLockNotice`**: **撤去した**(2026-09-03)。comp には元から描かれておらず、
   既存だから残していただけの要素。BIO 認証をどの機能の前提にもしない方針が決まり、
   UI から存在を消したため。comp の要素を落としたわけではない
6. **`AnalyticsErrorBanner`**(comp未定義 / 既存維持)
7. **注記行**(comp `.note`): 「合計 N件 / M コイン(LIVE Sidestage登録後データ)」
   - 10dp sub / padding 横16dp・上4dp・下8dp
   - **comp のテキストは「LIVE Sidestage登録後データ」のみだが、既存の件数・合計コインは
     情報として残す**(省略の既定はゼロ)。1行に収め、ellipsisしない
8. **ギフト行パネル**(comp `.panel.soft` + `.row-item`)
   - パネル: 背景 card / 角丸18dp / 左右margin 16dp / 枠線なし /
     影 `rgba(155,107,255,.12)` blur22 offset(0,8) spread -18
   - 行: padding 縦13dp・横14dp、行間 1dp divider `#F1EBEE`、最終行は線なし
   - 左: **リスナーアイコン**(comp `.r-icon.ring`) — 直径30dp、`gradRing` 1.5dp枠、
     内側は既存 `UserAvatar`。gap 12dp
   - 中央(縦積み、gap 1dp、`Expanded`):
     - ニックネーム 13.5dp w700 ink、1行ellipsis
     - ギフト名 ×個数 11.5dp sub、1行ellipsis。編集済みは「×N ・ 編集済み」(既存維持)
   - 右(縦積み、右寄せ、gap 1dp):
     - **🪙 + コイン数**(カンマ区切り) 13dp w800 c2、折り返さない
     - **受取時刻** `HH:MM`(JST) 10dp sub
   - **🎁絵文字とギフト画像サムネイルは出さない**(comp指示「🎁は廃止」)。
     ギフト名はテキストで中央列に残す
   - 行タップ → TikTokプロフィールを開く(既存 `openTiktokProfile`)
9. **`EmptyListNotice`**「この期間はまだギフトを受け取っていません」(comp未定義 / 既存維持)

## インタラクション

- 期間chip / ◀▶ / カスタム → 既存 `PeriodSelectorBar` の挙動をそのまま維持
- FREEで月・年chipを押した場合 → アップグレード導線(既存)
- pull-to-refresh → 再取得(既存 `RefreshIndicator`)
- 行タップ → TikTokプロフィール

## 状態

`../_kosai-tokens.md` §6 のとおり。長いニックネーム・長いギフト名はいずれも1行ellipsis。
件数が多い場合は `ListView` のスクロールで対応(comp通りの構造で自然に成立)。

## 省略の既定

ゼロ。ギフト画像サムネイルのみ comp の明示指示により削除する(ギフト名テキストは残す)。
