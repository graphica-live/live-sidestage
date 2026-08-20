# Live Sidestage (live_sidestage_mobile)

TikTok Liveのコメントをリアルタイムに取得し、オンデバイスVOICEVOXで読み上げるAndroidアプリ。
バックエンドは LiveAnalytics (Railway本番) を利用する。

- アプリ表示名: **Live Sidestage** (PC・Webサービス共通のブランド名)
- Dartパッケージ名: `live_sidestage_mobile`
- Androidパッケージ: `com.liveanalytics.live_sidestage_mobile`

## Getting Started

```bash
flutter pub get
flutter run
```

## Google サインインのセットアップ（必須）

Android の Google サインインは、Google Cloud Console に **パッケージ名 + ビルド署名の SHA-1** の組で
Android OAuth クライアントが登録されていないと必ず失敗する（`DEVELOPER_ERROR` / code 10）。
`applicationId` を変更した場合は登録し直すこと。

1. デバッグ署名の SHA-1 を取得する:

   ```powershell
   & "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -list -v `
     -alias androiddebugkey -keystore "$env:USERPROFILE\.android\debug.keystore" `
     -storepass android -keypass android
   ```

2. Google Cloud Console → 「APIとサービス」→「認証情報」→ OAuth クライアント ID を作成:
   - 種類: **Android**
   - パッケージ名: `com.liveanalytics.live_sidestage_mobile`
   - SHA-1: 上で取得した値（リリースビルドでは release keystore の SHA-1 も別途登録する）

3. `lib/core/api_client.dart` の `googleServerClientId` は **ウェブアプリケーション種別**の
   クライアント ID で、LiveAnalytics バックエンドの `GOOGLE_CLIENT_ID` と同じ値。
   パッケージ名を変えてもこちらは変更不要。

Flutter開発が初めての場合は以下を参照:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [online documentation](https://docs.flutter.dev/)
