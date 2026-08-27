# MyDesktop (live-sidestage-mydesktop)

`live-sidestage-desktop`(TikEffect)に接続する配信者個人専用のElectronアプリ。TikEffect本体の共有プロダクトには混ぜず、配信者個人の作業を助ける小さな機能ページを左サイドバーに追加していく器として作った。

SQLite・TikTok Live接続・動画保存ロジックは持たず、常駐しているTikEffect(`http://localhost:38100`)へsocket.io-clientで接続してイベントを購読するだけの軽量な観測者アプリ。**TikEffectが起動していることが前提**(配信中は必ず起動している)。

## 最初の機能: エフェクト予告

TikEffectの「エフェクト」ウィジェットが指定screen(1〜10)で動画を実際に再生し始めた瞬間、その動画の「指定秒数後のフレーム」を静止画としてこの画面に即座に表示する。変身エフェクトなどポーズが決まる演出で、配信者が実際にそのフレームが配信に出る前にポーズを準備できるようにする。

## コマンド

```powershell
npm install
npm start              # Electron起動
npm run build:windows  # electron-builder（NSIS）
```

## アーキテクチャ

- `main.js` — Electronメインプロセス。socket.io-clientでTikEffect(ポート38100固定)へ接続し、`effects:video-playing`イベントを購読。設定(`%LOCALAPPDATA%\MyDesktop\settings.json`)の読み書き、ウィンドウ位置の永続化、単一インスタンスロックを担う
- `preload.js` — contextBridge経由でrendererへ最小限のAPIを公開
- `renderer/` — 左サイドバーを持つシェルUI。v1は「エフェクト予告」ページのみ

詳細は [CLAUDE.md](CLAUDE.md) を参照。
