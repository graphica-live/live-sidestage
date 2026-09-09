---
risk: LOW
reviewers: [DeepSeek]
review_summary: { findings: 1, valid: 0, fixed: 0 }
last_updated: 2026-09-09
last_risk: LOW
last_reviewers: [DeepSeek(high)]
---

# バトル履歴 貢献者欄

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

対象: `src/app/(dashboard)/analytics/BattleDetailModal.tsx`, `src/lib/battle-history.ts`,
`src/lib/battle-history-finalize.ts`, `src/components/analytics/battle-types.tsx`, `src/lib/gift-analytics.ts`,
`src/app/api/mobile/analytics/battles/[battleId]/contributors/route.ts`(mobile向けエンドポイント)

## 正常

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 1 | 確定バトル(1v1)の貢献者一覧 | `npx dotenv -e .env.local.test -- vitest run src/lib/battle-history.integration.test.ts` | `aggregateGiftEventsToContributors` が `senderNicknameSnapshot` をそのまま表示名として返す |
| 2 | 確定バトル(乱戦/3陣営以上)の相手統合列 | 同上、`queryBattleContributors` の `mergeOpponents` 分岐 | `selectorMode: "individual"` の team が返り、参加者セレクタで個別表示できる |
| 3 | ライブ(未確定)バトルの貢献者一覧 | `npx dotenv -e .env.local.test -- vitest run src/lib/gift-analytics.integration.test.ts` | `aggregateGiftUsers` が `Gift.nickname` を表示名として返す |
| 9 | 2vs2チーム戦のヘッダー(`TeamCard`)で自陣営に自分+チームメイトがいる | 手動シード(`BattleHistory`+`BattleHistoryParticipant`、teamIndex0に自分anchorId・チームメイトanchorIdの2名)→ `/analytics` バトル履歴タブ→詳細モーダル | 自分・チームメイトともに実際の配信者名(nickName/displayId)で表示され、どちらか一方だけが「自分」固定文字列にならない。両者とも同じ陣営色(赤)で表示される |
| 10 | 同上バトルの`TeamContributorColumn`セレクタボタン(陣営全体合算/個別配信者切替) | 同上シード、モーダル内の貢献者欄セレクタを確認 | セレクタの各ボタンが自分/チームメイト双方とも実名(`queryBattleContributors`の`participants[].displayName`)で表示される |
| 14 | `TeamContributorColumn`の貢献者一覧(`ExpandableContributorRow`)の頭出し表示 | 同上シードに貢献者12名以上を追加(`totalDiamonds`降順)→ Playwrightで貢献者欄を確認 | 各行の先頭が旧アイコン(展開用の三角矢印)ではなく降順の順位番号(1,2,3…)で表示される |
| 15 | 14のケースで順位が2桁(10以上)になったとき | 同上、貢献者欄を最下部までスクロールして確認 | 2桁の順位でもアバターアイコンの左端位置が1桁の行と揃ったまま(`w-4 text-right tabular-nums`の固定幅右寄せで桁数によるズレが無い) |
| 17 | mobile向けcontributors routeが確定済みバトルの陣営別内訳(`teams`)を返す(2陣営) | `npx dotenv -e .env.local.test -- vitest run "src/app/api/mobile/analytics/battles/[battleId]/contributors/route.integration.test.ts"`(手動シード`BattleHistory`+`BattleHistoryParticipant`2件、side:self/opponent) | `body.teams`が2件、`teams[0].isSelf===true`・`teams[1].isSelf===false`・`selectorMode==="aggregate"` |
| 18 | `teams===null` かつ貢献者1名以上のフォールバック表示で、自陣営リストが2列gridの左半分に収まる | `TiktokBattle`(action=OPEN, endedAt=null, startedAt=直近60秒前)+自room宛`Gift`2件をシード(`npm run seed:battle-live:local`)→ Playwrightで詳細モーダルを撮影 | 貢献者セクションが`grid-cols-2`で描画され、左列(自陣営・🪙額を含む)が中央仕切りを越えて右へはみ出さない |
| 19 | 同じフォールバック表示で相手側に「集計中…」が点滅表示される | 18と同一シード、`OpponentPendingPlaceholder`(`BattleDetailModal.tsx`)を実ブラウザで確認 | 右列に`集計中…`が`animate-pulse`付きで表示される |

## 境界

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 4 | `Gift.nickname` が空文字(TikTok側nickname未提供)のギフト送信者 | 手動シード(`local_test_streamer`ルームへnickname:""のGiftを作成)→ `/analytics` バトル履歴タブでモーダルを開く | `aggregateGiftUsers` の表示名が `uniqueId` にフォールバックする(空文字のまま表示されない) |
| 5 | 4のケースで `FallbackContributorList`(狭い1カラム) | 同上、実ブラウザで確認 | アバター+名前(flex-1 truncate)+💎コイン数のみを1行で表示し、`@uniqueId` の重複表示や折り返しによるレイアウト崩れが起きない |
| 11 | 絵文字混在・長い配信者名(例:「Nana☺️🐾ファンダム最強伝説」「けん玉最弱王2nd配信中〜今日も練習配信するよ〜」)の`TeamCard`ラベルおよび`TeamContributorColumn`セレクタボタン群(「合算」+参加者ごとのボタン) | 手動シード+Playwright(390px/900px両方の幅で確認) | `TeamCard`ラベルは改行されず`truncate`で1行省略表示される。`TeamContributorColumn`のセレクタボタン群は名前の長さ・ボタン数に関わらず常に1段で表示され(折り返さない)、親幅に収まらない場合は各ボタンが均等に縮小し`truncate`で省略される(ボタンが枠外にはみ出さない)。左右の貢献者パネルの高さ・対称性が崩れない |
| 20 | 貢献者0件(境界)のフォールバック表示は2列gridにしない | 貢献者0件・`teams===null`のバトルで詳細モーダルを開く | 「バトル区間を確定できないため集計できません」/「このバトルへの貢献者なし」のいずれかが表示され、grid化・「集計中…」の表示は起きない |
| 21 | 進行中(`status==="live"`)バトルで自陣営がリードしている詳細モーダル | 手動シード(`npm run seed:battle-live:local`、自450/相手300)→ `/analytics` バトル履歴タブ→進行中バトルの詳細 | `WIN`バッジ・勝敗色ハイライトが表示されない(未決着のため) |
| 22 | 21と同じバトルが`finished`で確定しスコアが変わらないまま再取得 | 手動シードデータの`status`を`finished`相当に見立てて確認(既存の確定済みバトルで代替確認) | `WIN`バッジが表示される(決着後は通常どおり勝敗表示) |

## 異常

該当なし: 本修正はUI表示ロジックのみで、異常系(DB接続断・不正入力等)の挙動は変更していない

## 回帰

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 6 | 既存の統合テスト全体 | `npx dotenv -e .env.local.test -- vitest run src/lib/gift-analytics.integration.test.ts src/lib/battle-history.integration.test.ts src/lib/battle-history-finalize.integration.test.ts "src/app/api/mobile/analytics/battles/[battleId]/contributors/route.integration.test.ts"` | 42 tests 全て PASS |
| 7 | typecheck | `npm run typecheck` | エラーなし |
| 12 | `src/lib/battle-history.test.ts`(単体) | `npx vitest run src/lib/battle-history.test.ts` | 43 tests 全て PASS |
| 16 | mobile向けcontributors route: 未確定バトルは`teams:null`のまま(既存挙動を維持) | `npx dotenv -e .env.local.test -- vitest run "src/app/api/mobile/analytics/battles/[battleId]/contributors/route.integration.test.ts"` | `GET`の応答が`{contributors, status, teams:null}` |

## UI

| # | ケース | 実行方法 | 期待結果 |
| - | --- | --- | --- |
| 8 | ライブバトルモーダルの貢献者欄(5人、うち3人nickname未取得) | Playwright(headless)で `/analytics` → バトル履歴タブ → 進行中バトルをクリック | スクリーンショットで各行が1行に収まり、プロフィール名がある人物は日本語名で表示される |
| 13 | 2vs2チーム戦の詳細モーダル(`TeamCard`ヘッダー+`TeamContributorColumn`セレクタ+貢献者順位) | Playwright(headless、390px/900px)で `/analytics` → バトル履歴タブ → 該当バトルの詳細を開く | ケース9・10・11・14・15を実ブラウザで確認。自分/チームメイトとも実名・同色で表示され、セレクタボタン群は常に1段で名前の長さに関わらず段数が変わらず、貢献者順位も桁数に関わらずアイコン位置が揃う |

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

### 2026-09-06 自陣営2名時の「自分」誤表示・セレクタ改行・貢献者頭出しの修正

- 症状: 2vs2等チーム戦で自陣営に2名以上いる場合、チームメイトも「自分」と表示される(`TeamCard`は`team.isSelf`=陣営全体フラグで判定していたため)。加えて`TeamContributorColumn`のセレクタボタンが長い配信者名(絵文字混在)で改行し、左右の貢献者パネルの対称性が崩れる
- 調査の過程で発覚した第二の同種バグ: 確定済みスナップショット側(`queryBattleContributors`の参加者別セレクタ表示名)も陣営全体の`isSelf`(`index===0`)で「自分」判定しており、同じ誤表示がセレクタボタン側にも存在した
- ユーザーからの追加フィードバック(実装後): 「自分」という固定文字列自体をやめて自分の実プロフィール名を表示し、色もチームメイトと同じ(陣営色)にしたい。加えて貢献者一覧の頭出し(展開用の三角矢印アイコン)を降順の順位番号に変えたいが、2桁になったときにアバターの左右位置が1桁の行とずれないようにしたい、との指示を受け実装
- 最終的な変更:
  - `BattleDetailModal.tsx`の`TeamCard`: 参加者ラベルを`isSelf`分岐なしで常に実プロフィール名(nickName/@displayId/tiktokId)にし、文字色も自分/チームメイト問わず陣営色(`color`)を適用(自分だけ無色にしていた分岐を撤去)
  - `src/lib/battle-history.ts`の`queryBattleContributors`: セレクタボタンの`participants[].displayName`を常に`displayNameOf(p)`(実プロフィール名)にし、「自分」への差し替え分岐を撤去
  - `TeamContributorColumn`のセレクタボタンに`shrink-0`/`block`を追加(flex-wrapコンテナ内でのtruncate不発を解消、絵文字混在の長い名前でも改行しない)
  - `ExpandableContributorRow`: 先頭の展開矢印svgを`rank`(1始まりの表示順位)に置き換え。`w-4 text-right tabular-nums`の固定幅右寄せにすることで、桁数が変わってもアバターの左端位置が揃うようにした
  - 上記に伴い、当初`BattleParticipant`(`battle-history.ts`/`battle-types.tsx`)へ追加した参加者個別の`isSelf: boolean`はUI側の分岐が全て無くなり不要になったため撤去(データ層に不要なフィールドを残さない)。`battle-history-finalize.ts`の確定処理が`BattleHistoryParticipant.isSelf`を`faction.index===0`(陣営全体)ではなく`anchorId === selfHostUserId`で保存するよう修正した部分のみ残した(この列自体は表示に使っていないが、スキーマのコメントが「正はこちら」と明記する正規の参加者単位フラグであり、誤った値のまま確定保存を続ける理由がないため)
- レビュー: OmniRoute(`ext-agent.mjs`)/Qwen(`qwen-review.ps1`)とも利用不能・不安定(OmniRoute未設定、Qwenはカナリア検証で機能不全と判明)だったため、Claude自身が実コード照合で代替。`isSelf`削除後に参照が残っていないか(`grep isSelf`)、`selfHostUserId`のクロージャ一貫性、ライブ/確定済み両コードパスへの反映、rank採番のズレ(0始まり/1始まり)を確認
- テスト結果: `npm run typecheck` PASS。`npx vitest run src/lib/battle-history.test.ts` 43 tests PASS。`npx dotenv -e .env.local.test -- vitest run src/lib/battle-history.integration.test.ts src/lib/battle-history-finalize.integration.test.ts` 32 tests PASS。手動シード(`BattleHistory`+`BattleHistoryParticipant`、teamIndex0に自分+チームメイト、teamIndex1に絵文字名含む相手2名、貢献者14名)を作成し、Playwright(headless、390px/900px)で詳細モーダルを開き、ケース9・10・11・14・15を実画面で確認(PASS)。pre-commit全体実行時に`tiktok-room-cleanup.integration.test.ts`が3件FAILすることがあるが、単体実行では14 tests全PASSであり既知のクロスファイル干渉(auto-memory `analytics-vitest-cross-file-interference`)で本diffと無関係と確認

### 2026-09-06 セレクタボタン群の段数可変を修正(commit後の追加フィードバック)

- 症状: 上記commit後、ユーザーからスクリーンショット指摘。`TeamContributorColumn`のセレクタボタン群が親div`flex flex-wrap`のため、ボタン合計幅が親幅を超えると2段目へ折り返っており、名前の長さ・ボタン数次第で1段/2段が入れ替わっていた(前回のshrink-0対策は「1個のボタン内の文字が折り返る」問題のみを解消しており、この「ボタン塊単位の折り返し」は未対策のままだった)
- 最初の対策案(`flex-nowrap`+固定幅+`overflow-x-auto`)を試したところ、390px幅でボタンが3個以上あると枠外にはみ出て見切れる(横スクロールでは見えるが視覚的に非対称に見える)ことが判明し、ユーザーからのフィードバックで「スケールダウン」方式(固定幅でなく親幅に収まるよう均等縮小)を採用
- 最終的な変更: `TeamContributorColumn`のセレクタ親divを`flex flex-wrap`→`flex flex-nowrap`(折り返し禁止)。「陣営全体合算」ボタンを「合算」に短縮しテキスト量を削減。全ボタンのclassNameを固定幅(`max-w-[100px] shrink-0`)から`min-w-0 max-w-[Npx] flex-1 truncate`(親幅に応じて均等に縮小し、上限を超えて間延びしない可変幅)に変更
- レビュー: OmniRoute/DeepSeek/Qwenとも利用不能・不安定(既知)のため、Claude自身が実コード照合で代替。flex-1縮小とtruncateの両立に必要な`min-w-0`が両方のボタンに付与されているか、選択中/非選択のstyle上書き(borderColor/color)がclassName変更で壊れていないかを確認
- テスト結果: `npm run typecheck` PASS。Playwright(headless、390px/900px)で再確認し、両幅とも常に1段で全ボタンが枠内に収まり、名前の長さに関わらず段数が変わらないことを確認(PASS)

### 2026-09-08 mobile向けcontributors routeへteams対応を追加(web版の陣営別貢献欄移植)

- 変更: `src/app/api/mobile/analytics/battles/[battleId]/contributors/route.ts`が`queryBattleContributors()`の`teams`を握り潰していたのを修正。`sanitizeAvatarUrl`を`teams[].contributors`/`teams[].participants[].contributors`へ再帰適用してレスポンスへ含めるようにした
- レビュー: Codex(low, Design)+DeepSeek(high, Design)+Codex(medium, user-requested)+Gemini(agy/gemini-3.7-flash-medium, user-requested, NO ISSUES)。「複数アプリを跨ぐ変更」でHIGH判定
- テスト結果: `npm run typecheck` PASS。`npx dotenv -e .env.local.test -- vitest run "src/app/api/mobile/analytics/battles/[battleId]/contributors/route.integration.test.ts"` 11 tests PASS(新規「確定済みバトルはteams(陣営別)を返す」ケース含む)。既存の`gift-analytics`/`battle-history`/`battle-history-finalize`integrationテスト55 tests回帰PASS

### 2026-09-09 進行中バトルのWINバッジ誤表示を修正

- 症状: バトル履歴詳細モーダルで、進行中(`status==="live"`)のバトルでも片方が暫定的にリードした時点で`WIN`バッジ・勝敗色ハイライトが表示されていた(まだ決着していないのに)
- 原因: `BattleDetailModal.tsx`の`winningIndex`(`resolveWinningTeamIndex`呼び出し)と`win`/`lose`(`FallbackVersusHeader`用)が`battle.status`を見ずにスコアの大小だけで判定していた。mobile版(`battle_history_tab.dart`の`_OutcomeBadge`)は`status===live`を先にチェックする実装済みで、Web側だけ未対策だった
- 修正: `isDecided = battle.status !== "live"`を追加し、`bothScores`・`winningIndex`の算出に組み込んだ(`resolveWinningTeamIndex`自体は変更なし、呼び出し側でガード)
- レビュー: DeepSeek(LOW, high) — finding 1件(「`!== "live"`の否定条件が将来の未知status値に対して脆弱」)。`BattleStatus`型は`"live" | "finished" | "cut_short" | "unknown"`の4値で閉じておりfindingが懸念する未知値は型上発生しないため INVALID
- テスト結果: `npm run typecheck` PASS。手動シード(`seed:battle-live:local`、自450/相手300、進行中)をPlaywrightで確認し`WIN`バッジ0件、既存の確定済みバトルで`WIN`バッジ1件(回帰なし)を確認
