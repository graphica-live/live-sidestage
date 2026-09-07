date: 2026-09-08
feature: tiktok-id-change-lock
change summary: `ADMIN_EMAIL`(`src/lib/admin.ts`、既存の管理画面`/admin`専用アカウント)を、TikTok ID変更7日ロックの対象外にした。web(`POST /api/verify/generate`)・mobile(`PATCH /api/mobile/streamer`)の両方で、`checkTiktokIdChangeAllowed`の呼び出し(事前チェック・トランザクション内チェックの両方)だけを`isAdminEmail`判定でスキップする。CAS(`updateMany`のwhere句)・`tiktokIdChangedAt`更新・`verified`リセットは通常経路と同一コードパスのまま変更していない。
risk: HIGH(認可境界の変更として分類。DeepSeek + Codex独立レビュー)
reason: QA/デバッグ用に、内部運用者アカウントが実運用の7日制限を受けずにTikTok ID変更を繰り返しテストできるようにするため。一般ユーザーには一切影響しない。`ADMIN_EMAIL`は既に`/admin`(Euler API管理画面)専用アカウントとして存在していたものを流用し、新規の権限概念は追加していない。
affected baseline cases: TC-LOCK-501(web)、TC-LOCK-502(mobile)、TC-LOCK-503(`isAdminEmail`境界値)を追加。既存のTC-LOCK-*は無変更。
reviewers: DeepSeek(openrouter/deepseek/deepseek-v4-flash@high) + Codex(HIGH判定、独立並列)
important findings:
- DeepSeek(MEDIUM、VALID): baseline.mdにADMIN_EMAIL例外のテストケースが無かった → TC-LOCK-501/502として反映
- Codex(NO ISSUES、コード自体に問題なし。ロック判定のみスキップしCAS/tiktokIdChangedAt更新/verifiedリセットは維持されていることを確認)
- Codex(MEDIUM x2、VALID): admin例外経路でもtiktokIdChangedAt更新・verifiedリセットを検証すべき → 既存テストを強化(verified:trueから開始しfalseへリセットされることを確認)
- Codex(LOW、VALID): `isAdminEmail`自体の境界値(大文字小文字・前後空白・null/undefined)テストが無かった → `src/lib/admin.test.ts`を新規作成
- CAS競合(同時書込み)の実際の競合再現は、既存のTC-LOCK-301と同様に自動テストでは行っていない(トランザクション内で`current`を再読込するため、テスト側で外部から割り込むタイミングを作れない)。admin例外経路も同一の`updateMany`where句を通ることをコードレビューで確認済み
verification: `npm run typecheck` / `npm run test:unit`(1477件PASS) / `npm run test:integration`(870件PASS、TC-LOCK-501/502/503を含む)
remaining risks: `ADMIN_EMAIL`はハードコードされた単一アカウントの例外であり、環境変数化はしていない(既存`isAdminEmail`の設計をそのまま踏襲)。将来的に複数のデバッグアカウントが必要になった場合は`isAdminEmail`側の設計変更が要る
