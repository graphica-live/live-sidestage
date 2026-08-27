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
