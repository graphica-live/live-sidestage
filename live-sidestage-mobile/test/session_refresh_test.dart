import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/core/session_controller.dart';
import 'package:live_sidestage_mobile/core/session_storage.dart';
import 'package:live_sidestage_mobile/models/auth_session.dart';
import 'package:live_sidestage_mobile/screens/gift_sound_edit_screen.dart';

/// JWT(90日)が失効しても、常用のコメント受信は apiKey なので気づけない。
/// 401 を受けたときに無言でトークンを取り直せることを固定する。
class _FakeApi extends LiveAnalyticsApi {
  /// 再認証のたびに `new-1`, `new-2`, … と変わるトークンを配る。
  static const tokenPrefix = 'new';

  int authCalls = 0;
  int giftCalls = 0;
  int updateCalls = 0;

  /// このトークンでの呼び出しだけ成功させる。初期値は保存済みの `expired` と
  /// 一致しない値にしてある（＝サーバー側では既に失効している状態）。
  String validToken = 'server-side-only';

  String userId = 'u1';

  @override
  Future<AuthSession> authenticateWithGoogle({required String idToken}) async {
    authCalls++;
    validToken = '$tokenPrefix-$authCalls';
    return AuthSession(
      token: validToken,
      userId: userId,
      userName: 'me',
      userEmail: 'me@example.com',
      onboardingRequired: false,
      streamer: StreamerInfo(id: 's1', tiktokId: 'tt', apiKey: 'k', verified: true),
    );
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
  Future<StreamerInfo> updateTiktokId({required String token, required String tiktokId}) async {
    updateCalls++;
    if (token != validToken) {
      throw ApiException('認証が必要です', statusCode: 401);
    }
    return StreamerInfo(id: 's1', tiktokId: tiktokId, apiKey: 'k', verified: true);
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

AuthSession _expiredSession({String userId = 'u1'}) => AuthSession(
      token: 'expired',
      userId: userId,
      userName: 'me',
      userEmail: 'me@example.com',
      onboardingRequired: false,
      streamer: StreamerInfo(id: 's1', tiktokId: 'tt', apiKey: 'k', verified: true),
    );

SessionController _controller({
  required _FakeApi api,
  required _FakeStorage storage,
  required Future<String?> Function() silentIdToken,
}) {
  return SessionController(api: api, storage: storage, silentIdToken: silentIdToken)
    ..session = _expiredSession();
}

void main() {
  test('同時に呼んでも再認証は1回だけ', () async {
    final api = _FakeApi();
    final controller = _controller(
      api: api,
      storage: _FakeStorage(),
      silentIdToken: () async => 'id-token',
    );

    final results = await Future.wait([
      controller.refreshToken(),
      controller.refreshToken(),
      controller.refreshToken(),
    ]);

    expect(api.authCalls, 1);
    expect(results, ['new-1', 'new-1', 'new-1']);
    expect(controller.session!.token, 'new-1');
  });

  test('失敗したあとでも再度リフレッシュを試せる（進行中Futureを持ち越さない）', () async {
    final api = _FakeApi();
    var idToken = <String?>[null, 'id-token'];
    var call = 0;
    final controller = _controller(
      api: api,
      storage: _FakeStorage(),
      silentIdToken: () async => idToken[call++],
    );

    expect(await controller.refreshToken(), isNull);
    expect(await controller.refreshToken(), 'new-1');
  });

  test('無言サインインが通らないときはセッションを壊さない', () async {
    final api = _FakeApi();
    final storage = _FakeStorage();
    final controller = _controller(
      api: api,
      storage: storage,
      silentIdToken: () async => null,
    );

    expect(await controller.refreshToken(), isNull);
    expect(controller.session!.token, 'expired');
    expect(storage.saved, isNull);
    expect(storage.clears, 0);
  });

  test('オフラインで再認証が失敗してもセッションを壊さない', () async {
    final api = _FakeApi();
    final storage = _FakeStorage();
    final controller = _controller(
      api: api,
      storage: storage,
      silentIdToken: () async => throw ApiException('サーバーに接続できませんでした'),
    );

    expect(await controller.refreshToken(), isNull);
    expect(controller.session!.token, 'expired');
  });

  test('別のGoogleアカウントで再認証されたらセッションを上書きしない', () async {
    final api = _FakeApi()..userId = 'other';
    final storage = _FakeStorage();
    final controller = _controller(
      api: api,
      storage: storage,
      silentIdToken: () async => 'id-token',
    );

    expect(await controller.refreshToken(), isNull);
    expect(controller.session!.userId, 'u1');
    expect(storage.saved, isNull);
  });

  test('401ならトークンを取り直してギフト候補を取得し直す', () async {
    final api = _FakeApi();
    final controller = _controller(
      api: api,
      storage: _FakeStorage(),
      silentIdToken: () async => 'id-token',
    );

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
    final controller = _controller(
      api: api,
      storage: storage,
      silentIdToken: () async => 'id-token',
    );

    expect(await controller.changeTiktokId('newid'), isTrue);
    expect(api.updateCalls, 2);
    // 失効トークンを保存し直していないこと。
    expect(controller.session!.token, 'new-1');
    expect(storage.saved!.token, 'new-1');
    expect(controller.session!.streamer!.tiktokId, 'newid');
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
