---
project: live-sidestage-analytics
feature: mobile-token-auth
last_updated: 2026-09-09
last_risk: CRITICAL
last_reviewers: Codex-terra+Gemini(code-reviewで同時実施)+DeepSeek(利用不能)
---

# テストベースライン: mobile-token-auth

mobile(Flutter)の認証を、desktop向けAPIキー(DB照合の無期限共有シークレット)から分離し、
OAuth2的な access token(短命JWT、1時間)+ refresh token(長命、sliding 30日・absolute 90日、
rotation付き)方式へ全面置換した。Google/Apple/メール全ログイン経路で同じ発行・rotation機構
(`mobile-auth.ts`)を使う。socket.io(`chat:{streamerId}`)の認証も access token を使う。
desktop向けAPIキー発行・検証機能、`Streamer.apiKey`列は完全削除した。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-MTA-001 | 有効な refresh token で access+refresh の新ペアを発行し、古い行を無効化する | `rotateRefreshToken` | 正常 | DB上有効な refresh token | 新しい access token(1h)・refresh token を返す。古い refresh token 行は `revokedAt` が立つ | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-002 | rotation で absoluteExpiresAt を延長しない(無期限セッション化の防止) | `rotateRefreshToken` | 境界 | 初回発行から日数が経過した refresh token で rotation | 新しい行の `absoluteExpiresAt` は初回発行時刻+90日のまま変わらない | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-003 | streamerId はトークン記録値でなく現在のDB値で解決する | `rotateRefreshToken` | 正常 | rotation 後に Streamer 行が変わっている状態 | 新しい access token の streamerId claim は現在のDB値 | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-004 | 猶予期間(30秒)内の同時提示は書き込みなしで同じペアを返す(盗難扱いにしない) | `rotateRefreshToken` + `RefreshTokenReplay` | 境界 | 同一 refresh token を30秒以内に複数回提示(メイン/背景Isolate、ネットワーク再試行相当) | 全リクエストが同じ access+refresh ペアを返す。DB書き込みは1回のみ | `npx vitest run src/lib/mobile-auth.test.ts`(fakePrismaでのunit) + `npx dotenv -e .env.local.test -- vitest run src/app/api/mobile/auth/refresh/route.integration.test.ts -t "同一 refresh token を実DB上で同時提示"`(実PostgreSQLでの5並列統合テスト) | PASS | 2026-09-09追加。DeepSeek TestCaseレビューでunit(fakePrisma)のみでは行ロック競合を再現できない指摘、実DB統合テストを新規追加 |
| TC-MTA-005 | 猶予期間を過ぎた再提示は TOKEN_REUSE_DETECTED になり family 全体を失効させる | `rotateRefreshToken` | 異常 | 30秒経過後に既に無効化済みの refresh token を提示 | `TOKEN_REUSE_DETECTED` を返し、同一 family の全 refresh token が失効する | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-006 | 存在しない refresh token は INVALID_REFRESH_TOKEN | `rotateRefreshToken` | 異常 | DBに存在しないトークン文字列 | `INVALID_REFRESH_TOKEN` | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-007 | sliding expiresAt 超過は reuse 扱いにせず INVALID_REFRESH_TOKEN | `rotateRefreshToken` | 境界 | `expiresAt` を過ぎた refresh token | `INVALID_REFRESH_TOKEN`(family失効しない) | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-008 | absoluteExpiresAt 超過は expiresAt が未来でも INVALID_REFRESH_TOKEN | `rotateRefreshToken` | 境界 | `absoluteExpiresAt` のみ超過 | `INVALID_REFRESH_TOKEN` | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-009 | 退会済みユーザーへ access token を発行しない | `rotateRefreshToken` | 異常 | User が削除済みの refresh token | `INVALID_REFRESH_TOKEN` | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-010 | replay キャッシュが復号できなくても安全側にフォールバックする | `rotateRefreshToken` + `refresh-token-replay-crypto` | 異常 | 鍵ローテーション直後などで復号失敗 | 通常の rotation 処理へフォールバックする(fail-safe) | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-011 | 生の refresh token を DB へ平文で残さない | `rotateRefreshToken` | negative | rotation 実行後のDB行を確認 | `RefreshToken`はハッシュ列のみ、`RefreshTokenReplay`は暗号化済みペイロードのみで、生の値がどちらにも存在しない | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-012 | 期限切れの replay 行はベストエフォートで掃除される | `rotateRefreshToken` | 回帰 | 期限切れ `RefreshTokenReplay` 行が存在する状態 | 該当行が削除される(失敗しても rotation 自体は成功する) | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-013 | ログアウトで family 全体を失効させ以後の rotation を拒否する | `revokeRefreshTokenFamily` | 正常 | ログイン中の family | 全 refresh token が失効し、以後の rotation は `INVALID_REFRESH_TOKEN` | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-014 | 知らないトークンでも例外にしない(冪等) | `revokeRefreshTokenFamily` | 異常 | 存在しない refresh token でログアウト呼び出し | 例外を投げず正常終了する | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-015 | 他 family のトークンは巻き込まない | `revokeRefreshTokenFamily` | negative | 複数 family が存在する状態で1つを失効 | 他 family の refresh token は有効なまま | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-016 | access token は1時間で失効する(90日の長命トークンへ戻さない) | `signMobileToken` | 境界 | 発行直後と1時間経過後 | 1時間以内は有効、以降は期限切れ | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | |
| TC-MTA-017 | 旧90日トークン(`LEGACY_TOKEN_CUTOFF_SEC`以前発行)は期限内でも拒否する | `verifyMobileToken` | 回帰 | カットオフ前に発行されたトークン | 拒否される | `npx vitest run src/lib/mobile-auth.test.ts` | PASS | apiKey方式撤去と無関係に維持すべき既存不変条件 |
| TC-MTA-018 | socket.io接続はhandshake.auth.tokenのモバイルJWTで認証し、query.token(overlay用)と衝突しない | `server.js` `io.use()` | 正常 | mobile経路: handshake.auth.token、overlay経路: query.token | それぞれ正しい部屋(`chat:{streamerId}` / `overlay:{streamerId}`)へ振り分けられる | 手動結線確認(既存socket.io認証テストの回帰) | NOT RUN: server.jsのsocket.io統合テストは自動化されておらず、既存構成の維持を目視確認のみで代替(desktop apiKey分岐削除以外のロジック変更なし) | |
| TC-MTA-019 | JWT期限(exp)到達時にサーバー側から切断し、mobile側の自動再接続でTOKEN_EXPIREDを通知する | `server.js`(`MAX_TIMEOUT_MS`ガード含む) | 境界 | exp到達直前のトークンで接続 | expで自動切断、クライアントへTOKEN_EXPIRED相当のイベント | 手動コードレビュー確認(`MAX_TIMEOUT_MS = 2147483647`のガードを目視確認) | NOT RUN: `server.js`のsetTimeoutタイマーロジックに対する自動テスト(unit/integration)が存在しない。access token有効期限は現行1hのためoverflow自体は発生しないが、ガードコード自体の検証テストは無い | 2026-09-09修正。DeepSeek TestCaseレビューで実行方法の誤帰属(`mobile-auth.test.ts`はこのロジックを検証していない)を指摘され訂正 |
| TC-MTA-022 | `POST /api/mobile/auth/refresh`は成功時200で`{token, refreshToken}`を返し、不正/期限切れ/reuseは401+codeを返す | `src/app/api/mobile/auth/refresh/route.ts` | 正常/異常/境界 | 有効/無効/reuse対象のrefresh token、不正body | 200(成功時、生の旧refreshToken以外の秘密を含まない)、401(invalid/reuse時、bodyに`code`)、400(refreshToken欠落・空・過長・不正JSON時) | `npx dotenv -e .env.local.test -- vitest run src/app/api/mobile/auth/refresh/route.integration.test.ts` | PASS | 2026-09-09追加。DeepSeek TestCaseレビューでHTTPルートレベルのbaseline記載漏れを指摘され追加(自動テスト自体は実装時から存在) |
| TC-MTA-023 | `POST /api/mobile/auth/logout`は常に200を返しfamilyを失効させる(端末を止めないbest-effort) | `src/app/api/mobile/auth/logout/route.ts` | 正常/異常 | 有効なrefresh token、知らないtoken、壊れたbody | 200(いずれも)。有効な場合はfamily全体の`revokedAt`が立ち、以後の当該refresh tokenでのrefreshは401 | `npx dotenv -e .env.local.test -- vitest run src/app/api/mobile/auth/refresh/route.integration.test.ts -t "POST /api/mobile/auth/logout"` | PASS | 2026-09-09追加。同上 |
| TC-MTA-024 | `GET /api/mobile/listener-status`はJWTからprincipalId解決しstreamerId claim欠落でも動作する | `src/app/api/mobile/listener-status/route.ts` | 正常/異常/回帰 | トークン無し、Streamer未登録、streamerIdクレーム欠落、verified=false | トークン無し→401、Streamer未登録→401、streamerIdクレーム欠落でもprincipalIdから解決、verified=falseでも401にしない | `npx dotenv -e .env.local.test -- vitest run src/app/api/mobile/listener-status/route.integration.test.ts` | PASS | 2026-09-09追加。DeepSeek TestCaseレビューでx-api-key撤去に伴うregression testのbaseline記載漏れを指摘され追加(自動テスト自体は実装時から存在) |
| TC-MTA-020 | `Streamer.apiKey`列・desktop向けAPIキー発行/検証エンドポイントが完全に削除されている | `prisma/schema.prisma`、`src/app/api/streamer/api-key/route.ts` | negative | 削除後のschema・APIルート一覧 | `Streamer`モデルに`apiKey`フィールドが存在しない。`/api/streamer/api-key`ルートが存在しない(404) | `npm run typecheck` + `grep -rn apiKey prisma/schema.prisma` | PASS | Geminiレビューで67ファイル中の削除漏れ無しを確認済み |
| TC-MTA-021 | REFRESH_TOKEN_REPLAY_ENC_KEY未設定/不正長のまま本番起動しようとするとfail-fastする | `server.js` 起動時チェック | 異常 | `NODE_ENV=production`かつ環境変数未設定または32byteでない | 起動せず`process.exit(1)` | 手動確認(起動スクリプトの分岐を読んで確認。実プロセス起動はローカル`.env.local`が正しく設定済みのため未実施) | NOT RUN: 本番相当の異常系プロセス起動はローカルdev環境の性質上再現困難。コードレビュー(Codex-terra finding是正)とコードパスの目視確認で代替 | 2026-09-09追加。Codex-terra findingへの対応 |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`(unit 108 files / 1507 tests)
- `npm run test:integration`(integration 98 files / 899 tests、ローカルDB必須)

## Out of Scope

- Agency向け`apiKeyHash`機能(`src/lib/api-auth.ts`の`resolveAgencyApiKey`系)は今回の変更対象外。変更していない
- OBSオーバーレイのtoken認証(`overlayToken`)は今回の変更対象外
