import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_foreground_task/flutter_foreground_task_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:live_sidestage_mobile/core/account_status_store.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/core/app_config_store.dart';
import 'package:live_sidestage_mobile/core/battle_filter_store.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/core/session_storage.dart';
import 'package:live_sidestage_mobile/core/theme_mode_store.dart';
import 'package:live_sidestage_mobile/models/auth_session.dart';
import 'package:live_sidestage_mobile/models/tiktok_account_preview.dart';
import 'package:live_sidestage_mobile/screens/onboarding_screen.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _StoppedForegroundTaskPlatform extends FlutterForegroundTaskPlatform
    with MockPlatformInterfaceMixin {
  @override
  Future<bool> get isRunningService async => false;

  @override
  void sendDataToTask(Object data) {}
}

class _FakeGoogleSignIn extends GoogleSignIn {
  @override
  Future<GoogleSignInAccount?> signOut() async => null;
}

class _MemStorage extends SessionStorage {
  AuthSession? saved;

  @override
  Future<void> save(AuthSession session) async {
    saved = session;
  }

  @override
  Future<void> clear() async {
    saved = null;
  }
}

class _FakeApi extends LiveAnalyticsApi {
  ApiException? previewError;
  ApiException? registerError;
  TiktokAccountPreview preview = const TiktokAccountPreview(
    tiktokHandle: 'your_handle',
    nickname: 'ニックネーム',
    followingCount: 128,
    followerCount: 12340,
  );
  int previewCalls = 0;
  int registerCalls = 0;
  int logoutCalls = 0;

  @override
  Future<TiktokAccountPreview> previewStreamer({
    required String token,
    required String tiktokHandle,
  }) async {
    previewCalls++;
    final error = previewError;
    if (error != null) throw error;
    return preview;
  }

  @override
  Future<(String token, StreamerInfo streamer)> registerStreamer({
    required String token,
    required String tiktokHandle,
  }) async {
    registerCalls++;
    final error = registerError;
    if (error != null) throw error;
    return (
      'tok-new',
      StreamerInfo(id: 's1', tiktokHandle: tiktokHandle, verified: false),
    );
  }

  @override
  Future<void> logoutSession({required String refreshToken}) async {
    logoutCalls++;
  }
}

AuthSession _session() => AuthSession(
      token: 'tok',
      refreshToken: 'refresh',
      userId: 'u1',
      userName: '配信者',
      userEmail: 'me@example.com',
      onboardingRequired: true,
      provider: AuthProvider.google,
    );

SessionController _controller({_FakeApi? api, _MemStorage? storage}) {
  return SessionController(
    api: api ?? _FakeApi(),
    storage: storage ?? _MemStorage(),
    googleSignIn: _FakeGoogleSignIn(),
  )..session = _session();
}

Future<void> _pump(WidgetTester tester, SessionController controller) {
  return tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AppConfigStore>(create: (_) => AppConfigStore()),
        ChangeNotifierProvider<AccountStatusStore>(create: (_) => AccountStatusStore()),
        ChangeNotifierProvider<SessionController>.value(value: controller),
        ChangeNotifierProvider<ThemeModeStore>(create: (_) => ThemeModeStore()),
        ChangeNotifierProvider<BattleFilterStore>(create: (_) => BattleFilterStore()),
      ],
      child: const MaterialApp(home: OnboardingScreen()),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    FlutterForegroundTaskPlatform.instance = _StoppedForegroundTaskPlatform();
    const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'readAll') return <String, String>{};
      return null;
    });
  });

  testWidgets('初回は紹介スライドで、スキップすると連携ページへ行く', (tester) async {
    await _pump(tester, _controller());
    await tester.pumpAndSettle();

    expect(find.text('画面を見ずに、声で聞く'), findsOneWidget);
    expect(find.text('スキップ'), findsOneWidget);
    expect(find.text('TikTok ID（@なし）'), findsNothing);

    await tester.tap(find.text('スキップ'));
    await tester.pumpAndSettle();

    expect(find.text('TikTokアカウントの連携'), findsOneWidget);
    expect(find.text('確認する'), findsOneWidget);
    expect(find.text('スキップ'), findsNothing);
    expect(find.textContaining('ようこそ、配信者さん'), findsOneWidget);
  });

  testWidgets('次へで紹介スライドを順に進める', (tester) async {
    await _pump(tester, _controller());
    await tester.pumpAndSettle();

    await tester.tap(find.text('次へ'));
    await tester.pumpAndSettle();
    expect(find.text('ギフトが届いたら、音でわかる'), findsOneWidget);

    await tester.tap(find.text('次へ'));
    await tester.pumpAndSettle();
    expect(find.text('画面オフでも、途切れない'), findsOneWidget);

    await tester.tap(find.text('次へ'));
    await tester.pumpAndSettle();
    expect(find.text('TikTokアカウントの連携'), findsOneWidget);
  });

  testWidgets('空のTikTok IDでは確認シートを出さない', (tester) async {
    await _pump(tester, _controller());
    await tester.pumpAndSettle();
    await tester.tap(find.text('スキップ'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('確認する'));
    await tester.pumpAndSettle();

    expect(find.text('TikTok IDを入力してください'), findsOneWidget);
    expect(find.text('このアカウントで連携する'), findsNothing);
  });

  testWidgets('有効なTikTok IDなら確認シートが出て確定で登録する', (tester) async {
    final api = _FakeApi();
    await _pump(tester, _controller(api: api));
    await tester.pumpAndSettle();
    await tester.tap(find.text('スキップ'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), 'your_handle');
    await tester.tap(find.text('確認する'));
    await tester.pumpAndSettle();

    expect(api.previewCalls, 1);
    expect(find.text('このアカウントで連携する'), findsOneWidget);
    expect(find.text('@your_handle'), findsOneWidget);
    expect(find.text('ニックネーム'), findsOneWidget);

    await tester.tap(find.text('このアカウントで連携する'));
    await tester.pumpAndSettle();

    expect(api.registerCalls, 1);
  });

  testWidgets('確定登録失敗時はシートを残しエラーを出す', (tester) async {
    final api = _FakeApi()..registerError = ApiException('既にTikTokアカウントが登録されています');
    final controller = _controller(api: api);
    await _pump(tester, controller);
    await tester.pumpAndSettle();
    await tester.tap(find.text('スキップ'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), 'your_handle');
    await tester.tap(find.text('確認する'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('このアカウントで連携する'));
    await tester.pumpAndSettle();

    expect(api.registerCalls, 1);
    expect(find.text('このアカウントで連携する'), findsOneWidget);
    expect(find.text('既にTikTokアカウントが登録されています'), findsWidgets);
    expect(controller.session?.onboardingRequired, isTrue);
  });

  testWidgets('preview失敗時はシートを出さずエラーを表示する', (tester) async {
    final api = _FakeApi()
      ..previewError = ApiException('このTikTok IDのユーザーが見つかりません。IDに誤りがないかご確認ください(USER_NOT_FOUND)');
    await _pump(tester, _controller(api: api));
    await tester.pumpAndSettle();
    await tester.tap(find.text('スキップ'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), 'nobody');
    await tester.tap(find.text('確認する'));
    await tester.pumpAndSettle();

    expect(find.text('このアカウントで連携する'), findsNothing);
    expect(find.textContaining('USER_NOT_FOUND'), findsOneWidget);
  });

  testWidgets('overflowのログアウトでセッションが消える', (tester) async {
    final api = _FakeApi();
    final controller = _controller(api: api);
    await _pump(tester, controller);
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('その他'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ログアウト'));
    await tester.pumpAndSettle();
    expect(find.text('ログアウトしますか？'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'ログアウト'));
    await tester.pumpAndSettle();

    expect(api.logoutCalls, 1);
    expect(controller.session, isNull);
  });
}
