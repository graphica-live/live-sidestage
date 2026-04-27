# Windows Packaging

このアプリは Electron ベースで配布し、内部でブラウザ UI を表示する Windows アプリです。ユーザーは Node の個別インストール不要です。

## 配布方式

- アプリ本体は Electron + Express + Socket.io + SQLite で動かします。
- 配布物には Electron ランタイムを同梱します。
- インストーラは Inno Setup 6 で setup.exe を生成します。
- インストール先は `Program Files` 配下です。インストール時に管理者権限が必要です。
- 実行データは `%LOCALAPPDATA%\TikEffect` に保存します。

## 前提

- Windows でビルドする
- ビルド用 PC には Node.js / npm が入っている
- setup.exe まで作る場合は Inno Setup 6 を入れる
- setup.exe のインストール時は管理者権限が必要

## コマンド

contributors overlay のみ起動:

```powershell
npm run overlay:contributors:start
```

Electron を起動:

```powershell
npm run electron
```

Electron を開発モードで起動:

```powershell
npm run electron:dev
```

backend と overlay を別プロセスで同時起動:

```powershell
npm run start:split
```

ステージングのみ作る:

```powershell
npm run package:windows
```

installer まで作る:

```powershell
npm run installer:windows
```

生成先:

- ステージング: `dist\windows\app`
- インストーラ: `dist\windows\installer\TikEffect-Setup.exe`

## 実行時の挙動

- UI 資産は機能別に `backend\public\db` と `overlays\contributors` へ分割しています。
- `backend\public\db` には管理画面と setup、`overlays\contributors` には contributors 表示用オーバーレイを置きます。
- contributors overlay 専用サーバーは `38101` を既定で使い、backend は `38100` を使います。
- overlay 単独起動時は `OVERLAY_BACKEND_ORIGIN` で接続先 backend を切り替えられます。
- 管理画面の「URLをコピー」や effects の配布用 URL は、TikTok Live Studio が bare `localhost` を無効扱いするため、自動的に `127.0.0.1.sslip.io` ベースで生成します。
- TikTok 認証は Electron 版からのみ実行できます。Node 単体起動での手動認証は対応しません。

- 配布版は `Launch TikEffect.vbs` から起動し、cmd や PowerShell のコンソールは通常表示しません。
- 配布版ランチャーは admin 用と contributors overlay 用を分けています。
- `Launch TikEffect Admin.vbs` は `http://localhost:38100/admin` を開きます。
- `Launch TikEffect Contributors Overlay.vbs` は `http://localhost:38100/overlays/contributors` を開きます。
- 新しい overlay を追加するときは `scripts/windows-launchers.config.json` に 1 エントリ追加し、`npm run generate:windows-launchers` を実行すると launcher と installer shortcut 定義が再生成されます。
- 起動後は Windows のタスクバー通知領域にアイコンが常駐します。
- 通知領域アイコンは左クリックで管理画面を再表示し、右クリックメニューの「終了」でアプリを閉じられます。
- 通知領域アイコンの右クリックメニューから Windows のスタートアップ登録をオン/オフできます。
- Broadcaster ID 未設定時は既存ルートにより setup 画面へリダイレクトされます。
- SQLite DB は `%LOCALAPPDATA%\TikEffect\data` に作られます。
- Electron 版で取得した TikTok 認証情報は `%LOCALAPPDATA%\TikEffect\.auth.env` に保存し、次回起動時に再利用します。
- 開発時の `data` ディレクトリに既存 DB があり、AppData 側が空なら初回起動時に DB / WAL / SHM をコピーします。
- ポートは `38100` 固定です。他アプリが使用中の場合は自動で別ポートへ切り替えず、競合メッセージを出して起動失敗します。
- 起動に失敗した場合は PowerShell ランチャー側のダイアログでエラーを表示します。

## 環境変数

ルートの `.env`、または `%LOCALAPPDATA%\TikEffect\.env` を読み込みます。既存の OS 環境変数がある場合はそちらを優先します。

例:

```env
TIKTOK_USERNAME=yu_ki_nojo
TIKTOK_SESSION_ID=
AUTO_OPEN_BROWSER=1
APP_START_PATH=/admin
```

`APP_DATA_DIR` を設定すると保存先を明示的に切り替えられます。