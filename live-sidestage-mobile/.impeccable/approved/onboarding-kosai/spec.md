# 光彩(Kosai) — ログイン後オンボーディング 採用spec

採用元: 計画「モバイル ログイン後オンボーディング」方向（スライド5枚 + TikTok連携 + 確認シート）。
共通トークン・換算規則は `../_kosai-tokens.md` を正本とする。

comp caption:
> ログイン後・Streamer未登録時。紹介5枚はスキップ可、最終ページのTikTok ID連携は必須。
> 確認シートを経てから POST /api/mobile/streamer。28dp見出しは使わない（One Title Rule）。

画像素材: 該当なし — スライドヒーローは Kosai グラデ円（96dp）＋既存 Material アイコン。
写真イラストは幾何学ブランドと衝突し、アセット同梱も増える。gpt-image-2 は使わない。

## レイアウト（全ページ共通シェル）

- 背景 bg `#FAF7F5`
- `SafeArea`。画面横 padding **16dp**
- 上段: 左「スキップ」（紹介ページのみ） / 右 overflow `Icons.more_vert` 48×48dp タップ領域
- 下段固定（親指帯）: ドットインジケータ + 主CTA。下 padding 16dp

### 上段

| 要素 | 仕様 |
|---|---|
| スキップ | 紹介ページ0–4のみ。14dp w600 / sub `#7C7286` / 高さ48dp / 左寄せ。ページ5では同じ幅の空 `SizedBox` でレイアウトを保つ |
| overflow | `PopupMenuButton` tooltip「その他」。アイコン 24dp / ink `#2A2130`。メニュー: 「ログアウト」「アカウント削除」（後者は danger `#E24B4B`） |

### ドット

- 6個、gap 8dp、中央
- 非選択: 直径 8dp / `#E5DFE8`
- 選択: 幅 18dp × 高さ 8dp 角丸999 / `gradBadge` c1→c2
- ドット行の下 16dp で主CTA

### 主CTA（紹介）

- 「次へ」 KosaiPrimaryButton。全幅 / 縦padding 18dp / 角丸999 / 白 17dp w800 / プライマリ影
- タップ領域高さ ≥48dp

### 主CTA（連携ページ）

- 「確認する」 同上
- loading 中はボタン内 18dp 白 `CircularProgressIndicator` strokeWidth 2、不透明度 0.45

## 紹介スライド（ページ 0–4）

縦中央寄せ（上段と下段の間）。横 padding 16dp。

| # | 要素 | 仕様 |
|---|---|---|
| 1 | ヒーロー円 | 96dp / `BoxShape.circle` / 背景 `gradRing` c1→c2 135deg |
| 2 | アイコン | 白 44dp。0=`Icons.speaker_notes_rounded` / 1=`Icons.card_giftcard` / 2=`Icons.graphic_eq` / 3=`Icons.emoji_events` / 4=`Icons.bolt` |
| 3 | 余白 | 24dp |
| 4 | 見出し | GradientText 22dp w700 Zen Maru Gothic / 中央 / `gradBadge` |
| 5 | 余白 | 12dp |
| 6 | 本文 | 13.5dp w400 Zen Kaku Gothic New / sub `#7C7286` / 中央 / 行間 1.45 / 最大幅 320dp |

コピー:

- 0 見出し「画面を見ずに、コメントがわかる」 / 本文「コメントを音声で読み上げるので、配信画面から目を離さずに反応できます。リスナーごとに声を変えて、誰のコメントか聞き分けることもできます。」
- 1 見出し「ギフトが、音と演出に変わる」 / 本文「ギフトごとに効果音や短い音楽を設定。届いたことを音で把握するだけでなく、ダンスやリアクションなど、ギフト連動の企画にも使えます。」
- 2 見出し「配信画面のまま、読み上げも効果音も」 / 本文「配信するスマートフォンで読み上げと効果音をONにするだけ。1台で「配信」「コメント読み上げ」「ギフト演出」を同時に使えます。」
- 3 見出し「応援してくれた人を、見逃さない」 / 本文「貢献ランキングとギフト履歴をあとから確認。日付やリスナーで絞り込んで、誰がどれだけ応援してくれたか振り返れます。」
- 4 見出し「あのバトルを、あとから振り返る」 / 本文「対戦結果や貢献者だけでなく、バトル中の流れも疑似リプレイで確認。誰が、いつ、どれだけ貢献してくれたかを振り返れます。」

## 連携ページ（ページ 5）

上から縦積み（中央寄せしない）。上段の下 24dp から開始。

| # | 要素 | 仕様 |
|---|---|---|
| 1 | 見出し | GradientText 22dp w700 「TikTokアカウントの連携」 / 左寄せ |
| 2 | 余白 | 8dp |
| 3 | 歓迎文 | 13.5dp / sub 「ようこそ、{userName}さん。あなたのTikTok IDを連携してください。」 |
| 4 | 余白 | 24dp |
| 5 | 入力 | `TextFormField`。ラベル「TikTok ID（@なし）」13.5dp。カード面に乗せずテーマ既定のアウトライン |
| 6 | 余白 | 12dp |
| 7 | エラー | あるときのみ 13dp / danger `#E24B4B` |
| 8 | 注記 | 10dp / sub 「連携後7日間はIDを変更できません。本人のアカウントか確認してから進めてください。」 |

## 確認シート

`showModalBottomSheet`。上角丸 20dp / 背景 card `#FFFFFF` / 内側 padding 16dp。

| # | 要素 | 仕様 |
|---|---|---|
| 1 | アバター | 64dp 円。`GradientRing` 1.5dp c1→c2。画像は `avatarUrl`。無いときは `Icons.person` |
| 2 | nickname | 13.5dp w700 ink。null なら tiktokHandle |
| 3 | @handle | 11.5dp sub 「@{tiktokHandle}」 |
| 4 | 余白 | 16dp |
| 5 | 2列カード | 角丸 18dp / 枠 1dp line / padding 12dp。ラベル 10dp sub / 値 13.5dp w700 ink。フォロー / フォロワー。null は「-」。数値はカンマ区切り |
| 6 | signature | あるときのみ 11.5dp sub / 上 12dp / 最大2行 ellipsis |
| 7 | 余白 | 16dp |
| 8 | 「このアカウントで連携する」 | KosaiPrimaryButton |
| 9 | 余白 | 8dp |
| 10 | 「戻る」 | KosaiOutlineButton |

## インタラクション

- 横スワイプ: PageView。ページ5から先へは進めない
- スキップ: ページ5へジャンプ（アニメーションあり）
- 次へ: 次ページ。ページ4では連携ページへ
- 確認する: 空欄ならインラインエラー。それ以外は `POST /api/mobile/streamer/preview`
- シート確定: `POST /api/mobile/streamer`。成功で AuthGate がホームへ
- シート戻る / バリアタップ: シートを閉じ、入力値は残す
- ログアウト: `performLogout`
- アカウント削除: `confirmAndDeleteAccount`

## 状態

- **loading (preview/register)**: 主CTA busy。連携ページは入力欄下に 18dp インジケータ +「TikTokアカウントを確認しています…」(13dp sub)。入力欄は disabled。シート確定中もボタン busy
- **error**: 連携ページのエラー行。シートは閉じる（確定失敗時も）
- **empty 入力**: validator「TikTok IDを入力してください」
- **オフライン / 503**: サーバーが返した error 文言をそのまま表示。再試行は同じボタン
- **ダーク**: comp未定義。bg/card/ink/sub/line はテーマ。グラデ3色はライトと同一
- **長文 nickname / signature**: ellipsis。未定義だったが実装必須

## 要素インベントリ

| 要素 | 役割 | データ出典 |
|---|---|---|
| スキップ | 紹介を飛ばす | なし |
| overflow | ログアウト/削除 | なし |
| ヒーロー円+アイコン | 概念の視覚 | なし |
| 見出し/本文 | コピー | 固定文言 |
| ドット | 位置 | PageController |
| 次へ / 確認する | 進行 | なし |
| 歓迎文 | 誰のオンボーディングか | `AuthSession.userName` |
| TikTok ID 欄 | 入力 | ユーザー入力 → tiktokHandle |
| エラー | 失敗理由 | API `error` |
| 7日注記 | ロック予告 | 固定文言 |
| アバター/nickname/@handle/フォロー/フォロワー/signature | 取り違え防止 | preview API |
| 連携する / 戻る | 確定/取消 | なし |

## 省略の既定

ゼロ。VOICEVOX規約はホーム初回のまま（この画面に出さない — 計画どおり）。

## 未解決

- ダークはトークン仮置き（他 Kosai 画面と同じ）
- アバター画像のネットワーク失敗はプレースホルダへ倒す
