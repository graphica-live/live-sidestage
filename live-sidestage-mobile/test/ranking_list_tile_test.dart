// ランキング上位3人の視覚差別化。
//
//  - 新規の色・アイコンは追加しない(既存primary色とテーマの一段階大きいフォントロールのみ)
//  - Cardのelevation/surfaceTintColorはテーマ値のまま変更しない(Card Deck Rule)
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/gift_ranking_entry.dart';
import 'package:live_sidestage_mobile/screens/widgets/ranking_list_tile.dart';

const _primary = Color(0xFFD9591F);
const _line = Color(0xFFECE5DC);

Widget wrap(Widget child) {
  return MaterialApp(
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: _primary).copyWith(primary: _primary),
      cardTheme: CardThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: _line),
        ),
      ),
    ),
    home: Scaffold(body: child),
  );
}

const _entry = GiftRankingEntry(
  uniqueId: 'u1',
  nickname: 'テストユーザー',
  giftCount: 3,
  totalDiamonds: 1000,
);

void main() {
  testWidgets('1〜3位はprimary色の枠線になる', (tester) async {
    for (final rank in [1, 2, 3]) {
      await tester.pumpWidget(wrap(RankingListTile(rank: rank, entry: _entry)));
      final card = tester.widget<Card>(find.byType(Card));
      final shape = card.shape as RoundedRectangleBorder;
      expect(shape.side.color, _primary, reason: 'rank $rank');
      expect(shape.side.width, 1.5, reason: 'rank $rank');
    }
  });

  testWidgets('4位以下はテーマ既定の枠線のまま', (tester) async {
    await tester.pumpWidget(wrap(const RankingListTile(rank: 4, entry: _entry)));
    final card = tester.widget<Card>(find.byType(Card));
    expect(card.shape, isNull);
  });

  testWidgets('1〜3位はコイン数の表示が大きくなる', (tester) async {
    await tester.pumpWidget(wrap(const RankingListTile(rank: 1, entry: _entry)));
    final topText = tester.widget<Text>(find.text('1000コイン'));
    expect(topText.style?.fontSize, 20);

    await tester.pumpWidget(wrap(const RankingListTile(rank: 4, entry: _entry)));
    final normalText = tester.widget<Text>(find.text('1000コイン'));
    expect(normalText.style?.fontSize, 18);
  });

  testWidgets('1〜3位は順位数字がprimary色、4位以下はデフォルト色', (tester) async {
    await tester.pumpWidget(wrap(const RankingListTile(rank: 1, entry: _entry)));
    final topRank = tester.widget<Text>(find.text('1'));
    expect(topRank.style?.color, _primary);

    await tester.pumpWidget(wrap(const RankingListTile(rank: 4, entry: _entry)));
    final normalRank = tester.widget<Text>(find.text('4'));
    expect(normalRank.style?.color, isNull);
  });
}
