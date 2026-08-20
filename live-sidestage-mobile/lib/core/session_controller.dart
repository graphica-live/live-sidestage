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
  final LiveAnalyticsApi _api = LiveAnalyticsApi();
  final SessionStorage _storage = SessionStorage();
  final GoogleSignIn _googleSignIn = GoogleSignIn(
    serverClientId: googleServerClientId,
    scopes: ['email'],
  );

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
      final streamer = await _api.updateTiktokId(token: current.token, tiktokId: tiktokId);
      return current.withStreamer(token: current.token, streamer: streamer);
    });
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
