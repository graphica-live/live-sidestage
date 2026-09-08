---
project: live-sidestage-mobile
feature: battle-history-tab
last_updated: 2026-09-09
last_risk: LOW
last_reviewers: [Code]DeepSeek(high, finding 1件INVALID判定)(Design Modeは局所的な状態管理ロジック修正のため対象外)
---

# テストベースライン: battle-history-tab

バトル履歴タブ(`lib/screens/tabs/battle_history_tab.dart`)。analyticsの `chat:battle` 集計を読み取り専用で表示し、
日/週/月/カスタム期間の切替、しきい値トグルによる非表示、カードタップでの貢献者ボトムシート展開を持つ。
視覚仕様は `.impeccable/approved/battle-history-kosai/spec.md` を正本とする。

2026-09-08: web版の陣営別貢献欄(乱戦対応)・バトル再生機能をmobileへ移植。再生はFlutterネイティブ再現ではなく
`webview_flutter`によるWebView埋め込み(既存の公開共有ページ`/b/[token]`をそのまま表示、`lib/screens/battle_replay_webview_screen.dart`)。
貢献欄は陣営別タブ表示(`_BattleContributorsSheet`→`_TeamsContributorsView`/`_TeamTabContent`)をネイティブ実装。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-BH-001 | 2陣営バトルのスコア・勝敗表示が崩れない | `_BattleCard` / `_ScoreSegment` | UI | selfScore > opponentScore の1vs1バトル | カードが表示され、自陣スコアがグラデーション文字、勝敗バッジ「WIN」が表示される | 実機adb screencap(Pixel 7a、WiFi ADB、実データ) | PASS(2026-09-08、11-1のWINバッジで確認。LOSEバッジも別バトルで確認) | |
| TC-BH-002 | 参加人数合計>2でも1vs1と同じ基準サイズで表示され、収まらない陣営数のときだけ自動縮小する | `_ScoreSegment` / `_BattleCard.build`(`FittedBox`) | 境界 | selfCount+opponentCount>2 のバトル(2vs2等)、および3陣営以上(`teams`経由) | 2vs2はアバター40dp/スコア24dp/名前11.5dp(1vs1と同一)で表示される。1vs1vs1vs1(4陣営)はカード幅に収まらないため`FittedBox(scaleDown)`で全体が比例縮小されるが、数値は省略されずoverflowも発生しない | 実機adb screencap(Pixel 7a、一時プレビューハーネスで6パターン確認) | PASS(2026-09-06、設計変更後の6パターン再確認で全てPASS) | Artifact参照(下記URL) |
| TC-BH-003 | スコア不明時は勝敗バッジを出さない | `_OutcomeBadge` | 異常 | selfScore/opponentScore の一方または両方がnull | ステータスがlive/cutShort以外ならバッジ非表示 | 実機adb screencap(Pixel 7a) | PASS(2026-09-06、実データ opponentScore null で確認) | ロジック自体は本変更で未変更 |
| TC-BH-004 | しきい値トグルで低スコアバトルが一覧から隠れる | しきい値トグル行 | 正常 | max(selfScore, opponentScore) < しきい値のバトルが存在 | 該当バトルが一覧から消える。全件非表示なら専用文言を表示 | 実機/エミュレータ(Marionette MCP) | NOT RUN: Marionette MCP未接続。実データがしきい値(既定100)を超えており非表示条件に該当しない | ロジック自体は本変更で未変更 |
| TC-BH-005 | カードサイズが視認しやすい大きさになっている(2026-09-06サイズ改訂、アバター再拡大・最小高さ再調整込み) | `_BattleCard` 全体 | UI | 通常のバトル1件以上 | カード最小高さ148dp・padding18dp・アバター40/32dp・スコア文字24/16dp・名前11.5/10dp・勝敗バッジ12dpで表示され、旧サイズ(142dp・アバター26/19dp等)より明確に大きい。かつスコア行下からフッターまでの余白が間延びしない | 実機adb screencap(Pixel 7a)、実データで撮影 | PASS(2026-09-06、最小高さ再調整後の再撮影込みでArtifactでユーザー提示済) | 配信者フィードバック「カード全体小さい」→サイズ拡大→「アイコンまだ小さい」→アバター再拡大(32/24→40/32dp)→「空きスペース多すぎ」→最小高さ168→148dpへ縮小 |
| TC-BH-006 | カードタップで貢献者ボトムシートが開く | `_BattleContributorsSheet` | 回帰 | カードをタップ | `RankingListTile`でこのバトルの貢献者一覧が表示される | 実機adb screencap(Pixel 7a、WiFi ADB) | PASS(2026-09-08、1vs1バトルカードタップでボトムシート表示・貢献者一覧確認) | 本変更でロジック未変更 |
| TC-BH-007 | 同点(DRAW)時のバッジ表示が崩れない | `_OutcomeBadge` | 境界 | selfScore == opponentScore | 背景card・枠1dp line・文字subの「DRAW」バッジが拡大後サイズ(12dp/padding縦6横14)で表示される | 実機adb screencap(Pixel 7a、WiFi ADB、実データ) | PASS(2026-09-08、0-0・3-3のDRAWバッジで確認) | |
| TC-BH-008 | ちょうど2陣営(1vs1)は基準サイズをそのまま使う(縮小されない) | `_ScoreSegment` | 境界 | selfCount+opponentCount == 2(1vs1) | 基準サイズ(アバター40dp/スコア24dp/名前11.5dp)で表示され、`FittedBox`による縮小は発生しない(カード幅に自然に収まるため) | 実機adb screencap(Pixel 7a、一時プレビューハーネス) | PASS(2026-09-06、1vs1パターンで確認) | |
| TC-BH-009 | 短い名前・低スコアでもカード拡大後のレイアウトが崩れない | `_BattleCard` 全体 | 境界 | 表示名が短い(1〜2文字)・スコアが1桁のバトル | 最小高さ148dpは維持され、要素の重なり・はみ出しが発生しない | 実機/エミュレータ(Marionette MCP) | NOT RUN: Marionette MCP未接続。実データが該当しなかった | |
| TC-BH-010 | 3陣営以上(teams経由)のスコア行が横幅overflowしない | `_BattleCard.build`(`FittedBox`) | 境界 | teamsが3件以上(1vs1vs1、1vs1vs1vs1等) | 各陣営セグメントがカード幅に収まり、RenderFlexのoverflow(黄黒縞)が発生しない。数値・アイコンは省略されず必要なら全体が自動縮小される | 実機adb screencap(Pixel 7a、一時プレビューハーネスで6パターン確認) | FAIL→修正→PASS(2026-09-06。1vs1vs1vs1で実際にoverflow発生を確認、当初`_ScoreSegment`個別にConstrainedBox+FittedBoxでラップして修正。その後の陣営数サイズ統一(TC-BH-002参照)で個別FittedBoxを撤去し、`_BattleCard.build`がスコア行全体を`FittedBox(scaleDown)`で包む方式へ再設計、再撮影でoverflow消失を再確認) | 6パターン確認作業中に発見した回帰。3陣営(1vs1vs1)までは発生せず4陣営から顕在化する境界値バグだった |
| TC-BH-011 | `replay.available == true`のバトルだけカードに「再生」ボタンが出る | `_BattleCard`フッター行 | 正常/境界 | replay.available=true/falseの2バトル | trueのカードのみ再生アイコン+「再生」ボタンが表示され、falseのカードには出ない | 実機adb screencap(Pixel 7a、WiFi ADB、実データ) | PASS(2026-09-08、終了/中断バトルに再生ボタン表示を確認) | パースロジック自体はユニットテストでPASS |
| TC-BH-012 | 再生ボタンタップでshare URLを取得しWebView画面へ遷移する | `_openReplay` / `BattleReplayWebViewScreen` | 正常 | 再生可能バトルの「再生」ボタンをタップ | `fetchBattleReplayShareUrl`が返すURLで`BattleReplayWebViewScreen`が開き、`/b/[token]`が表示される(JavaScript有効) | 実機adb screencap(Pixel 7a、WiFi ADB) | NOT RUN: モバイルアプリは本番analytics(`https://analytics.livesidestage.com`)へハードコード接続。今回新設した`/api/mobile/analytics/battles/[battleId]/share`はworktree内のみでまだ本番未デプロイのため、実機タップではHTTP 404が返り遷移しない(TC-BH-013として観測) | JavaScript必須の理由: `PublicBattleClient.tsx`がuseState使用のClient Component |
| TC-BH-013 | share URL取得失敗時はSnackBarでエラーを表示し画面遷移しない | `_openReplay` | 異常 | `fetchBattleReplayShareUrl`が`ApiException`を投げる(ネットワーク断・404等) | SnackBarにエラーメッセージが表示され、WebView画面へは遷移しない | 実機adb screencap(Pixel 7a、WiFi ADB) | PASS(2026-09-08、share route未デプロイによる実際のHTTP 404で発生。SnackBarにエラー表示され、画面遷移しないことを確認) | TC-BH-012の未デプロイ制約が偶然この異常系を実地検証する形になった |
| TC-BH-014 | 再生ボタンの連打で二重にshare URLを発行しない | `_openReplay` / `_replayLoadingBattleId` | 境界/negative | 発行中(1回目のリクエスト未完了)に同じボタンを連打 | 2回目以降のタップは無視され、`fetchBattleReplayShareUrl`は1回しか呼ばれない | 実機/エミュレータ(Marionette MCP) | NOT RUN: 実機ではリクエストが即404で返るため連打の再現猶予が無い | `_replayLoadingBattleId`が非nullの間はボタンの`onPressed`がnullになり操作不能 |
| TC-BH-015 | 陣営が2つ以上あるバトルは貢献者シートが陣営別タブになり、自陣が先頭固定される | `_TeamsContributorsView` | 正常 | `teams`が2件以上(2陣営・3陣営) | タブバーに陣営数分のタブが並び、`isSelf`の陣営が常に先頭タブになる | `BattleTeamContributors.tryParseList`は`battle_team_contributors_test.dart`でユニット検証。実画面はMarionette MCP/実機 | NOT RUN: 実データ(実際のTikTok Liveバトル履歴)に2陣営以上のバトルが存在しなかった(全件1vs1)。パースロジックはユニットテストでPASS | |
| TC-BH-016 | `selectorMode:"individual"`の陣営タブは参加者セレクタを持ち、初期選択は`participants[0]` | `_TeamTabContent` | 正常/境界 | 相手が3陣営以上に分かれる乱戦(統合列、`participants`3件以上) | チップ列で参加者を選べ、未選択時は`participants[0]`の内訳(スコア・貢献者一覧)が表示される。選び直すと選択者の内訳に切り替わる | `battle_team_contributors_test.dart`(4陣営統合のパース)でユニット検証。実画面切替操作はMarionette MCP/実機 | NOT RUN: 実データに乱戦(3陣営以上)バトルが存在しなかった。パースはPASS | |
| TC-BH-017 | 陣営が2つ未満(または旧サーバー応答でteams自体が無い)なら従来のフラット貢献者一覧にフォールバックする | `_BattleContributorsSheetState.build` | 回帰/境界 | `teams`がnull(1陣営のみ、または`teams`キー自体が無い) | 陣営タブは表示されず、`contributors`の`RankingListTile`フラット一覧がそのまま表示される(既存挙動を維持) | 実機adb screencap(Pixel 7a、WiFi ADB、実データ) | PASS(2026-09-08、1vs1バトルの貢献者ボトムシートがタブ無しのフラット一覧で表示されることを確認) | 既存のTC-BH-006(貢献者シート表示)と同じ経路の分岐 |
| TC-BH-018 | `captureStatus`/`partialNote`/`battleScore`がある陣営・参加者はタブ内に注記として表示される | `_TeamTabContent` | 境界 | 一部欠測(`captureStatus`)や部分集計(`partialNote`)を持つ陣営 | タブ上部に「スコア: N / <captureStatus> / <partialNote>」の軽量テキストが表示される。いずれも無ければ何も表示しない | 実機/エミュレータ(Marionette MCP) | NOT RUN: 陣営別タブ自体が表示される実データ(TC-BH-015/016)が無かった | |
| TC-BH-019 | `selectorMode:"aggregate"`の陣営で参加者が2人以上(コラボ)なら「合算」+各参加者のチップセレクタが出て、個別に切り替えられる。人数が多くても常に1行に収まる | `_TeamTabContent` | 正常/境界 | 2vs2または1vs3の複数人側など、`selectorMode:"aggregate"`かつ`participants`が2件以上の陣営(名前が長い参加者を含む場合も) | チップ列に「合算」(既定選択、陣営全体の内訳、固定幅)と各参加者(表示名=nickname、「自分」表記は使わない、`Expanded`で均等縮小)が横1列に並び、折り返さない。名前が長く入りきらない参加者は`ellipsis`で省略され、はみ出さない。選び直すとその参加者単独の内訳(スコア・貢献者一覧)に切り替わる | `battle_team_contributors_test.dart`でパースはユニット検証。実画面切替操作はMarionette MCP/実機 | NOT RUN: Marionette MCP未接続(worktree内に`.mcp.json`なし)、adbもPATH未導入で実機接続不可。実データにも複数人陣営(2vs2等)のバトルが存在しなかった(TC-BH-015と同じ制約) | 修正前は`selectorMode:"aggregate"`の陣営が常に陣営合算固定で、参加者個別を見る手段が無かった。さらに旧`Wrap`実装は参加者が多い/名前が長いと2行に折り返っていたため、`Row`+`Expanded`+`ellipsis`へ変更(今回の修正対象そのもの) |
| TC-BH-020 | 陣営の参加者が1人だけ(1vs3の1人側等)ならセレクタを出さない | `_TeamTabContent` | 境界 | `participants.length <= 1`の陣営(aggregate/individual問わず) | チップ列自体が表示されず、陣営合算(=その1人)の内訳がそのまま表示される | `battle_team_contributors_test.dart`でパースはユニット検証。実画面はMarionette MCP/実機 | NOT RUN: 同上(Marionette未接続・adb未導入・該当実データなし) | |
| TC-BH-021 | 陣営タブ(`_TeamsContributorsView`)のラベルは自陣も「自分」固定文字列でなく、代表者nickname(+他N人)で表示される | `_TeamsContributorsView` | 正常/回帰 | 自陣(`isSelf:true`)に自分1人、または自分+チームメイトがいるバトル | 自陣タブのラベルが「自分」ではなく実際のnickname(例:「ゆきのじょー」、複数人なら「ゆきのじょー 他1人」)で表示される。他陣営のラベル生成ロジックと同一 | analytics側`battle-history.integration.test.ts`(自陣営2名ケース)で`displayName`が`isSelf`によらず代表者nickname(+他N人)になることを検証。実画面はMarionette MCP/実機 | NOT RUN: Marionette MCP未接続・adb未導入・該当実データなし(TC-BH-015と同じ制約) | analytics側`queryBattleContributors`の陣営`displayName`生成で`isSelf`分岐(`"自分"`固定)を撤廃した変更。web版(analytics)は2026-09-06に`participants[].displayName`側だけ同種修正済みで、陣営全体の`displayName`は今回まで「自分」固定が残っていた |

## Quality Gate

- `flutter analyze` → No issues found (2026-09-09)
- `flutter test` → 494 tests, All tests passed! (2026-09-09)

## Out of Scope

- 4陣営以上での「4スコア横並び」表示: サーバーAPIがselfScore/opponentScoreの2値しか返さないため未実装(spec.md記載のとおり、データ不在による意図的な仕様)
