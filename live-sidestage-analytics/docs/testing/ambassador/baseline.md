---
project: live-sidestage-analytics
feature: ambassador
last_updated: 2026-09-08
last_risk: HIGH
last_reviewers: Codex+DeepSeek
---

# テストベースライン: ambassador

管理者が招待URLを発行し、そのURL経由で新規登録した先着1名または管理者が直接指定した既存ユーザーを
アンバサダーにする機能。アンバサダーはPROプランを無料で利用でき、ULTRAへは差額課金でアップグレードできる
(差額Price ID未設定の間はULTRA自体購入不可)。招待URLは発行から30日で期限切れになり、Railway Cron
(`ambassador-invite-retention.ts`)が期限切れレコードを定期削除する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-AM-001 | 招待URLを複数同時発行できる | `createInvite` / `/admin/ambassadors` | 正常 | 管理者が招待発行を2回連続で押す | それぞれ別tokenのAmbassadorInvite行が作られ、両方とも一覧に表示される | Playwright: `/admin/ambassadors`で発行ボタンを2回押す | PASS | screenshot提示済(02) |
| TC-AM-002 | 招待URL経由の新規登録で先着1名だけがアンバサダーになる | `claimAmbassadorInviteForNewUser` | 正常 | 有効な招待token、新規User | `updateMany`(usedAt:null かつ expiresAt>now)が成功した場合だけAmbassador行が作られる | `npx dotenv -e .env.local.test -- vitest run src/lib/ambassador/ambassador.integration.test.ts` | PASS | — |
| TC-AM-003 | 同一招待の同時claim競合で二重にアンバサダーが作られない | `claimAmbassadorInviteForNewUser` | 異常 | 同一tokenへ2人が連続してclaim | 2人目の`updateMany`は`count!==1`となり`invalid_or_used`を返し、Ambassadorは1件のみ | `npx dotenv -e .env.local.test -- vitest run src/lib/ambassador/ambassador.integration.test.ts` | PASS | — |
| TC-AM-004 | Ambassador作成が失敗した場合、招待は消費済みのまま残らない | `claimAmbassadorInviteForNewUser` | 異常 | 対象userIdが既にAmbassador(`tx.ambassador.create`がP2002で失敗) | `$transaction`全体がロールバックされ`already_ambassador`を返す。招待の`usedAt`は`null`のまま | `npx dotenv -e .env.local.test -- vitest run src/lib/ambassador/ambassador.integration.test.ts` | PASS | — |
| TC-AM-005 | 期限切れ・存在しない招待token はclaimできない | `claimAmbassadorInviteForNewUser` | 境界 | `expiresAt`が過去のtoken、存在しないtoken | いずれも`invalid_or_used`を返す | `npx dotenv -e .env.local.test -- vitest run src/lib/ambassador/ambassador.integration.test.ts` | PASS | — |
| TC-AM-006 | 期限切れの招待URLはRailway Cronで自動削除される | `runAmbassadorInviteRetentionCycle` | 境界 | 期限切れ招待と有効招待が混在(使用済み含む) | dry-runはカウントのみ、`dryRun:false`は期限切れのみ削除(使用済み・未使用問わず)、有効な招待は残る | `npx dotenv -e .env.local.test -- vitest run src/lib/ambassador-invite-retention.integration.test.ts` | PASS | ちょうど`expiresAt===now`の1ミリ秒境界は自動テスト化せず(下記注記) |
| TC-AM-007 | 既存ユーザーをメールアドレスで直接アンバサダーに追加できる | `addAmbassadorByEmail` / `/admin/ambassadors` | 正常 | 既存User(email一致)のメールアドレスを入力して追加 | 201で成功し、アンバサダー一覧に即座に反映される | Playwright: `/admin/ambassadors`でメール追加フォームを操作 / `npx dotenv -e .env.local.test -- vitest run src/lib/ambassador/ambassador.integration.test.ts` | PASS | screenshot提示済(03) |
| TC-AM-008 | 未登録・空・空白のみのメールアドレスはエラーになる | `addAmbassadorByEmail` | 異常 | 存在しないメール／空文字／空白のみを入力 | 未登録は404`このメールアドレスのユーザーが見つかりません。`、空・空白は400`invalid` | `npx dotenv -e .env.local.test -- vitest run src/lib/ambassador/ambassador.integration.test.ts` | PASS | — |
| TC-AM-009 | 既にアンバサダーのユーザーを重複追加しようとするとエラーになる | `addAmbassadorByEmail` | 異常 | 既にAmbassador行があるUserのメールアドレスを入力(前後空白・大文字混在も) | 409、`このユーザーはすでにアンバサダーです。`(P2002を捕捉)。メールは正規化して同一ユーザーと判定する | `npx dotenv -e .env.local.test -- vitest run src/lib/ambassador/ambassador.integration.test.ts` | PASS | — |
| TC-AM-010 | 管理者以外は管理画面APIにアクセスできない | `/api/admin/ambassadors` (GET/POST/DELETE) | 異常 | 未ログイン、または管理者以外のセッション | `getAdminSession()`が`null`を返し401 | 実コード確認(既存`getAdminSession()`を流用、`admin/agencies`等の既存APIと同一パターン) | PASS | — |
| TC-AM-011 | 未使用の招待URLは失効(削除)できる | `revokeInvite` | 正常 | `usedAt:null`の招待IDを指定してDELETE | `deleteMany({where:{id, usedAt:null}})`で削除され、一覧から消える | Playwright: `/admin/ambassadors`で失効ボタンを押す | PASS | — |
| TC-AM-012 | 使用済み・存在しない招待は失効できない | `revokeInvite` | 境界 | `usedAt`設定済みの招待ID／存在しないIDを指定してDELETE | `deleteMany`の対象が0件で`removed:false`、404を返す | 実コード確認(`deleteMany`のwhere条件に`usedAt:null`が含まれるため、存在確認と使用済み判定を同一クエリで兼ねる) | PASS | — |
| TC-AM-013 | アンバサダーはPROプランが無料で使える | `getUserPlan` / `/billing` | 正常 | Ambassador行が存在するuserId | `getUserPlan()`がSubscription行の有無によらずPRO以上を返す。`/billing`のPROカードに「アンバサダー特典で無料」と表示され、購入ボタンは出ない | Playwright: `/billing`をアンバサダーでログインして確認 / `npm run test:unit` | PASS | screenshot提示済(07) |
| TC-AM-014 | アンバサダーがPROを通常課金しようとすると拒否される(二重課金防止) | `/api/billing/checkout` | 異常 | Ambassadorが`plan:"PRO"`でcheckout APIを呼ぶ | 400、`アンバサダー特典によりPROは既に無料でご利用いただけます` | 実コード確認(`route.ts`の`if (ambassador && plan === "PRO") return 400`) | PASS | — |
| TC-AM-015 | アンバサダーはULTRAへ差額アップグレードできる(差額Price設定時) | `/api/billing/checkout`, `price-map.ts` | 正常 | Ambassador、`STRIPE_PRICE_ULTRA_AMBASSADOR_DIFF`設定済み、Subscription行なし | `priceIdForAmbassadorUltraUpgrade()`のPrice IDでCheckoutセッションが作られる | 実コード確認 | PASS | ULTRA自体は現状Stripe価格未設定のため実発行(Stripe実APIとの疎通)は未検証(Out of Scope参照) |
| TC-AM-016 | 差額Price未設定時、アンバサダーのULTRA購入は503かつUIは「準備中」になる(通常価格へフォールバックしない) | `/api/billing/checkout`, `/billing` | 境界 | Ambassador、`STRIPE_PRICE_ULTRA_AMBASSADOR_DIFF`未設定 | APIは503。`/billing`のULTRAカードは「準備中」ボタン(disabled)になり、通常`STRIPE_PRICE_ULTRA`へは絶対にフォールバックしない | Playwright: `/billing`をアンバサダーでログインして確認 | PASS | screenshot提示済(07)。実環境で`STRIPE_PRICE_ULTRA_AMBASSADOR_DIFF`未設定のため「準備中」表示を実ブラウザで確認済み |
| TC-AM-017 | 既にPRO実購読中のユーザーが後からアンバサダー指定されても、ULTRA差額アップグレードがブロックされない | `/api/billing/checkout`, `/billing` (`isActivePaid`) | 回帰 | Ambassador かつ 既存の有効なPRO Subscription行(provider STRIPE)を持つユーザー | checkout APIの二重課金防止チェックはPRO行を除外して判定し409にならない。`/billing`のULTRAカードも「プラン変更はプランを管理するから」に固定されず購入ボタンが出る | 実コード確認(review-auto Code Mode DeepSeekのHIGH指摘2件を実コードで確認し修正。修正後`npm run typecheck`・`npm run test:unit`再検証済み) | PASS | 2026-09-08にHIGHバグとして発見・修正 |
| TC-AM-018 | Stripe webhookが差額Price IDからULTRAへ正しく逆引きできる | `planForPriceId` | 正常 | `priceId === STRIPE_PRICE_ULTRA_AMBASSADOR_DIFF` | `planForPriceId()`が`"ULTRA"`を返す(通常のPAID_PLANSループで解決できなくても) | 実コード確認(`price-map.ts`の実装) | PASS | — |
| TC-AM-019 | アンバサダー資格を解除できる | `removeAmbassador` / `/admin/ambassadors` | 正常 | 既存Ambassador行のIDを指定してDELETE | Ambassador行が削除され、`removed:true`を返す。ULTRA差額の有効購読があれば`hadActiveAmbassadorUltraSubscription:true`が併せて返り、UI側に警告文言が出る | 実コード確認 | PASS | Stripe側の自動解約はスコープ外(UI警告のみ) |
| TC-AM-020 | 招待URL・招待開始APIは未ログインでもアクセスできる(middleware保護対象外) | `src/middleware.ts` | UI | `/invite/ambassador/<token>`、`/api/ambassador/invite/start`への未ログインアクセス | middlewareが通し、ログイン画面へリダイレクトされない | `npx vitest run src/middleware.test.ts` | PASS | — |
| TC-AM-021 | 招待パスの境界(前置一致による誤公開)がない | `src/middleware.ts` | 境界 | `/invited`, `/api/ambassador/invitees`, `/api/ambassador`, `/admin/ambassadors` | いずれも保護される(前置一致で`invite`/`api/ambassador/invite`に食われない) | `npx vitest run src/middleware.test.ts` | PASS | — |
| TC-AM-022 | 有効な招待URLを開くと招待ページが表示される | `/invite/ambassador/[token]` | UI | 未使用・期限内の招待token | 「Googleでサインアップ」ボタンが表示される | Playwright実ブラウザ確認 | PASS | screenshot提示済(04) |
| TC-AM-023 | 無効な招待URL(存在しないtoken)はエラー表示になる | `/invite/ambassador/[token]` | 異常 | 存在しないtoken | 「この招待URLは無効です。期限切れ、または既に使用されている可能性があります。」が表示される | Playwright実ブラウザ確認 | PASS | screenshot提示済(05) |
| TC-AM-024 | 招待開始APIが有効な招待をCookieに積んでGoogleサインインへ流す | `/api/ambassador/invite/start` | 正常 | 有効な招待token | `Set-Cookie`(`ambassador_invite_token`、httpOnly・sameSite=lax・path=/)がセットされ、`/api/auth/signin/google`へ307 | `npx dotenv -e .env.local.test -- vitest run src/app/api/ambassador/invite/start/route.integration.test.ts` | PASS | — |
| TC-AM-025 | 無効・使用済みの招待でstart APIを叩くとCookieをセットせず招待ページへ戻す | `/api/ambassador/invite/start` | 異常 | 無効・期限切れ・使用済みtoken | Cookieをセットせず`?error=invalid`付きで招待ページへ307リダイレクト | `npx dotenv -e .env.local.test -- vitest run src/app/api/ambassador/invite/start/route.integration.test.ts` | PASS | — |
| TC-AM-026 | 通常ユーザー(アンバサダーでない)のbilling画面表示は従来通り | `/billing` | 回帰 | Ambassador行なしのユーザー | FREE/PRO/ULTRAのカードが従来通り表示され、アンバサダー特典表示は出ない | Playwright実ブラウザ確認 / `npm run test:unit`(既存1480件回帰なし) | PASS | screenshot提示済(06) |
| TC-AM-027 | 実際のGoogleサインアップ完了(User作成イベント発火)で招待Cookieからアンバサダーが付与される | `authOptions.events.createUser` | 正常 | 招待Cookie保持、新規User作成イベント発火 | User作成・招待の`usedAt`更新・Ambassador作成が行われる | `npx dotenv -e .env.local.test -- vitest run src/lib/auth.ambassador.integration.test.ts` | PASS | `cookies()`をモックしNextAuthのUser作成イベントを直接検証 |
| TC-AM-028 | 招待Cookieが無い・無効な新規登録ではAmbassadorが付与されずサインアップ自体は成功する | `authOptions.events.createUser` | 正常 | Cookieなし／無効tokenで新規User作成イベント発火 | 例外を投げずに完了し、Ambassador行は作られない | `npx dotenv -e .env.local.test -- vitest run src/lib/auth.ambassador.integration.test.ts` | PASS | — |
| TC-AM-029 | アンバサダー付与に失敗しても新規登録自体は失敗しない | `authOptions.events.createUser` | 異常 | `claimAmbassadorInviteForNewUser`が例外を投げる状況(例: 既にAmbassador) | サインアップは成功、失敗内容(token・userId)がログに残り、管理者が`addAmbassadorByEmail`で手動救済できる | 実コード確認(`auth.ts`の`catch`ブロック、`claimAmbassadorInviteForNewUser`の`already_ambassador`分岐は例外を投げない設計なので実際に到達するのはDB接続断等の稀なケース) | PASS | 自動リトライは無い設計上の既知の制約(review-auto Code ModeでCodexがHIGH指摘、手動救済経路の存在を確認しログ強化のみ実施) |
| TC-AM-030 | 管理画面にアンバサダーのナビゲーションリンクが表示される | `/admin/layout.tsx` | UI | 管理者ログイン | ナビゲーションに「アンバサダー」リンクが存在し`/admin/ambassadors`へ遷移する | Playwright実ブラウザ確認(`/admin/ambassadors`への直接遷移で画面が表示されることで確認、screenshot 01) | PASS | — |
| TC-AM-031 | アンバサダーがストア契約中にULTRA購入を試みると通常通り拒否される | `/api/billing/checkout` | 異常 | Ambassador、有効な非Stripe Subscription行(provider≠STRIPE)、plan=ULTRA | PRO行のみを除外する実装のため、非Stripe行は引き続き409`ストアで契約中のプランがあります` | 実コード確認(`checkout/route.ts`の`rowsForDuplicateCheck`はPRO行のみ除外、他providerの行はそのまま判定対象) | PASS | — |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`(104ファイル1480件、既存回帰含む)
- `npm run test:integration`(96ファイル895件、ambassador関連の新規integrationテスト15件を含む)
- `npx vitest run src/middleware.test.ts`(21件)
- `npm run db:push:local`(スキーマ反映確認)

## Out of Scope

- Railway CLIでの新規Cronサービス追加自体の動作確認(このbaselineはアプリケーションコードの検証が対象。Railway側のサービス設定は別途デプロイ後に確認する)
- ULTRA本体・差額のStripe Price ID発行後の実際のCheckout決済フロー(Stripeとの実通信、実カード決済)。現時点でULTRA自体が購入不可、ユーザーが後日Price ID発行を行う予定のため未検証
- `ambassador-invite-retention.ts`のRailway上での実行スケジュール自体(ロジック層のintegrationテストのみ検証)
- `expiresAt`とretention実行時刻がミリ秒単位で一致する境界(claim不可・削除対象外の両方に属する一瞬の状態)。次回retentionサイクルで確実に削除されるため実害なく、flaky化を避けて自動テスト化しない
