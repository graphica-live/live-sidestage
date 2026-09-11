---
project: live-sidestage-analytics
feature: worker watchPatterns ドリフト検知
last_updated: 2026-09-11
last_risk: MEDIUM
last_reviewers: DeepSeek (Code Mode + TestCase Mode)
---

# テストベースライン: worker watchPatterns ドリフト検知

`worker.ts`/`src/lib/tiktok-listener.ts` を起点にした静的 import graph（BFS）と、Railway 本番の
worker1/2/3 `watchPatterns`（読み取り専用）を突き合わせ、ドリフト（未反映の追加・削除）を検知する
ローカルCLI（`npm run check:worker-watch-patterns`）。自動修正はしない、検知のみ。

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
| TC-WWP-010 | mockデータのみでworker1/2/3全チェックが成功する | CLI `check-worker-watch-patterns.ts` | 正常 | `--mock-railway`に本番70項目相当のsnapshot | 全一致でexit code 0、`All checks passed`を出力 | `npx vitest run scripts/worker-watch-patterns/cli.test.ts`(Test A) | PASS | |
| TC-WWP-011 | 新規importの追加はmissing検出になる | CLI | 異常 | `--extra-root`で実src/lib配下に新規ファイルを一時追加 | exit code 1、出力に`Missing`を含む | 同上(Test B) | PASS | 一時ファイルは実`src/lib`配下に作成し`finally`で必ず削除 |
| TC-WWP-012 | 実在しないパスがactualにあるとextra検出になる | CLI | 異常 | mockデータのworker1配列にダミーパスを追加 | exit code 1、出力に`Extra`を含む | 同上(Test C) | PASS | |
| TC-WWP-013 | worker間で個別に差異があれば該当workerのみ検出する | CLI | 境界 | mockデータのworker2配列から1件削除 | exit code 1、出力に`Missing`と`worker2`を含む | 同上(Test D) | PASS | |
| TC-WWP-014 | mockデータの構造が不正だと明確なエラーで終了する | CLI `--mock-railway`読み込み部 | 異常 | `worker1`等が配列でないJSON | `mock railway data missing array field`を含むエラーでexit code 1 | 手動実行(`--mock-railway`に不正JSON) | PASS | code-review finding反映 |
| TC-WWP-015 | Railway実APIから読み取りワークフローが完走し本番watchPatternsと一致する | `railway-client.ts` + CLI(本番読み取り専用) | 回帰 | `railway login`済み環境、`--mock-railway`無指定 | exit code 0、`Fetched watchPatterns...`→`All checks passed` | `npx tsx scripts/check-worker-watch-patterns.ts`(本番読み取りのみ、書き込みなし) | PASS | 2026-09-11実測: worker1/2/3とも本番70項目(6共通+64lib)と完全一致 |
| TC-WWP-016 | Windows環境で`railway`/`npx`をshell経由で起動できる | `railway-client.ts` execFileSync, `cli.test.ts` runCli | 境界 | Windows(win32) | `shell:true`によりENOENTにならずexit code 0で完走する(CLI実行時のシェル起動エラーが発生しない) | 同上(TC-WWP-010〜015実行時に暗黙確認) | PASS | 計画時点の「未解決事項」が実際に発現し修正 |
| TC-WWP-017 | GraphQL応答にwatchPatternsフィールドが欠落していれば明確なエラーを投げる | `railway-client.ts` fetchWatchPatterns | 異常 | `globalThis.fetch`をモックし`watchPatterns`フィールド無しの応答を返す | `missing watchPatterns field`を含むエラーがthrow | `npx vitest run scripts/worker-watch-patterns/railway-client.test.ts` | PASS | TestCase Mode指摘反映、mock fetchで自動化済み |
| TC-WWP-018 | GraphQL応答の`serviceInstances.edges`が欠落していれば明確なエラーを投げる | `railway-client.ts` fetchWatchPatterns | 異常 | `globalThis.fetch`をモックし`environment`のみで`serviceInstances`無しの応答を返す | `missing environment.serviceInstances.edges`を含むエラーがthrow | 同上 | PASS | |
| TC-WWP-019 | GraphQL errorsが返れば明確なエラーを投げる | `railway-client.ts` fetchWatchPatterns | 異常 | `globalThis.fetch`をモックし`errors`配列を返す | エラーメッセージ(例: `Not Authorized`)を含むエラーがthrow | 同上 | PASS | |
| TC-WWP-020 | 正常なGraphQL応答からworker1/2/3へ正しく振り分ける | `railway-client.ts` fetchWatchPatterns | 正常 | `globalThis.fetch`をモックし3サービス分のedgesを返す | 各serviceIdに対応するwatchPatternsが正しく格納される | 同上 | PASS | |
| TC-WWP-021 | 存在しない相対importはunresolvedに記録される | `core.ts` buildImportGraph | 異常 | `import { x } from "./nonexistent"` | unresolvedに`./nonexistent`を含む行が記録される | `npx vitest run scripts/worker-watch-patterns/core.test.ts` | PASS | TestCase Mode指摘反映 |

## Quality Gate

- `npm run typecheck`
- `npx vitest run scripts/worker-watch-patterns/`

## Out of Scope

- Railway `watchPatterns` の自動修正・書き込み（本ツールは検知のみ。修正は既存の`serviceInstanceUpdate`手動フローのまま、[[railway-analytics-watchpatterns]]参照）
- `src/lib`配下ファイル追加時のホワイトリスト自動反映（引き続き手動、本ツールは検知のみ）
- **正規表現ベースimport抽出の既知の限界**（TestCase Modeレビューで指摘、個別ケース化せず既知制約として記録）:
  テンプレートリテラル動的import(`` import(`./${x}`) ``)、`from`を伴わないside-effect import(`import "./foo"`)、
  `require.resolve(...)`の誤マッチはいずれも未対応。`worker.ts`/`tiktok-listener.ts`起点の実import graph(64ファイル)には
  該当パターンが存在しないことを実行結果(`unresolved: 0`)で確認済みだが、将来的にこれらの書き方が追加された場合は
  検出漏れ・誤検出になりうる。AST化は対応コストに見合わないと判断し見送り
- `--extra-root`に存在しないパス/ディレクトリを渡した場合のCLIエラーメッセージの網羅（`buildImportGraph`のroot検証(TC-WWP-007/008)と同一コードパスのため個別ケース化は省略）
- srcDir外ファイルを経由した再exportの追跡（意図的にsrcDir内のみBFSする設計。srcDir外へ迂回した再exportは検出されない既知の制約）
- mockスナップショットの配列内重複エントリの挙動（`Set`比較のため重複は自然に畳まれる、実害なしと判断）
- `buildImportGraph`の`roots`が空配列のケース（実運用では常に`worker.ts`/`tiktok-listener.ts`を渡すため発生しない）
