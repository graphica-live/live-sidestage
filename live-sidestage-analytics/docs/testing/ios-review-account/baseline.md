---
project: live-sidestage-analytics
feature: ios-review-account
last_updated: 2026-09-14
---

# テストベースライン: ios-review-account

App Store 審査用メール認証アカウント(`appletest@livesidestage.com`)と、貢献/ギフト/バトル履歴の見本データ投入。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-IOSREV-001 | 4文字パスワードでも審査用アカウントにログインできる | `scripts/seed-ios-review-account.ts` / email login | 正常 | seed済み、email=`appletest@livesidestage.com` password=`test` | 200、`onboardingRequired=false`、streamer付き | `npx dotenv -e .env.local.test -- vitest run scripts/seed-ios-review-account.integration.test.ts` | PASS | 登録APIの8文字下限は通さない。ログインはハッシュ照合のみ |
| TC-IOSREV-002 | 当日の貢献・ギフト・バトル履歴が空でない | ranking / gift-history / battles | 正常 | 同上、period=day のJST今日 | 3APIとも件数>0 | 同上 | PASS | 審査官がタブを開いた直後に空画面にならないこと |
| TC-IOSREV-003 | 偽TikTok roomはWorker監視対象から外す | TiktokRoom.handleStaleAt | negative | seed直後のroom | `handleStaleAt` 非null、`monitoringSuspended=true` | 同上 | PASS | ログインで監視再開されても handleStaleAt 中は接続しない |
| TC-IOSREV-004 | purgeで審査用Principalと専用roomが消える | `purgeIosReviewAccount` | 正常 | seed後にpurge | メールのPrincipalが無い | 同上 afterAll | PASS | 審査完了後の撤去経路 |
| TC-IOSREV-005 | purge does not delete unrelated Principal/room | `purgeIosReviewAccount` | negative | bystander Principal+room exist, then seed then purge | bystander rows remain; review Principal is gone | `npx dotenv -e .env.local.test -- vitest run scripts/seed-ios-review-account.integration.test.ts` | PASS | |

