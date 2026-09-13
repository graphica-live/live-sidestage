# Control Home — approved spec

Surface: Live Sidestage Desktop Control ホーム（Electron 管理画面の第一画面）
Approved: 2026-09-13
Comp: comp.png / comp.html
World: Cursor の浮き窓 + 暗い無地 + 透ける漆。書体 Zen Kaku Gothic New。油彩背景は不採用。
Monitor constraint: 大きな明るい面・ベージュ塗り禁止（配信者顔への色被り）。

## 余白 (px)

- .desk padding: 36
- 窓と背景の間: 画面端からおおよそ 36 以上
- .tb 高さ: 38、左右 padding: 14、ドット間隔: 8
- .body 列: 220 / 1fr / 280
- .side padding: 10 8
- nav リンク padding: 7 10、radius: 6
- .main padding: 16 18
- h1 下: 0、.path margin: 0 0 10
- プレビュー下ボタン行 gap: 8、margin-top: 12
- .chat padding: 12
- イベント行 padding: 8 0
- ランキング行 gap: 6、内側 padding: 8 10、プレビュー内 inset: 16

## タイポ

- ファミリー: Zen Kaku Gothic New, Yu Gothic UI, sans-serif
- body: 15px / 1.55 / weight 500 / letter-spacing 0.01em / antialiased
- タイトルバー Live Sidestage Desktop: 12px / letter-spacing 0.08em / color #c6bba8
- 検索 placeholder: 12px
- nav: 15px inherited / 非選択 #b7b1a7 / 選択 #f3efe8
- h1: 16px / weight 600 / #f3efe8
- .path: 12px / #6f6a62
- .sec: 11px / #6f6a62
- .file: 12px / #9a958c、選択時 #f3efe8
- ボタン: 12.5px / 主ボタン weight 700
- .chat h2: 12px / weight 600 / #8f8a80
- イベント: 12.5px
- 順位数字: #d4b483（真鍮。塗り面にしない）

## サイズ

- 窓: width min(1180, 96vw)、height min(720, 90vh)
- タイトルバー: 38
- 信号灯: 10x10 radius 99
- 検索欄: width 240、height 24、radius 5
- プレビュー: height 340、radius 8
- ボタン: height 30、padding 0 12、radius 6
- 接続ドット: 6x6
- 右カラム composer: textarea height 52、枠 radius 8

## 色 (hex / rgba)

- 机: 無地 #12110f。画像なし
- 窓: rgba(22,18,14,0.72) + backdrop-filter blur(22px) saturate(1.15)
- 窓枠: rgba(232,214,176,0.18)、radius 12
- 内側ハイライト: inset 0 1px 0 rgba(255,240,210,0.14)
- 影: 0 50px 120px rgba(0,0,0,0.5)
- 本文: #e8e6e1
- 主ボタン面: #2a2622、文字 #f4f1ea、枠 rgba(244,241,234,0.35)
- 副ボタン: 同系ダーク、枠 rgba(255,255,255,0.1)
- 警告: #e0b03a（テキストのみ）
- 接続OK: #3ddc84
- **禁止:** #ead9b8 などベージュ塗りつぶしの大きい面

## 角丸

- 窓 12 / プレビュー 8 / ボタン 6 / nav 6 / 検索 5 / composer 8 / ランキング行 6 / 信号灯 99

## 情報密度

- ナビ 6
- TONIGHT 2（使用中 + effects）
- 庫 3（折りたたみ名のみ）
- プレビュー内ランキング 3行、各行 順位+名前+点数
- 直近 3
- 主アクション 3（コピー / テスト / 詳細）

## 視覚階層

1. プレビュー（ON AIR の実物）
2. 主ボタン行（暗い面。発光しない）
3. 左の使用中ファイル行

## 画像素材

- 	ik-effect-desk-bg.png
- 配置: body 全画面 #12110f。窓の背後に絵は置かない。
- 用途サイズ: デスクトップ壁紙。透過不要。

## 要素・挙動インベントリ

- 背景: 暗い無地。データなし
- キャプション: 右上 Win11 フルブリード（最小化・最大化・閉じる）。左上の Mac 信号灯は使わない
- タイトル Live Sidestage Desktop
- 検索 input: 接続・ウィジェット・ギフト。Ctrl 相当のコマンドパレット。未定義: 実検索結果UI
- nav: ホーム / ウィジェット / エフェクト / ギフト / コメント / 設定。クリックで各ページ。ホームが current
- TONIGHT: top-gift.html 使用中、effects 汎用 12。出典: ローカル設定 / イベント数
- 庫: goal-gifts, comments, timer。クリックで当該ウィジェット設定
- @yu_ki_nojo: 接続ID。出典 TikTok uniqueId
- TikTok 再確認 8s: 接続状態。出典 live 接続ハートビート
- h1 トップギフトランキング: 使用中ウィジェット名
- path widgets/top-gift · 127.0.0.1.sslip.io:38099: overlay URL
- プレビュー: ウィジェット iframe。透明キャンバス維持。ここは合成プレビュー用に暗い床
- ランキング3行: ウィジェット描画。出典ギフト集計
- URLをコピー: overlay URL を clipboard
- 今のギフトで出す: 疑似ギフト送信
- 詳細: 当該ウィジェット設定
- 直近3: エフェクト発火ログ
- 疑似ギフト textarea: テスト入力。送信操作は未定義（Enter かボタン）

## 状態

- loading: 未定義
- empty（使用中なし）: 未定義
- error（コピー失敗）: 未定義
- TikTok オフライン: 警告テキスト（comp にあり）
- 長文ニックネーム: 未定義
- 庫が多い: 未定義（3件のみ描画）

## 未解決

- Electron の実タイトルバーと偽信号灯の二重化
- 検索の結果パネル
- ウィジェット一覧ページ / エフェクトページの comp がこの凍結に含まれない
- OBS ウィジェット本体のテーマはこの凍結の対象外（透明キャンバス維持）
- 疑似ギフトの送信アフォーダンス（textarea のみ）
