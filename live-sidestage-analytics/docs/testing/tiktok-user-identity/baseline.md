---
project: live-sidestage-analytics
feature: tiktok-user-identity
last_updated: 2026-09-09
last_risk: CRITICAL
last_reviewers: (実装前) Codex x3 + Fable x3 + Gemini x3 + DeepSeek(design review 8周) / (実装後) review-auto Code Mode
---

# テストベースライン: tiktok-user-identity

TikTok の不変な数値ID(`tiktokUid`)を主キーとする `TikTokUser` テーブルを正本とし、
全ての人物識別を3語彙(`principalId` / `tiktokUid` / `tiktokHandle`)へ統一した機能の保証事項。

対象は `src/lib/tiktok-user.ts`(正本アクセサ)、`scripts/migrate-tiktok-userid-reset.ts`(全テーブル
TRUNCATE 移行)、`src/lib/tiktok-listener.ts` の `precheckApiLive()`(接続時 uid 照合)、
登録ゲート(`requireExistingTiktokAccount()` / `resolveExistence()`)、`TiktokRoom` の一意キー。

**この機能の主目的は「可変ハンドルを同一性キーにしない」こと。** ハンドル改名で集計が割れる /
改名で空いたハンドルを第三者が取得して他人のデータへ紐付く、の2つを構造的に潰す。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-TUI-001 | protobuf proto3 の既定値 `"0"` を欠落として扱う | `normalizeTikTokUserId()` | 境界 | `"0"` | `null` | `npx vitest run src/lib/tiktok-user.test.ts` | PASS | ts-proto の `createBaseUser()` が `userId: "0"` を既定値に持つ。空文字だけ弾くと uid 不明の全ユーザーが `"0"` という1人へ畳まれる |
| TC-TUI-002 | 空文字・undefined・null・非数字・33桁を拒否する | `normalizeTikTokUserId()` | 境界/異常 | `""` / `undefined` / `null` / `"abc"` / `"12a"` / `"1"×33` | すべて `null` | 同上 | PASS | |
| TC-TUI-003 | 数値文字列をそのまま返す(number も受ける) | `normalizeTikTokUserId()` | 正常 | `"6829876543210987654"` / `123` | 文字列としてそのまま | 同上 | PASS | |
| TC-TUI-004 | uid が正規化できない観測では upsert しない | `recordTikTokUser()` | 異常 | `tiktokUid: "0"` | `tikTokUser.upsert` が呼ばれない | 同上 | PASS | |
| TC-TUI-005 | 表示名を欠く観測は `update` を空にする(既知値を null で潰さない) | `recordTikTokUser()` | 境界 | `tiktokHandle: null`, `nickname: "  "` | `update: {}`、`create` 側は `null` | 同上 | PASS | `mergeHostProfiles()` と同じ規律。素の last-write-wins にすると行が名無しへ退行し、生観測系から表示列を落としてあるので復旧元が残らない |
| TC-TUI-006 | 観測値を trim して保存する | `recordTikTokUser()` | 正常 | `" alice "` / `" アリス "` | trim 済みの値で `create` / `update` | 同上 | PASS | |
| TC-TUI-007 | スロットルの marker は commit コールバックを呼ぶまで立たない | `recordTikTokUser()` | 並行/異常 | 同一観測を3回。2回目までは commit を呼ばない | 1・2回目は upsert が走り、commit 後の3回目は走らない | 同上 | PASS | upsert 時点で marker を立てると、外側が rollback しても10分「記録済み」扱いになり生観測行だけ commit されうる |
| TC-TUI-008 | 表示名が変われば同じ uid でもスロットルを跨いで upsert する | `recordTikTokUser()` | 正常 | 同一 uid で `alice` → `alice2` | 2回とも upsert | 同上 | PASS | スロットルキーは `uid + handle + nickname` |
| TC-TUI-101 | 外側のトランザクションが rollback すると `tiktok_users` 行も残らない | `recordTikTokUser()` | 並行/異常 | `$transaction` 内で呼んだ直後に throw | 行が存在しない | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-user.integration.test.ts` | PASS | 生観測系から表示列を落とした前提条件そのもの。fire-and-forget にしない |
| TC-TUI-102 | rollback 後の再観測はスロットルで飛ばされない | `recordTikTokUser()` | 回帰 | rollback → 同一観測を再実行 | 2回目で行が作られる | 同上 | PASS | TC-TUI-007 の実DB版 |
| TC-TUI-103 | commit すれば必ず対応行がある | `recordTikTokUser()` | 正常 | `$transaction` 内で呼び commit | `tiktokHandle` / `nickname` が保存される | 同上 | PASS | |
| TC-TUI-104 | 表示名を欠く後続観測が既知の値を実DB上でも残す | `recordTikTokUser()` | 境界 | `known`/`既知` を保存 → `undefined`/`undefined` を観測 | 既知値が残る | 同上 | PASS | TC-TUI-005 の実DB版 |
| TC-TUI-105 | 非 null の新しい値は上書きする(改名の追随) | `recordTikTokUser()` | 正常 | `before`/`旧` → handle だけ `after` | `tiktokHandle="after"`, `nickname="旧"` | 同上 | PASS | 改名追随とnull潰し防止が両立していること |
| TC-TUI-106 | 同じ観測値の2回目はスロットルで upsert されない | `recordTikTokUser()` | 正常 | 保存 → DBを手で書き換え → 同一観測 | 手で書き換えた値が残る | 同上 | PASS | 実DBで upsert の不発を観測する |
| TC-TUI-107 | uid から順引きでき、行の無い uid はマップに現れない | `resolveTikTokUserDisplay()` | 正常/境界 | 存在するuid・存在しないuid・重複・空文字 | 存在する1件のみ、`size===1` | 同上 | PASS | 集計側の唯一の表示名解決口 |
| TC-TUI-108 | 空の入力では DB を引かずに空マップを返す | `resolveTikTokUserDisplay()` | 境界 | `[]` / `[""]` | `size===0` | 同上 | PASS | |
| TC-TUI-201 | `prisma.tikTokUser` を `src/lib/tiktok-user.ts` 以外から触らない | ソース走査 | 回帰/規律 | `src/**/*.ts(x)`(テスト除く) | 違反ファイル0件 | `npx vitest run src/lib/tiktok-user.guard.test.ts` | PASS | ハンドル→uid の逆引きが混入する余地を機械検査で塞ぐ |
| TC-TUI-202 | `prisma.tiktokRoom.create` / `.upsert` を `src/lib/tiktok-room.ts` 以外から触らない | ソース走査 | 回帰/規律 | 同上 | 違反ファイル0件 | `npx vitest run src/lib/tiktok-room.guard.test.ts` | PASS | 「room を作って `TikTokUser` を作らない経路は存在してはならない」を構造で担保する |
| TC-TUI-301 | テーブルが1つも無い空DBでも移行スクリプトが例外を投げない | `runReset()` | 異常系境界 | `db push` 前のDB | 例外なし。旧形列0件 | `npx dotenv -e .env.local.test -- vitest run scripts/migrate-tiktok-userid-reset.integration.test.ts` | PASS | 新規 Railway 環境 / CI の空DB。専用の一時DB `itest_tiktok_uid_reset` を `CREATE DATABASE` して検証する |
| TC-TUI-302 | 新形のみ(db push 直後)のDBでは何も消さない | `runReset()` | 正常 | seed 済み・旧形列なし | Gift・Event が残る。marker も立たない | 同上 | PASS | **旧形検出型**。marker の有無で判定しない(marker が立たない正当な経路があり、AND 判定だと新規DBの2回目デプロイでデータを全消去する) |
| TC-TUI-303 | 新形の必須列が実スキーマに1つも欠けていない(指紋の綴り検証) | `detectMissingNewColumns()` / `REQUIRED_NEW_COLUMNS` | 回帰 | `db push` 後のスキーマ | `missing` が空、必須列リストが非空 | 同上 | PASS | 指紋に存在しない綴りを1つでも書くと恒久的に不一致になる。手書きリストを実 `information_schema.columns` と突き合わせる |
| TC-TUI-304 | 旧形の列があれば全 TRUNCATE する | `runReset()` | 正常 | `gifts.uniqueId` を復活させた状態 | Gift/Event/EventMatch/TiktokRoom/User がすべて0件 | 同上 | PASS | `public` と `event` の両スキーマ |
| TC-TUI-305 | 手動確定(`winnerDecidedBy IN ('MANUAL','DRAW')`)を TRUNCATE より前に AppSetting へ退避する | `runReset()` | 異常系/データ保全 | `MANUAL` の EventMatch が1件 | `tiktok-userid-reset:manual-decisions-backup*` が1件、中身が `MANUAL` 1件。値は非 null | 同上 | PASS | 採取が TRUNCATE より後だとバックアップが必ず空になる(番号順の実行で踏む) |
| TC-TUI-306 | marker があっても旧形の列が残っていれば再実行される | `runReset()` | 回帰 | marker あり + `gifts.uniqueId` あり + seed | 全 TRUNCATE される | 同上 | PASS | ロールバック→再前進の救済。marker を手で消す必要がない |
| TC-TUI-307 | 新形の列が無い旧スキーマでも例外を投げない | `runReset()` | 異常 | `gifts.tiktokUid` を DROP した状態 | 例外なし | 同上 | PASS | このスクリプトは新 Prisma Client で旧スキーマに対して動く(Dockerfile の CMD 順)。raw SQL 原則が守られていることの検証でもある |
| TC-TUI-401 | 接続前に api-live の uid と room の `hostTiktokUid` を照合する | `precheckApiLive()` | セキュリティ | 一致 / 不一致 / 欠損 / 例外 の4状態 | `verified` のみ接続。他は接続しない | `docs/testing/tiktok-listener-connection/baseline.md` TC-TLC-002/002b/002c/003 | PASS | 実体は tiktok-listener-connection baseline に集約(重複管理を避ける)。追加の TikTok 問い合わせはゼロ |
| TC-TUI-109 | 所有を確定する呼び出しは `EXISTS` の positive キャッシュを読み飛ばす | `existenceChecker.check()` | セキュリティ | ハンドル H を uid=A でキャッシュ → API が uid=B を返す状態 → `skipPositiveCache: true` | uid=B が返る(A を掴まない) | `npx vitest run src/lib/tiktok-existence.test.ts` | PASS | 6時間 positive キャッシュは「`tiktokHandle` → `tiktokUid` 逆引き表」そのもの。接続時 uid 照合では救えない(誤紐付けは登録時点で成立済み) |
| TC-TUI-110 | `MISSING` の negative キャッシュと in-flight 重複排除は共有したまま | `existenceChecker.check()` | 回帰 | `MISSING` をキャッシュ後に `skipPositiveCache: true` / 同時2要求 | 問い合わせは1回のまま | 同上 | PASS | uid を持ち回らないので共有してよい。ここまで捨てると TikTok への問い合わせが増える |
| TC-TUI-111 | ゲートが `ExistenceCheckOptions` を checker へそのまま渡す | `requireExistingTiktokAccount()` | 正常 | options 有り / 無し | checker が受け取った options が一致 | 同上 | PASS | 所有確定5経路(verify/generate・mobile/streamer・agency・worker-status・event participants)が `skipPositiveCache: true` を立てる |
| TC-TUI-402 | `handleStaleAt` が立った room を監視停止の候補にしない | `selectCleanupCandidates()` | セキュリティ/回帰 | `handleStaleAt` 非 null の room | 候補に入らない | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-room-cleanup.integration.test.ts` | PASS | 旧ハンドルが消えていれば `NOT_FOUND` が積み上がって本人の room が停止され、第三者が取得済みなら実在確認の共有枠を無駄に食う |
| TC-TUI-403 | 本人が改名して再登録すると `handleStaleAt` が解除されハンドルが追随する | `resolveRoomForStreamer()` | 正常 | uid 同一・ハンドルのみ変更 | 同じ room。`handleStaleAt: null`、`tiktokHandle` が新ハンドル | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-room.integration.test.ts` | PASS | `handleStaleAt` は自動解除しない。書き直す経路が同時に null を書く |
| TC-TUI-404 | `user_not_found` の明示有無で監視停止判定が変わらない | `classifyExistenceResult()` | 回帰 | `explicitNotFound` の有無 | 判定が一致 | `npx vitest run src/lib/tiktok-room-cleanup.test.ts` | PASS | 唯一の消費者だった `hostTiktokUid` 補完の give-up が uid 化で廃止されたので、フィールドごと削除した |
| TC-TUI-501 | 分析画面のギフト内訳が `tiktokUid` で取得でき、表示名が無くても壊れない | `AnalyticsView.tsx` | 正常/境界 | `tiktokHandle` / `nickname` が null の送信者を含むランキング | 内訳が 200 で開く。表示名は `nickname → tiktokHandle → tiktokUid` の順で落ち、`@null` を出さずプロフィールリンクも出さない | 実ブラウザ(`npm run dev:local` + `npm run seed:local`。ランキング・内訳展開・ギフト履歴・390px を Playwright で撮影) | PASS(内訳は 200 で展開。`TikTokUser` 未観測の送信者は `7000000000000000999` が表示名になり、@ハンドル行もプロフィールリンクも出ない。console error / 4xx ともに 0 件) | クライアントの `interface` はサーバー DTO への嘘なので tsc をすり抜ける。移行前は `&tiktokHandle=` を送っており両エンドポイントとも 400 で恒久到達不能だった |

## Quality Gate

- `npm run typecheck` — PASS
- `npm run test:unit` — PASS(105 files / 1470 tests)
- `npm run test:integration` — PASS(96 files / 889 tests)
- 命名規約の機械検査(`live-sidestage-analytics/CLAUDE.md` の「識別子の命名規約」節にある grep 3本)

## Out of Scope

- **desktop(TikEffect)の追随** — `/api/analytics/monthly-contributors` の応答キーを `tiktokHandle` へ改名したため
  `backend/lib/shogo-state.js` の dedupe / 登録キーが壊れる。ユーザー決定でスコープ外(運用開始前・月間MVP取り込みは必須機能ではない)
- **本番デプロイ手順の実行** — worker 停止順・web 停止・cutover 後に Dockerfile の CMD から
  移行スクリプトを外す工程は plan §9 が正本。このベースラインはコードの保証事項のみを扱う
- **`hostProfiles` の `displayId` がハンドルと一致するかの実測** — tiktok-probe による実配信での確認が未着手。
  匿名観測room の `hostTiktokUid` NOT NULL 化はこの前提に乗っている
- **`TIKTOK_EXISTENCE_CHECK_DISABLED=1` kill switch の意味変更** — uid 必須化により、このフラグが立っている間は
  登録経路が使えなくなる。フラグの用途(TikTok 障害時に登録を通し続ける)と矛盾するが、本改修では挙動を変えていない
