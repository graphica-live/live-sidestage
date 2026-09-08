---
project: live-sidestage-analytics
feature: login-stats
last_updated: 2026-09-06
last_risk: MEDIUM
last_reviewers: Qwen(NO ISSUES応答だがカナリア検証で未読と判明、無効。Claude自身でdiff照合)
---

# テストベースライン: login-stats

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

ログイン画面(`/login`)の実績訴求バナー。未認証で見える公開API
`GET /api/public/login-stats`([route.ts](../../../src/app/api/public/login-stats/route.ts))が集計値を返し、
`GoogleLoginPanel.tsx`が表示する。5分キャッシュ(`revalidate=300`)。

「監視中の配信者数」表示は登録ユーザー(`Streamer`テーブル)の行数ではなく、実際に接続・監視している
`TiktokRoom`の行数(`roomCount`)を使う。コラボ自己申告(`ensureRoomWatchedForCollab`)等でStreamer未登録の
まま監視対象になっているRoomが存在するため、Streamer行数だと実際の監視数より少なく表示されるバグがあった。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-LGS-001 | 監視中人数はTiktokRoom行数を返す(Streamer行数ではない) | `route.ts` GET | 正常/回帰 | ローカルDB(Streamer 28件, TiktokRoom 86件) | レスポンスの`roomCount`がTiktokRoom件数(86)と一致、Streamer件数とは一致しない | `curl http://localhost:3000/api/public/login-stats` | PASS | 2026-09-06実測: roomCount=86, Streamer件数28とは別値 |
| TC-LGS-002 | ログイン画面のバナー文言が`roomCount`を表示する | `GoogleLoginPanel.tsx` LoginForm | 正常 | `/login`をブラウザで開く | 「{roomCount}人の配信者データを集計する」の数値がAPIレスポンスの`roomCount`と一致 | Playwrightで`/login`を開きスクリーンショット確認 | PASS | 2026-09-06実測: 画面表示「86人」= API roomCount:86 |
| TC-LGS-003 | API未応答時は数値なしの文言にフォールバックする | `GoogleLoginPanel.tsx` useLoginStats | 異常 | fetch失敗またはstats取得前 | 「配信者データを集計する、配信を支えるサポートプラットフォーム」(数値なし)を表示 | コード確認(`stats ? ... : "配信者データを集計する..."`の分岐、既存ロジック未変更) | PASS | 今回の変更でこの分岐自体は触っていない |

## Quality Gate

- `npx tsc --noEmit`(PASS, No errors found)

## Out of Scope

- `contributorCount` / `giftCount` / `battleCount`の集計ロジック(`loadGiftTotals`等) — 今回変更なし
