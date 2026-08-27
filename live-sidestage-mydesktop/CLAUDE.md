# CLAUDE.md

このファイルは `live-sidestage-mydesktop` で作業するときの前提知識をまとめたもの。モノレポ全体の位置づけはルートの [../CLAUDE.md](../CLAUDE.md) を参照。

## このプロジェクトの位置づけ

`live-sidestage-desktop`(TikEffect)の派生。TikEffect本体には混ぜない、配信者個人専用の機能ページを左サイドバーへ足していく器として作った。**TikEffectとは完全に別プロセス・別データ**で、SQLite・TikTok Live接続・動画保存ロジックは一切持たない「軽量な観測者アプリ」。

- 常駐しているTikEffect(`http://localhost:38100`、ポート固定・別プロセス)へ`socket.io-client`で接続し、イベントを購読するだけ
- **TikEffectが起動していないと何も表示されない**。配信中は必ずTikEffectが起動している前提のため実用上問題ない
- TikEffect側のDB・業務ロジックには一切触れない。TikEffectのコードを直接importしたり、SQLiteファイルを共有したりしない

## TikEffect側への依存(片方向)

- 接続先は`http://localhost:38100`固定(TikEffect側は環境変数で変更不可、`live-sidestage-desktop/backend/index.js`の`FIXED_PORT`)
- 購読するイベントは`effects:video-playing`のみ。これはTikEffect側の`backend/lib/effect-overlay-html.js`(`video`要素の`playing`イベントから発火)と`backend/lib/socket-handlers.js`(`socket.broadcast.emit`で中継)に**mydesktopのために追加した新規イベント**。TikEffect本体の既存動作(OBSオーバーレイ・管理UI・LIVE Studio連携)には影響しない完全な追加
- `effects:video-playing`のpayload: `{ playbackId, eventId, screen, videoUrl }`。`videoUrl`はTikEffectの`/video/<file>`等から配信される
- TikEffect側でこのイベントの発火箇所・payload形式を変更する場合、mydesktopの`main.js`(socket.io-client購読部分)も合わせて確認すること

## アーキテクチャ

- `main.js` — Electronメインプロセス。単一インスタンスロック、`socket.io-client`接続、IPC、設定の読み書き(`%LOCALAPPDATA%\MyDesktop\settings.json`)、ウィンドウ位置の永続化
- `preload.js` — `contextBridge`で`window.mydesktop`をrendererへ公開(`nodeIntegration:false`, `contextIsolation:true`)
- `renderer/` — 自前Expressサーバーは持たず`loadFile()`でローカルHTML/JS/CSSを直接読み込む
  - `app.js` — サイドバー・ページ切り替えの土台(v1はページが1つのみなので実質空)
  - `effects-preview.js` — 「エフェクト予告」ページの実装本体

native moduleはゼロ(better-sqlite3等は使わない)。依存は`electron`/`electron-builder`/`socket.io-client`のみ。

## 将来ページを追加するとき

1. `renderer/index.html`の`.nav-list`に`<li class="nav-item" data-page="...">`を追加
2. `renderer/<page-name>.js`を新規作成し、`window.<PageName>Page = { init() {...} }`のパターンに従う
3. `renderer/app.js`にページ切り替えロジック(クリックで`.page`の表示切り替え)を追加する(v1時点では未実装)
4. 新しいIPCが必要なら`main.js`/`preload.js`にフィールド単位のAPIを追加する(全体上書き系のAPIは作らない)

## コマンド

```powershell
npm install
npm start              # Electron起動
npm run build:windows  # electron-builder（NSIS）
```

自動テストは現状無い(個人向け初版のため意図的に見送り、検証は手動が中心)。動作確認の詳細な手順は実装計画([../CLAUDE.md](../CLAUDE.md)のプロジェクト一覧経由で辿れる`.claude/plans/`の計画ファイル、または本README)を参照。

## 既知の制約

- `%LOCALAPPDATA%\MyDesktop`は初回起動時に自動作成される。TikEffectの`%LOCALAPPDATA%\TikEffect`とは別ディレクトリ
- 自動テストランナーは未導入。ページが増えて複雑化した時点で導入を検討する
