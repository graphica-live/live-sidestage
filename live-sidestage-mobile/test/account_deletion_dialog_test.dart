// アカウント削除の確認ダイアログ。3画面(Settings/Onboarding/UpdateRequired)共通の
// confirmAndDeleteAccount(account_deletion.dart)がどこからも呼べることと、
// キャンセルすればセッションに触れないことを固定する。
//
// 削除実行そのもの(SessionController.deleteAccount)のロジックは
// session_refresh_test.dart側で見ているので、ここではUIの配線だけを見る。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:live_sidestage_mobile/core/account_status_store.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/core/battle_filter_store.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/core/theme_mode_store.dart';
import 'package:live_sidestage_mobile/models/auth_session.dart';
import 'package:live_sidestage_mobile/screens/home_screen.dart' show SpeechState;
import 'package:live_sidestage_mobile/screens/onboarding_screen.dart';
import 'package:live_sidestage_mobile/screens/tabs/settings_tab.dart';
import 'package:live_sidestage_mobile/screens/update_required_screen.dart';

AuthSession _session({bool onboardingRequired = false}) => AuthSession(
      token: 'tok',
      userId: 'u1',
      userName: 'me',
      userEmail: 'me@example.com',
      onboardingRequired: onboardingRequired,
      provider: AuthProvider.google,
      streamer: StreamerInfo(id: 's1', tiktokId: 'tt', apiKey: 'k', verified: true),
    );

Future<void> _pump(WidgetTester tester, SessionController controller, Widget child) {
  return tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AppConfigStore>(create: (_) => AppConfigStore()),
        ChangeNotifierProvider<AccountStatusStore>(create: (_) => AccountStatusStore()),
        ChangeNotifierProvider<SessionController>.value(value: controller),
        ChangeNotifierProvider<ThemeModeStore>(create: (_) => ThemeModeStore()),
        ChangeNotifierProvider<BattleFilterStore>(create: (_) => BattleFilterStore()),
      ],
      child: MaterialApp(home: child),
    ),
  );
}

void main() {
  testWidgets('SettingsTabからアカウント削除の確認ダイアログを開ける', (tester) async {
    final controller = SessionController()..session = _session();
    await _pump(
      tester,
      controller,
      Scaffold(
        body: SettingsTab(
          speech: const SpeechState(),
          busy: false,
          onChangeTiktokId: () async {},
          onBeforeLogout: () async {},
        ),
      ),
    );

    await tester.dragUntilVisible(
      find.text('アカウント削除'),
      find.byType(ListView),
      const Offset(0, -200),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('アカウント削除'));
    await tester.pumpAndSettle();

    expect(find.text('アカウントを削除しますか？'), findsOneWidget);

    await tester.tap(find.text('キャンセル'));
    await tester.pumpAndSettle();

    expect(find.text('アカウントを削除しますか？'), findsNothing);
    expect(controller.session, isNotNull);
  });

  testWidgets('OnboardingScreenからもアカウント削除の確認ダイアログを開ける', (tester) async {
    final controller = SessionController()..session = _session(onboardingRequired: true);
    await _pump(tester, controller, const OnboardingScreen());

    await tester.tap(find.byTooltip('アカウント削除'));
    await tester.pumpAndSettle();

    expect(find.text('アカウントを削除しますか？'), findsOneWidget);

    await tester.tap(find.text('キャンセル'));
    await tester.pumpAndSettle();

    expect(controller.session, isNotNull);
  });

  testWidgets('UpdateRequiredScreenからもアカウント削除の確認ダイアログを開ける', (tester) async {
    final controller = SessionController()..session = _session();
    await _pump(tester, controller, const UpdateRequiredScreen(currentVersion: '1.0.0'));

    await tester.tap(find.byTooltip('アカウント削除'));
    await tester.pumpAndSettle();

    expect(find.text('アカウントを削除しますか？'), findsOneWidget);

    await tester.tap(find.text('キャンセル'));
    await tester.pumpAndSettle();

    expect(controller.session, isNotNull);
  });
}
