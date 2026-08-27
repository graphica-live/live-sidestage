## Widget Preview Background Rule

新規ウィジェットに iframe プレビューを追加するとき:

1. `html, body { background: transparent; }` はそのまま（overlay用）
2. preview/sample モード時にJS でbodyにdark gradient設定:
   ```js
   if (previewMode) {
       document.body.style.background = 'radial-gradient(circle at top, rgba(30, 41, 59, 0.88) 0%, rgba(15, 23, 42, 0.94) 100%)';
       document.body.style.minHeight = '100vh';
   }
   ```
3. 設定ページUI行要素（iframeではない）は `background: var(--panel)`
4. 参考実装: `top-gift.html` の `body.preview-card` CSS rule

## コマンド

```powershell
npm run electron            # Electron起動（prepare-electron.ps1 が先に走る）
npm run electron:dev        # nodemon + electron
npm run run                 # loader-server(38099) + electron を並走
npm run backend:dev         # Expressバックエンドのみ (ブラウザで確認したいとき)
npm test                    # jest (tests/unit/**/*.test.js)
npm run test:visual         # playwright（mock-server.js を自動起動、日本語ロケール固定）
npm run test:visual:update  # スクリーンショット更新
npm run build:windows       # electron-builder（NSIS）
npm run build:publish       # ビルド + Cloudflare R2 へ publish
```

単体テスト1件: `npx jest tests/unit/store.test.js -t "テスト名"` / ビジュアル1件: `npx playwright test tests/visual/widgets.spec.js`

`build:windows` の前に、**このプロジェクトのパス**に紐づく node/electron プロセスだけを停止する（グローバル `~/.claude/docs/electron-desktop-widgets.md` の repo スコープ版を使う。モノレポ化後はパス絞り込みが `live-sidestage-desktop` まで含む点に注意 — ルートパスで絞ると他4プロジェクトのプロセスまで巻き込む）。

## アーキテクチャの要点 — 3レイヤーのローカル完結アプリ

- ルートの `index.js` は `backend/index.js` を再 export するだけ。実体は **`backend/index.js`（130KB超のモノリス）+ `backend/lib/` のウィジェット別 state モジュール群**（`*-state.js` / `*-runtime.js`）。ルートは `backend/lib/routes/`、SQLite アクセスは `backend/lib/db/store.js`
- レイヤー: `electron/main.js`（ウィンドウ・トレイ常駐・electron-updater） / `backend`（Express + socket.io + better-sqlite3） / `backend/public`（`db/` = 管理UI「Control」、`widgets/` = OBS に読ませる HTML）
- **ポートは 38100 固定**。競合しても自動フォールバックせず起動失敗する。`loader-server/index.js`（38099）はバックエンドの TCP 生存を見て起動を仲介するランチャー用サーバー
- 管理UIが「URLをコピー」で出す配布 URL は `127.0.0.1.sslip.io` ベース。TikTok Live Studio が bare `localhost` を無効扱いするための回避
- 実行データは `%LOCALAPPDATA%\TikEffect`（SQLite DB、`.auth.env`、`.env`）。TikTok 認証は Electron 版からのみ実行可能
- ウィジェットを1つ増やすと触るのは: `backend/public/widgets/<name>.html` + `backend/lib/<name>-state.js` + 管理UI側 `backend/public/db/widgets.html` / `widgets.js`（295KB）への登録
- Windows ランチャー(.vbs/.cmd)は `scripts/windows-launchers.config.json` に1エントリ追加して `npm run generate:windows-launchers` で再生成する。詳細は [WINDOWS-PACKAGING.md](WINDOWS-PACKAGING.md)

### 連携先

- analytics との連携は `GET /api/analytics/monthly-contributors?month=YYYY-MM`（[backend/lib/monthly-mvp-client.js](backend/lib/monthly-mvp-client.js)）。baseUrl と apiKey は称号ウィジェット設定として SQLite に保存され、先月の MVP/TOP5 を取り込む
- モノレポ化以前は `C:\dev\tiktok-app` にあった。`.mcp.json` の `cwd` と `.claude/settings.json` の hooks が旧パスを指したままで実在しない（code-review-graph MCP はこの状態では動かない）

## フロントエンドの完了条件

- package.jsonに定義済みのlint、test、buildを実行する
- 存在しないコマンドを捏造しない
- 開発サーバーを起動し、実際のブラウザで確認する
- コンソールエラー、画像404、ネットワークエラーを確認する
- 画像のアスペクト比を維持し、意図しない引き伸ばしをしない
- PC表示とスマートフォン表示を確認する
- 動作確認していない状態で「完了」と報告しない
