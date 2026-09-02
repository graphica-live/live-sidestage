# 光彩(Kosai) — ログイン画面(WelcomeScreen) 採用spec

採用元: `mobile-kosai-other-tabs.html` 方向A の7枚目の `.phone`(`comp.png`)。
共通トークン・換算規則は `../_kosai-tokens.md` を正本とする。

comp caption:
> ログイン画面 — 未着手だった画面。アプリ名をグラデーション文字に、ボタンを角丸999pxのpillへ統一。
> Appleボタンは公式SignInWithAppleButtonパッケージが描画するのでロゴ・配色は既定のまま、
> 寸法(高さ・角丸)だけGoogle側と揃える(独自にリンゴ絵文字等は描かない)

## レイアウト

- 背景 bg。`SafeArea` + 縦中央寄せ。画面横padding 32dp
- 縦の並び(上から):

| # | 要素 | 仕様 |
|---|---|---|
| 1 | アプリ名「LIVE Sidestage」 | **グラデ文字**(`gradBadge` c1→c2)/ Zen Maru Gothic 28dp w700 / 中央 |
| 2 | 余白 | 8dp |
| 3 | サブコピー「TikTok Liveのコメントを読み上げます」 | 13dp / sub / 中央 |
| 4 | 余白 | 36dp |
| 5 | エラーメッセージ(あるときのみ) | 13dp danger / 中央 / 下12dp |
| 6 | 「Googleでログイン」 | Primary グラデーションpill。全幅 / **高さ48dp** / 角丸999 / 背景 `gradBadge` / 文字白 20.6dp w800 / プライマリ影 |
| 7 | 余白 | 12dp |
| 8 | 「Appleでサインイン」 | `SignInWithAppleButton` を**そのまま**使う。`height: 48`, `borderRadius: 999`。ロゴ・配色・文言はパッケージ既定(黒地に白ロゴ)。**独自にリンゴ絵文字やアイコンを描かない**。`isAppleSignInConfigured` が false なら出さない |
| 9 | 余白 | 12dp |
| 10 | 「メールアドレスでログイン」 | Secondary アウトラインpill。全幅 / 高さ48dp / 角丸999 / 背景 card / 文字 c2 20.6dp w800 / 枠1.5dp c2 |
| 11 | 余白 | 26dp |
| 12 | 「プライバシーポリシー」 | 12dp / sub / **下線あり** / 中央 / `TextButton` |

## 文字サイズの根拠

`SignInWithAppleButton` は Apple のガイドラインに従い文字サイズを `height * 0.43` で
決め打ちしており外から変えられない。並べたときにちぐはぐにならないよう、Google/メール側も
同じ式(`48 * 0.43 = 20.64dp`)を使う。**この既存の取り決めを維持する**(既存コードの
`_buttonFontSize` をそのまま流用)。

## 変更点(現状 → comp)

- 角丸: 8dp → **999dp(Stadium)**。`_buttonRadius` を `BorderRadius.circular(999)` に変更
- Googleボタン: 単色 `FilledButton` → **グラデーションpill + 影**
- メールボタン: 既定 `OutlinedButton` → **1.5dp c2 枠 / 文字 c2 w800 のpill**
- アプリ名: 黒28dp bold → **グラデ文字**(Zen Maru Gothic 28dp w700)
- サブコピー: `Colors.grey` → **sub `#7C7286`**、13dp
- エラー: `Colors.red` → **テーマの `colorScheme.error`**
- プライバシーポリシー: 既定 `TextButton` → 12dp sub + 下線

## インタラクション

- Googleボタン: `signInWithGoogle()`。`isLoading` 中は無効化し、ラベル位置に 20dp の
  `CircularProgressIndicator`(strokeWidth 2、白)
- Appleボタン: `signInWithApple()`。`isLoading` 中は押しても何もしない(既存の早期returnを維持)
- メールボタン: `EmailAuthScreen` へ push。`isLoading` 中は無効化
- プライバシーポリシー: 外部ブラウザ

## 状態

- **loading**: Googleボタン内のインジケータ。他ボタンは無効化(不透明度は Flutter 既定の
  disabled 表現ではなく、pillの背景を維持したまま 0.45 の不透明度にする)
- **error**: 上記5の行。comp未定義だが既存機能なので残す
- **Apple未設定**: Appleボタン自体を出さない(既存 `isAppleSignInConfigured` を維持)
- **ダーク**: comp未定義。背景・文字はテーマトークンへ、グラデーション3色はライトと同一

## 省略の既定

ゼロ。既存要素(エラー表示、Apple条件付き表示、ローディング)はすべて残す。
