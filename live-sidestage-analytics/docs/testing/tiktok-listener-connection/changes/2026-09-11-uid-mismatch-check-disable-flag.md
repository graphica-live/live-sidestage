---
date: 2026-09-11
feature: tiktok-listener-connection
---

## 変更概要

`connectInstance()` の hostTiktokUid mismatch判定(接続直前に `api-live/user/room/` の実測uidと登録済み `hostTiktokUid` を照合し、不一致なら `markRoomHandleStale()` でroomを恒久凍結するfail-closed安全機構)に、既存の環境変数フラグ `isTiktokUidMismatchCheckDisabled()`(`tiktok-id-lock.ts`、未設定=デフォルトで無効化)を適用した。テスト運用中に全ユーザー向けにこの安全機構を一時OFFにできるようにするため。

## Risk

HIGH(ユーザー判断によりCRITICALから降格。理由: 一時的とはいえ「ハンドル再利用による第三者データ混入防止」機構を全ユーザー向けに意図的に無効化する変更だが、実装ロジック自体は既存フラグの参照のみで単純)。

## 経緯・設計判断

ADMIN_EMAIL(`graphicatestlive@gmail.com`)のテストアカウントでTikTokアカウントの実体を入れ替えた結果、`@aomine_kazuha` 関連roomがこの安全機構で凍結され、テスト自体ができなくなっていた。当初はADMIN_EMAIL限定のexempt追加を検討したが、ユーザーの意図は「テスト運用中は全体のUID mismatchチェックを一時OFFにしたい」であり、ADMIN_EMAIL限定ではなく全ユーザー対象の一時的なフラグOFFへ方針転換した。

## Reviewer / 重要指摘の採否

design-review・code-reviewとも Codex-terra + DeepSeek + Gemini(並列3体)。

- **Codex(design-review・code-review双方でHIGH指摘)**: 「未設定を『チェック無効』とする既定は、環境変数の設定漏れ・再デプロイ・設定消失だけでfail-openが標準化し、第三者データ混入を招く」。**INVALID(既に承認済みの意図的仕様)** — ユーザーが「テスト中は全体OFF、あとで復活させる」と明示要求した設計そのものであり、design-review完了時点でリスクを認識した上で承認済み。監査ログ・メトリクス等の追加提案(recommended_fix)は今回のスコープ外(Invariants「新規環境変数・新規判定ロジックは追加しない」)として見送った
- **Codex(design-reviewのみHIGH指摘、VALID採用)**: `scripts/unfreeze-frozen-rooms.ts`(Batch02)の `--handle` 指定が `TiktokRoom.tiktokHandle` 非unique制約(改名で空いたハンドルを第三者が取得しうるため同一ハンドル複数行が正常、`prisma/schema.prisma` コメントで実証)を考慮していなかった。plan修正: `--handle` は1件一意特定時のみ許可、複数ヒットなら一覧表示して停止、`updateMany` に `handleStaleAt: { not: null }` 条件を追加
- **DeepSeek(code-reviewでLOW指摘、VALID採用)**: TC-TLC-002dに `listenerReason !== "handle_mismatch"` のアサーションが無く、将来の誤回帰を検知できない懸念。1行追加して反映(baseline参照)
- Gemini: design-review・code-reviewとも NO ISSUES(各変更ファイルの確認内容を明記、bare判定回避済み)

## Verification

- typecheck PASS
- unit test 116 files / 1554 tests PASS
- integration test(全体) 217 files / 2501 tests PASS
- 対象integrationファイル単独実行 8/8 PASS(TC-TLC-002c/002d含む)

## Remaining risks

- フラグが既定(未設定)の間、全ユーザーの第三者ハンドル取り違え検知が機能しない。`TIKTOK_UID_MISMATCH_CHECK_DISABLED="0"` を設定すれば復帰する(コード変更不要)
- 既存の凍結room(`@aomine_kazuha` 関連含む)はこのコード変更だけでは自動復旧しない。別途Batch02(本番DB `handleStaleAt` 解除)をユーザー確認の上で実施する必要がある
