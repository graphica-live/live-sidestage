import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:tikcaption_reader/main.dart';

void main() {
  setUp(() {
    const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'readAll') return <String, String>{};
      return null;
    });
  });

  testWidgets('起動直後はウェルカム画面が表示される', (WidgetTester tester) async {
    await tester.pumpWidget(const TikCaptionReaderApp());
    await tester.pump();
    await tester.pump();

    expect(find.text('TikCaptionReader'), findsOneWidget);
    expect(find.text('Googleでログイン'), findsOneWidget);
  });
}
