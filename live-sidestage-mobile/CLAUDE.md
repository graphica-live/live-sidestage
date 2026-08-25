<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**重要: このプロジェクトにはナレッジグラフがある。コードベース探索時は Grep/Glob/Read より先に必ず code-review-graph MCPツールを使うこと。** グラフはより高速・低コスト（トークン節約）で、ファイルスキャンでは得られない構造的コンテキスト（呼び出し元・依存関係・テストカバレッジ）を提供する。

### グラフツールを優先すべき場面

- **コード探索**: Grep の代わりに `semantic_search_nodes` か `query_graph`
- **影響範囲把握**: importを手動で追う代わりに `get_impact_radius`
- **コードレビュー**: ファイル全読みの代わりに `detect_changes` + `get_review_context`
- **関係性調査**: `query_graph` に callers_of/callees_of/imports_of/tests_for を指定
- **アーキテクチャ把握**: `get_architecture_overview` + `list_communities`

グラフで対応できない場合のみ Grep/Glob/Read にフォールバックする。

### 主要ツール

| ツール | 使用場面 |
| ------ | ---------- |
| `detect_changes` | コード変更レビュー — リスクスコア付き分析 |
| `get_review_context` | レビュー用ソースの断片取得 — トークン効率が高い |
| `get_impact_radius` | 変更の影響範囲を把握 |
| `get_affected_flows` | 影響を受ける実行パスの特定 |
| `query_graph` | 呼び出し元・先・import・テスト・依存関係のトレース |
| `semantic_search_nodes` | 名前やキーワードで関数/クラスを検索 |
| `get_architecture_overview` | コードベースの高レベル構造把握 |
| `refactor_tool` | リネーム計画・デッドコード検出 |

### ワークフロー

1. グラフはファイル変更時に自動更新される（フック経由）。
2. コードレビューには `detect_changes` を使う。
3. 影響把握には `get_affected_flows` を使う。
4. カバレッジ確認には `query_graph` pattern="tests_for" を使う。

ルール: まずファイルを読む。完全な解を書く。テストは1回。過剰設計しない。

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

## 並行作業ルール（複数タブ）

**コード変更を伴うタスクを開始する際は、ユーザーに確認せず自動的に `EnterWorktree` ツールを使って作業ブランチを分離すること。** 同一ディレクトリを複数タブで同時編集すると、Editツールの内容衝突や意図しない上書きが発生するため。

- `EnterWorktree` は `.claude/worktrees/` 配下に新規ブランチを作成しセッションの作業ディレクトリを切り替える。`node_modules` は設定済みのsymlinkDirectoriesにより自動共有される
- 単純な確認・調査のみのタスク（コード変更なし）では不要
- ユーザーからの明示的な指示がなくても、このCLAUDE.mdの指示によりworktree使用がトリガーされる（EnterWorktreeツールの仕様）

### 片付け（ExitWorktree）

`ExitWorktree` はツール仕様上「ユーザーが明示的に頼んだ時のみ呼ぶ」制約があり、CLAUDE.mdの指示だけでは自動発動しない（未コミット変更やブランチを誤って消さないための安全策）。そのためユーザーに確認なしで黙って削除することはしない。代わりに以下を徹底する：

- コミット完了・PR作成・マージ完了など「このworktreeでの作業が一区切りついた」タイミングを検知したら、ユーザーに聞かれる前にこちらから `keep`/`remove` をワンクリックで選べる形で確認を出す（ユーザーが「片付けて」と言うのを待たない）
- タブを閉じるだけの場合はセッション終了時にkeep/removeの確認が自動で出る仕様のため、追加対応は不要

**Why:** 複数タブが同じディレクトリを共有すると、ファイル競合や意図しない上書きが起きる。タスク開始時に自動でworktree分離すれば、ユーザーが毎回コマンドを打つ必要がなく、他タブの完了を待たずに真の並行作業ができる。

### worktree作成に失敗した場合

`EnterWorktree`が失敗した場合（すでにworktreeセッション内にいる／新規ブランチ名が既存ブランチと衝突している／対象worktreeが`locked`状態、など）、**黙ってmainを直接編集しない**。

- 失敗を検知したら `AskUserQuestion` でユーザーに状況（失敗理由・衝突したブランチ名やlocked中のworktreeパスなど）を伝え、対応方針を確認する。選択肢の例:
  - 別名で `EnterWorktree` を再試行する
  - 関連する既存worktreeに `path` 指定で切り替えて作業する
  - 今回に限り明示的な許可を得た上でmainを直接編集する
- ユーザーの回答を待たずにmain編集へフォールバックしてはならない。

### マージキュー方式

worktreeでのタスクが完了（コミット済み）しても、mainへは**即マージしない**。代わりに「マージキュー」に積んでおき、ユーザーからのマージ指示があった時点でキューをまとめて消化する。

- キューは `.claude/merge-queue.md` で管理する（存在しなければ作成）。1行1エントリで `- <branch> — <タスク概要> (<完了日時>)` の形式。
- worktreeタスクのコミットが完了したら、mainのcheckoutでマージする代わりに、このキューファイルにエントリを追加する。
- ユーザーが「マージして」「キュー消化して」「たまってるやつマージして」等の指示を出したら、キューにあるブランチを上から順に main の checkout から `git merge --no-ff <branch> -m "..."` でマージし、成功したエントリをキューファイルから削除する。
- 各マージ成功後、worktreeのkeep/remove確認をAskUserQuestionで出す（[片付け（ExitWorktree）](#片付けexitworktree)のルールに従う）。
- コンフリクトなど消化中に問題が起きたら、そのエントリはキューに残したまま処理を止めてユーザーに報告する。
- ユーザーが特定タスクで「今回はすぐマージして」等、明示的に即時マージを指示した場合はキューを経由せずその場でマージしてよい（例外）。

**Why:** 複数タブで並行してworktreeタスクを進めていると、都度mainへ自動マージするとタイミングによってはユーザーが把握していないマージが積み重なる。マージ作業をユーザーの明示的な指示に紐づけることで、いつ・何がmainに入るかをユーザー側でコントロールできるようにする。

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
- 本番バックエンド URL は `lib/core/api_client.dart` にハードコード（`https://liveanalytics-production.up.railway.app`）
- 認証フロー: `POST /api/mobile/auth/google` → JWT → `GET /api/mobile/streamer` で apiKey 取得 → socket.io に `?apiKey=` で接続し `chat:{streamerId}` ルームの `chat:comment` を受信
- Google サインインは **パッケージ名 + 署名 SHA-1 の組**を Google Cloud Console に Android OAuth クライアントとして登録しないと必ず `DEVELOPER_ERROR`(code 10) になる。`applicationId` を変えたら再登録が必要。手順は [README.md](README.md)
- Apple サインインは Android にネイティブ実装が無いので **Custom Tab の web フロー**。client_id は Bundle ID ではなく **Services ID** で、Apple の `form_post` を受けて `intent://` へ中継する `/api/mobile/auth/apple/callback` が要る。**id_token ではなく authorizationCode をサーバーへ送る**（受け口の `SignInWithAppleCallback` Activity は exported なので他アプリからも叩け、id_token 単体では他人の応答を差し込まれる）。端末は `state` を、サーバーは code 交換と `nonce` の完全一致を検証する。`--dart-define=APPLE_SERVICES_ID=...` を渡していないビルドではボタン自体を出さない。手順は [README.md](README.md)
- **Google と Apple は常に別ユーザー**（メールが同じでも統合しない）。Apple で入り直すとオンボーディングからやり直しになる。担保の仕組みはサーバー側 [live-sidestage-analytics/src/lib/apple-account.ts](../live-sidestage-analytics/src/lib/apple-account.ts) の冒頭コメント
- `AuthSession.provider` は **どちらでログインしたかの記録**で、無言リフレッシュとログアウトの分岐、設定画面のアカウント表示（Google/Apple）に使う。Apple には `signInSilently` 相当が無いので、JWT が失効したら手動の再ログインになる。保存済みセッションでは `provider` を**必須キーにしない**（既存インストールのセッションが消える）
- **`sign_in_with_apple` は Android で Custom Tab を閉じられると Future を永久に resolve しない**（プラグイン側に戻りを知る手段が無いための仕様）。そのまま待つと `isLoading` が立ちっぱなしになり、再起動するまでログインできなくなる。`SessionController._awaitAppleCredential()` がアプリの復帰を検知して猶予3秒で打ち切っている。この打ち切りを外さないこと
- VOICEVOX モデルと OpenJTalk 辞書は `assets/` に同梱（サイズ大）。**vvm は中のキャラ数に関係なく1本 55MB 前後**（`0.vvm` は4キャラ10スタイル、`4.vvm` は2キャラ2スタイルで同サイズ）で、`extractTtsAssets()` が起動時にアプリ領域へ展開するので端末上は二重に載る。読み上げ開始時に全 vvm を `loadModel` するため、**増やすと常駐 RAM と初期化時間が本数に比例して増える**（合成のコストは選ばれた1スタイルぶんなので本数に依存しない）。Foreground Service はメモリ圧で真っ先に落とされる側なので、増やすときは実機で `dumpsys meminfo` を見る
- **vvm を足す・差し替えるときは [lib/models/voice_catalog.dart](lib/models/voice_catalog.dart) も更新する。** 設定画面のボイス選択肢はこの静的な表から出している（VOICEVOX が返す実際の一覧は読み上げを開始するまで存在せず、停止中に開く設定画面では使えないため）。更新し忘れても壊れはしない（`VoicePool` が実在しない styleId を先頭のボイスへ落とす）が、増えたキャラを選べないままになる
- ギフト名の日本語表示は `lib/core/gift_name_ja.dart` が `assets/gift_names/gift_names_ja.json` を参照する。この JSON はモノレポ `shared/gift-names/` からの生成物なので直接編集しない（詳細は [../shared/gift-names/README.md](../shared/gift-names/README.md)）
- このリポジトリは統合前の git remote を持たないローカル専用リポジトリだった。モノレポが唯一のリモートバックアップ
