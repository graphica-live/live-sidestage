import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/auth_session.dart';

class SessionStorage {
  static const _storage = FlutterSecureStorage();

  static const _requiredKeys = ['token', 'userId', 'userName', 'userEmail', 'onboardingRequired'];

  /// `provider` は **必須キーにしない**。必須にすると、この機能より前に
  /// ログインした端末は読み込み時に null 判定でセッションごと消える。
  /// 欠落時の扱いは [AuthSession.fromStorageMap] 側で google に寄せている。
  static const _optionalKeys = ['streamerId', 'tiktokId', 'apiKey', 'verified', 'provider'];

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
