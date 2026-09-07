---
date: 2026-09-07
feature: listener-comment
risk: HIGH
reviewers: DeepSeek(review-auto/openrouter-review)+Fable(review-auto Code Mode。Codex/Geminiはquota切れのため代理)
---

# リスナーコメントDB保存+30日retentionの新規実装

- change summary: `ListenerComment`テーブル新設、chat受信ハンドラでfire-and-forget保存、
  `listener-comment-retention.ts`による30日retention削除バッチを追加した。
- reason: 将来のAIによるリスナーコメント傾向分析用途の素材として保存する。無期限保持は
  コスト・個人情報保持の観点で避け、保持期限30日+自動削除とした。
- affected baseline cases: TC-LC-001〜009(新規機能のため全件新規追加)
- important findings / VALID・INVALID の重要判断:
  - **Design Mode(OpenRouter/DeepSeek, MEDIUM判定)**: HIGH2件(fire-and-forgetの書き込み負荷、
    エラーハンドリング未記載)、MEDIUM2件(dayKey定義未記載、migration運用の説明不足)、
    LOW1件、テスト未定義1件。全件VALID、planへ反映して解消。
  - **Code Mode(OpenRouter/DeepSeek)**: MEDIUM1件(`deletableRows`がdryRun:false時に
    「削除後件数」を指しフィールド名と意味が食い違う)、LOW1件(バッチ削除SQLにORDER BY
    が無く新規insertの割り込みでループが長引く恐れ)。両方VALID、修正済み
    (`ListenerCommentRetentionResult`をUnion型化、`ORDER BY id`追加)。
  - **Code Mode(Codex, HIGH)**: OmniRoute経由でquota切れ(429 Too Many Requests)、
    レビュー未実施。review-autoルール「Codex不可時のみGeminiが代理」に従いGeminiへ切替。
  - **Code Mode(Gemini, HIGH代理)**: Antigravity個人quota切れ(107h30m後リセット)、
    レビュー未実施。Codex/Gemini双方不可のケースはSKILL.mdに明記が無く、CRITICAL構成の
    fable-expertをHIGH代理として追加起動する判断をした(ユーザーへ状況報告のうえ続行)。
  - **Code Mode(fable-expert, HIGH代理)**: MEDIUM2件、LOW2件、INFO1件。
    - F1(VALID): chat高頻度createがGiftの書き込み用Prismaコネクションプールを圧迫しうる
      →`LISTENER_COMMENT_SAVE_CONCURRENCY_LIMIT=12`の簡易セマフォを追加、超過分は破棄+ログ。
    - F2(VALID/運用): Railway Cronサービスが無いと削除が一度も走らない
      →コード変更なし、運用手順としてユーザーへ案内(Out of Scope節に記載)。
    - F3(INVALID、現状維持が正解): 保存失敗時にmsgId FIFOをforgetしない設計は、
      giftと違いchatは既に配信済みのため意図的。変更不要と判断。
    - F4(INVALID、現状維持が正解): ロールアップ省略の設計判断は妥当と確認。
    - F5(INFO、変更不要): advisory lockのセッションスコープ運用はgift-retention等の
      既存パターンと同型で問題なし。
- verification: `npm run typecheck` / unit(103ファイル1444件) / integration(87ファイル852件、
  新規2ファイル含む)全通過。ローカルDB(`liveanalytics_test_listener_comment_retention`)へ
  `prisma db push`で反映確認。`listener-comment-retention.ts`をdry-runで実行し空DB上で
  正常終了を確認。
- remaining risks: 本番chatピーク流量でのセマフォ上限(12)の妥当性は実測未検証。
  Railway Cronサービス未作成の間はretentionが機能しない(運用作業として別途案内)。
- rollback / migration note: `prisma/migrations/20260907140905_add_listener_comment/`に
  CREATE TABLE文を保存済み(本番では`db push`が適用するため実行はされない、履歴用)。
  ロールバックは`ListenerComment`テーブルをDROPするだけで他テーブルへの影響なし
  (`onDelete: Cascade`のFK以外に依存なし)。
