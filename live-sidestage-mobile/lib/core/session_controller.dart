import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../models/auth_session.dart';
import 'api_client.dart';
import 'session_storage.dart';

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
      final account = await _googleSignIn.signIn();
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
