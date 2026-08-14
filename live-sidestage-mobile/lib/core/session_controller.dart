import 'package:flutter/foundation.dart';

import '../models/auth_session.dart';
import 'api_client.dart';
import 'session_storage.dart';

class SessionController extends ChangeNotifier {
  final LiveAnalyticsApi _api = LiveAnalyticsApi();
  final SessionStorage _storage = SessionStorage();

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

  Future<bool> register({
    required String name,
    required String email,
    required String password,
    required String tiktokId,
  }) {
    return _run(() => _api.register(
          name: name,
          email: email,
          password: password,
          tiktokId: tiktokId,
        ));
  }

  Future<bool> login({required String email, required String password}) {
    return _run(() => _api.login(email: email, password: password));
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
    session = null;
    notifyListeners();
  }
}
