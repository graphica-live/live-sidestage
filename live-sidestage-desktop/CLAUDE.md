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
