import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/screens/widgets/analytics_status.dart';

void main() {
  const message = 'FREEプランでは1日1件までバトルデータを収集できます。すべてのバトルを記録するにはPROへアップグレードしてください。';
  const cta = 'PROへアップグレード';

  testWidgets('shows the full notice and invokes upgrade callback', (tester) async {
    var tapped = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: FreePlanLimitNotice(
            message: message,
            ctaLabel: cta,
            onUpgrade: () => tapped++,
          ),
        ),
      ),
    );

    expect(find.text(message, findRichText: true), findsOneWidget);
    await tester.tap(find.byType(FreePlanLimitNotice));
    await tester.pump();
    expect(tapped, 1);
  });
}
