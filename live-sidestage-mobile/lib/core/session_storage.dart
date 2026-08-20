import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/auth_session.dart';

class SessionStorage {
  static const _storage = FlutterSecureStorage();

  static const _requiredKeys = ['token', 'userId', 'userName', 'userEmail', 'onboardingRequired'];
  static const _optionalKeys = ['streamerId', 'tiktokId', 'apiKey', 'verified'];

  Future<void> save(AuthSession session) async {
    final map = session.toStorageMap();
    for (final key in [..._requiredKeys, ..._optionalKeys]) {
      final value = map[key];
      if (value != null) {
        await _storage.write(key: key, value: value);
      } else {
        await _storage.delete(key: key);
      }
    }
  }

  Future<AuthSession?> load() async {
    final map = <String, String>{};
    for (final key in _requiredKeys) {
      final value = await _storage.read(key: key);
      if (value == null) return null;
      map[key] = value;
    }
    for (final key in _optionalKeys) {
      final value = await _storage.read(key: key);
      if (value != null) map[key] = value;
    }
    return AuthSession.fromStorageMap(map);
  }

  Future<void> clear() async {
    for (final key in [..._requiredKeys, ..._optionalKeys]) {
      await _storage.delete(key: key);
    }
  }
}
