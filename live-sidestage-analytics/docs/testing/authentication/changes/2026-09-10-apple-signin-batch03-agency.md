date: 2026-09-10
feature: authentication (Web Sign in with Apple, Batch 03 — 事務所コンソール側)
change summary: `src/lib/agency/auth.ts` に `AppleProvider`(id: `apple-agency`)を追加、`src/app/api/auth/[...nextauth]/route.ts` の `handlerFor` を事務所用provider id集合(Google+Apple)へ拡張。
risk: HIGH(認証境界。plan `.claude/plans/20260910-web-apple-signin.md` のBatch 00 design-reviewで確定した方針に基づく実装)

## reviewers

- DeepSeek(V4 Flash, reasoning high): finding 3件(HIGH 1 / MEDIUM 2)
- Codex: 2回連続でハング(`omniroute launch-codex --profile sol` がoutput 0行のまま無応答。それぞれ約20分・約12分待機後にTaskStopで強制終了)。原因未調査。HIGHのCodex代理としてGemini(OmniRoute経由、`agy/gemini-3.7-flash-medium`)へ切替、無確認で実行(既存ルール通り)
- Gemini: NO ISSUES(ファイル別確認一覧あり、bare応答ではない)

## VALID / INVALID の重要判断

- **VALID(修正済み)**: `src/lib/agency/auth.ts` に `agencyCookiePrefix`という未使用変数があった(dead code)。`session-cookie.ts`側の`AGENCY_STATE_COOKIE`等の定数に`__Secure-`prefixが既に埋め込み済みで、`auth.ts`側での再計算は完全な重複・未使用だった。削除した。
- **INVALID(却下)**: DeepSeekはHIGHとして「state/pkceCodeVerifier/nonce cookieの`secure`が`AGENCY_USE_SECURE_COOKIES`でなく`true`固定されており、ローカル開発(http)でGoogleログインまで壊れる」と指摘。実コード確認の結果、配信者側`src/lib/auth.ts`(Batch 02, design-review確定済み)も同じ`secure: true`固定パターンであり、事務所側はこれと一貫性を保つため踏襲しただけで、Batch03固有の新規問題ではない。既存(Batch02)の設計としてdesign-reviewを通過済みのため、当時の判断を覆さず今回はINVALID扱いとした。ただし「ローカル開発環境でGoogle/Appleログインがsecure cookie制約により機能しない可能性」自体は解消していない実質的懸念として残る(下記「remaining risks」参照)。
- **INVALID(却下)**: 上記と表裏一体で、DeepSeekはMEDIUMとして「`sameSite: "none"`が`secure`の値に連動していない」も指摘。同じ理由(Batch02からの一貫パターン踏襲)でINVALID。

## affected baseline cases

TC-AUTH-107(新規)、TC-AUTH-108(新規)

## verification

- `npm run typecheck`: PASS
- `npm run test:unit`: 1532 tests PASS
- `npm run test:integration`(ローカルPostgres): 925 tests PASS

## remaining risks

- **ローカル開発環境(`NEXTAUTH_URL`がhttp)でのApple/Google OAuthフローの実地未検証。** state/pkceCodeVerifier/nonce cookieが`secure: true`固定のため、http環境ではブラウザがこれらのcookieを送信しない可能性がある(Batch02時点からの既存懸念、DeepSeekが今回改めて指摘)。本番(Railway、`NEXTAUTH_URL`は常にhttps)では問題にならないが、ローカルでのGoogle/Appleログイン動作確認手順が無い場合、この経路の実地検証機会自体が無いままになる。次にWeb認証周りへ触るときに実地検証するか、意図的にローカル検証対象外とするかを明確にしておくとよい。
- TC-AUTH-107は本worktree環境(`APPLE_SERVICES_ID`等未設定)ではconditional skip相当のPASSであり、Apple providerが実際にproviders配列へ正しく登録されることの検証はenv var設定済み環境でのみ成立する。
- Codexのハング原因未調査(2回目も同一条件で再現)。次回HIGH以上のレビューでも再発する可能性があるため、原因調査または既知問題としての記録を検討。
