// VOICEVOX 音声の二次利用についての案内。
//
// 押さえたいのは2点。
//
//  1. 設定からいつでも読み返せること（規約の提示が初回の1回きりでは足りない）
//  2. 初回の読み上げ開始で一度出したら、次からは出さないこと
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/account_status_store.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/core/battle_filter_store.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/core/theme_mode_store.dart';
import 'package:live_sidestage_mobile/models/auth_session.dart';
import 'package:live_sidestage_mobile/screens/home_screen.dart' show SpeechState;
import 'package:live_sidestage_mobile/screens/tabs/settings_tab.dart';
import 'package:live_sidestage_mobile/screens/widgets/voicevox_terms.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

AuthSession _session() => AuthSession(
      token: 'tok',
      userId: 'u1',
      userName: 'me',
      userEmail: 'me@example.com',
      onboardingRequired: false,
      provider: AuthProvider.google,
      streamer: StreamerInfo(id: 's1', tiktokId: 'tt', apiKey: 'k', verified: true),
    );

Future<void> _pumpSettings(WidgetTester tester) async {
  final controller = SessionController()..session = _session();

  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AppConfigStore>(create: (_) => AppConfigStore()),
        ChangeNotifierProvider<AccountStatusStore>(create: (_) => AccountStatusStore()),
        ChangeNotifierProvider<SessionController>.value(value: controller),
        ChangeNotifierProvider<ThemeModeStore>(create: (_) => ThemeModeStore()),
        ChangeNotifierProvider<BattleFilterStore>(create: (_) => BattleFilterStore()),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: SettingsTab(
            speech: const SpeechState(),
            busy: false,
            onChangeTiktokId: () async {},
            onBeforeLogout: () async {},
          ),
        ),
      ),
    ),
  );
  // 読み上げ・効果音の設定項目をこのタブへ集約したぶん一覧が縦に伸び、規約と
  // ログアウトは初期表示の外へ出た。ListView は可視域の外を組み立てないので、
  // 使う行はテストごとに scrollUntilVisible で送ってから触る。
  await tester.pumpAndSettle();
}

/// 読み上げの開始ボタン相当。押すと初回だけ案内が出る。
Future<void> _pumpStartButton(WidgetTester tester) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => showVoicevoxTermsDialogOnce(context),
            child: const Text('開始'),
          ),
        ),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('設定のログアウトの上に利用規約の行がある', (tester) async {
    await _pumpSettings(tester);
    await tester.scrollUntilVisible(find.text('ログアウト'), 100);
    await tester.pumpAndSettle();

    final terms = find.text('VOICEVOX利用規約');
    final logout = find.text('ログアウト');
    expect(terms, findsOneWidget);
    expect(logout, findsOneWidget);
    expect(
      tester.getTopLeft(terms).dy,
      lessThan(tester.getTopLeft(logout).dy),
    );
  });

  testWidgets('設定の行を押すと本文とリンクが出る', (tester) async {
    await _pumpSettings(tester);
    await tester.scrollUntilVisible(find.text('VOICEVOX利用規約'), 100);
    await tester.pumpAndSettle();

    await tester.tap(find.text('VOICEVOX利用規約'));
    await tester.pumpAndSettle();

    expect(find.text('VOICEVOX音声の利用について'), findsOneWidget);
    expect(
      find.textContaining('使用する各キャラクターの利用規約を遵守してください'),
      findsOneWidget,
    );
    // ダイアログ内のリンク3本。1本目は設定の行と同じ文字列なので、
    // ダイアログを開いた時点で2つ目が増えている。
    expect(find.text('VOICEVOX利用規約'), findsNWidgets(2));
    expect(find.text('使用キャラクターの利用規約'), findsOneWidget);
    expect(find.text('VOICEVOX Q&A'), findsOneWidget);
  });

  testWidgets('初回の開始でだけ案内を出す', (tester) async {
    await _pumpStartButton(tester);

    await tester.tap(find.text('開始'));
    await tester.pumpAndSettle();
    expect(find.text('VOICEVOX音声の利用について'), findsOneWidget);

    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.text('VOICEVOX音声の利用について'), findsNothing);

    await tester.tap(find.text('開始'));
    await tester.pumpAndSettle();
    expect(find.text('VOICEVOX音声の利用について'), findsNothing);
  });

  testWidgets('初回の案内はOKを押すまで閉じられない', (tester) async {
    await _pumpStartButton(tester);

    await tester.tap(find.text('開始'));
    await tester.pumpAndSettle();

    // ダイアログの外側（バリア）をタップしても消えない。
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();
    expect(find.text('VOICEVOX音声の利用について'), findsOneWidget);
  });
}
