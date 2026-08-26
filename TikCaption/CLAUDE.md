## Commit Rule

**MANDATORY**: 修正・機能追加・設定変更が完了するたびに即座に `git commit` すること。スキップ禁止。

- prefix: `fix:` / `feat:` / `chore:` / `refactor:`
- メッセージは変更内容を端的に記述
- 複数ファイルの変更でも、論理的に1単位なら1コミットでOK

## Build Rule

`npm run build:windows` 実行前に node/electron プロセスを全停止すること。

```powershell
Get-Process | Where-Object { $_.Name -match '^(electron|node)$' } | Stop-Process -Force
```

**Why:** `better_sqlite3.node` がロックされたままだと gyp clean で `EPERM: operation not permitted, unlink` が出てビルド失敗する。

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
npm start                   # electron .
npm test                    # jest --forceExit
npm run build:windows       # electron-builder (NSIS)
npm run deploy              # scripts/deploy.ps1
```

単体テスト1件: `npx jest tests/server.test.js -t "テスト名"`

## アーキテクチャの要点 — Electron + Python ASR

- `main.js` が Python を探し、無ければ `winget` で導入 → `pip install -r requirements.txt` → `caption_server.py` を spawn する自動セットアップを持つ。ASR は NeMo Parakeet + silero-VAD、パッケージ時は `extraResources` として同梱される
- Python → Node は `POST /api/caption/asr-text`、Node → 表示は socket.io で `public/overlay.html`（字幕）と `public/tts-overlay.html` へ配信。制御は `/api/caption/*` と `/api/tts/*`
- TTS 側は `main.js` が `WebcastPushConnection` で TikTok Live に接続しコメントを読み上げる
- 設定は `%USERPROFILE%\.tikcaption-settings.json`（`TIKCAPTION_SETTINGS_PATH` で変更可）
- 他4プロジェクト（analytics/desktop/mobile/TikRIng）とコード上の連携はない独立プロダクト
