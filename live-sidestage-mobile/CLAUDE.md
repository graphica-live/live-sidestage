## フロントエンドの完了条件

- package.jsonに定義済みのlint、test、buildを実行する
- 存在しないコマンドを捏造しない
- 開発サーバーを起動し、実際のブラウザで確認する
- コンソールエラー、画像404、ネットワークエラーを確認する
- 画像のアスペクト比を維持し、意図しない引き伸ばしをしない
- PC表示とスマートフォン表示を確認する
- 動作確認していない状態で「完了」と報告しない

## コマンド

```bash
flutter pub get
flutter run                 # 実機/エミュレータ
flutter analyze             # analysis_options.yaml (flutter_lints)
flutter test                # test/widget_test.dart
flutter test test/widget_test.dart --plain-name "テスト名"
flutter build apk --release
```

## アーキテクチャの要点 — Flutter + オンデバイス VOICEVOX

- `lib/core/` が中核: `SessionController`（認証・セッション、ChangeNotifier）/ `CommentFeed`（socket.io 受信）/ `SpeechQueue` + `TtsEngine` + `VoicePool`（VOICEVOX 合成）/ `background_task_handler.dart`（`flutter_foreground_task` で画面オフ中も読み上げ継続）
- 本番バックエンド URL は `lib/core/api_client.dart` にハードコード（`https://analytics.livesidestage.com`。Apple Sign-inのredirect URIは別ホスト`api.livesidestage.com`のまま — Apple Developer Portal登録値と一致させる必要があり連動しない）
- 認証フロー: `POST /api/mobile/auth/google` → JWT → `GET /api/mobile/streamer` で apiKey 取得 → socket.io に `?apiKey=` で接続し `chat:{streamerId}` ルームの `chat:comment` を受信
- Google サインインは **パッケージ名 + 署名 SHA-1 の組**を Google Cloud Console に Android OAuth クライアントとして登録しないと必ず `DEVELOPER_ERROR`(code 10) になる。`applicationId` を変えたら再登録が必要。手順は [README.md](README.md)
- Apple サインインは Android にネイティブ実装が無いので **Custom Tab の web フロー**。client_id は Bundle ID ではなく **Services ID** で、Apple の `form_post` を受けて `intent://` へ中継する `/api/mobile/auth/apple/callback` が要る。**id_token ではなく authorizationCode をサーバーへ送る**（受け口の `SignInWithAppleCallback` Activity は exported なので他アプリからも叩け、id_token 単体では他人の応答を差し込まれる）。端末は `state` を、サーバーは code 交換と `nonce` の完全一致を検証する。`--dart-define=APPLE_SERVICES_ID=...` を渡していないビルドではボタン自体を出さない。手順は [README.md](README.md)
- **Google と Apple は常に別ユーザー**（メールが同じでも統合しない）。Apple で入り直すとオンボーディングからやり直しになる。担保の仕組みはサーバー側 [live-sidestage-analytics/src/lib/apple-account.ts](../live-sidestage-analytics/src/lib/apple-account.ts) の冒頭コメント
- `AuthSession.provider` は **どちらでログインしたかの記録**で、無言リフレッシュとログアウトの分岐、設定画面のアカウント表示（Google/Apple）に使う。Apple には `signInSilently` 相当が無いので、JWT が失効したら手動の再ログインになる。保存済みセッションでは `provider` を**必須キーにしない**（既存インストールのセッションが消える）
- **`sign_in_with_apple` は Android で Custom Tab を閉じられると Future を永久に resolve しない**（プラグイン側に戻りを知る手段が無いための仕様）。そのまま待つと `isLoading` が立ちっぱなしになり、再起動するまでログインできなくなる。`SessionController._awaitAppleCredential()` がアプリの復帰を検知して猶予3秒で打ち切っている。この打ち切りを外さないこと
- VOICEVOX モデルと OpenJTalk 辞書は `assets/` に同梱（サイズ大）。**vvm は中のキャラ数に関係なく1本 55MB 前後**（`0.vvm` は4キャラ10スタイル、`4.vvm` は2キャラ2スタイルで同サイズ）で、`extractTtsAssets()` が起動時にアプリ領域へ展開するので端末上は二重に載る。読み上げ開始時に全 vvm を `loadModel` するため、**増やすと常駐 RAM と初期化時間が本数に比例して増える**（合成のコストは選ばれた1スタイルぶんなので本数に依存しない）。Foreground Service はメモリ圧で真っ先に落とされる側なので、増やすときは実機で `dumpsys meminfo` を見る
- **vvm を足す・差し替えるときは [lib/models/voice_catalog.dart](lib/models/voice_catalog.dart) も更新する。** 設定画面のボイス選択肢はこの静的な表から出している（VOICEVOX が返す実際の一覧は読み上げを開始するまで存在せず、停止中に開く設定画面では使えないため）。更新し忘れても壊れはしない（`VoicePool` が実在しない styleId を先頭のボイスへ落とす）が、増えたキャラを選べないままになる
- **ギフト名の日本語表示は TikTok 公式の名前をサーバーから取る。** `GET /api/mobile/gifts` の `labelJa`（analytics が `gift/list/` を `webcast_language=ja-JP` で叩いて貯めたもの）を `lib/core/gift_name_ja.dart` が端末へキャッシュし、以後はオフラインでも引ける。更新は起動時（`HomeScreen.initState`）とギフトピッカーを開いたときの2箇所。以前あったアセット同梱の手作業辞書（`assets/gift_names/`、モノレポ `shared/gift-names/` の生成コピー）は廃止した
- **一致キー（`GiftSound.giftName`）は日本語にしない。** LIVE の gift イベントは英語で届くので、日本語を保存すると無言で鳴らなくなる。日本語は表示と検索にだけ使い、逆引きは持たない。ただし配信者ごとのサブスクギフトは TikTok 自身が日本語名で送ってくる（例:「わやハグ」）ので、ピッカーの自由入力で日本語を**禁止はしない**（注意文だけ出す）
- このリポジトリは統合前の git remote を持たないローカル専用リポジトリだった。モノレポが唯一のリモートバックアップ
