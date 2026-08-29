// 認証プロバイダ(Google / Apple)の取り回し。
//
// Apple には Google の `signInSilently` に相当するものが無いので、
// **どちらでログインしたか**を覚えていないと、Apple のセッションで
// Google の無言サインインを走らせてしまう。保存済みセッションの後方互換も含めて固定する。
import 'dart:async';

import 'package:fake_async/fake_async.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/core/session_storage.dart';
import 'package:live_sidestage_mobile/models/auth_session.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

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
  int appleAuthCalls = 0;
  int emailRegisterCalls = 0;
  int emailLoginCalls = 0;
  String? lastNonce;
  Object? emailLoginError;

  @override
  Future<AuthSession> authenticateWithGoogle({required String idToken}) async {
    googleAuthCalls++;
    return _session();
  }

  @override
  Future<AuthSession> authenticateWithApple({
    required String authorizationCode,
    required String nonce,
    String? givenName,
    String? familyName,
  }) async {
    appleAuthCalls++;
    lastNonce = nonce;
    return _session(provider: AuthProvider.apple);
  }

  @override
  Future<AuthSession> registerWithEmail({required String email, required String password}) async {
    emailRegisterCalls++;
    return _session(provider: AuthProvider.email);
  }

  @override
  Future<AuthSession> loginWithEmail({required String email, required String password}) async {
    emailLoginCalls++;
    if (emailLoginError != null) throw emailLoginError!;
    return _session(provider: AuthProvider.email);
  }
}

AuthorizationCredentialAppleID _credential({required String? state}) =>
    AuthorizationCredentialAppleID(
      userIdentifier: null,
      givenName: '太郎',
      familyName: '山田',
      authorizationCode: 'code-1',
      email: null,
      identityToken: null,
      state: state,
    );

/// Apple の設定が入っているビルドを模した controller。
///
/// [watchAppResumeOnApple] は既定で true にしてある — このファイルのテストは
/// Android の Custom Tab フロー(復帰監視で打ち切る挙動)を検証するものが多く、
/// 実際の既定値([Platform.isAndroid])はテストを実行しているホストOSに左右されて
/// しまう(macOS上でflutter testを回すとfalseになる)ため。
SessionController _appleController({
  required _FakeApi api,
  required AppleCredentialFetcher appleCredential,
  AppResumeWatcher? watchAppResume,
  bool watchAppResumeOnApple = true,
}) =>
    SessionController(
      api: api,
      storage: _FakeStorage(),
      googleSignIn: _FakeGoogleSignIn(),
      appleSignInEnabled: true,
      appleCredential: appleCredential,
      watchAppResume: watchAppResume ?? (_) => () {},
      watchAppResumeOnApple: watchAppResumeOnApple,
    );

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

  group('メールアドレス+パスワード認証', () {
    test('新規登録に成功するとメールセッションになる', () async {
      final api = _FakeApi();
      final controller = SessionController(
        api: api,
        storage: _FakeStorage(),
        googleSignIn: _FakeGoogleSignIn(),
      );

      final success = await controller.registerWithEmail(
        email: 'test@example.com',
        password: 'correct-horse',
      );

      expect(success, isTrue);
      expect(api.emailRegisterCalls, 1);
      expect(controller.session!.provider, AuthProvider.email);
    });

    test('ログインに成功するとメールセッションになる', () async {
      final api = _FakeApi();
      final controller = SessionController(
        api: api,
        storage: _FakeStorage(),
        googleSignIn: _FakeGoogleSignIn(),
      );

      final success = await controller.signInWithEmail(
        email: 'test@example.com',
        password: 'correct-horse',
      );

      expect(success, isTrue);
      expect(api.emailLoginCalls, 1);
      expect(controller.session!.provider, AuthProvider.email);
    });

    test('ログイン失敗はエラーメッセージに反映される', () async {
      final api = _FakeApi()..emailLoginError = ApiException('メールアドレスまたはパスワードが正しくありません');
      final controller = SessionController(
        api: api,
        storage: _FakeStorage(),
        googleSignIn: _FakeGoogleSignIn(),
      );

      final success = await controller.signInWithEmail(
        email: 'test@example.com',
        password: 'wrong',
      );

      expect(success, isFalse);
      expect(controller.session, isNull);
      expect(controller.errorMessage, 'メールアドレスまたはパスワードが正しくありません');
    });

    test('メールセッションのログアウトでは Google のサインアウトを呼ばない', () async {
      final google = _FakeGoogleSignIn();
      final storage = _FakeStorage();
      final controller = SessionController(
        api: _FakeApi(),
        storage: storage,
        googleSignIn: google,
      )..session = _session(provider: AuthProvider.email);

      await controller.logout();

      expect(google.signOuts, 0);
      expect(storage.clears, 1);
      expect(controller.session, isNull);
    });

    test('メールセッションは無言リフレッシュを試みない', () async {
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
      )..session = _session(provider: AuthProvider.email);

      expect(await controller.refreshToken(), isNull);
      expect(silentCalls, 0);
      expect(api.googleAuthCalls, 0);
      expect(controller.session, isNotNull);
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

    test('state が一致したときだけサーバーへ送る', () async {
      final api = _FakeApi();
      String? seenNonce;
      final controller = _appleController(
        api: api,
        appleCredential: ({required nonce, required state}) async {
          seenNonce = nonce;
          return _credential(state: state);
        },
      );

      expect(await controller.signInWithApple(), isTrue);
      expect(api.appleAuthCalls, 1);
      // 端末が生成した nonce をそのままサーバーへ渡していること。
      expect(api.lastNonce, seenNonce);
      expect(controller.session!.provider, AuthProvider.apple);
    });

    test('nonce と state は毎回作り直す（使い回さない）', () async {
      final api = _FakeApi();
      final seen = <String>{};
      final controller = _appleController(
        api: api,
        appleCredential: ({required nonce, required state}) async {
          seen.addAll([nonce, state]);
          return _credential(state: state);
        },
      );

      await controller.signInWithApple();
      await controller.signInWithApple();

      // 2回分の nonce/state が4つとも別物。
      expect(seen.length, 4);
    });

    test('state が一致しなければサーバーを呼ばない（他人の認証結果を投げ込まれた場合）', () async {
      final api = _FakeApi();
      final controller = _appleController(
        api: api,
        appleCredential: ({required nonce, required state}) async {
          return _credential(state: 'attacker-state');
        },
      );

      expect(await controller.signInWithApple(), isFalse);
      expect(api.appleAuthCalls, 0);
      expect(controller.session, isNull);
      expect(controller.errorMessage, contains('照合に失敗'));
    });

    test('state が欠けていてもサーバーを呼ばない', () async {
      final api = _FakeApi();
      final controller = _appleController(
        api: api,
        appleCredential: ({required nonce, required state}) async => _credential(state: null),
      );

      expect(await controller.signInWithApple(), isFalse);
      expect(api.appleAuthCalls, 0);
    });

    test('Custom Tab を閉じて戻ってきたらキャンセル扱いにする（スピナーが固まらない）', () {
      // Android のプラグインは、認証を完了せずタブを閉じられると Future を
      // 永久に resolve しない。復帰を検知して打ち切れることを固定する。
      fakeAsync((async) {
        final api = _FakeApi();
        late VoidCallback fireResume;
        final controller = _appleController(
          api: api,
          // 解決しない Future = タブを閉じられた状態。
          appleCredential: ({required nonce, required state}) => Completer<AuthorizationCredentialAppleID>().future,
          watchAppResume: (onResumed) {
            fireResume = onResumed;
            return () {};
          },
        );

        bool? result;
        controller.signInWithApple().then((value) => result = value);
        async.flushMicrotasks();
        expect(controller.isLoading, isTrue);

        fireResume();
        async.elapse(const Duration(seconds: 5));

        expect(result, isFalse);
        expect(controller.isLoading, isFalse);
        expect(api.appleAuthCalls, 0);
        expect(controller.errorMessage, contains('キャンセル'));
      });
    });

    test('復帰直後に結果が届く正常系では打ち切らない', () {
      fakeAsync((async) {
        final api = _FakeApi();
        final pending = Completer<AuthorizationCredentialAppleID>();
        String? issuedState;
        late VoidCallback fireResume;
        final controller = _appleController(
          api: api,
          appleCredential: ({required nonce, required state}) {
            issuedState = state;
            return pending.future;
          },
          watchAppResume: (onResumed) {
            fireResume = onResumed;
            return () {};
          },
        );

        bool? result;
        controller.signInWithApple().then((value) => result = value);
        async.flushMicrotasks();

        // 復帰 → 猶予の内側で callback が解決する。
        fireResume();
        async.elapse(const Duration(seconds: 1));
        pending.complete(_credential(state: issuedState));
        async.elapse(const Duration(seconds: 5));

        expect(result, isTrue);
        expect(api.appleAuthCalls, 1);
      });
    });

    test('iOSではCustom Tabの復帰監視を使わず、プラグインのFutureをそのまま待つ', () {
      // iOS/macOSはネイティブシートなのでプラグインのFutureが必ず解決する。
      // Android専用の復帰監視(3秒の偽キャンセル猶予)を通すと、正常系なのに
      // 打ち切られる理論的余地があるため、iOSでは監視自体を無効化する。
      fakeAsync((async) {
        final api = _FakeApi();
        var watchAppResumeCalled = false;
        final controller = _appleController(
          api: api,
          appleCredential: ({required nonce, required state}) async => _credential(state: state),
          watchAppResume: (onResumed) {
            watchAppResumeCalled = true;
            return () {};
          },
          watchAppResumeOnApple: false,
        );

        bool? result;
        controller.signInWithApple().then((value) => result = value);
        async.flushMicrotasks();

        expect(result, isTrue);
        expect(api.appleAuthCalls, 1);
        expect(watchAppResumeCalled, isFalse);
      });
    });
  });
}
