# 貢献タブ: 大規模room(約1900人)での重い/固まる不具合 修正計画(再設計版)

## 目的

live-sidestage-mobile の貢献タブ(`ContributionTab`)で、ランキング人数が多いroom(実機で約1900人規模)を
表示すると Pixel 7a で操作不能に近いレベルまで重くなる不具合を解消する。人数が少ないroom(約240人)では
問題が出ないことを維持しつつ、大規模roomでもスクロール・タップが実用的な速度で動く状態を最終形とする。

**これは旧plan(`ListPanel.builder` + `shrinkWrap: true` の `ListView.builder`)の再設計版である。**
旧planは実装前のdesign-review(Gemini, Design Mode)で **CRITICAL** finding を受け、実コード照合の上で
VALID と確定した。理由は「本セクション: 何が問題だったか」を参照。本ドキュメントは旧planを破棄し、
真に画面外の行をbuildしない設計へ作り直したものである。

## 何が問題だったか(旧planの欠陥、確定事項)

旧Batch01は`ListPanel`に`ListPanel.builder({itemCount, itemBuilder})`という新コンストラクタを追加し、
内部で
```dart
ListView.builder(shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), itemCount: ..., itemBuilder: ...)
```
を使う設計だった。`shrinkWrap: true`を指定した`ListView`(`ListView.builder`含む)は、**自身の高さを
確定するために全childrenのレイアウトが必須**になる(Flutter公式ドキュメントに明記された既知の制約)。
つまり`itemBuilder`は結局約1900件全件に対して呼ばれ、`Image.network`を含む全行が即座に構築される。
これは修正前と同じ「全件同時構築」であり、今回のバグ(固まる不具合)は一切解消されない。設計そのものが
目的を達成できていなかった。

この欠陥はGeminiのfindingとして提出され、`shrinkWrap`の実際の挙動をFlutter SDKソース
(`C:\src\flutter\packages\flutter\lib\src\widgets\decorated_sliver.dart`等の周辺調査、および
`shrinkWrap`の公式挙動)と突き合わせて確認し、VALIDと確定した。

## Mode

`Bug`

## Research Strategy

`A: Planner単独`

理由: 対象コンポーネント(`ContributionTab` / `RankingListTile` / `ListPanel` / `RankingSyncStore`)は
旧planの調査で既に特定済み。今回の再設計に必要だったのは、(1) 旧設計がなぜ機能しないかの実コード確認
(`shrinkWrap`の挙動)と、(2) 真の仮想化を実現する代替手段の技術検証(`DecoratedSliver`の実際の動作を
Flutter SDKソース`decorated_sliver.dart`で確認)のみで、いずれもGrep数回+SDKソースの直接確認で完結した。
外部委譲・並列調査に明確な利益はなかった。

## 現状

`ContributionTab.build()`(`live-sidestage-mobile/lib/screens/tabs/contribution_tab.dart:356-465`)は
画面全体を1つの`ListView`(非builder)で組んでおり、ランキング行(448-461行目)は以下のように**for文で
全件のWidgetを即座に構築**して`ListPanel`へ渡している。

```dart
if (users.isNotEmpty)
  ListPanel(
    children: [
      for (var i = 0; i < users.length; i++)
        RankingListTile(
          key: ValueKey('${users[i].tiktokUid}_${_rangeSignature()}'),
          rank: i + 1,
          entry: users[i],
          fetchBreakdown: _fetchBreakdown,
        ),
    ],
  ),
```

`ListPanel`(`lib/screens/widgets/list_panel.dart:12-47`)は`Container`(margin/padding/decoration: 白カード
+角丸18+`kosaiPanelShadow`)の中で`children`を丸ごと`Column`に展開するだけで、仮想化を一切行わない。
users.length件(約1900件)ぶんの`RankingListTile`が画面外の分も含めて全部同時にbuild/layout/paintされ、
各行が`UserAvatar`経由で`Image.network`を持つため約1900枚の画像リクエストが同時に発火する。

push駆動リアルタイム同期(`RankingSyncStore`)がギフト受信のたびに`notifyListeners()`を呼び、
`context.watch<RankingSyncStore>()`(374行目)経由で`ContributionTab.build()`全体が再実行されるため、
1900件では毎回のギフト受信ごとにこの全件構築コストがのしかかる。

「サーバーが混み合っているか、一時的に応答できない状態です」という表示は、UIスレッドが大量Widget構築で
ブロックされている状況下でのタイムアウト判定遅延の**症状の一つ**であり、別原因ではない(旧plan調査で確定
済み、本再設計でも変更なし)。

## 調査結果

旧planの調査結果(`ContributionTab`/`RankingSyncStore`/サーバー側`aggregateGiftUsers`にボトルネックが
無いこと、`gift_history_tab.dart`が同一パターンの潜在バグを持つこと、`battle_history_tab.dart`は対象外
とすること)は本再設計でも変更なく有効。今回追加で確認した事実のみ以下に記す。

- **`DecoratedSliver`(Flutter SDK標準ウィジェット、`package:flutter/widgets.dart`)** を
  `C:\src\flutter\packages\flutter\lib\src\widgets\decorated_sliver.dart`で直接確認した。
  「sliverの実際のペイント範囲(`SliverGeometry`)に対してのみDecorationを描画し、childのsliverを
  レイアウトする責務はchild自身(例: `SliverList`)に委譲する」という設計であるため、**中に置く
  `SliverList.builder`の遅延構築(仮想化)を一切妨げない**。かつ描画されるDecorationの矩形はスクロール
  位置に関わらずsliver全体のscrollExtent基準(スクロールしても角丸が途中で現れたりしない)。
  1900件全件のレイアウトを要求する`shrinkWrap`とは根本的に異なる、Flutter公式が提供する
  「複数の遅延構築アイテムをまとめて1枚のカードとして装飾する」ための標準解法である
- 対象Flutter SDK: `Flutter 3.47.0`(`flutter --version`で確認)。`DecoratedSliver`はFlutter 3.10で追加
  済みのため、このプロジェクトのSDKバージョンで問題なく利用できる
- `contribution_tab.dart`のヘッダー部分(タイトル・サブタイトル・`PeriodSelectorBar`・シェアボタン・
  エラーバナー・ローディング表示・合計金額カード・ラベル・空状態通知、356-447行目)は**`users.length`に
  依存しないコストの一定な部分**であり、`ListPanel`のカード装飾の対象にもなっていない(独立した
  `Padding`/`Widget`の列)。よって仮想化のためにヘッダー自体を行単位へ分解する必要は無く、丸ごと
  1個の`SliverToBoxAdapter`に入れるだけで済む
- `gift_history_tab.dart`(280-397行目)も同型の構造(ヘッダー部分は件数非依存、`ListPanel(children:
  [...])`部分だけが全件Widget化、行にkeyは使っていない)であることを再確認した
- `RankingListTile`は`StatefulWidget`で、タップ時にギフト内訳パネルを展開してサイズが変わる。この
  「lazy-listの1アイテムが自身の高さを動的に変える」挙動は`tts_tab.dart`等の既存`ListView.builder`
  採用箇所と同種であり、Sliverへ切り替えても新規の技術リスクにはならない

## Root Cause

**確定(HIGH confidence、旧planから変更なし)**: `ContributionTab`が仮想化されていない`ListView`+
`ListPanel`(内部`Column`)でランキング全件のWidget(画像読み込みを含む)を画面外の分まで一括構築して
いることが直接の原因。push駆動同期による再構築頻度の増加が、この既存の弱点を悪化させている。

「サーバーが混み合っている」表示は上記の副次症状であり、別原因ではない。

## Invariants

- ランキングの正データはサーバー集計のみ(端末側で数字を積まない)という既存方針を変更しない
- `RankingSyncStore`のpush同期契約(`acknowledgeResync` / `needsResync` / snapshot反映条件)は変更しない
- 期間切替で行が再マウントされる`key`設計(`_rangeSignature()`)を維持する
- `ListPanel`の視覚的契約(白カード+角丸18+シャドウ+行間1dp区切り線、`list_panel.dart`冒頭コメント)を
  ピクセル単位で維持する。今回の再設計(`DecoratedSliver`)は「実際に構築される行数」を変えるだけで、
  カードの見た目そのものの表現方法(色/角丸/シャドウ/区切り線)は変更しない設計を採るため、旧planと
  異なり視覚差分が生じる懸念は無い(ただし後述「リスク概要」の実機確認は必須)
- 既存の`ListPanel(children: [...])`呼び出し(`gift_history_tab.dart`(Batch03対象を除く)/
  `battle_history_tab.dart` / `settings_tab.dart`)は無変更のまま動作させる。既存`ListPanel`クラス自体は
  一切変更しない(新規クラス`ListPanelSliver`を追加するだけの非破壊的変更)

## Implementation Standards

`DecoratedSliver`はFlutter SDK公式が提供する標準ウィジェットであり(`package:flutter/widgets.dart`,
Flutter 3.10+)、「複数の遅延構築アイテム(sliver)をまとめて1つの装飾(背景色/角丸/シャドウ)で包む」
というまさに本要件に対する公式解法である。新しい抽象化・外部パッケージの導入は行わない。
`SliverList.builder`(`SliverChildBuilderDelegate`)によるリスト仮想化も、旧plan同様
Flutter公式が大量アイテムの標準解法として推奨するパターンであり、本コードベースの`tts_tab.dart` /
`sound_tab.dart` / `gift_sound_edit_screen.dart`と技術的系譜は同じ(box版の`ListView.builder`から
sliver版の`SliverList.builder`への一般化)。`implementation-standards` Skillは不要と判断した
(標準ウィジェットの組み合わせであり、独自実装・wrapper層の追加ではない)。

## Schema Change

`none` — DB/API/永続化への変更は無い。モバイル側のWidgetツリー構築方式のみを変更する。

## リスク概要

全体Risk: **MEDIUM**。DB/API/認証/課金には触れず、影響範囲はFlutterモバイルアプリのUI描画方式のみに
限定される。`git revert`で即座に戻せる。ただし以下2点は必ず実機で確認すること。

1. `CustomScrollView`+`RefreshIndicator`の組み合わせでpull-to-refreshが従来通り動くこと(標準的な
   組み合わせだが、`ListView`から`CustomScrollView`への変更は本アプリ初適用のため確認必須)
2. `ListPanelSliver`のカード装飾(角丸/シャドウ/区切り線/余白)が旧`ListPanel`と完全に同一に見えること
   (`DecoratedSliver`はレイアウト機構としては異なるため、ピクセル単位の見た目一致は理屈上の設計だけで
   なく実機/実画面で確認する)

## 実装Batch

### Batch 01: `ListPanelSliver`(真の仮想化対応)を新規追加

Risk: MEDIUM
Worker: worker-normal
Depends on: None
Parallel: No(Batch02/03の前提)

#### 目的

`DecoratedSliver` + `SliverList.builder`により、旧`ListPanel`と同一の視覚(白カード+角丸18+
`kosaiPanelShadow`+行間1dp区切り線+余白)を保ったまま、画面外の行を実際にbuildしない新規sliverウィジェット
を追加する。既存`ListPanel`クラスは一切変更しない(完全に別クラスとして追加する非破壊的変更)。

#### 対象

- `live-sidestage-mobile/lib/screens/widgets/list_panel.dart`

#### 実装内容

1. 同ファイルに新規クラス`ListPanelSliver`を追加する。**`ListPanel`とは別クラス**とする(同一クラスの
   別コンストラクタにすると、呼び出し側がbox文脈/sliver文脈のどちらに置くべきか型で区別できず誤用の
   リスクがあるため、意図的に分離する)。

   ```dart
   /// 光彩(Kosai)の一覧パネルの sliver 版。[ListPanel] と同一の視覚(白カード+角丸18+
   /// シャドウ+行間1dp区切り線)を保ちながら、`CustomScrollView` の `slivers` 直下に置くことで
   /// 画面外の行を実際に build しない(真の仮想化)。件数が多い一覧(貢献ランキング等)専用。
   /// 件数が少ない一覧は従来通り [ListPanel] を使う。
   class ListPanelSliver extends StatelessWidget {
     const ListPanelSliver({
       super.key,
       required this.itemCount,
       required this.itemBuilder,
       this.margin = const EdgeInsets.fromLTRB(16, 4, 16, 4),
       this.horizontalPadding = 14,
     });

     final int itemCount;
     final Widget Function(BuildContext context, int index) itemBuilder;
     final EdgeInsetsGeometry margin;
     final double horizontalPadding;

     @override
     Widget build(BuildContext context) {
       final divider = kosaiRowDividerColor(context);
       return SliverPadding(
         padding: margin,
         sliver: DecoratedSliver(
           decoration: BoxDecoration(
             color: kosaiCardColor(context),
             borderRadius: BorderRadius.circular(18),
             boxShadow: kosaiPanelShadow,
           ),
           sliver: SliverPadding(
             padding: EdgeInsets.symmetric(horizontal: horizontalPadding),
             sliver: SliverList(
               delegate: SliverChildBuilderDelegate(
                 (context, i) => Column(
                   mainAxisSize: MainAxisSize.min,
                   children: [
                     if (i > 0) Divider(height: 1, thickness: 1, color: divider),
                     itemBuilder(context, i),
                   ],
                 ),
                 childCount: itemCount,
               ),
             ),
           ),
         ),
       );
     }
   }
   ```

   `mainAxisSize: MainAxisSize.min`を忘れないこと(sliver子要素は高さ無限の制約を受けるため、既定の
   `MainAxisSize.max`だとレイアウトエラーになる)。
2. `ListPanel`(既存クラス)は一切変更しない。`kosaiCardColor` / `kosaiRowDividerColor` /
   `kosaiPanelShadow`(`gradient_kit.dart`)は両クラスから共通で参照するだけで、これらの関数・定数自体も
   変更しない。

#### Invariants / 注意事項

- `margin` / `horizontalPadding`の既定値を`ListPanel`と完全に一致させる(`EdgeInsets.fromLTRB(16, 4, 16,
  4)` / `14`)
- 区切り線の色(`kosaiRowDividerColor(context)`)・太さ・位置(`i > 0`の時だけ行の上に挿入)を`ListPanel`と
  同一にする
- `DecoratedSliver`の`sliver:`引数に渡す`SliverList`は`SliverChildBuilderDelegate`を使い、
  `SliverChildListDelegate`(全件即時構築)を使わないこと。ここを誤ると旧plan(`shrinkWrap`)と同じ
  「全件構築」の欠陥を再導入することになるため、コードレビューで明示的に確認する
- 既存3ファイル(`gift_history_tab.dart`のBatch03対象外部分 / `battle_history_tab.dart` /
  `settings_tab.dart`)の`ListPanel(children: [...])`呼び出しには一切触れない

#### 完了条件

- `ListPanelSliver`が`ListPanel`と同じ見た目(角丸・シャドウ・区切り線・余白)を出す
- 既存`ListPanel`呼び出し3ファイルに差分が無い(`git diff`で確認)

#### 検証方法

- `flutter analyze`
- `flutter test`(既存widgetテストがあれば実行)
- Batch02の実機確認と合わせて視覚差分を確認(`ListPanelSliver`単独では画面に出ないため)

---

### Batch 02: `ContributionTab`を`CustomScrollView`+`ListPanelSliver`へ切替

Risk: MEDIUM
Worker: worker-normal
Depends on: Batch 01
Parallel: No

#### 目的

貢献タブのランキング行を`ListPanelSliver`で描画し、大規模room(約1900人)でも画面外の行・画像リクエストを
一切発生させない状態にする。これが今回のPixel 7a固まる不具合の直接修正。

#### 対象

- `live-sidestage-mobile/lib/screens/tabs/contribution_tab.dart`(`build()`メソッド全体、356-465行目)

#### 実装内容

1. `build()`内の`RefreshIndicator(child: ListView(physics: ..., children: [...]))`を
   `RefreshIndicator(child: CustomScrollView(physics: ..., slivers: [...]))`へ置き換える。
2. 現状`children:`に列挙されているヘッダー系Widget群(タイトル`Padding`、サブタイトル`Padding`、
   `PeriodSelectorBar`、シェアボタンの`Padding`、`if (_error != null) AnalyticsErrorBanner`、
   `if (_loading && result == null) ...スピナー`、`if (result != null) ...合計金額カード`、
   `if (result != null) ...ラベル`、`if (!_loading && result != null && users.isEmpty)
   EmptyListNotice`)は、**個々を分解せず丸ごと** 1個の`SliverToBoxAdapter(child: Column(children:
   [...]))`にまとめる(これらは`users.length`に依存しないコストの一定な部分で、`ListPanel`のカード
   装飾の対象でもないため、分解の必要が無い)。
3. 末尾の
   ```dart
   if (users.isNotEmpty)
     ListPanel(
       children: [
         for (var i = 0; i < users.length; i++)
           RankingListTile(key: ValueKey(...), rank: i + 1, entry: users[i], fetchBreakdown: _fetchBreakdown),
       ],
     ),
   ```
   を、`slivers:`配列の2番目の要素として
   ```dart
   if (users.isNotEmpty)
     ListPanelSliver(
       itemCount: users.length,
       itemBuilder: (context, i) => RankingListTile(
         key: ValueKey('${users[i].tiktokUid}_${_rangeSignature()}'),
         rank: i + 1,
         entry: users[i],
         fetchBreakdown: _fetchBreakdown,
       ),
     ),
   ```
   へ置き換える。`key`の生成ロジック(`_rangeSignature()`込み)は変更しない。
4. 他の変更は行わない(`RankingSyncStore`購読・`_load()`・期間切替ロジックはそのまま)。

#### Invariants / 注意事項

- `key`は既存と完全に同じ値を生成すること(期間切替時の内訳リセット動作を壊さない)
- `_fetchBreakdown`の受け渡し方法(関数そのものを渡す)を変えない
- `CustomScrollView`の`physics:`には元の`ListView`と同じ`AlwaysScrollableScrollPhysics()`を指定し、
  pull-to-refreshが機能する状態を維持する
- ヘッダーの`SliverToBoxAdapter`と`ListPanelSliver`の間で、既存の縦方向の余白(`Padding`の値)が変わらない
  ことを確認する(`CustomScrollView`のslivers間には`ListView`のchildren間と違って自動の余白は無いため、
  既存`Padding`をそのままヘッダーColumnの中に残せば同一になるはずだが、実機で確認する)

#### 完了条件

- 約1900件のランキングでもスクロールが可能な速度で動く(実機確認)
- 約240件の既存roomで見た目・動作に変化が無い(実機確認)
- pull-to-refreshが従来通り動作する

#### 検証方法

- `flutter analyze` / `flutter test`
- 実機(Pixel 7a)で人数の多いroom・少ないroomの両方を表示し、スクロール・タップ・行展開(ギフト内訳)・
  pull-to-refreshがスムーズに動くことを確認する
- 可能であればiPhone実機/シミュレータでも同様に確認する
- `test-auto`のUIスクリーンショット工程で、変更前後の見た目差分(角丸・シャドウ・区切り線・行間・余白)が
  無いことを確認する

---

### Batch 03: `gift_history_tab.dart`への同種修正の横展開(推奨・同一原因の潜在バグ)

Risk: MEDIUM
Worker: worker-normal
Depends on: Batch 01
Parallel: Yes(Batch02と並列可能。ただしBatch01完了後。`contribution_tab.dart`と
`gift_history_tab.dart`は別ファイルのため競合しない)

#### 目的

調査で判明した同一パターンの潜在バグ(`gift_history_tab.dart`が個々のギフト受信イベントを全件
非仮想化で描画している)を、Batch01で用意した`ListPanelSliver`で解消する。今回明示的に報告された症状
ではないが、大規模roomでは貢献タブと同様に固まる可能性が高く、同じ部品を使い回すだけで低コストに修正
できるため合わせて対応する。

#### 対象

- `live-sidestage-mobile/lib/screens/tabs/gift_history_tab.dart`(`build()`メソッド全体、
  約270-398行目。`ListPanel(children: [...])`部分は324-394行目)

#### 実装内容

1. Batch02と同じ要領で、外側`ListView(children: [...])`を`CustomScrollView(slivers: [...])`へ変更する。
   ヘッダー部分(`KosaiSectionHeading` / `PeriodSelectorBar` / エラーバナー / スピナー / 合計件数
   `Padding` / `EmptyListNotice`)は1個の`SliverToBoxAdapter(child: Column(children: [...]))`にまとめる。
2. `events`(`GiftHistoryEvent`のリスト)を全件`for`文でWidget化している324-394行目の`ListPanel`を、
   `ListPanelSliver(itemCount: events.length, itemBuilder: (context, i) => ...)`へ置き換える。
   既存はkeyを使っていないため、`itemBuilder`が返す`InkWell`にも新たにkeyを付与しない(既存動作を変えない)。
3. `gift_history_tab.dart`固有のロジック(期間フィルタ・push同期・`openTiktokProfile`によるタップ動作)には
   触れない。

#### Invariants / 注意事項

- Batch02と同じ注意点(見た目の非破壊、`physics:`の維持)
- `event.tiktokHandle == null`の分岐(プロフィール導線の有無)をそのまま維持する

#### 完了条件

- 件数が多い期間(例: 1日で数千件のギフト受信があるroom)でもスクロールが可能な速度で動く
- 既存の少件数roomで見た目・動作に変化が無い

#### 検証方法

- `flutter analyze` / `flutter test`
- 実機で件数の多い期間・少ない期間の両方を表示して確認
- test-autoのUIスクリーンショットで見た目差分が無いことを確認

## 実行順序

1. Batch 01
2. Batch 02 / Batch 03(Batch01完了後に並列実行可能。`list_panel.dart`は両Batchとも読むだけで
   変更しないため競合しない)
3. 全体検証

## 全体検証

- `flutter analyze`
- `flutter test`
- 実機(Pixel 7a)で約1900人規模room・約240人規模room両方の貢献タブを確認(スクロール・タップ・行展開・
  pull-to-refresh)
- 可能であればiPhone実機/シミュレータでも確認
- Batch03を実施する場合はギフト履歴タブも同様に確認
- `test-auto`のUIスクリーンショット工程で、変更前後の見た目差分(角丸・シャドウ・区切り線・行間・
  フォント・ヘッダーとリストの間の余白)が無いことを確認し、Artifactとして提示する

## Rollback / Recovery

- 全Batchとも`git revert`で即座に戻せる(DB/API/永続化への変更が無いため復旧コストはゼロ)
- feature flag等は不要(UIレンダリング方式の変更のみで、ロールバックに互換性ウィンドウは不要)

## 未解決事項

- `battle_history_tab.dart`は今回の調査でBatch対象から意図的に除外した(1バトル区間の貢献者一覧は自然に
  件数上限がかかるため)。将来的にバトル参加者が非常に多いケースが確認された場合は、同じ
  `ListPanelSliver`を適用できる
- Batch03(`gift_history_tab.dart`)は今回報告された症状の直接対象ではないため、ユーザーの優先度判断に
  委ねる。実装しない場合でも根本原因(Batch01/02)は解消される
- `CustomScrollView`+`ListPanelSliver`の組み合わせは本コードベースで初適用のパターンである
  (既存の`ListView.builder`採用箇所は`tts_tab.dart`等、いずれもCustomScrollViewやDecoratedSliverは
  未使用)。技術検証はFlutter SDKソース確認により完了しているが、初適用パターンである点は実装・レビュー
  時に留意する

## design-review

`design-review: completed -- risk=MEDIUM; reviewers=DeepSeek V4 Flash, Gemini 3.7 Flash(agy, canary再実行込み)`

両モデルからHIGH finding(同一主張: 「`DecoratedSliver`は`scrollExtent`でなく可視領域`paintExtent`基準で装飾を描画するため、スクロール中に角丸・シャドウが画面端に貼り付く」)が出たが、
Flutter SDKソース(`C:\src\flutter\packages\flutter\lib\src\rendering\decorated_sliver.dart`の`RenderDecoratedSliver.paint()`、
および`sliver.dart:1745`の`getMaxPaintRect()`)を直接確認しINVALIDと確定した。実装は`sliverGeometry.maxPaintExtent`
(有限なslverでは実質リスト全体の範囲)を矩形サイズとして使い、`leadingOffset`でスクロール位置ぶんだけ矩形をシフトさせる設計。
両モデルが引用した「`paintExtent`をサイズとして使う」というコード行はSDK実装に実在せず(捏造引用)、CustomScrollViewの
クリッピングにより実際に見えるのはビューポート内の部分のみで、角丸はリストの実際の先頭/末尾でのみ現れる(plan記述通り)。
Gemini側はcanary再実行で`missed`(既知バグ検出失敗)となり、モデル側の検証精度低下がこの誤指摘を補強する状況証拠。
CRITICAL/HIGH相当の未解決指摘無し。実装(worker-normal)へ進む。

## メインエージェント判断事項

- Batch03(`gift_history_tab.dart`への横展開)を今回のバグ修正と同じ作業単位で実施するか、別途スコープと
  するかはユーザー判断が望ましい。同一原因の潜在バグであり修正コストが低いため実施を推奨するが、今回
  明示的に報告された症状の対象ではないため、必須にはしていない
- 旧plan(`ListPanel.builder` + `shrinkWrap`)は本ドキュメントにより完全に置き換えられた。旧planファイルが
  存在していたworktree(`mobile-contribution-breakdown-error`)側は本タスクの対象外(別worktreeであり、
  本タスクの作業ディレクトリではないため、当該worktree内のファイルには一切触れていない)
