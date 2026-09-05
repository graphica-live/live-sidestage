---
risk: LOW
reviewers: [qwen]
review_summary: { findings: 2, valid: 2, fixed: 1 }
---

# ダッシュボードヘッダー — ログイン中メールアドレス表示

対象: `src/app/(dashboard)/DashboardHeader.tsx`, `src/app/(dashboard)/layout.tsx`
仕様: `.impeccable/approved/dashboard-header-email/spec.md`

| # | 観点 | 内容 | 実行方法 | 期待結果 | 結果 |
| --- | --- | --- | --- | --- | --- |
| 1 | 正常 | ログイン後、ヘッダーにログイン中アカウントのメールアドレスが表示される | `npm run dev:local` 起動、`/login` で開発用ログイン(`dev@local.test`)後 `/analytics` をPlaywrightで確認 | ヘッダー内(リスナー状態と設定リンクの間)に `dev@local.test` がテキスト表示される | PASS |
| 2 | 境界 | メールアドレスが長い場合にヘッダーが崩れずtruncate表示される | DB上でテストユーザーのemailを `dev.very.long.streamer.account@local-sidestage-test.example.com` に変更し再ログイン、Playwrightでスクリーンショット | 他の要素(ロゴ/設定/ログアウト)のレイアウトは崩れない。email表示はmax-width(モバイル100px/sm以上160px)を超えた分がCSS `text-overflow: ellipsis` で省略記号(…)表示になり、`title`属性のhoverで全文が確認できる | PASS |
| 3 | UI(レスポンシブ) | モバイル幅(375px)でも表示崩れなし | Playwrightでviewport 375x812のスクリーンショットを取得 | モバイル幅でもメールアドレスがtruncate表示され、他要素と重ならない | PASS |
| 4 | 回帰 | 既存のリスナー状態表示・設定リンク・ログアウトボタンの表示/動作に影響がない | 上記スクリーンショットで目視確認 | リスナー状態ドット・「設定」リンク・「ログアウト」ボタンが従来通り表示される | PASS |
| 5 | 回帰 | 既存の単体テストスイートが全てPASSする | `npm run test:unit` | 全テストPASS(既存84ファイル/1214件に新規ケースなし) | PASS(84 files / 1214 tests passed) |
| 6 | 異常 | `session.user.email` がnullish時にspanごと非表示になる(理論上のケース、型上nullable。Apple経由Userは`User.email`がnullで作られるため実在しうる) | コードレビュー(`{email && (...)}` によるガード) | spanがレンダリングされず、他要素のレイアウトに影響しない | NOT RUN: 本プロジェクトにReactコンポーネント単体テスト基盤(@testing-library/react等)が無く(既存84テストファイルは全てAPI/lib関数のvitestロジックテスト)、新規導入は今回のLOW risk・小規模変更のスコープを超えるため見送り。dev-loginはemail必須でnullセッションを作れず、Apple認証もローカルでモックできないためブラウザ実地確認も不可。既存の同型パターン(`{listener && (...)}`)と同一のconditional renderingであることをコードレビューで確認済み(Qwen TestCase Modeレビューでcoverage gapとして指摘されたが、対応はインフラ導入を要するため今回は見送りと判断) |
| 7 | 型検査 | 変更ファイルにTypeScriptの型エラーがない | `npm run typecheck` | エラー無し | PASS(No errors found) |

## レビュー指摘と対応

review-auto(Code Mode, Qwen, LOWリスク)の結果を流用(同一diff)。

| 指摘 | 分類 | 対応 |
| --- | --- | --- |
| emailをtitle属性・子要素に直接使用しておりXSSリスクがある(MEDIUM) | INVALID | React JSXの`{email}`はテキストノードとして自動エスケープされ、`dangerouslySetInnerHTML`未使用。title属性もReactが文字列としてDOM属性設定するのみでHTML解釈されない。修正不要 |
| `session.user.email`がnull/undefinedの場合の考慮が無い(LOW) | ALREADY_HANDLED | `DashboardHeader.tsx`側で`{email && (...)}`によりnullish時は非表示にする実装済み |

### テストケースレビュー(Qwen, TestCase Mode)

| 指摘 | 分類 | 対応 |
| --- | --- | --- |
| TC-02(長いメールのtruncate)の期待結果が曖昧(LOW) | VALID | 期待結果をpx幅基準のellipsis省略+title属性という具体的記述へ修正(fixed) |
| TC-06(email nullishケース)がNOT RUNのまま、境界条件として重要(MEDIUM) | VALID | 指摘は正しいが、Reactコンポーネント単体テスト基盤が本プロジェクトに存在せず新規導入はスコープ超過と判断。dev-loginでのnullセッション再現・Apple認証のローカルモックも不可なため、今回はテスト追加を見送り理由を明記(skipped) |
