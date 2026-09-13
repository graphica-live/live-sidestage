---
project: live-sidestage-analytics
feature: worker 再起動提案
last_updated: 2026-09-14
last_risk: MEDIUM
last_reviewers: Gemini 3.7 Flash (Code Mode; TestCase simultaneous)
---

# テストベースライン: worker 再起動提案

`worker.ts` / `src/lib/tiktok-listener.ts` を起点にした静的 import graph（BFS）から
`buildExpectedPatterns` で求めた対象パスと、push/PR（または `--changed-files`）の変更ファイルの
**交差**で、TikTok worker1/2/3 の手動再起動が必要かを提案する CLI
（`npm run check:worker-restart-proposal` / `scripts/check-worker-restart-proposal.ts`）。

Railway 本番 `watchPatterns` との一致チェック・snapshot・Railway API 読み取りは廃止。
提案の有無では **exit 0**（起動不能な graph エラーのみ非 0）。GitHub Actions verify でも
再起動推奨時に job を fail させない（`docs/deploy/worker-restart-proposal.md` の本番手順は別）。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-WWP-001 | 相対import(./)を解決してlibFilesに含める | `core.ts` buildImportGraph | 正常 | `main.ts`が`./helper.ts`をimport | `helper.ts`がlibFilesに含まれ、unresolvedは0件 | `npx vitest run scripts/worker-watch-patterns/core.test.ts` | PASS | |
| TC-WWP-002 | `@/`エイリアスを`rootDir/src/`基準で解決する | `core.ts` resolveImportSpec | 正常 | `main.ts`が`@/lib/nested/nested`をimport | `nested/nested.ts`がlibFilesに含まれる | 同上 | PASS | 実装バグ修正済み(旧実装は`srcDir`=`src/lib`基準で二重libパスになり解決失敗していた) |
| TC-WWP-003 | 動的import/requireも解決対象に含む | `core.ts` extractImports | 正常 | `import("./dynamic")` / `require("./required")` | 対象ファイルがlibFilesに含まれる | 同上 | PASS | |
| TC-WWP-004 | 外部パッケージ/node組み込みモジュールはスキップされunresolvedに含まれない | `core.ts` buildImportGraph | negative | `import { foo } from "external-package"` | libFilesに追加されず、unresolvedにも記録されない | 同上 | PASS | 設計欠陥修正済み(旧実装は外部importも無差別にunresolvedへ積み、CLIが常時exit 1になっていた) |
| TC-WWP-005 | root file自身がsrcDir配下ならlibFilesに含める | `core.ts` buildImportGraph | 境界 | root=`src/lib/main.ts` | `main.ts`自身がlibFilesに含まれる | 同上 | PASS | 実装バグ修正済み(旧実装はroot自身を期待値へ算入せず、本番実在ファイルtiktok-listener.tsがExtra誤検知されていた) |
| TC-WWP-006 | 循環importで無限ループしない | `core.ts` buildImportGraph(cycle detection) | 境界 | `main.ts`⇄`cyclic.ts`相互import | 有限時間で終了し、両ファイルがlibFilesに1回ずつ含まれる | 同上 | PASS | |
| TC-WWP-007 | root fileが存在しないとエラーを投げる | `core.ts` buildImportGraph | 異常 | 存在しないパスをrootsに指定 | `root file not found`を含むエラーがthrowされる | 同上 | PASS | |
| TC-WWP-008 | root fileがディレクトリだとエラーを投げる | `core.ts` buildImportGraph | 異常 | ディレクトリパスをrootsに指定 | `not a regular file`を含むエラーがthrowされる | 同上 | PASS | |
| TC-WWP-009 | 実リポジトリからimport graphを生成できる(回帰) | `core.ts` + 実`worker.ts`/`tiktok-listener.ts` | 回帰 | roots=実ファイル | libFilesが1件以上、ソート済み、unresolvedは配列 | 同上 | PASS | |
| TC-WWP-010 | `prisma/**` パターンがスキーマ変更パスにマッチする | `core.ts` patternMatches | 正常 | pattern=`live-sidestage-analytics/prisma/**`、path=`live-sidestage-analytics/prisma/schema.prisma` | `true` | `npx vitest run scripts/worker-watch-patterns/core.test.ts` | PASS | COMMON_WATCH_PATTERNS の glob 一致 |
| TC-WWP-011 | 変更パスをモノレポ相対に正規化して交差する | `core.ts` normalizeRepoRelativePath / intersectChangedWithExpected | 正常 | changed=`src/lib/foo.ts`（プレフィックス無し）、expected に `live-sidestage-analytics/src/lib/foo.ts` | 交差に正規化後パスが含まれる | 同上 | PASS | CI の `git diff` は analytics 配下でプレフィックス無しになりうる |
| TC-WWP-012 | graph 外の変更のみでは交差が空 | `core.ts` intersectChangedWithExpected | 正常 | changed=`live-sidestage-analytics/src/app/page.tsx` のみ | 交差は空配列 | 同上 | PASS | |
| TC-WWP-013 | worker.ts 変更で再起動を提案し exit 0 | CLI `check-worker-restart-proposal.ts` | 正常 | `--changed-files` に `live-sidestage-analytics/worker.ts` | stdout に `WORKER_RESTART_RECOMMENDED` と当該パス、exit code 0 | `npx vitest run scripts/worker-watch-patterns/cli.test.ts` | PASS | 自動再起動はしない |
| TC-WWP-014 | 無関係パスのみでは不要と明示し exit 0 | CLI | 正常 | `--changed-files` に app ページ等 graph 外のみ | `WORKER_RESTART_NOT_NEEDED`、exit code 0 | 同上 | PASS | |
| TC-WWP-015 | git diff 失敗時は fail-open（警告・交差空・exit 0） | CLI `getChangedFilesFromGit` | 境界 | 不正な base/head で git が失敗 | stderr に Warning、hits 空、`WORKER_RESTART_NOT_NEEDED`、exit 0 | 手動（無効 ref で CLI 実行） | PASS | `origin/main...HEAD` が main push で空になる場合も同様に不要扱いになりうる |
| TC-WWP-016 | Windows環境で `npx tsx` CLI を shell 経由で起動できる | `cli.test.ts` runCli | 境界 | Windows(win32) | ENOENT にならず TC-WWP-013/014 が完走 | `npx vitest run scripts/worker-watch-patterns/cli.test.ts` | PASS | |
| TC-WWP-017 | CI verify の提案ステップは推奨時も job を fail させない | `.github/workflows/analytics-ci.yml` verify + CLI 契約 | 回帰 | graph 内ファイルを含む PR | Job Summary / `::notice::` に提案または不要が出る、verify は成功 | PR 上の Actions ログ確認（`npm run check:worker-restart-proposal` と同契約） | PASS | `continue-on-error` に頼らず CLI が常に exit 0 を返す |
| TC-WWP-022 | used-export は未使用 export 経路を辿らない（mixed fixture） | `core.ts` buildUsedBindingGraph | 正常 | A→B.helper のみ、B.query だけ C を import | used に C なし、graph に C あり | `npx vitest run scripts/worker-watch-patterns/core.test.ts` | PASS | |
| TC-WWP-023 | 実リポで battle-replay.ts は graph のみ（used 除外） | `core.ts` 回帰 | 回帰 | roots=実 worker/listener | used に battle-replay なし、graph に含む | 同上 | PASS | finalize helpers 経路 |
| TC-WWP-024 | import type は used/graph ともに辿らない | `core.ts` buildUsedBindingGraph | 正常 | import type のみ | types モジュールは libFiles に入らない | 同上 | PASS | |
| TC-WWP-025 | side-effect import を graph/used で辿る | `core.ts` extractImportSpecsForGraph | 正常 | `import "./side"` | side.ts が used に含まれる | 同上 | PASS | 旧 Out of Scope から撤回 |
| TC-WWP-026 | CLI 3 状態（GRAPH_ONLY は notice なし） | `check-worker-restart-proposal.ts` | 正常 | battle-replay.ts 単独変更 | `WORKER_RESTART_GRAPH_ONLY`、RECOMMENDED なし、exit 0 | `npx vitest run scripts/worker-watch-patterns/cli.test.ts` | PASS | |
| TC-WWP-027 | COMMON/worker 変更は RECOMMENDED 優先 | CLI | 正常 | battle-replay + worker.ts | 先頭 RECOMMENDED、worker.ts 列挙 | 同上 | PASS | |
| TC-WWP-028 | inline object 戻り値型の関数本体依存を辿る | `core.ts` buildUsedBindingGraph | 境界 | `run(): { ok: boolean } { return helper() }` | used に helper 元ファイルを含む | `npx vitest run scripts/worker-watch-patterns/core.test.ts` | PASS | return type の `{` を本体と誤認しない |
| TC-WWP-029 | `import { Interface }` は WHOLE_MODULE に倒さない | `core.ts` collectNeededExportSources | 境界 | types が interface のみ named import、types は heavy-dep を import | used に heavy-dep なし | 同上 | PASS | `import type` なしの型 import |
| TC-WWP-030 | class メソッド内の import を辿る | `core.ts` extractTopLevelBindingBody | 正常 | `export class Handler { exec() { return helper() } }` | used に helper 元ファイルを含む | 同上 | PASS | |
| TC-WWP-031 | 型注釈付き top-level const の依存を辿る | `core.ts` buildUsedBindingGraph | 境界 | `export const run: Runner = () => helper()` | used に helper 元ファイルを含む | `npx vitest run scripts/worker-watch-patterns/core.test.ts` | PASS | `=` 直前の型注釈 |
| TC-WWP-021 | 存在しない相対importはunresolvedに記録される | `core.ts` buildImportGraph | 異常 | `import { x } from "./nonexistent"` | unresolvedに`./nonexistent`を含む行が記録される | `npx vitest run scripts/worker-watch-patterns/core.test.ts` | PASS | unresolved のみでは CI を落とさない（警告） |

## Quality Gate

- `npm run typecheck`
- `npm run check:worker-restart-proposal`（ローカルで変更範囲を確認する場合）
- `npx vitest run scripts/worker-watch-patterns/`

## Out of Scope

- Railway 本番 `watchPatterns` とのドリフト検知・snapshot・GraphQL 読み取り（廃止。本番の Watch Paths 削除は `docs/deploy/worker-restart-proposal.md`）
- worker の自動再起動（`restarts` / `serviceConnect` / `railway up`）。提案と Job Summary のみ
- Railway `watchPatterns` のコードからの書き込み
- `src/lib` 配下ファイル追加時の Railway ホワイトリスト人手更新（import graph はコード追従。Railway 側は runbook）
- **正規表現ベースimport抽出の既知の限界**（TestCase Modeレビューで指摘、個別ケース化せず既知制約として記録）:
  テンプレートリテラル動的import(`` import(`./${x}`) ``)、
  `require.resolve(...)`の誤マッチはいずれも未対応。`worker.ts`/`tiktok-listener.ts`起点の実import graphには
  該当パターンが存在しないことを実行結果(`unresolved: 0`)で確認済みだが、将来的にこれらの書き方が追加された場合は
  検出漏れ・誤検出になりうる。AST化は対応コストに見合わないと判断し見送り
- srcDir外ファイルを経由した再exportの追跡（意図的にsrcDir内のみBFSする設計。srcDir外へ迂回した再exportは検出されない既知の制約）
- `buildImportGraph`の`roots`が空配列のケース（実運用では常に`worker.ts`/`tiktok-listener.ts`を渡すため発生しない）