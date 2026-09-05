---
risk: LOW
reviewers: [qwen]
review_summary: { findings: 2, valid: 0, fixed: 0 }
---

# バトル履歴 貢献者欄

対象: `src/app/(dashboard)/analytics/BattleDetailModal.tsx`, `src/lib/battle-history.ts`,
`src/lib/gift-analytics.ts`

## 正常

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 1 | 確定バトル(1v1)の貢献者一覧 | `npx dotenv -e .env.local.test -- vitest run src/lib/battle-history.integration.test.ts` | `aggregateGiftEventsToContributors` が `senderNicknameSnapshot` をそのまま表示名として返す |
| 2 | 確定バトル(乱戦/3陣営以上)の相手統合列 | 同上、`queryBattleContributors` の `mergeOpponents` 分岐 | `selectorMode: "individual"` の team が返り、参加者セレクタで個別表示できる |
| 3 | ライブ(未確定)バトルの貢献者一覧 | `npx dotenv -e .env.local.test -- vitest run src/lib/gift-analytics.integration.test.ts` | `aggregateGiftUsers` が `Gift.nickname` を表示名として返す |

## 境界

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 4 | `Gift.nickname` が空文字(TikTok側nickname未提供)のギフト送信者 | 手動シード(`local_test_streamer`ルームへnickname:""のGiftを作成)→ `/analytics` バトル履歴タブでモーダルを開く | `aggregateGiftUsers` の表示名が `uniqueId` にフォールバックする(空文字のまま表示されない) |
| 5 | 4のケースで `FallbackContributorList`(狭い1カラム) | 同上、実ブラウザで確認 | アバター+名前(flex-1 truncate)+💎コイン数のみを1行で表示し、`@uniqueId` の重複表示や折り返しによるレイアウト崩れが起きない |

## 異常

該当なし: 本修正はUI表示ロジックのみで、異常系(DB接続断・不正入力等)の挙動は変更していない

## 回帰

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 6 | 既存の統合テスト全体 | `npx dotenv -e .env.local.test -- vitest run src/lib/gift-analytics.integration.test.ts src/lib/battle-history.integration.test.ts src/lib/battle-history-finalize.integration.test.ts "src/app/api/mobile/analytics/battles/[battleId]/contributors/route.integration.test.ts"` | 42 tests 全て PASS |
| 7 | typecheck | `npm run typecheck` | エラーなし |

## UI

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 8 | ライブバトルモーダルの貢献者欄(5人、うち3人nickname未取得) | Playwright(headless)で `/analytics` → バトル履歴タブ → 進行中バトルをクリック | スクリーンショットで各行が1行に収まり、プロフィール名がある人物は日本語名で表示される |

## 変更履歴

### 2026-09-05 貢献者欄のnicknameフォールバック・レイアウト修正

- 変更: `gift-analytics.ts` の `aggregateGiftUsers` を `??` → `||` に変更(空文字nicknameもuniqueIdへフォールバック)。`BattleDetailModal.tsx` の `FallbackContributorList` から `@uniqueId` の重複表示を撤去し、名前を `flex-1 truncate` に変更してレイアウト崩れを解消
- レビュー: Qwen(LOW) — カナリア検証で実読み込みを確認。findingは「`??`→`||`の変更(修正の意図そのもの)」「gap-2→gap-1.5の軽微な調整」の2件、いずれもINVALID(意図した変更/影響軽微)
- テスト結果: PASS 7 / FAIL 0 / NOT RUN 0(UIケース#8含む、スクリーンショットで確認)

### 2026-09-05 ヘッダーVSマークと中央分割線のズレ修正(ユーザー指摘、同diffに追加)

- 変更: `VersusHeader` を包む `<div className="mt-2 pr-8">` から `pr-8` を撤去。日付行のみ閉じるボタン避けの `pr-8` を残す
- 原因: 縦分割線(`left-1/2`)は外側の全幅基準、下部貢献欄グリッドも全幅基準だが、ヘッダー行だけ `pr-8`(32px)で右を削っていたため、VSの中心が分割線より16px左にずれていた
- レビュー: Qwen(LOW、既存diffへの追加分として再レビュー) — カナリア検証で実読み込みを確認。findingは「pr-8除去によるスペーシング劣化の懸念」のみ、実ブラウザ確認でクローズボタンとの衝突・視覚崩れなしを確認しINVALID
- テスト結果: Playwrightでモーダル中央(240px)とVS位置(240px)の一致を目視確認。typecheck PASS
