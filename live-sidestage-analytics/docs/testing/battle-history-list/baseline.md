---
risk: LOW
reviewers: [DeepSeek]
review_summary: { findings: 4, valid: 3, fixed: 3 }
last_updated: 2026-09-09
last_risk: LOW
last_reviewers: [DeepSeek(high)]
---

# バトル履歴一覧(web)

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

対象: `src/components/analytics/AnalyticsView.tsx`(コイン閾値非表示フィルタ)、
`src/components/analytics/battle-types.tsx`(`BattleScoreLine`)

## 正常

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 1 | 「コイン100以下を非表示」ON時、しきい値未満の終了済みバトル | Playwright(headless)で `/analytics` → バトル履歴タブ | 一覧に表示されない(件数から除外される) |
| 2 | スコア文字色(2陣営) | 同上 | 自陣営スコアは赤(`text-red-600 dark:text-red-400`)、相手陣営スコアは青(`text-blue-600 dark:text-blue-400`)。勝敗に関係なく固定 |
| 3 | スコア文字色(3陣営以上、`battle.teams`分岐) | 同上、乱戦バトルで確認 | `isSelf`陣営が赤、それ以外が青。最高スコア陣営でも色は変わらない |

## 境界

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 4 | 「コイン100以下を非表示」ON時、しきい値未満の**進行中**バトル(`status==="live"`) | Playwrightで `local_test_streamer` に低コイン(自40/相手30)の進行中バトルをシードして確認 | 一覧から除外されない(進行中バトルはコイン閾値フィルタの対象外) |
| 5 | 進行中と判定される猶予(`LIVE_GRACE_MS`=5分)を過ぎ`status`が`unknown`になったバトル | 同上、シードから5分以上経過後に再取得 | `status!=="live"`になるため通常どおりコイン閾値フィルタの対象(想定どおりの既存仕様、今回の変更範囲外) |
| 8 | 対戦相手に`nickname`(TikTok表示名)が設定されているバトル | 手動シード(`BattleHistoryParticipant.nicknameSnapshot`に日本語名を設定)→ `/analytics` バトル履歴タブ | 一覧のメイン表示名が`nickname`になり、`@tiktokHandle`はサブラベルとして併記される(`tiktokHandle`がメイン表示名にならない) |
| 9 | 対戦相手に`nickname`が無い(null)バトル | 既存の確定済みバトル(`nicknameSnapshot: null`)で確認 | メイン表示名が`@tiktokHandle`にフォールバックする(サブラベルは重複表示しない) |

## 異常

該当なし: 本修正はフィルタ条件と表示色のみで、異常系(DB接続断・不正入力等)の挙動は変更していない

## 回帰

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 6 | typecheck | `npm run typecheck` | エラーなし |

## UI

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 7 | バトル履歴タブ全体の表示(進行中1件+終了1件、フィルタON/OFF) | Playwright(headless)で `/analytics` → バトル履歴タブ、チェックボックスON/OFF両方でスクリーンショット | フィルタON時も進行中バトルは表示され続け、スコア色が陣営固定(自=赤/相手=青)で一貫している |

## UI(追加)

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 10 | `nickname`設定済み対戦相手の一覧表示 | Playwright(headless)で `/analytics` → バトル履歴タブ、`nicknameSnapshot`設定済みバトルを含む状態でスクリーンショット | メイン表示名が`nickname`("ライバル花子"等)、`@tiktokHandle`がグレーの小文字でサブ表示される |

## Out of Scope

- `src/app/(dashboard)/analytics/BattleDetailModal.tsx`(詳細モーダル)のスコア色は今回変更していない(勝敗基準の`text-brand`/`red`のまま)。一覧と詳細で色の意味が異なる状態になるが、ユーザー指示は「一覧」限定のためスコープ外
- mobile側の同等フィルタ修正(`live-sidestage-mobile`)は別baseline(mobile側 `docs/testing/battle-history-list/baseline.md`)で管理

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
