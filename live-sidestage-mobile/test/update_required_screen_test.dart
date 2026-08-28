import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/screens/update_required_screen.dart';

void main() {
  testWidgets('現在バージョンと案内文を表示する', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: UpdateRequiredScreen(currentVersion: '1.0.0')),
    );

    expect(find.text('最新版へのアップデートが必要です'), findsOneWidget);
    expect(find.textContaining('1.0.0'), findsOneWidget);
  });
}
