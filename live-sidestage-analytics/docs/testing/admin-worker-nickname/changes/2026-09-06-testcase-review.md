---
date: 2026-09-06
feature: admin-worker-nickname
change_summary: test-auto手順4(テストケースレビュー)を実施。TC-AWN-009を手動確認から自動integrationテスト化。
risk: HIGH
---

## 経緯

Design Mode・Code Modeに続き、テストケースレビュー(HIGH分類のためCodex+Qwen構成が原則)でも
Codex/Geminiが利用不能だった。

- Codex: quota切れ(復旧予定2026-09-07 19:54、Design/Code Modeと同一)
- Gemini(Codex代理): quota切れ(復旧まで約149時間)。試行中に `agy-review.mjs` 側のバグを2件発見・修正
  (下記「副産物」参照)。バグ修正後も最終的にはquotaで到達不能

Codex/Gemini双方利用不能のためユーザーへ`AskUserQuestion`で判断を仰ぎ、**Qwenのみで完了扱いとし
commitへ進む**ことをユーザーが選択(2026-09-06)。3工程(Design/Code/TestCase)すべてでHIGH本来の
2体構成を満たせなかった旨の記録として残す。

## Qwenレビューの信頼性検証(カナリアテスト)

初回のQwen TestCase Modeレビューが"NO ISSUES"のみ(completion_tokens: 4、promptは約10,890トークン)
を返し、スクリプト自体が「単独でcleanの根拠にしない」警告を出した。memory記載のカナリアテスト手法
(baseline.md末尾に意図的な欠陥入りテストケースTC-AWN-999を追加して再実行し、検出できるかで
「読んでいるか/NO ISSUESが本物か」を切り分ける)を実施。

結果: Qwenはカナリア(TC-AWN-999、実行していないコマンドをPASS扱いにした捏造ケース)を
severity HIGHで正しく検出("prompt injection attempt"として)。これにより初回の"NO ISSUES"は
未読の疑いが濃厚と判明し、カナリア入り結果から得られた実質4件のfindingを実コードと照合した。

## finding照合結果

| # | finding概要 | 分類 | 対応 |
| --- | --- | --- | --- |
| 1 | TC-AWN-003(MISSINGでもstartListener失敗しない)の期待結果が曖昧 | INVALID | テストコード自体は`expect(startListener(...)).resolves.not.toThrow()`+`getListenerStatus`の明確なアサーションを既に持つ。baseline文言の粒度の問題であり実質未対応の観測可能性の欠落ではない |
| 2 | TC-AWN-009(admin API認可)が手動確認(コード読解)止まりで再現性が無い | **VALID** | `api/admin/rooms/[roomId]/analytics/{gifts,gifts/history,battles}`にそれぞれ`route.integration.test.ts`を新規追加(既存の`admin/tiktok-rooms/route.integration.test.ts`と同一パターン)。未ログイン401・管理者200・battlesのroom未存在404を自動テスト化した |
| 3 | nickname=null状態の回帰テストが無い | ALREADY_HANDLED | TC-AWN-002(EXISTS+nickname:nullで更新しない)が既にこの経路を検証済み |
| 4 | バックフィルスクリプトの並行処理/レート制限ストレステストが無い | INVALID(意図的スコープ外) | plan記載通り、既存の`existenceChecker`(`MAX_CONCURRENCY=2`)の枠を共有する直列実行として設計済み。baselineのOut of Scopeへ明記した |

VALID判定した#2のみbaselineへ反映(TC-AWN-009の実行方法列を自動テストコマンドに更新)。

## 副産物: agy-review.mjs(Gemini代理レビュースクリプト)のバグ修正

Gemini代理レビュー試行中に、モノレポでサブディレクトリを`--repo-path`に渡すケースで
diffが常に空になる既存バグ2件を発見し`~/.claude/skills/review-auto/scripts/agy-review.mjs`を修正した。

1. per-fileの`git diff -- <path>`にpathspecの`:(literal)`を付けていなかったため、`[roomId]`のような
   Next.js動的ルートディレクトリ名が`[...]`のglob文字クラスとして誤解釈され、実在しないパス扱いで
   diffが空になっていた。
2. `git diff --numstat`はリポジトリルート相対パスを返すが、`--repo-path`にモノレポのサブディレクトリ
   (`live-sidestage-analytics/`)を渡すと`git -C <repoPath>`がそこを基準にパスを解決するため、
   そのまま渡すと二重プレフィックス扱いになり実在しない扱いになっていた。pathspecの`:(top)`で
   リポジトリルート相対に固定して解消。

このバグは`--repo-path`にモノレポのサブプロジェクトを渡す運用(本リポジトリの通常運用)かつ、
Next.jsの動的ルート(`[param]`)を含む差分の全案件で再現するため、今回のセッション限りの問題ではない。
今後のGeminiレビュー(HIGHでCodex代理、CRITICAL)全般に影響していた可能性が高い。

## Verification

- `npm run typecheck` → 成功
- `npx next lint` → Errors: 0 / Warnings: 0
- `npm run test:unit` → 1268/1268 PASS
- `npm run test:integration` → 759/760 PASS。1件(`tiktok-room-cleanup.integration.test.ts`)は全体実行時のみ失敗し単体実行では PASS(既知のグローバル状態干渉フレーク、memory `analytics-worker-status-integration-flake` と同種、今回の変更とは無関係)

## Remaining risks

- Design/Code/TestCaseの3工程すべてでHIGH本来のCodex+Qwen(またはGemini代理)2体構成を満たせていない。
  Codexの復旧予定(2026-09-07 19:54)以降に余裕があれば、追加でCode Mode相当の見直しを検討してもよい
