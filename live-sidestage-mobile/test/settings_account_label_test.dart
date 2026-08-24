// 設定画面のアカウント行のラベル。
//
// Apple サインインを足すまでは Google 決め打ちで正しかったが、いま決め打ちにすると
// Apple で入っている人に嘘を表示する。session が持つ provider で出し分ける。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/models/auth_session.dart';
import 'package:live_sidestage_mobile/screens/home_screen.dart' show SpeechState;
import 'package:live_sidestage_mobile/screens/tabs/settings_tab.dart';

AuthSession _session(AuthProvider provider) => AuthSession(
      token: 'tok',
      userId: 'u1',
      userName: 'me',
      userEmail: 'me@example.com',
      onboardingRequired: false,
      provider: provider,
      streamer: StreamerInfo(id: 's1', tiktokId: 'tt', apiKey: 'k', verified: true),
    );

Future<void> _pumpSettings(WidgetTester tester, AuthProvider provider) async {
  final controller = SessionController()..session = _session(provider);

  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AppConfigStore>(create: (_) => AppConfigStore()),
        ChangeNotifierProvider<SessionController>.value(value: controller),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: SettingsTab(
            speech: const SpeechState(),
            onChangeTiktokId: () async {},
            onBeforeLogout: () async {},
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('Google でログインしていれば Google アカウントと出す', (tester) async {
    await _pumpSettings(tester, AuthProvider.google);

    expect(find.text('Googleアカウント'), findsOneWidget);
    expect(find.text('Appleアカウント'), findsNothing);
    expect(find.text('me@example.com'), findsOneWidget);
  });

  testWidgets('Apple でログインしていれば Apple アカウントと出す', (tester) async {
    await _pumpSettings(tester, AuthProvider.apple);

    expect(find.text('Appleアカウント'), findsOneWidget);
    expect(find.text('Googleアカウント'), findsNothing);
  });
}
