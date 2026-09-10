import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/core/session_storage.dart';
import 'package:live_sidestage_mobile/core/token_refresh_result.dart';
import 'package:live_sidestage_mobile/models/auth_session.dart';
import 'package:live_sidestage_mobile/screens/gift_sound_edit_screen.dart';

/// 実プラグインを叩かせない（plain `test()` にはplatform channelのbindingが無い）。
class _FakeGoogleSignIn extends GoogleSignIn {
  int signOuts = 0;

  @override
  Future<GoogleSignInAccount?> signOut() async {
    signOuts++;
    return null;
  }
}

/// access token は短命なので通常の利用でも失効する。失効したら refresh token を
/// 交換して無言で取り直せること（**プロバイダに依らず**）を固定する。
class _FakeApi extends LiveAnalyticsApi {
  /// rotation のたびに `new-1`, `new-2`, … と変わる access token を配る。
  static const tokenPrefix = 'new';

  int refreshCalls = 0;
  int giftCalls = 0;
  int updateCalls = 0;
  int logoutCalls = 0;
  String? lastLogoutRefreshToken;

  /// このトークンでの呼び出しだけ成功させる。初期値は保存済みの `expired` と
  /// 一致しない値にしてある（＝サーバー側では既に失効している状態）。
  String validToken = 'server-side-only';

  /// サーバーが受け付ける唯一の refresh token。**rotation のたびに変わる**
  /// （1回使い切り）。
  String validRefreshToken = 'r-0';

  /// 設定すると refreshAccessToken がこの例外を投げる。
  ApiException? refreshError;

  @override
  Future<(String token, String refreshToken)> refreshAccessToken({
    required String refreshToken,
  }) async {
    refreshCalls++;
    final error = refreshError;
    if (error != null) throw error;
    if (refreshToken != validRefreshToken) {
      throw ApiException('再ログインが必要です', statusCode: 401, code: 'INVALID_REFRESH_TOKEN');
    }
    validToken = '$tokenPrefix-$refreshCalls';
    validRefreshToken = 'r-$refreshCalls';
    return (validToken, validRefreshToken);
  }

  @override
  Future<void> logoutSession({required String refreshToken}) async {
    logoutCalls++;
    lastLogoutRefreshToken = refreshToken;
  }

  @override
  Future<List<GiftCandidate>> fetchGiftCandidates({required String token}) async {
    giftCalls++;
    if (token != validToken) {
      throw ApiException('認証が必要です', statusCode: 401);
    }
    return const [GiftCandidate.single(name: 'rose', label: 'Rose', diamondCount: 1)];
  }

  @override
  Future<StreamerInfo> updateTiktokHandle({
    required String token,
    required String tiktokHandle,
  }) async {
    updateCalls++;
    if (token != validToken) {
      throw ApiException('認証が必要です', statusCode: 401);
    }
    return StreamerInfo(id: 's1', tiktokHandle: tiktokHandle, verified: true);
  }

  int deleteAccountCalls = 0;

  /// 設定するとdeleteAccountがこの例外を投げる（サーバー側のfail-closedを模す）。
  ApiException? deleteAccountError;

  @override
  Future<void> deleteAccount({required String token}) async {
    deleteAccountCalls++;
    final error = deleteAccountError;
    if (error != null) throw error;
  }
}

/// secure storage は platform channel なのでテストでは触らせない。
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

AuthSession _expiredSession({
  String userId = 'u1',
  AuthProvider provider = AuthProvider.google,
}) =>
    AuthSession(
      token: 'expired',
      refreshToken: 'r-0',
      userId: userId,
      userName: 'me',
      userEmail: 'me@example.com',
      onboardingRequired: false,
      provider: provider,
      streamer: StreamerInfo(id: 's1', tiktokHandle: 'tt', verified: true),
    );

SessionController _controller({
  required _FakeApi api,
  required _FakeStorage storage,
  AuthProvider provider = AuthProvider.google,
}) {
  return SessionController(
    api: api,
    storage: storage,
    googleSignIn: _FakeGoogleSignIn(),
  )..session = _expiredSession(provider: provider);
}

void main() {
  test('同時に呼んでも refresh token の交換は1回だけ', () async {
    // **必須の直列化。** refresh token は1回使い切りなので、同じ値で並行に
    // 交換を試みるとサーバー側の reuse 検知(family全体の失効)に触れうる。
    final api = _FakeApi();
    final controller = _controller(api: api, storage: _FakeStorage());

    final results = await Future.wait([
      controller.refreshToken(),
      controller.refreshToken(),
      controller.refreshToken(),
    ]);

    expect(api.refreshCalls, 1);
    expect(results, ['new-1', 'new-1', 'new-1']);
    expect(controller.session!.token, 'new-1');
  });

  test('rotation では access token と refresh token を対で差し替える', () async {
    // 片方だけ更新すると、次の再発行で無効化済みの refresh token を提示して
    // family ごと失効させられる。
    final api = _FakeApi();
    final storage = _FakeStorage();
    final controller = _controller(api: api, storage: storage);

    expect(await controller.refreshToken(), 'new-1');
    expect(controller.session!.refreshToken, 'r-1');
    expect(storage.saved!.token, 'new-1');
    expect(storage.saved!.refreshToken, 'r-1');

    // 保存し直した新しい refresh token で、続けてもう一度取り直せる。
    expect(await controller.refreshToken(), 'new-2');
  });

  test('プロバイダに依らず再発行できる（Apple/メールも同じ経路）', () async {
    for (final provider in [AuthProvider.apple, AuthProvider.email]) {
      final api = _FakeApi();
      final controller = _controller(api: api, storage: _FakeStorage(), provider: provider);

      expect(await controller.refreshToken(), 'new-1');
      expect(api.refreshCalls, 1);
    }
  });

  test('失敗したあとでも再度リフレッシュを試せる（進行中Futureを持ち越さない）', () async {
    final api = _FakeApi()..refreshError = ApiException('サーバーが混み合っています', statusCode: 503);
    final controller = _controller(api: api, storage: _FakeStorage());

    expect(await controller.refreshToken(), isNull);
    api.refreshError = null;
    expect(await controller.refreshToken(), 'new-2');
  });

  test('refreshTokenDetailed: 成功したら TokenRefreshed を返す', () async {
    final api = _FakeApi();
    final controller = _controller(api: api, storage: _FakeStorage());

    final result = await controller.refreshTokenDetailed();
    expect(result, isA<TokenRefreshed>());
    expect(result.token, 'new-1');
  });

  test('refreshTokenDetailed: refresh token 失効は TokenRefreshRejected を返す（一時的失敗と混同しない）', () async {
    final api = _FakeApi()..validRefreshToken = 'rotated-elsewhere';
    final controller = _controller(api: api, storage: _FakeStorage());

    final result = await controller.refreshTokenDetailed();
    expect(result, isA<TokenRefreshRejected>());
    expect(result.token, isNull);
  });

  test('refreshTokenDetailed: 通信断・5xxは TokenRefreshFailed を返す（再ログイン扱いにしない）', () async {
    final api = _FakeApi()..refreshError = ApiException('サーバーが混み合っています', statusCode: 503);
    final controller = _controller(api: api, storage: _FakeStorage());

    final result = await controller.refreshTokenDetailed();
    expect(result, isA<TokenRefreshFailed>());
    expect(result.token, isNull);
  });

  test('refresh token が拒否されてもセッションは壊さない', () async {
    // 再ログインが要る状態だが、破棄の判断は呼び出し側の導線に委ねる。
    final api = _FakeApi()..validRefreshToken = 'rotated-elsewhere';
    final storage = _FakeStorage();
    final controller = _controller(api: api, storage: storage);

    expect(await controller.refreshToken(), isNull);
    expect(controller.session!.token, 'expired');
    expect(storage.saved, isNull);
    expect(storage.clears, 0);
  });

  test('オフラインで再発行が失敗してもセッションを壊さない', () async {
    final api = _FakeApi()..refreshError = ApiException('サーバーに接続できませんでした');
    final storage = _FakeStorage();
    final controller = _controller(api: api, storage: storage);

    expect(await controller.refreshToken(), isNull);
    expect(controller.session!.token, 'expired');
    expect(storage.clears, 0);
  });

  test('待っている間にログアウトされていたらセッションを復活させない', () async {
    final api = _FakeApi();
    final controller = _controller(api: api, storage: _FakeStorage());

    final refreshing = controller.refreshToken();
    controller.session = null;

    expect(await refreshing, isNull);
    expect(controller.session, isNull);
  });

  test('背景Isolateが rotation したペアを取り込める', () async {
    final storage = _FakeStorage();
    final controller = _controller(api: _FakeApi(), storage: storage);

    await controller.adoptTokens(token: 'bg-token', refreshToken: 'bg-refresh');

    expect(controller.session!.token, 'bg-token');
    expect(controller.session!.refreshToken, 'bg-refresh');
    expect(storage.saved!.refreshToken, 'bg-refresh');
  });

  test('401ならトークンを取り直してギフト候補を取得し直す', () async {
    final api = _FakeApi();
    final controller = _controller(api: api, storage: _FakeStorage());

    final gifts = await fetchGiftCandidatesWithRefresh(
      api: api,
      token: controller.session!.token,
      refreshToken: controller.refreshToken,
    );

    expect(gifts.single.name, 'rose');
    expect(api.giftCalls, 2); // 401 → リフレッシュ → 1回だけやり直す
  });

  test('リフレッシュできなければ401をそのまま投げる（再ログイン導線へ）', () async {
    final api = _FakeApi();

    await expectLater(
      fetchGiftCandidatesWithRefresh(
        api: api,
        token: 'expired',
        refreshToken: () async => null,
      ),
      throwsA(isA<ApiException>().having((e) => e.isUnauthorized, 'isUnauthorized', isTrue)),
    );
    expect(api.giftCalls, 1);
  });

  test('401以外はリフレッシュせずそのまま投げる', () async {
    final api = _FakeApi();
    var refreshCalls = 0;

    await expectLater(
      fetchGiftCandidatesWithRefresh(
        api: _FailingApi(statusCode: 404),
        token: 'expired',
        refreshToken: () async {
          refreshCalls++;
          return 'new-1';
        },
      ),
      throwsA(isA<ApiException>()),
    );
    expect(refreshCalls, 0);
    expect(api.giftCalls, 0);
  });

  test('TikTok ID 変更も401でトークンを取り直し、新しいトークンを保存する', () async {
    final api = _FakeApi();
    final storage = _FakeStorage();
    final controller = _controller(api: api, storage: storage);

    expect(await controller.changeTiktokHandle('newid'), isTrue);
    expect(api.updateCalls, 2);
    // 失効トークンを保存し直していないこと。
    expect(controller.session!.token, 'new-1');
    expect(storage.saved!.token, 'new-1');
    // access token だけの再発行なので refresh token は据え置き。
    expect(storage.saved!.refreshToken, 'r-1');
    expect(controller.session!.streamer!.tiktokHandle, 'newid');
  });

  group('logout', () {
    test('サーバー側の family 失効を呼んでからローカルを消す', () async {
      final api = _FakeApi();
      final storage = _FakeStorage();
      final controller = _controller(api: api, storage: storage);

      await controller.logout();

      expect(api.logoutCalls, 1);
      expect(api.lastLogoutRefreshToken, 'r-0');
      expect(storage.clears, 1);
      expect(controller.session, isNull);
    });
  });

  group('deleteAccount', () {
    test('成功したらセッションとローカルストレージを消す', () async {
      final api = _FakeApi();
      final storage = _FakeStorage();
      final controller = _controller(api: api, storage: storage);

      final result = await controller.deleteAccount();

      expect(result, isTrue);
      expect(api.deleteAccountCalls, 1);
      expect(controller.session, isNull);
      expect(storage.clears, 1);
      expect(controller.errorMessage, isNull);
    });

    test('サーバー側が失敗(fail-closed)ならセッションを壊さずfalseを返す', () async {
      final api = _FakeApi()..deleteAccountError = ApiException('Stripe解約に失敗しました', statusCode: 500);
      final storage = _FakeStorage();
      final controller = _controller(api: api, storage: storage);

      final result = await controller.deleteAccount();

      expect(result, isFalse);
      expect(controller.session, isNotNull);
      expect(controller.errorMessage, 'Stripe解約に失敗しました');
      expect(storage.clears, 0);
    });

    test('失敗後は通常どおりtoken refreshできる(削除中フラグを引きずらない)', () async {
      final api = _FakeApi()..deleteAccountError = ApiException('失敗', statusCode: 500);
      final controller = _controller(api: api, storage: _FakeStorage());

      expect(await controller.deleteAccount(), isFalse);
      expect(await controller.refreshToken(), 'new-1');
    });

    // 削除リクエスト送信中に割り込んだ token refresh が、消えたUserのために
    // 無駄なトークンを発行しに行かないことを固定する。_deleting は deleteAccount() の
    // 最初のawaitより前に同期的に立つので、直後に呼んだ refreshToken() は
    // _doRefresh() の入り口で早期returnする。
    test('削除中に割り込んだtoken refreshは再発行を試みない', () async {
      final api = _FakeApi();
      final controller = _controller(api: api, storage: _FakeStorage());

      final deleteFuture = controller.deleteAccount();
      final refreshResult = await controller.refreshToken();

      expect(refreshResult, isNull);
      expect(api.refreshCalls, 0);
      expect(await deleteFuture, isTrue);
    });
  });
}

class _FailingApi extends LiveAnalyticsApi {
  _FailingApi({required this.statusCode});

  final int statusCode;

  @override
  Future<List<GiftCandidate>> fetchGiftCandidates({required String token}) async {
    throw ApiException('TikTokアカウントが未登録です', statusCode: statusCode);
  }
}
