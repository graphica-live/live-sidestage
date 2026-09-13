# Control Home

機能: TikEffect Control シェル（`backend/public/db/home.html`）と凍結ホーム（今夜のプレビュー・URLコピー・疑似ギフト）。背景は暗い無地。油彩は使わない。

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TC-CH-001 | ホームが暗い無地＋浮き窓の3カラムで開く | live-sidestage-desktop/backend/public/db/home.html | UI | Control を開く | タイトルバーに Live Sidestage Desktop、左にホーム〜設定、中央にトップギフトランキング、右に直近と疑似ギフト欄。油彩壁紙も大きなベージュ塗りも無い | 実ブラウザ http://127.0.0.1:38300/ |PASS |
| TC-CH-002 | ナビが iframe ページへ切り替わる | home.html setCurrentRoute | 正常 | ウィジェットをクリック | 右レールが消え、中央がウィジェット管理。ホーム以外の aria-current はウィジェットのみ | 実ブラウザ |PASS |
| TC-CH-003 | URLコピーが今の origin の overlay を載せる | control-home.js copyOverlay | 正常 | 非パッケージ（node）で URLをコピー | clipboard が `http://127.0.0.1:<port>/overlays/top-gift`（死んだ loader ポートではない） | 実ブラウザ |PASS |
| TC-CH-004 | 疑似ギフト送信がテスト API を叩く | POST /api/effects/gift-test | 正常 | テキスト Rose、今のギフトで出す | 400 にならず JSON ok | curl |PASS |
| TC-CH-005 | OBS ウィジェット本体の透過は変えない | widgets/*.html | negative | ホーム改修後 | overlay HTML の html/body 背景は transparent のまま | grep widgets/top-gift.html |PASS |
| TC-CH-007 | 検索はフィルタのみで結果パネルを出さない | home.html 検索 | negative | 検索欄に入力 | ドロップダウンは出ない。Enter で先頭の可視ナビ/庫へ | 実ブラウザ |PASS |
| TC-CH-008 | 接続状態でドットと警告色が変わる | home.html syncStatusCard | 正常 | connected / disabled | 無効時は警告テキスト。connected では is-off が無い | 実ブラウザ + /api/state |PASS |
| TC-CH-009 | 管理ページからホームへ戻ると3カラムに戻る | setCurrentRoute | 正常 | ウィジェットのあとホーム | is-page が外れプレビューと直近が見える | 実ブラウザ |PASS |
| TC-CH-010 | 子ページ単体では in-control-shell が付かない | control-embed.js | 回帰 | widgets.html をトップレベルで開く | html.in-control-shell が付かない | 実ブラウザ /widgets |PASS |
| TC-CH-011 | 既定では TikTok 接続ポートは 38100 のまま | TIKEFFECT_PORT / DISABLE | 回帰 | インストール版 | 開発 38300 と本番 38100 が同時に Listen。DISABLE_TIKTOK=1 の開発は接続しない | netstat + /api/state |PASS |
| TC-CH-012 | ギフト iframe が漆トーン | gifts.html in-control-shell | UI | ナビ「ギフト」 | ネイビーの大きなヒーローではなく暗いパネル＋表 | 実ブラウザ |PASS |

| TC-CH-013 | Electron 右上の Win 操作で窓を動かし、漆がネイティブ窓いっぱいになる | electron/preload-control.js / .caption | 正常 | APP_DATA_DIR 分離の Electron。右上 ─ □ ✕ | 最小化・最大化切替・閉じる。左上に Mac 信号灯は無い。html.is-electron-shell で desk 余白が消える。ブラウザでは見た目のみ | npm run electron + 環境変数 |PASS |
| TC-CH-014 | TONIGHT/庫でプレビューを切り替える | control-home.js applySelection | 正常 | effects 汎用または goal-gifts をクリック | タイトルと overlay iframe src が選んだウィジェットになる | 実ブラウザ |PASS |
| TC-CH-016 | インストール版と開発 Electron が同時に動く | APP_DATA_DIR + TIKEFFECT_PORT | 回帰 | 38100 の TikEffect.exe を残したまま 38300 Electron | 両方 Listen。開発は DISABLE_TIKTOK=1 | netstat |PASS |

## Out of Scope

- ウィジェット一覧 / エフェクト詳細の個別 comp
- 検索のコマンドパレット UI

| TC-CH-018 | analytics login UI | home.html | UI | Control settings | analytics URL/email/password and streamer register exist | read home.html | PASS | Electron not launched |
| TC-CH-019 | map analytics gift payload | analytics-live-client.js | 正常 | desktop gift payload | uniqueId is tiktokHandle | jest analytics-live-client.test.js | PASS |
| TC-CH-020 | no analytics creds means no live client | connectToTikTok | 異常 | missing token | not_configured return | read index.js | PASS |
