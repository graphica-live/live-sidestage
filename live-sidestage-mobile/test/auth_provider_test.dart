// 認証プロバイダ(Google / Apple)の取り回し。
//
// Apple には Google の `signInSilently` に相当するものが無いので、
// **どちらでログインしたか**を覚えていないと、Apple のセッションで
// Google の無言サインインを走らせてしまう。保存済みセッションの後方互換も含めて固定する。
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/core/session_storage.dart';
import 'package:live_sidestage_mobile/models/auth_session.dart';

AuthSession _session({
  AuthProvider provider = AuthProvider.google,
  StreamerInfo? streamer,
}) =>
    AuthSession(
      token: 'tok',
      userId: 'u1',
      userName: 'me',
      userEmail: 'me@example.com',
      onboardingRequired: streamer == null,
      provider: provider,
      streamer: streamer,
    );

class _FakeApi extends LiveAnalyticsApi {
  int googleAuthCalls = 0;

  @override
  Future<AuthSession> authenticateWithGoogle({required String idToken}) async {
    googleAuthCalls++;
    return _session();
  }
}

class _FakeStorage extends SessionStorage {
  AuthSession? saved;
  int clears = 0;

  @override
  Future<void> save(AuthSession session) async => saved = session;

  @override
  Future<AuthSession?> load() async => saved;

  @override
  Future<void> clear() async {
    clears++;
    saved = null;
  }
}

class _FakeGoogleSignIn extends GoogleSignIn {
  int signOuts = 0;

  @override
  Future<GoogleSignInAccount?> signOut() async {
    signOuts++;
    return null;
  }
}

void main() {
  group('保存済みセッションの provider', () {
    test('往復しても失われない', () {
      final restored = AuthSession.fromStorageMap(_session(provider: AuthProvider.apple).toStorageMap());
      expect(restored.provider, AuthProvider.apple);
    });

    test('provider が無い古い保存データは google として読む（更新しただけでログアウトさせない）', () {
      final map = _session().toStorageMap()..remove('provider');
      expect(AuthSession.fromStorageMap(map).provider, AuthProvider.google);
    });

    test('知らない provider は破損として読み込まない', () {
      final map = _session().toStorageMap()..['provider'] = 'facebook';
      expect(() => AuthSession.fromStorageMap(map), throwsA(isA<FormatException>()));
    });

    test('SessionStorage が provider を保存対象にしている', () {
      // 必須キーに入れてしまうと、この機能より前の端末はセッションごと消える。
      expect(_session(provider: AuthProvider.apple).toStorageMap().containsKey('provider'), isTrue);
    });

    test('オンボーディング完了(withStreamer)後も provider を引き継ぐ', () {
      final session = _session(provider: AuthProvider.apple).withStreamer(
        token: 'tok2',
        streamer: StreamerInfo(id: 's1', tiktokId: 'tt', apiKey: 'k', verified: true),
      );
      expect(session.provider, AuthProvider.apple);
    });

    test('サーバー応答から作るときは呼び出し側が provider を決める', () {
      final session = AuthSession.fromJson(
        {
          'token': 'tok',
          'user': {'id': 'u1', 'name': 'me', 'email': 'me@example.com'},
          'streamer': null,
          'onboardingRequired': true,
        },
        provider: AuthProvider.apple,
      );
      expect(session.provider, AuthProvider.apple);
      expect(session.onboardingRequired, isTrue);
    });
  });

  group('Apple セッションの扱い', () {
    test('無言リフレッシュを試みない（Google のサインインを走らせない）', () async {
      final api = _FakeApi();
      var silentCalls = 0;
      final controller = SessionController(
        api: api,
        storage: _FakeStorage(),
        googleSignIn: _FakeGoogleSignIn(),
        silentIdToken: () async {
          silentCalls++;
          return 'id-token';
        },
      )..session = _session(provider: AuthProvider.apple);

      expect(await controller.refreshToken(), isNull);
      expect(silentCalls, 0);
      expect(api.googleAuthCalls, 0);
      // セッションは壊さない（手動の再ログインに委ねる）。
      expect(controller.session, isNotNull);
    });

    test('ログアウトで Google のサインアウトを呼ばない', () async {
      final google = _FakeGoogleSignIn();
      final storage = _FakeStorage();
      final controller = SessionController(
        api: _FakeApi(),
        storage: storage,
        googleSignIn: google,
      )..session = _session(provider: AuthProvider.apple);

      await controller.logout();

      expect(google.signOuts, 0);
      expect(storage.clears, 1);
      expect(controller.session, isNull);
    });

    test('Google セッションのログアウトでは従来どおりサインアウトする', () async {
      final google = _FakeGoogleSignIn();
      final controller = SessionController(
        api: _FakeApi(),
        storage: _FakeStorage(),
        googleSignIn: google,
      )..session = _session();

      await controller.logout();

      expect(google.signOuts, 1);
    });
  });

  group('Apple サインイン', () {
    test('Services ID が未設定のビルドではボタンを出さない', () {
      // dart-define を渡していないテスト実行では常に未設定。
      expect(isAppleSignInConfigured, isFalse);
      expect(appleServicesId, isEmpty);
    });

    test('未設定のまま呼ばれたらエラーにする（Apple まで飛ばさない）', () async {
      final controller = SessionController(
        api: _FakeApi(),
        storage: _FakeStorage(),
        googleSignIn: _FakeGoogleSignIn(),
        appleCredential: ({required nonce, required state}) async {
          fail('Apple の認証画面を開いてはいけない');
        },
      );

      expect(await controller.signInWithApple(), isFalse);
      expect(controller.errorMessage, contains('利用できません'));
    });
  });
}
