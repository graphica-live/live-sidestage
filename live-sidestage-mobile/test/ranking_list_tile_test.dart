// RankingListTileは貢献タブ・バトル履歴タブの1行。
// 行そのものの見た目(枠線・サイズ)はrankによらず統一し、
// 1〜3位だけ順位数字を金銀銅の丸バッジにする。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/gift_ranking_entry.dart';
import 'package:live_sidestage_mobile/screens/widgets/ranking_list_tile.dart';

const _gold = Color(0xFFC9971F);
const _silver = Color(0xFFA8ADB5);
const _bronze = Color(0xFFC48A5A);

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
  testWidgets('rankによらずCardの枠線は変わらない', (tester) async {
    for (final rank in [1, 2, 3, 4]) {
      await tester.pumpWidget(wrap(RankingListTile(rank: rank, entry: _entry)));
      final card = tester.widget<Card>(find.byType(Card));
      expect(card.shape, isNull, reason: 'rank $rank');
    }
  });

  testWidgets('rankによらずコイン数は🪙表記・フォントサイズ14のまま', (tester) async {
    for (final rank in [1, 4]) {
      await tester.pumpWidget(wrap(RankingListTile(rank: rank, entry: _entry)));
      final text = tester.widget<Text>(find.text('🪙1,000'));
      expect(text.style?.fontSize, 14, reason: 'rank $rank');
    }
  });

  testWidgets('1〜3位は金銀銅の丸バッジになる', (tester) async {
    final expected = {1: _gold, 2: _silver, 3: _bronze};
    for (final entry in expected.entries) {
      await tester.pumpWidget(wrap(RankingListTile(rank: entry.key, entry: _entry)));
      final badge = tester.widget<Container>(find.byWidgetPredicate(
        (w) =>
            w is Container &&
            w.decoration is BoxDecoration &&
            (w.decoration! as BoxDecoration).shape == BoxShape.circle &&
            w.constraints?.maxWidth == 24,
      ));
      expect((badge.decoration! as BoxDecoration).color, entry.value, reason: 'rank ${entry.key}');
    }
  });

  testWidgets('4位以下は丸バッジにならずデフォルト色の数字のまま', (tester) async {
    for (final rank in [4, 5]) {
      await tester.pumpWidget(wrap(RankingListTile(rank: rank, entry: _entry)));
      expect(
        find.byWidgetPredicate(
          (w) =>
            w is Container &&
            w.decoration is BoxDecoration &&
            (w.decoration! as BoxDecoration).shape == BoxShape.circle &&
            w.constraints?.maxWidth == 24,
        ),
        findsNothing,
        reason: 'rank $rank',
      );
      final text = tester.widget<Text>(find.text('$rank'));
      expect(text.style?.color, isNull, reason: 'rank $rank');
    }
  });
}
