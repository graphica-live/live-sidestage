# DashboardHeader — ログイン中メールアドレス表示 spec

採用日: 2026-09-05
comp.png: なし（ASCIIモックのみで意思決定、軽微な追加のため画像基準は省略）

## 採用案

案A: ヘッダー内・常時表示

## 配置

既存ヘッダー `<header class="border-b border-border bg-panel sticky top-0 z-10">` 内、
`⚙️ 設定` リンクの直前に新規 `<span>` を1つ追加する。
順序: ロゴ → リスナー状態span（表示時のみ） → **メールアドレスspan（新規）** → 設定リンク → ログアウトボタン。

## 視覚仕様

- クラス: `text-xs text-muted truncate shrink min-w-0 max-w-[160px]`
- モバイル幅（〜375px）では `max-w-[100px]`（例: `max-w-[100px] sm:max-w-[160px]`）
- 省略時（truncate発生時）は `title={email}` で全文をネイティブtooltip表示
- アイコン・装飾なし。プレーンテキストのみ
- 新規デザイン判断（色/角丸/影/フォント）は無し。既存トークン `text-muted`, `text-xs` の再利用のみ

## データ取得

- `DashboardHeader` は client component（既存のuseState/useEffectあり）
- `DashboardLayout`（server component）が既に `getServerSession(authOptions)` で `session.user.email` を保持
- props経由で渡す: `<DashboardHeader email={session.user.email} />`
- `email` が nullish の場合、span自体をレンダリングしない（デフォルトで要素を落とさないが、値が無い場合の唯一の例外）

## 要素・挙動インベントリ

- **表示要素**: ログイン中メールアドレス（文字列）。出典: NextAuth `session.user.email`
- **インタラクション**: なし。リンクでもボタンでもない、プレーンテキスト
- **状態**:
  - email が truthy → 表示
  - email が falsy（型上nullableだが通常発生しない） → 非表示
  - 長いメール → CSS `truncate` で省略、`title` 属性でhover時に全文
- **未解決**: なし（スコープが小さいため）

## スコープ外

- (agency)/(billing)/(event)/(overlay-settings) の各Headerは対象外
