// 設定画面の「アカウントID」行。principalId はサポート問い合わせ時の
// 本人特定キーなので、値がある間は必ず表示され、コピー操作ができること、
// 未取得時に生の "null"/空文字を見せないことを固定する。
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:live_sidestage_mobile/core/account_status_store.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/core/battle_filter_store.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/core/theme_mode_store.dart';
import 'package:live_sidestage_mobile/models/account_status.dart';
import 'package:live_sidestage_mobile/models/auth_session.dart';
import 'package:live_sidestage_mobile/screens/home_screen.dart' show SpeechState;
import 'package:live_sidestage_mobile/screens/tabs/settings_tab.dart';

AuthSession _session() => AuthSession(
      token: 'tok',
      refreshToken: 'refresh',
      userId: 'u1',
      userName: 'me',
      userEmail: 'me@example.com',
      onboardingRequired: false,
      provider: AuthProvider.google,
      streamer: StreamerInfo(id: 's1', tiktokHandle: 'tt', verified: true),
    );

Future<void> _pumpSettings(WidgetTester tester, {required String principalId}) async {
  final controller = SessionController()..session = _session();
  final accountStatus = AccountStatusStore()
    ..status = AccountStatus(
      principalId: principalId,
      plan: 'FREE',
      mobileBetaActive: false,
      planLabel: 'FREE',
      features: const [],
      minimumSupportedVersion: '0.0.0',
      maintenanceMode: false,
    );

  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AppConfigStore>(create: (_) => AppConfigStore()),
        ChangeNotifierProvider<AccountStatusStore>.value(value: accountStatus),
        ChangeNotifierProvider<SessionController>.value(value: controller),
        ChangeNotifierProvider<ThemeModeStore>(create: (_) => ThemeModeStore()),
        ChangeNotifierProvider<BattleFilterStore>(create: (_) => BattleFilterStore()),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: SettingsTab(
            speech: const SpeechState(),
            busy: false,
            onChangeTiktokHandle: () async {},
            onBeforeDeleteAccount: () async {},
          ),
        ),
      ),
    ),
  );
}

Future<void> _scrollToAccountId(WidgetTester tester) async {
  await tester.dragUntilVisible(
    find.text('アカウントID'),
    find.byType(ListView),
    const Offset(0, -100),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('principalId があればそのまま表示し、タップでコピーする', (tester) async {
    await _pumpSettings(tester, principalId: 'clx1234567890');
    await _scrollToAccountId(tester);

    expect(find.text('clx1234567890'), findsOneWidget);

    final log = <MethodCall>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        log.add(call);
        return null;
      },
    );

    await tester.tap(find.text('アカウントID'));
    await tester.pump();

    final setDataCalls = log.where((c) => c.method == 'Clipboard.setData').toList();
    expect(setDataCalls.single.arguments, {'text': 'clx1234567890'});
    expect(find.text('コピーしました'), findsOneWidget);
  });

  testWidgets('principalId が未取得(空文字)なら「（未取得）」と出しタップ不可', (tester) async {
    await _pumpSettings(tester, principalId: '');
    await _scrollToAccountId(tester);

    expect(find.text('（未取得）'), findsOneWidget);
    expect(find.text('null'), findsNothing);
  });
}
