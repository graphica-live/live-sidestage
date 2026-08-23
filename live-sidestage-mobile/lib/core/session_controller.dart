import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../models/auth_session.dart';
import 'api_client.dart';
import 'session_storage.dart';

/// android/app/build.gradle.kts の applicationId と一致させること。
/// Google Cloud ConsoleのAndroid OAuthクライアント登録に使う値。
const String androidPackageName = 'com.liveanalytics.live_sidestage_mobile';

class SessionController extends ChangeNotifier {
  /// 依存はテストのためだけに差し替え可能にしてある。既定は本番実装。
  SessionController({
    LiveAnalyticsApi? api,
    SessionStorage? storage,
    GoogleSignIn? googleSignIn,
    Future<String?> Function()? silentIdToken,
  })  : _api = api ?? LiveAnalyticsApi(),
        _storage = storage ?? SessionStorage(),
        _googleSignIn = googleSignIn ??
            GoogleSignIn(
              serverClientId: googleServerClientId,
              scopes: ['email'],
            ) {
    _silentIdToken = silentIdToken ?? _silentIdTokenFromGoogle;
  }

  final LiveAnalyticsApi _api;
  final SessionStorage _storage;
  final GoogleSignIn _googleSignIn;

  /// 無言でGoogleのidTokenを取り直す。取れなければ null（＝手動の再ログインが要る）。
  late final Future<String?> Function() _silentIdToken;

  /// 進行中のトークン再発行。複数のAPI呼び出しが同時に401になっても
  /// Googleのサインインを多重起動しないよう、同じ Future を共有する。
  Future<String?>? _refreshInFlight;

  AuthSession? session;
  bool initialized = false;
  bool isLoading = false;
  String? errorMessage;

  Future<void> loadPersisted() async {
    try {
      session = await _storage.load();
    } catch (_) {
      session = null;
    }
    initialized = true;
    notifyListeners();
  }

  Future<bool> signInWithGoogle() {
    return _run(() async {
      final GoogleSignInAccount? account;
      try {
        account = await _googleSignIn.signIn();
      } on PlatformException catch (e) {
        throw ApiException(_googleSignInMessage(e));
      }
      if (account == null) {
        throw ApiException('サインインがキャンセルされました');
      }
      final auth = await account.authentication;
      final idToken = auth.idToken;
      if (idToken == null) {
        throw ApiException('Google認証トークンの取得に失敗しました');
      }
      return _api.authenticateWithGoogle(idToken: idToken);
    });
  }

  /// Google Play services側の失敗を、原因が特定できる日本語メッセージに変換する。
  /// 特にcode 10(DEVELOPER_ERROR)は、Google Cloud Consoleに
  /// 「パッケージ名 + ビルド署名のSHA-1」でAndroid OAuthクライアントが
  /// 登録されていない場合に必ず発生する。applicationIdを変更した直後は要再登録。
  String _googleSignInMessage(PlatformException e) {
    final detail = e.message ?? '';
    if (detail.contains('10:') || detail.contains('DEVELOPER_ERROR')) {
      return 'Googleサインインの設定が未完了です(DEVELOPER_ERROR)。'
          'Google Cloud Consoleに、パッケージ名 $androidPackageName と'
          'このビルドの署名SHA-1でAndroid OAuthクライアントが登録されているか確認してください。';
    }
    if (e.code == 'network_error') {
      return 'ネットワークに接続できませんでした。通信状態を確認してください。';
    }
    return 'Googleサインインに失敗しました(${e.code})。';
  }

  Future<bool> completeOnboarding({required String tiktokId}) {
    final current = session;
    if (current == null) return Future.value(false);

    return _run(() async {
      final (token, streamer) = await _api.registerStreamer(
        token: current.token,
        tiktokId: tiktokId,
      );
      return current.withStreamer(token: token, streamer: streamer);
    });
  }

  Future<bool> changeTiktokId(String tiktokId) {
    final current = session;
    if (current == null) return Future.value(false);

    return _run(() async {
      try {
        final streamer = await _api.updateTiktokId(token: current.token, tiktokId: tiktokId);
        return current.withStreamer(token: current.token, streamer: streamer);
      } on ApiException catch (e) {
        if (!e.isUnauthorized) rethrow;
        final token = await refreshToken();
        if (token == null) rethrow;
        // リフレッシュ後は [session] が差し替わっている。キャプチャ済みの
        // [current] を戻り値の基底にすると、成功したのに失効トークンを
        // 保存し直してしまう。
        final refreshed = session ?? current;
        final streamer = await _api.updateTiktokId(token: token, tiktokId: tiktokId);
        return refreshed.withStreamer(token: token, streamer: streamer);
      }
    });
  }

  /// 失効した JWT を Google の無言サインインで取り直す。
  ///
  /// 成功したら新しいトークンを返し、保存済みセッションも差し替える。
  /// 取り直せなければ null を返す（手動の再ログインが要る）。**セッションは壊さない** ――
  /// オフラインや Play services 側の一時的な失敗でログアウト扱いにしないため。
  ///
  /// サーバーの JWT は90日で失効するが、常用のコメント受信は socket.io の
  /// apiKey で繋いでいて失効を検知できない。JWT を使う API（ギフト候補・TikTok ID 変更）が
  /// 401 を返したときにだけ、ここを通して1回やり直す。
  /// `MOBILE_JWT_SECRET` のローテーションで失効した場合も同じ経路で復帰する。
  Future<String?> refreshToken() {
    return _refreshInFlight ??= _doRefresh().whenComplete(() => _refreshInFlight = null);
  }

  Future<String?> _doRefresh() async {
    final current = session;
    if (current == null) return null;

    try {
      final idToken = await _silentIdToken();
      if (idToken == null) return null;

      final refreshed = await _api.authenticateWithGoogle(idToken: idToken);
      // 端末に別のGoogleアカウントが残っている場合に、他人のセッションで上書きしない。
      // 待っている間にログアウトされていた場合も、セッションを復活させない。
      if (session == null || refreshed.userId != current.userId) return null;

      await _storage.save(refreshed);
      session = refreshed;
      // isLoading / errorMessage は動かさない（[_run] を通さない）。背景での更新であり、
      // ログイン画面のスピナーやエラー表示を動かす種類の処理ではない。
      notifyListeners();
      return refreshed.token;
    } catch (_) {
      return null;
    }
  }

  Future<String?> _silentIdTokenFromGoogle() async {
    // reAuthenticate: true が要る。付けないと、同じプロセスが動き続けている間は
    // ネイティブ呼び出しをスキップして前回サインイン時の idToken（有効期限は約1時間）を
    // 返してくるため、常駐後のリフレッシュが必ず失敗する。
    final account = await _googleSignIn.signInSilently(reAuthenticate: true);
    if (account == null) return null;
    return (await account.authentication).idToken;
  }

  Future<bool> _run(Future<AuthSession> Function() action) async {
    isLoading = true;
    errorMessage = null;
    notifyListeners();

    try {
      final result = await action();
      await _storage.save(result);
      session = result;
      return true;
    } on ApiException catch (e) {
      errorMessage = e.message;
      return false;
    } catch (e) {
      // 想定外の例外もUIに出す。握り潰すと「押しても何も起きない」状態になる。
      errorMessage = '予期しないエラーが発生しました: $e';
      return false;
    } finally {
      isLoading = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await _storage.clear();
    try {
      await _googleSignIn.signOut();
    } catch (_) {
      // ignore — ローカルセッションは既にクリア済み
    }
    session = null;
    notifyListeners();
  }
}
