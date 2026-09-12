import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/analytics_period.dart';
import 'package:live_sidestage_mobile/screens/widgets/period_selector.dart';

void main() {
  testWidgets('extendedRangeAllowed:falseのとき週タップはonChangedせずアップグレードSnackBar', (tester) async {
    var changed = 0;
    final selection = AnalyticsPeriodSelection.today();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PeriodSelectorBar(
            selection: selection,
            rangeLabel: selection.date,
            extendedRangeAllowed: false,
            onChanged: (_) => changed++,
          ),
        ),
      ),
    );

    await tester.tap(find.text('週'));
    await tester.pump();

    expect(changed, 0);
    expect(find.text('週・月・年での表示はPRO/ULTRAプランで利用できます'), findsOneWidget);

    await tester.pump(const Duration(seconds: 3));
  });
}
