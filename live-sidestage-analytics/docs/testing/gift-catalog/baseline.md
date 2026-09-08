---
project: live-sidestage-analytics
feature: gift-catalog
last_updated: 2026-09-07
last_risk: MEDIUM
last_reviewers: DeepSeek(Design Mode 1ラウンド + Code Mode 1ラウンド、TestCase十分性レビューはCode Modeで同時実施。room_id付き複数部屋取得の撤去分)
---

# テストベースライン: gift-catalog

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

`src/lib/tiktok-gift-catalog.ts`(+`src/lib/tiktok-listener.ts`の`resolveGiftCatalogSources`)が担う、TikTokギフトカタログ(`tiktok_gift_catalog`)の定期取得・正規化・英日突合・カタログ取得専用プロキシ(`GIFT_CATALOG_PROXY_URL`)・取得成否の監査ログ(`/admin/proxy`)。

**2026-09-07: room_id付き複数部屋取得(配信者固有コミュニティギフトの事前収集)を撤去した。** community_giftはLIVE受信時点で既に日本語名確定、`GET /api/mobile/gifts`は受信履歴からも名前・画像を拾う和集合設計のため、事前収集の価値が薄いと判断(詳細は`changes/`参照)。カタログ取得は`GIFT_CATALOG_SOURCE_COUNT=1`件・room_id無しに単純化した。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-GC-001 | レスポンス正規化 | `normalizeCatalogEntries` | 正常 | `name`/`giftName`混在、`diamond_count`/`diamondCount`混在 | 表示名・コイン数・小文字一致キーを正しく作る | `npx vitest run src/lib/tiktok-gift-catalog.test.ts` | PASS | |
| TC-GC-002 | 不正エントリの除外 | `normalizeCatalogEntries` | 異常 | 名前無し/id不正/コイン数不正/配列でないレスポンス | 不正分は捨て、コイン数不正のみは0埋めで残す | 同上 | PASS | |
| TC-GC-003 | 同一giftId重複の畳み込み | `normalizeCatalogEntries` | 境界 | レスポンス内に同一giftIdが複数行 | 後勝ちで1件に畳む | 同上 | PASS | 実測でレスポンス内に4行出るケースあり |
| TC-GC-004 | 同名別giftIdは両方保持 | `normalizeCatalogEntries` | 正常 | 同じ表示名で giftId が異なる2件 | 両方残す(giftId照合にしない理由そのもの) | 同上 | PASS | |
| TC-GC-005 | アイコンURL採用の優先順位 | `normalizeCatalogEntries` | 正常/異常 | `image.url_list`/`giftImage`/`icon`、allowlist外URL混在 | allowlist内を優先採用、無ければnull(エントリは残す) | 同上 | PASS | |
| TC-GC-006 | 英日突合 | `mergeLocalizedCatalog` | 正常 | 英語版+日本語版レスポンス | giftIdで突合し`labelJa`を付与。`name`/`label`は英語版のまま | 同上 | PASS | |
| TC-GC-007 | 日本語版欠損時の扱い | `mergeLocalizedCatalog` | 異常 | 日本語版が空、または該当giftIdが日本語版に無い | 全エントリを返しつつ、base の label がひらがな・カタカナを含まなければ`labelJa: null`(取得失敗を理由にカタログ更新自体は止めない) | 同上 | PASS | 2026-09-07: `hasJapaneseText`フォールバック追加に伴い期待結果を更新。日本語を含む場合の挙動はTC-GC-027参照 |
| TC-GC-008 | TTLキャッシュ | `refreshGiftCatalogIfStale` | 正常/境界 | カタログ空/TTL内/TTL超過 | 空またはTTL超過時のみ取得、TTL内は取得元解決すらしない | 同上 | PASS | |
| TC-GC-009 | 失敗時の非伝播とバックオフ | `refreshGiftCatalogIfStale` | 異常 | 取得失敗、空/全件不正レスポンス | 呼び出し元へ例外を投げず、`CATALOG_FAILURE_BACKOFF_MS`(30分)は叩き直さない。成功でバックオフ解除 | 同上 | PASS | ライブ接続を巻き込まない不変条件 |
| TC-GC-010 | 同時呼び出しの単一飛行化 | `refreshGiftCatalogIfStale` | 並行 | 同一プロセスから同時に複数回呼ぶ | 実際の取得は1回にまとまる | 同上 | PASS | |
| TC-GC-011 | 最初に成功した部屋だけを使う(和集合廃止) | `refreshGiftCatalogIfStale` | 正常 | `resolveSources()`が複数件返す(通常は1件だが防御的にテスト)、1部屋目が成功 | 1部屋目のbase+jaだけで書き込む。2部屋目は試さない | 同上 | PASS | 2026-09-07: room_id付き複数部屋取得の撤去に伴い、旧「和集合」仕様から「最初の1件のみ採用」へ変更 |
| TC-GC-013 | 日本プロキシの優先とフォールバック | `fetchGiftsFromTikTok` | 正常/境界 | `GIFT_CATALOG_PROXY_URL`が値あり/未設定/空文字列 | 値ありなら`source.proxyUrl`より優先、未設定・空文字列は`source.proxyUrl`へフォールバック | 同上 | PASS | 空文字列を未設定扱いにする境界を明示的にカバー |
| TC-GC-014 | 日本プロキシ障害時に部屋プロキシへは落とさない | `fetchGiftsFromTikTok` | negative | `GIFT_CATALOG_PROXY_URL`設定済みで取得失敗 | `source.proxyUrl`への自動フォールバックはしない(地域ギフト取りこぼし再発防止、意図的仕様)。接続を作り直さない(construct 1回のみ) | `npx vitest run src/lib/tiktok-gift-catalog.test.ts` | PASS | TestCaseレビュー(Qwen、カナリア検証で本物と確認)指摘により自動テスト化 |
| TC-GC-015 | 取得成否の監査ログ記録 | `recordProxyAttempt`(`fetchGiftsFromTikTok`経由) | 正常/異常 | 成功/失敗それぞれ1回呼び出し。レスポンスが配列でない異常形状。監査tx自体が例外を投げる(DB障害) | `AppSetting`(`giftCatalogProxyAttemptLog`)へsuccess/failureエントリを1件追加、失敗時は元の例外を投げ直す。`giftCount`は配列でなければ`undefined`。監査tx自体の例外は握り潰し、成功/失敗いずれの結果も呼び出し元へそのまま伝わる(reconcileループを止めない不変条件) | 同上 | PASS | |
| TC-GC-016 | usedJpProxy/localeフラグの記録 | `recordProxyAttempt` | 正常/境界 | `GIFT_CATALOG_PROXY_URL`設定時/未設定時、locale="ja"/"default" | ログエントリの`usedJpProxy`が実際の使用有無と一致し、`locale`もそのまま記録される | 同上 | PASS | |
| TC-GC-017 | 資格情報の非露出 | `recordProxyAttempt` | セキュリティ | プロキシURL(user:pass付き)を含むエラーメッセージ | ログの`error`にuser/passが残らず`//***:***@`にマスクされる | 同上 | PASS | |
| TC-GC-018 | 並行書き込みのlost update防止 | `recordProxyAttempt` | 並行 | advisory lock取得成功/失敗の両パターン | 失敗時は書き込みをスキップし例外を投げない(監視ログにつき1件欠落は許容)。成功時はread-modify-writeがtx内で完結 | 同上 | PASS | `worker-guardian.ts`の`appendAuditLog`と同型 |
| TC-GC-019 | 監査ログのFIFO cap | `recordProxyAttempt` | 境界 | 既存50件(`PROXY_ATTEMPT_LOG_MAX_ENTRIES`)に1件追加 | 最新50件のみ保持、最古1件を切り捨て | 同上 | PASS | |
| TC-GC-020 | 監査ログの破損データからの復旧 | `recordProxyAttempt` | 異常 | 既存`AppSetting.value`がJSON破損 | 空配列から再開し、以後の記録を継続する | 同上 | PASS | |
| TC-GC-023 | 管理画面: 取得履歴の表示 | `/admin/proxy` + `/api/admin/proxy` | 正常 | 監査ログが1件以上ある管理者セッション | 新しい順に時刻・成功/失敗・locale・部屋・件数またはエラー文言が表示される | Playwright(headless、要ログイン) | PASS | 手順は下記「Web実機確認」参照 |
| TC-GC-023b | 管理画面: フォールバック成功の警告表示 | `/admin/proxy`(`outcomeBadge`) | 境界 | `outcome: "success"` かつ `usedJpProxy: false`(部屋プロキシへのフォールバック成功) | 緑「成功」ではなく黄色「成功(フォールバック)」と表示する。`usedJpProxy: true`の成功は従来どおり緑「成功」、`outcome: "failure"`は従来どおり赤「失敗」 | Playwright(headless、要ログイン) | PASS | 2026-09-06: フォールバック成功が緑「成功」表示のままで実質失敗に近い状態が区別できないという指摘により追加。下記「Web実機確認」参照 |
| TC-GC-024 | 管理画面API: 未認証アクセス | `/api/admin/proxy` | 異常 | 管理者セッションなし(`getAdminSession()`が`null`) | `401 Unauthorized`、`getSetting`を呼ばない | `npx vitest run src/app/api/admin/proxy/route.test.ts` | PASS | 既存`getAdminSession()`ゲートを流用(`admin/workers/route.ts`と同型)。unit化(TestCaseレビューFable指摘) |
| TC-GC-025 | 管理画面API: 破損/欠損データへの耐性と順序 | `/api/admin/proxy` | 異常/境界 | 設定値が無い/JSON破損/配列でない形状/正常な複数件 | いずれもエラーにせず空配列または正しい配列を返す。正常時は新しい順(reverse)で返す | `npx vitest run src/app/api/admin/proxy/route.test.ts` | PASS | |
| TC-GC-026 | 管理画面: 履歴0件時の表示 | `/admin/proxy` | 境界/empty state | 監査ログが0件 | エラーにならず空状態の文言を表示する | Playwright(headless) | PASS | 下記「Web実機確認」参照 |
| TC-GC-027 | ひらがな・カタカナ含有時のフォールバック(保険) | `mergeLocalizedCatalog` | 正常/境界 | 日本語版に無いgiftIdで、base の label がひらがな・カタカナを含む/含まない | 含む場合は`labelJa`にbaseのlabelをそのまま採用、含まない場合は`labelJa: null` | `npx vitest run src/lib/tiktok-gift-catalog.test.ts` | PASS | 元々は配信者固有コミュニティギフト(base取得時点から日本語名確定、`gift-name-verification/REPORT.md`発見2)の`labelJa`欠落を防ぐ目的だったが、2026-09-07にroom_id付き複数部屋取得(community_gift事前収集)自体を撤去したため通常は発動しない保険コードになった。base側に日本語表記の通常ギフトが紛れた場合の保護として残す |
| TC-GC-028 | ja版取得は1部屋のみ(2部屋目は試さない) | `refreshGiftCatalogIfStale` | 正常/異常 | 1部屋目のbaseが成功、ja取得が成功/失敗するケース | ja取得の成否に関わらず2部屋目は試さない(base取得が成功した時点で打ち切る) | 同上 | PASS | 2026-09-07: room_id付き複数部屋取得の撤去に伴い、カタログ取得自体が1部屋(`GIFT_CATALOG_SOURCE_COUNT=1`)構成になったため、ja版だけでなくbase側も含めて「最初に成功した部屋のみ」に統一した |
| TC-GC-029 | base取得失敗時の次部屋フォールバック(防御的) | `refreshGiftCatalogIfStale` | 異常 | `resolveSources()`が複数件返し、1部屋目のbase取得が失敗 | 2部屋目のbase取得を試す(全滅時のみ失敗扱い) | 同上 | PASS | `resolveSources()`は通常1件しか返さないが、複数件返った場合のフォールバックとして`refreshGiftCatalogIfStale`側のforループは維持している |

## Quality Gate

- `npm run typecheck`
- `npx vitest run src/lib/tiktok-gift-catalog.test.ts`
- `npm run test:unit`
- `npx next build`

## Out of Scope

- `GIFT_CATALOG_SOURCE_COUNT`(1件固定)自体の引き上げ・reconcileループの起動間隔(既存仕様、今回変更なし)
- `mergeLocalizedCatalog`/`writeCatalog`の呼び出し元である`worker.ts`の30秒reconcileループ本体(`worker-shard`機能のbaseline対象)
- ギフト履歴・モバイルピッカー等、カタログを消費する側のロジック(`gift-history.ts`/`api/mobile/gifts/route.ts`。カタログ行が増えれば自動反映されるだけで今回変更していない)
- Webshare側のプロキシ調達・Railway環境変数設定作業(インフラ運用手順)
- 同一`device_id`をライブ接続用(東南アジア)と異なるリージョン(日本)のIPから出すことによる、TikTok側の不整合検知・ライブ接続への長期的な悪影響(自動テスト不能。本番投入後の運用監視で判断。デプロイ後、担当部屋の再接続頻度に悪化が無いことを手動確認する。TestCaseレビューFable指摘)
