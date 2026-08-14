import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/auth_session.dart';

class SessionStorage {
  static const _storage = FlutterSecureStorage();

  static const _keys = [
    'token',
    'userId',
    'userName',
    'userEmail',
    'streamerId',
    'tiktokId',
    'apiKey',
    'verified',
  ];

  Future<void> save(AuthSession session) async {
    final map = session.toStorageMap();
    for (final key in _keys) {
      await _storage.write(key: key, value: map[key]);
    }
  }

  Future<AuthSession?> load() async {
    final map = <String, String>{};
    for (final key in _keys) {
      final value = await _storage.read(key: key);
      if (value == null) return null;
      map[key] = value;
    }
    return AuthSession.fromStorageMap(map);
  }

  Future<void> clear() async {
    for (final key in _keys) {
      await _storage.delete(key: key);
    }
  }
}
