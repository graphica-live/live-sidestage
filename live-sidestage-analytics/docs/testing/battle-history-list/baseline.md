---
last_updated: 2026-09-10
last_risk: HIGH
last_reviewers: [DeepSeek(high), Codex-terra(medium)]
---

# バトル履歴一覧(web)

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

対象: `src/components/analytics/AnalyticsView.tsx`(コイン閾値非表示フィルタ + しきい値入力)、
`src/components/analytics/useBattleFilterSettings.ts`(設定の読み書きhook)、
`src/lib/battle-filter-settings.server.ts` / `src/app/api/streamer/battle-filter-settings/route.ts`(設定API)、
`src/components/analytics/battle-types.tsx`(`BattleScoreLine`)

## 正常

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 1 | 「コイン N 以下を非表示」ON時、`selfTotalDiamonds <= N` の終了済みバトル(N=しきい値入力の値、既定100) | Playwright(headless)で `/analytics` → バトル履歴タブ、しきい値を1500に設定 | 自ダイヤ25のバトルが一覧から消え、41000以上のバトルは残る(件数表示も減る) |
| 11 | トグル・しきい値の永続化 | Playwrightで トグルON + しきい値1500 → リロード | リロード後もトグルON・入力欄1500・フィルタ結果が維持される(`GET /api/streamer/battle-filter-settings` が `{hideLowDiamondEnabled:true, threshold:1500}` を返す) |
| 12 | 初回(未保存)の既定値 | `route.integration.test.ts`(設定行なしで GET) | `{hideLowDiamondEnabled:false, threshold:100}`。トグルOFF・入力欄100 |
| 13 | PATCH後のGET | `route.integration.test.ts` | PATCHした値がGETで返る(upsert) |
| 2 | スコア文字色(2陣営) | 同上 | 自陣営スコアは赤(`text-red-600 dark:text-red-400`)、相手陣営スコアは青(`text-blue-600 dark:text-blue-400`)。勝敗に関係なく固定 |
| 3 | スコア文字色(3陣営以上、`battle.teams`分岐) | 同上、乱戦バトルで確認 | `isSelf`陣営が赤、それ以外が青。最高スコア陣営でも色は変わらない |

## 境界

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 4 | トグルON時、しきい値以下の**進行中**バトル(`status==="live"`) | Playwrightで `local_test_streamer` に低コイン(自40/相手30)の進行中バトルをシードして確認 | 一覧から除外されない(進行中バトルはコイン閾値フィルタの対象外) |
| 5 | 進行中と判定される猶予(`LIVE_GRACE_MS`=5分)を過ぎ`status`が`unknown`になったバトル | 同上、シードから5分以上経過後に再取得 | `status!=="live"`になるため通常どおりコイン閾値フィルタの対象(既存仕様) |
| 14 | しきい値0 | `route.integration.test.ts`(PATCH threshold:0) | 200で保存される(下限0を含む) |
| 15 | しきい値の大きい値でフィルタ | Playwrightでしきい値50000 | 41000台のバトルも消え、進行中バトルと50000超のみ残る |
| 8 | 対戦相手に`nickname`(TikTok表示名)が設定されているバトル | 手動シード(`BattleHistoryParticipant.nicknameSnapshot`に日本語名を設定)→ `/analytics` バトル履歴タブ | 一覧のメイン表示名が`nickname`になり、`@tiktokHandle`はサブラベルとして併記される(`tiktokHandle`がメイン表示名にならない) |
| 9 | 対戦相手に`nickname`が無い(null)バトル | 既存の確定済みバトル(`nicknameSnapshot: null`)で確認 | メイン表示名が`@tiktokHandle`にフォールバックする(サブラベルは重複表示しない) |

## 異常

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 16 | 未ログインで設定API | `route.integration.test.ts` | GET/PATCH とも 401 |
| 17 | ログイン済みだが Streamer 未登録 | 同上 | 404 `配信者情報が見つかりません。` |
| 18 | 不正なしきい値(PATCH `-1` / `1.5` / `"abc"`) | 同上 | 400 `しきい値は0以上の整数で指定してください。`、値は変わらない |
| 19 | 不正なトグル値(PATCH `hideLowDiamondEnabled:"yes"`) | 同上 | 400 `小さいバトル非表示フラグが不正です。` |
| 20 | UI側の不正入力(空欄・負数・小数・非数値) | Playwrightで入力欄に `-5` / `1.5` / `abc` / 空欄 を順に入れて blur | いずれもPATCHを送らず入力欄が保存済み値へ戻る |
| 24 | 設定APIが失敗した場合のエラー表示 | Playwrightで `/api/streamer/battle-filter-settings` のGETを500へ差し替えて `/analytics` を開く | チェックボックス付近に赤字のエラーメッセージが表示される |

## negative

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 21 | 他配信者の設定を書き換えられない | `route.integration.test.ts`(body に別 streamerId を入れて PATCH) | body の streamerId は無視され、セッションの Streamer 行だけが更新される |
| 22 | 管理画面(`/admin/rooms/[roomId]`)では設定APIを呼ばない | Playwrightで管理画面のバトル履歴タブを開きネットワークを記録 | `/api/streamer/battle-filter-settings` へのリクエスト0件。トグル・しきい値はローカル状態のみで動く |

## 回帰

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 6 | 既存バトル履歴一覧の表示・検索・進行中表示が変わらない | Playwrightで `/analytics` バトル履歴タブ(既定状態) | トグルOFF・入力欄100で全件表示、コンソールエラーなし |

## UI

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 7 | バトル履歴タブ全体の表示(進行中1件+終了1件、フィルタON/OFF) | Playwright(headless)で `/analytics` → バトル履歴タブ、チェックボックスON/OFF両方でスクリーンショット | フィルタON時も進行中バトルは表示され続け、スコア色が陣営固定(自=赤/相手=青)で一貫している |
| 23 | しきい値入力欄の表示(PC/モバイル幅) | Playwrightで 1280px / 390px 幅でスクリーンショット | チェックボックス・「コイン」・数値入力(幅 `w-20`)・「以下を非表示」が1行に並び、モバイル幅でもはみ出さない。入力欄クリックでチェックボックスがトグルしない |

## UI(追加)

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 10 | `nickname`設定済み対戦相手の一覧表示 | Playwright(headless)で `/analytics` → バトル履歴タブ、`nicknameSnapshot`設定済みバトルを含む状態でスクリーンショット | メイン表示名が`nickname`("ライバル花子"等)、`@tiktokHandle`がグレーの小文字でサブ表示される |

## Quality Gate

`npm run typecheck` / `npm run test:unit` / `npm run test:integration`(ローカルDB)

## Out of Scope

- `src/app/(dashboard)/analytics/BattleDetailModal.tsx`(詳細モーダル)のスコア色は今回変更していない(勝敗基準の`text-brand`/`red`のまま)。一覧と詳細で色の意味が異なる状態になるが、ユーザー指示は「一覧」限定のためスコープ外
- mobile側の既定トグルOFF化(`battle_filter_store.dart`)を含む同等フィルタは別baseline(mobile側 `docs/testing/battle-history-list/baseline.md`)で管理

## 変更履歴

### 2026-09-06 進行中バトルをコイン閾値フィルタから除外 / スコア色を陣営固定に変更

- 変更1: `AnalyticsView.tsx` の `filteredBattles` で `hideLowDiamond && b.selfTotalDiamonds <= 100` に `b.status !== "live"` を追加し、進行中バトルを除外対象から外した
- 変更2: `BattleScoreLine` の色付けを勝敗/最高スコア基準(`text-brand`/`red`)から陣営固定(自陣営=red、相手陣営=blue)へ変更。`maxScore`/`win`/`lose`計算を削除
- レビュー: Qwen(risk=MEDIUM) — finding 3件(CRITICAL/MEDIUM/LOW各1)、実コード照合の結果いずれもINVALIDまたはスコープ外。CRITICAL指摘(フィルタ条件のロジック誤り)はQwenの読み違い(`b.status !== "live"`の否定条件を逆に解釈)。MEDIUM指摘(BattleDetailModalとの色不整合)は事実だが一覧限定の指示によりスコープ外。LOW指摘(冗長括弧)は実在せず
- テスト結果: PASS 6 / FAIL 0 / NOT RUN 0(typecheck含む)。UIケース#7はPlaywrightでスクリーンショット確認(進行中バトルの低コイン非表示回避、陣営固定色を実データで確認)

### 2026-09-09 対戦相手の一覧表示名がtiktokHandleになっていたバグを修正

- 症状: バトル履歴一覧の対戦相手表示名が`nickname`(TikTok表示名)ではなく`tiktokHandle`(可変@ハンドル)になっていた
- 原因: `battle-types.tsx`の`BattleOpponent`/`BattleParticipant`型と`AnalyticsView.tsx`の`BattleOpponentInfo`が、サーバーレスポンスの実フィールド名(`nickname`/`tiktokHandle`)ではなく旧フィールド名(`nickName`/`displayId`)を参照していたため、常に`undefined`となり`tiktokHandle`表示へフォールバックしていた
- 修正: `battle-types.tsx`の型定義から`displayId`を削除し`nickName`を`nickname`へリネーム。`AnalyticsView.tsx`・`BattleDetailModal.tsx`の参照箇所を実フィールド名に合わせた。検索フィルタの`displayId`検索も削除(型に存在しないフィールドだったため実質無効だった)
- レビュー: DeepSeek(LOW, high) — finding 4件のうち3件VALID(サブラベル表示条件の回帰。090450c5以前は`nickname`チェックなしで`tiktokHandle`があれば常にサブ表示していたが、修正時に誤って`nickname &&`条件を追加していた→旧仕様に合わせて`tiktokHandle`のみの条件に修正)、1件INVALID(スコープ外の指摘)
- テスト結果: `npm run typecheck` PASS。手動シード(`BattleHistoryParticipant.nicknameSnapshot`に「ライバル花子」を設定)をPlaywrightで確認し、一覧のメイン表示名が`nickname`、`@tiktokHandle`がサブラベルとして表示されることを確認(ケース#8〜#10)

### 2026-09-10 コイン閾値を配信者ごとに設定可能にし、トグル・しきい値をDBへ永続化

- 変更: 新テーブル `battle_history_filter_settings`(Streamer 1:1、`hideLowDiamondEnabled` 既定 false / `threshold` 既定 100)。`GET/PATCH /api/streamer/battle-filter-settings`(自Streamerのみ)。`AnalyticsView` に数値入力を追加し、`persistBattleFilter` prop が true(`/analytics` のみ)のときだけ設定APIを使う。管理画面はローカル状態のまま
- ケース1/4/5をしきい値可変に更新、11〜23を追加
