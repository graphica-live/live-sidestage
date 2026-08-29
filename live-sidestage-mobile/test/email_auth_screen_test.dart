// ログイン/新規登録を1画面で切り替える EmailAuthScreen。
//
// 確認メールが無いスコープなので、フォーム側のバリデーション(特にパスワード
// 確認の一致)が唯一の入力ミス防止策になる。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/core/session_storage.dart';
import 'package:live_sidestage_mobile/models/auth_session.dart';
import 'package:live_sidestage_mobile/screens/email_auth_screen.dart';

class _FakeStorage extends SessionStorage {
  @override
  Future<void> save(AuthSession session) async {}

  @override
  Future<AuthSession?> load() async => null;

  @override
  Future<void> clear() async {}
}

class _FakeApi extends LiveAnalyticsApi {
  int registerCalls = 0;
  int loginCalls = 0;
  String? lastEmail;
  String? lastPassword;

  @override
  Future<AuthSession> registerWithEmail({required String email, required String password}) async {
    registerCalls++;
    lastEmail = email;
    lastPassword = password;
    return AuthSession(
      token: 'tok',
      userId: 'u1',
      userName: '',
      userEmail: email,
      onboardingRequired: true,
      provider: AuthProvider.email,
    );
  }

  @override
  Future<AuthSession> loginWithEmail({required String email, required String password}) async {
    loginCalls++;
    lastEmail = email;
    lastPassword = password;
    return AuthSession(
      token: 'tok',
      userId: 'u1',
      userName: '',
      userEmail: email,
      onboardingRequired: false,
      provider: AuthProvider.email,
    );
  }
}

/// 遷移元のルートも積んでおく。EmailAuthScreen は送信成功時に自分自身を
/// pop するので、スタックがこの画面だけだと pop 先が無くて assert に落ちる。
Future<_FakeApi> _pumpScreen(WidgetTester tester) async {
  final api = _FakeApi();
  final controller = SessionController(api: api, storage: _FakeStorage());

  await tester.pumpWidget(
    ChangeNotifierProvider<SessionController>.value(
      value: controller,
      child: MaterialApp(
        home: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const EmailAuthScreen()),
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return api;
}

void main() {
  testWidgets('初期表示はログインモード(登録専用の確認欄は出ない)', (tester) async {
    await _pumpScreen(tester);

    expect(find.text('ログイン'), findsWidgets);
    expect(find.text('ログインする'), findsOneWidget);
    expect(find.text('パスワード(確認)'), findsNothing);
  });

  testWidgets('トグルで登録モードに切り替わる', (tester) async {
    await _pumpScreen(tester);

    await tester.tap(find.text('新規登録はこちら'));
    await tester.pumpAndSettle();

    expect(find.text('登録する'), findsOneWidget);
    expect(find.text('パスワード(確認)'), findsOneWidget);
  });

  testWidgets('メールアドレス未入力では送信できない', (tester) async {
    final api = await _pumpScreen(tester);

    await tester.tap(find.text('ログインする'));
    await tester.pumpAndSettle();

    expect(find.text('メールアドレスを入力してください'), findsOneWidget);
    expect(api.loginCalls, 0);
  });

  testWidgets('登録モードでパスワードが一致しないとエラーを出し送信しない', (tester) async {
    final api = await _pumpScreen(tester);

    await tester.tap(find.text('新規登録はこちら'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextFormField, 'メールアドレス'), 'test@example.com');
    await tester.enterText(find.widgetWithText(TextFormField, 'パスワード'), 'correct-horse');
    await tester.enterText(find.widgetWithText(TextFormField, 'パスワード(確認)'), 'different');

    await tester.tap(find.text('登録する'));
    await tester.pumpAndSettle();

    expect(find.text('パスワードが一致しません'), findsOneWidget);
    expect(api.registerCalls, 0);
  });

  testWidgets('登録モードで8文字未満のパスワードは送信しない', (tester) async {
    final api = await _pumpScreen(tester);

    await tester.tap(find.text('新規登録はこちら'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextFormField, 'メールアドレス'), 'test@example.com');
    await tester.enterText(find.widgetWithText(TextFormField, 'パスワード'), 'short1');
    await tester.enterText(find.widgetWithText(TextFormField, 'パスワード(確認)'), 'short1');

    await tester.tap(find.text('登録する'));
    await tester.pumpAndSettle();

    expect(find.text('パスワードは8文字以上で入力してください'), findsOneWidget);
    expect(api.registerCalls, 0);
  });

  testWidgets('入力が正しいログインはAPIへ委譲される', (tester) async {
    final api = await _pumpScreen(tester);

    await tester.enterText(find.widgetWithText(TextFormField, 'メールアドレス'), 'test@example.com');
    await tester.enterText(find.widgetWithText(TextFormField, 'パスワード'), 'correct-horse');

    await tester.tap(find.text('ログインする'));
    await tester.pumpAndSettle();

    expect(api.loginCalls, 1);
    expect(api.lastEmail, 'test@example.com');
    expect(api.lastPassword, 'correct-horse');
  });

  testWidgets('入力が正しい登録はAPIへ委譲される', (tester) async {
    final api = await _pumpScreen(tester);

    await tester.tap(find.text('新規登録はこちら'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextFormField, 'メールアドレス'), 'new@example.com');
    await tester.enterText(find.widgetWithText(TextFormField, 'パスワード'), 'correct-horse');
    await tester.enterText(find.widgetWithText(TextFormField, 'パスワード(確認)'), 'correct-horse');

    await tester.tap(find.text('登録する'));
    await tester.pumpAndSettle();

    expect(api.registerCalls, 1);
    expect(api.lastEmail, 'new@example.com');
  });
}
