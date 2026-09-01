# LIVE Sidestage (live_sidestage_mobile)

TikTok Liveのコメントをリアルタイムに取得し、オンデバイスVOICEVOXで読み上げるAndroidアプリ。
バックエンドは LIVE Sidestage Analytics (Railway本番) を利用する。

- アプリ表示名: **LIVE Sidestage** (PC・Webサービス共通のブランド名)
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
   クライアント ID で、LIVE Sidestage Analytics バックエンドの `GOOGLE_CLIENT_ID` と同じ値。
   パッケージ名を変えてもこちらは変更不要。

## Apple サインインのセットアップ（任意・Apple Developer Program 必須）

**設定が済むまでボタンは表示されない。** `--dart-define=APPLE_SERVICES_ID=...` を渡したビルドでだけ
ログイン画面に「Appleでサインイン」が出る（未設定のまま押しても必ず失敗するため）。
バックエンド側も必須の環境変数が欠けていれば `POST /api/mobile/auth/apple` は 503 を返す。

Android にはネイティブの Apple 認証が無いので、Custom Tab で **web フロー**を回す。
そのため client_id は Bundle ID ではなく **Services ID** になり、Apple からの `form_post` を
受けて `intent://` へ中継する自前のエンドポイントが要る（`/api/mobile/auth/apple/callback`）。

### 1. Apple Developer Portal（Certificates, Identifiers & Profiles）

| 作るもの | 値 | 用途 |
| --- | --- | --- |
| App ID | `com.liveanalytics.live-sidestage-mobile` | iOS 版。Sign In with Apple capability を有効化する。**Bundle ID に underscore は使えない**（英数字・ハイフン・ピリオドのみ）ので、Android の `applicationId` とは別の値になる |
| Services ID | 例 `com.liveanalytics.live-sidestage.signin` | Android / Web の client_id。上の App ID を **primary App ID として関連付ける**（これをしないと同じ人でもクライアントごとに別の `sub` になる） |
| Key (.p8) | Sign in with Apple 用 | client_secret の署名鍵。**ダウンロードは1回きり** |

Services ID の設定で以下を登録する。

- Domains and Subdomains: `api.livesidestage.com`
- Return URLs:
  - `https://api.livesidestage.com/api/mobile/auth/apple/callback` （モバイル用）
  - `https://analytics.livesidestage.com/api/auth/callback/apple` （**将来 Web(NextAuth) に足すとき用**。今は未使用だが、先に登録しておけば後から Apple 側を触らずに済む）

### 2. バックエンド（Railway の web サービス）

| 変数 | 必須 | 値 |
| --- | --- | --- |
| `APPLE_TEAM_ID` | ✓ | Apple Developer の Team ID |
| `APPLE_KEY_ID` | ✓ | 上で作った Key の Key ID |
| `APPLE_PRIVATE_KEY` | ✓ | `.p8` の中身（改行は `\n` エスケープでよい） |
| `APPLE_SERVICES_ID` | ✓ | Services ID |
| `APPLE_REDIRECT_URI` | ✓ | 登録した Return URL と**完全一致**させる |
| `APPLE_BUNDLE_ID` | — | iOS 版で設定。`aud` として Bundle ID も許容する |
| `APPLE_ANDROID_PACKAGE` | — | 既定 `com.liveanalytics.live_sidestage_mobile` |

### 3. アプリのビルド

```bash
flutter build apk --release \
  --dart-define=APPLE_SERVICES_ID=com.liveanalytics.live-sidestage.signin \
  --dart-define=APPLE_REDIRECT_URI=https://api.livesidestage.com/api/mobile/auth/apple/callback
```

`APPLE_REDIRECT_URI` は省略すると `API_BASE_URL` から組み立てるので、本番URLのままなら
`APPLE_SERVICES_ID` だけでよい。

### 既存 Google ユーザーとの関係

**Google と Apple は常に別アカウントになる。** メールが同じでも統合しない。

同じ人が両方でログインすると、配信設定・TikTok ID・apiKey はそれぞれ独立する。
Apple で入り直した場合は TikTok ID の登録からやり直しになる（同じ TikTok ID を入れれば
ギフトデータ自体は同じものを見る。接続は `TiktokRoom` 単位で共有されるため）。

意図せず片方の設定へ吸着させないための方針。詳細と、この分離がどこまで保証されるかは
[live-sidestage-analytics/src/lib/apple-account.ts](../live-sidestage-analytics/src/lib/apple-account.ts) の
冒頭コメントにある。

Flutter開発が初めての場合は以下を参照:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [online documentation](https://docs.flutter.dev/)
