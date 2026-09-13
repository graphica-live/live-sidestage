import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/screens/tabs/gift_history_tab.dart';
import 'package:live_sidestage_mobile/screens/widgets/gift_thumbnail.dart';

void main() {
  testWidgets('gift name sits alone when image URL is missing', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: GiftHistoryGiftLabel(giftName: 'Rose', repeatCount: 3),
        ),
      ),
    );

    expect(find.text('Rose \u00d73'), findsOneWidget);
    expect(find.byType(GiftThumbnail), findsNothing);
  });

  testWidgets('gift image sits to the left of the gift name', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: GiftHistoryGiftLabel(
            giftName: 'Rose',
            repeatCount: 3,
            imageUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/rose.png~tplv-obj.webp',
          ),
        ),
      ),
    );

    expect(find.byType(GiftThumbnail), findsOneWidget);
    expect(find.text('Rose \u00d73'), findsOneWidget);
    final thumb = tester.getTopLeft(find.byType(GiftThumbnail));
    final name = tester.getTopLeft(find.text('Rose \u00d73'));
    expect(thumb.dx < name.dx, isTrue);
    expect(tester.getSize(find.byType(GiftThumbnail)), const Size(20, 20));
  });
}
