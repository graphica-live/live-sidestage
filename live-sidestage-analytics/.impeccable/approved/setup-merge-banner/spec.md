# setup-merge-banner — TikTok ID自動合流の事後通知バナー

採用案: 案A(アクセント境界線型)。comp.png / comp.html 参照。

## 対象

1. Web: `src/app/(dashboard)/setup/page.tsx`
2. Mobile: `live-sidestage-mobile` 設定タブ(SnackBar形式、下記「Mobile仕様」)

## Web 視覚仕様(数値)

### バナー本体
- 幅: 親コンテナ幅いっぱい(`max-w-md` = 448px の内側)
- 背景色: `#111111`(`bg-surface`)
- 枠線: `1px solid rgba(254,44,85,0.3)`(`border border-brand/30`)。MERGED状態のみこの色
- 左アクセント線: `4px solid #fe2c55`(`border-l-4 border-brand`)
- 角丸: 左上・左下 `0`、右上・右下 `12px`(`rounded-r-xl`。既存 `.card` の `rounded-xl` に合わせる。従来指示の `rounded-lg` から `rounded-xl` へ実寸修正、以下この値を正とする)
- 内側パディング: `16px`(`p-4`)
- 要素間マージン: 下のカードとの間 `16px`(`mb-4`)
- 内部レイアウト: `display:flex; align-items:flex-start; gap:8px`

### 本文テキスト
- フォントサイズ: `14px`(`text-sm`)
- 行間: `1.5`(`leading-relaxed`相当)
- 色: `#e5e5e5`(`text-gray-200`)
- flex: `1 1 0%`(`flex-1`)

### 閉じるボタン
- 記号: `×`
- フォントサイズ: `18px`
- 色: `#9ca3af`(`text-gray-400`)、hover `#ffffff`(`hover:text-white`)
- パディング: `4px`、角丸 `6px`(タップ領域確保)
- 背景: なし。hover時 `rgba(255,255,255,0.05)`(`hover:bg-white/5`、既存 `.btn-ghost` と同トーン)

### BLOCKED系(BLOCKED_OLD_HANDLE_ALIVE / SELF_NOT_FOUND)
- 左アクセント線・枠線の色のみ変更: `#9ca3af`(gray-400、`border-l-gray-400 border-gray-400/30`)
- 他の数値(パディング・角丸・フォント等)は MERGED と完全に同一
- brand色(赤系)を使わない。ただし通常 UI のプライマリカラー自体が brand(#fe2c55、TikTokレッド)であるため、「赤=削除確認専用」という mobile の Signal-Only Color Rule は Web 側の brand 色使用には適用しない(既存 `code_issued` ステップの `border-brand/30` 情報表示と同型)

## 配置

`/setup` ページの最上部、`<h1>TikTok IDの設定</h1>` の直下・メインカードの直前。`recentMerge` が存在し未読の場合のみレンダリング(存在しなければ DOM 自体を出さない)。

## 要素・挙動インベントリ

- **要素**: バナー本体(アクセント線+背景+枠線)、本文テキスト(outcome種別で文言分岐)、閉じるボタン(×)
- **データ出典**: Web は setup ページのセッション取得APIに `recentMerge` フィールドを追加(直近の `TiktokIdMergeLog` のうち `outcome` が `MERGED` または `BLOCKED_OLD_HANDLE_ALIVE`/`SELF_NOT_FOUND` かつ `acknowledgedAt IS NULL` の最新1件)。mobile は `GET /api/mobile/me` に同フィールドを追加
- **文言**:
  - MERGED: `旧ID @{oldTiktokId} のギフト{giftCount}件を引き継ぎました`
  - BLOCKED_OLD_HANDLE_ALIVE / SELF_NOT_FOUND: `引き継げなかったデータがあります。サポートへご連絡ください`
- **インタラクション**: 閉じるボタンタップ/クリック → バナー非表示 + `acknowledgedAt` 書込みAPI呼び出し(楽観的UI。書込み失敗はログのみ、UIは閉じたままでよい)。それ以外のタップは無し(遷移なし、確認画面ではない)
- **状態**:
  - 未読ログなし → バナー自体非表示(コンポーネントごと出さない)
  - 複数未読ログあり → サーバー側で最新1件のみ返す。クライアントは常に0件/1件の前提
  - `acknowledgedAt` 書込み失敗 → UIは閉じたまま(既読化失敗は許容、次回訪問時に再表示されるのみ)
  - ローディング状態 → 無し(ページ/タブロード時にサーバーから同期的に取得済みの値を使う)
- **省略しない**: 上記要素すべて実装に含める。要素・状態を実装で落とす場合はユーザーへ明示確認する

## 未解決

- `giftCount` の出典フィールド名は実装時に `TiktokIdMergeLog.stats`(Phase2 `AbsorbStats`)のJSON構造と突き合わせて確定する(現時点の想定キー: `giftsMoved`)

## Mobile仕様

- 形式: `SnackBar`
- 色: 中立トーン(brand色ベース、赤不使用)。既存 `analytics_status.dart` 系のSnackBar背景トーンを踏襲
- dismiss: デフォルトのタイムアウト/スワイプでは既読化しない。明示的な「閉じる」アクションボタンのみが `acknowledgedAt` 書込みAPIを呼ぶ
- 表示タイミング: 設定タブを開いた時点で `recentMerge` があれば1回表示
- 文言: Web版と同一の2パターン
- 視覚仕様の詳細数値(padding/フォントサイズ等)はFlutter実装時に mobile DESIGN.md の SnackBar既定値へ準拠、構造(タイトル無し・本文+閉じるアクションのみ)はこの spec のWeb版インベントリと同一とする
