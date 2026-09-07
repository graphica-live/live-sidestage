# tiktok-account-confirm-modal — spec

comp: `comp.html` / `comp.png`(同ディレクトリ)。データソース: `api-live/user/room/`(コード内 `fetchTiktokProfile`/`requestUserRoom`)の1リクエストで完結(`data.user.avatarLarger`, `data.user.nickname`, `data.user.uniqueId`, `data.user.signature`, `data.stats.followingCount`, `data.stats.followerCount`)。追加リクエスト・プロキシ/Euler signature消費なし(検証済み)。

## 対象画面

1. `src/app/(dashboard)/setup/page.tsx` — 配信者本人の初回TikTok ID登録(`POST /api/verify/generate`)
2. `src/app/(dashboard)/admin/workers/page.tsx` の `AddWatchForm` — 管理者によるID追加(`POST /api/admin/workers/watch`)

両方から共通の1モーダルコンポーネントを呼ぶ。

## 視覚仕様(数値/hex)

### オーバーレイ(backdrop)
- `position: fixed; inset: 0`
- 背景: `rgba(0,0,0,0.6)`(Tailwind `bg-black/60`)
- `backdrop-filter: blur(4px)`(Tailwind `backdrop-blur-sm`)
- 配置: `display:flex; align-items:center; justify-content:center`

### カード
- 幅: 360px(`max-w-sm`相当)
- 背景: `#1a1a1a`(`bg-panel`)
- ボーダー: `1px solid #2a2a2a`(`border border-border`)
- 角丸: `12px`(`rounded-xl`)
- シャドウ: `shadow-xl`(Tailwind既定値、`0 20px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.5)`相当)
- 内側パディング: `16px`(`p-4`)

### ヘッダー行(アバター+nickname+handle)
- レイアウト: `flex items-center gap-3`(gap 12px)
- アバター: `64px × 64px`, `border-radius: 9999px`(`rounded-full`)。画像は`data.user.avatarLarger`(署名付きURL、失効あり。取得できなければ既定の丸プレースホルダ)
- nickname: `font-size: 0.875rem(14px); font-weight: 600; color: #ffffff`
- handle(`@${uniqueId}`): `font-size: 0.75rem(12px); color: #8b90a0; margin-top: 2px`

### 統計(フォロー/フォロワー)
- レイアウト: `flex gap-2`(gap 8px)、`margin-top: 16px`
- 各セル: `flex:1; background:#111111; border:1px solid #2a2a2a; border-radius:8px; padding:8px 12px; text-align:center`
- ラベル(「フォロー」「フォロワー」): `font-size:0.75rem(12px); font-weight:500; color:#6b7280`
- 数値: `font-family: ui-monospace, SFMono-Regular, Menlo, monospace(font-mono); font-size:0.875rem(14px); font-weight:500; color:#f0f0f0`。3桁区切りカンマ表示(`toLocaleString`)

### BIO
- 位置: 統計セルの**下**(`margin-top: 12px`)
- `font-size: 0.75rem(12px); color:#6b7280; line-height:1.4`
- 2行で省略(`-webkit-line-clamp:2; overflow:hidden`)
- データ: `data.user.signature`。空文字なら要素自体を非表示(未定義動作としない — 空なら描画しない)

### 確認文言
- 「このユーザーでよろしいですか？」
- `margin-top:16px; font-size:0.875rem(14px); color:#f0f0f0; line-height:1.5`

### ボタン行
- レイアウト: `flex justify-end gap-2`(gap 8px)、`margin-top:16px`
- キャンセル(`.btn-ghost`): 背景透明、`color:#9ca3af`、ホバーで`text-white bg-white/5`、`rounded-lg(8px)`, `padding:8px 16px`
- 登録する(`.btn-primary`): 背景`#fe2c55`、`color:#ffffff; font-weight:600`、`rounded-lg(8px)`, `padding:8px 16px`、`disabled:opacity-50`

## 視覚階層

1番目: nickname(白・セミボールド) 2番目: フォロー/フォロワー数値(font-mono) 3番目: 確認文言・アバター 4番目: handle/BIO(muted)

## 要素・挙動インベントリ

| 要素 | 役割 | データ出典 |
|---|---|---|
| アバター画像 | 本人確認の視覚的手がかり | `data.user.avatarLarger` |
| nickname | 表示名 | `data.user.nickname` |
| handle(`@uniqueId`) | 入力値の確認 | `data.user.uniqueId` |
| BIO | 誤認防止の追加手がかり(2行clamp) | `data.user.signature` |
| フォロー数 | 実在感の裏付け | `data.stats.followingCount` |
| フォロワー数 | 実在感の裏付け | `data.stats.followerCount` |
| 確認文言 | 意思確認 | 固定文言 |
| キャンセルボタン | モーダルを閉じ登録を中止する。フォーム入力値は保持 | - |
| 登録するボタン | 確定。元のAPI呼び出し(`/api/verify/generate`または`/api/admin/workers/watch`)を実行し結果をフォームへ反映 | - |

### インタラクション
- キャンセルボタン押下 / Escキー / backdropクリック → モーダルを閉じる。登録処理は実行しない。フォームのテキスト入力値はそのまま残す(再入力不要)
- 登録するボタン押下 → 元APIへ確定リクエスト送信 → 成功ならモーダルを閉じフォームに既存の成功メッセージを表示 → 失敗なら(通常起こらないはずだが)フォームにエラー表示

### 状態
- **取得中**(存在確認API呼び出し中): モーダルはまだ出さない。フォームの登録ボタン側で`busy`表示(既存実装の「確認中...」を踏襲)
- **取得失敗**(フォーマット不正・MISSING・UNVERIFIED・RATE_LIMITED・ERROR): モーダルを出さず、フォーム側に`text-red-400 text-sm`でメッセージ+エラーコードのかっこ書きを表示。登録は行わない
- **取得成功**: モーダル表示、ユーザーの確定操作を待つ
- **確定後**: モーダルを閉じ、フォームの成功メッセージ表示(admin側は既存の「@xxx を追加しました」、setup側は既存の認証コード表示フローへ接続)
- **BIOが空文字**: BIO要素を描画しない(高さが詰まる。レイアウト崩れ禁止)
- **avatarLarger取得不可**: 既定の丸プレースホルダ(単色円)を表示。取得エラーにはしない

## 未解決

- なし(ブリーフ確定時点で全項目合意済み)

## 差分許容

- フォント: システムフォントスタックのまま(comp通り)
- アイコンなし(絵文字はnickname内のユーザー入力データそのもの、装飾アイコンは使用しない)
