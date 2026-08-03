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
- 作業完了後、ユーザーがPR作成やマージを終えたら `ExitWorktree`（`keep` or `remove`）で終了する
- ユーザーからの明示的な指示がなくても、このCLAUDE.mdの指示によりworktree使用がトリガーされる（EnterWorktreeツールの仕様）

**Why:** 複数タブが同じディレクトリを共有すると、ファイル競合や意図しない上書きが起きる。タスク開始時に自動でworktree分離すれば、ユーザーが毎回コマンドを打つ必要がなく、他タブの完了を待たずに真の並行作業ができる。

## フロントエンドの完了条件

- package.jsonに定義済みのlint、test、buildを実行する
- 存在しないコマンドを捏造しない
- 開発サーバーを起動し、実際のブラウザで確認する
- コンソールエラー、画像404、ネットワークエラーを確認する
- 画像のアスペクト比を維持し、意図しない引き伸ばしをしない
- PC表示とスマートフォン表示を確認する
- 動作確認していない状態で「完了」と報告しない
