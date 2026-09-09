---
date: 2026-09-09
feature: battle-replay-share
---

# admin代理閲覧画面のバトルシェア解禁

## change summary

管理者代理閲覧画面(`/admin/rooms/[roomId]`)でバトル履歴のシェアボタンが表示されない不具合を修正。
admin用API群は本人用APIを手動複製したものだが、share routeだけ実装漏れだった。

- 新規: `src/app/api/admin/rooms/[roomId]/analytics/battles/[battleId]/share/route.ts`
- 新規: 同 `route.test.ts`
- 変更: `src/components/analytics/BattleDetailModal.tsx`(`canShare`判定拡張、`ShareButton`へ`base` prop追加、fetch先を動的化)

## risk

HIGH(planner判定: コード自体は既存adminルートパターンの機械的複製でLOWだが、「管理者が配信者の同意なしに
公開共有URL `/b/[token]` を発行できるようになる」権限拡張のため)。

## reason

- ユーザーから明示承認済み:「管理者がURL発行できてかまわん」
- `getAdminSession()`のみで認可。room所有者チェックは無い(admin以外は弾かれるため設計通り)
- レスポンス形状は本人用`route.ts`と完全一致することを実コード照合で確認済み(フロントの`ShareButton`が共用されるため)

## affected baseline cases

- `docs/testing/battle-replay-share/baseline.md` TC-BRS-013 — 仕様を完全反転
  - 旧:「管理者向けのバトル詳細にはシェアボタンを出さない」(PASS 0件)
  - 新:「管理者向けのバトル詳細でも配信者本人と同じシェアボタンが使え、発行したリンクは本人発行時と同一トークンで
    第三者が匿名で開ける」
- `docs/testing/battle-replay-api/baseline.md` — 対象ファイル一覧・実行方法にadmin share route追加、TC-BRA-040新規

## reviewers

Code Mode(HIGH×MODERATE構成): DeepSeek(high) + Codex-terra(medium)、2026-09-09

## important findings

- finding1(MEDIUM, DeepSeek): admin share routeのレスポンス形状が本人用と一致するか未確認 →
  実コード照合の結果、完全一致を確認。ALREADY_HANDLED
- finding2: `BattleDetailModal.tsx`の`canShare`判定が`base?.startsWith(...)`とoptional chainingを使っていたが、
  `base`は必ずstring(`apiBase ?? "/api/analytics"`)なので死んだ防御コード → VALID、`?.`を`.`へ修正

## verification

- typecheck: PASS
- test:unit: 1485 tests PASS
- test:integration: 894 tests PASS(新規admin share route.test.ts含む)
- Playwright実ブラウザ確認: admin画面でシェアボタン表示、本人画面にregression無し、admin発行URLと本人発行URLの
  トークン完全一致、admin発行URLを匿名contextで正しく開ける(全項目成功)
- TestCaseレビュー(DeepSeek単体): finding5件中4件VALID(TC-BRS-013の期待結果具体化に統合)、1件は
  ShareButtonのHTTPエラー時error state表示(既存ロジック、今回のスコープ外)として記録のみ

## remaining risks

- admin発行の共有URLは配信者本人への通知が無い。将来「配信者へ通知」等の要件が出た場合は別途対応が必要
- 「モバイルと同じシェアイラストボタンにしたい」というユーザー依頼は、mobile側に該当UI(共有ボタン)が
  実在しないため未対応(2回のExplore調査で0件、ユーザーへ確認待ち)
