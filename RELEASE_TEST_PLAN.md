# リリース前総合テスト計画

対象範囲: `live-sidestage-analytics` + `live-sidestage-mobile` 横断リリース。

- βフラグ廃止 → 機能別βフラグ(mobile/analytics/events) + プラン表示一元化
- iOS版 Apple IAP (StoreKit2) 課金追加
- Android版 Google Play 課金
- event avatar snapshot（`src/event/avatar-snapshot.ts`）
- mobile向け analytics API 3本（battles / gift-history / ranking）改修

対象コミット range: `f729155`（iOS IAP追加）〜 `eee7509`（effectivePlan付け替えfix）+ 継続中の本体修正分。

**本ドキュメント作成時点で本体修正は継続中。** 下記「未実行フェーズ」は本体修正完了後に着手する。

---

## 自動化済み（既存CIでカバー、二重実施しない）

### analytics — `.github/workflows/analytics-ci.yml`
push/PR で自動発火: `npm ci` → `prisma generate` → `typecheck` → `test:unit` → `prisma db push` → `vitest run integration` → `next build`。
コマンド詳細は [live-sidestage-analytics/CLAUDE.md](live-sidestage-analytics/CLAUDE.md) 参照。

### analytics — pre-commit フック
`.githooks/pre-commit`（要 `git config core.hooksPath .githooks`）が `live-sidestage-analytics/` の変更を検知し、typecheck → ローカルDocker DB起動 → `db:push:local` → `npm test` を強制。

### mobile — `flutter test`
既存テストは自動実行対象。ただし **billing系（`apple_billing_service.dart` / `billing_service.dart`）に対応する `*_test.dart` は未整備**（穴）。本体修正確定後、追加を推奨（今回のドキュメント作成では追加しない — 修正中コードとのコンフリクト回避のため）。

### 課金APIの認可境界（サーバ側）
`verify-purchase` route（Apple/Google 両方）は統合テスト済み。外部決済APIは `vi.mock` で差し替え、実通信なし。検証範囲: 未トークン401・不一致400・intent一致200・他人名義403等。

---

## 未実行フェーズ（本体修正完了後、この順で実行）

| # | フェーズ | 内容 | 自動/手動 |
|---|---|---|---|
| 1 | `review-auto` Code Mode | 課金/プラン差分レビュー。HIGH相当想定（billing/migration該当） | 自動 |
| 2 | `test-auto` | analytics統合テスト + mobile `flutter test` + lint/typecheck/build一括 | 自動 |
| 3 | mobile実機（Pixel 7a） | β各フラグ組合せ × プラン表示一元化確認。手順は既存メモリ参照 | 半自動（Marionette経由） |
| 4 | Apple/Googleストア実購入E2E | sandboxアカウント（Apple）/ ライセンステスター（Google）での実購入フロー | **手動必須**（下記理由） |
| 5 | Railway migration確認 | `prisma/schema.prisma` 差分を本番相当環境へ適用しCI外で最終確認 | 自動（CIで担保済み、最終目視のみ） |
| 6 | UIスクリーンショット提示 | subscription_screen等の変更箇所。test-auto工程内で無確認提示 | 自動 |

### フェーズ4が手動必須な理由
サーバ側receipt検証はモックで自動テスト済みだが、クライアント→ストア→サーバの実E2E（実際の購入確定・webhook到達・receipt発行）はApple/Googleの実サーバ依存。CI環境でのストアアカウント認証は規約上・技術上非推奨のため自動化不可。

---

## 既知の穴

- mobile側 billing系ユニットテスト未整備。本体修正確定後、`apple_billing_service_test.dart` / `billing_service_test.dart` 相当を追加すべき

---

## TikTok ID自動合流(live-sidestage-analytics)

- 配信者アカウントでTikTok ID変更 → `mergeTick()`実行後、旧ハンドルのroomが削除され
  Gift/バトル履歴が現ハンドル側へ引き継がれていること
- **合流後、旧ハンドルのTikTok listenerが残っていないこと**(`watchedRoomFilter()`が
  削除済みroomIdを対象外にすること。worker側のreconcileログで確認)
- Web `/setup` とmobile設定タブに合流通知バナーが表示され、閉じると再表示されないこと
  (`TiktokIdMergeLog.acknowledgedAt`)
- `BLOCKED_OLD_HANDLE_ALIVE`/`SELF_NOT_FOUND`時、赤を使わない中立トーンで
  「引き継げなかったデータがあります」バナーが出ること
