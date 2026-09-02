// RankingListTileは貢献タブ・バトル履歴タブの1行。
// 行そのものの見た目(枠線・サイズ)はrankによらず統一し、
// 1〜3位だけ順位数字をグラデーションメダル(光彩)にする。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/gift_ranking_entry.dart';
import 'package:live_sidestage_mobile/screens/widgets/gradient_kit.dart';
import 'package:live_sidestage_mobile/screens/widgets/ranking_list_tile.dart';

const _rank1 = KosaiPalette.rank1;
const _rank2 = KosaiPalette.rank2;
const _rank3 = KosaiPalette.rank3;

Widget wrap(Widget child) {
  return MaterialApp(home: Scaffold(body: child));
}

const _entry = GiftRankingEntry(
  uniqueId: 'u1',
  nickname: 'テストユーザー',
  giftCount: 3,
  totalDiamonds: 1000,
);

void main() {
  testWidgets('rankによらず行のパディングは変わらない', (tester) async {
    for (final rank in [1, 2, 3, 4]) {
      await tester.pumpWidget(wrap(RankingListTile(rank: rank, entry: _entry)));
      final padding = tester.widget<Padding>(find.byType(Padding).first);
      expect(padding.padding, const EdgeInsets.symmetric(vertical: 10), reason: 'rank $rank');
    }
  });

  testWidgets('rankによらずコイン数は🪙表記・太字のまま', (tester) async {
    for (final rank in [1, 4]) {
      await tester.pumpWidget(wrap(RankingListTile(rank: rank, entry: _entry)));
      final text = tester.widget<Text>(find.text('🪙1,000'));
      expect(text.style?.fontWeight, FontWeight.w700, reason: 'rank $rank');
    }
  });

  testWidgets('1〜3位はグラデーションメダルになる', (tester) async {
    final expected = {1: _rank1, 2: _rank2, 3: _rank3};
    for (final entry in expected.entries) {
      await tester.pumpWidget(wrap(RankingListTile(rank: entry.key, entry: _entry)));
      // GradientRing(アバター枠、30x30)も同じgradient値を取りうるため、GradientMedal固有のサイズ(26x26)で絞り込む。
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Container &&
              w.constraints == const BoxConstraints.tightFor(width: 26, height: 26) &&
              w.decoration is BoxDecoration &&
              (w.decoration! as BoxDecoration).shape == BoxShape.circle &&
              (w.decoration! as BoxDecoration).gradient == entry.value,
        ),
        findsOneWidget,
        reason: 'rank ${entry.key}',
      );
    }
  });

  testWidgets('4位以下はグラデーションメダルにならずデフォルト色の数字のまま', (tester) async {
    for (final rank in [4, 5]) {
      await tester.pumpWidget(wrap(RankingListTile(rank: rank, entry: _entry)));
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Container &&
              w.constraints == const BoxConstraints.tightFor(width: 26, height: 26) &&
              w.decoration is BoxDecoration &&
              (w.decoration! as BoxDecoration).shape == BoxShape.circle,
        ),
        findsNothing,
        reason: 'rank $rank',
      );
      final text = tester.widget<Text>(find.text('$rank'));
      expect(text.style?.color, isNull, reason: 'rank $rank');
    }
  });
}
