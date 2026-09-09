import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/auth_session.dart';

/// Foreground Service Isolate 側が持つ access token の永続化キー。
///
/// **メイン Isolate の [SessionStorage]（`flutter_secure_storage`）とは別の保存先。**
/// headless な背景 Isolate からは secure storage のプラットフォームチャネルを
/// 安定して使えないため、背景側は `FlutterForegroundTask.saveData` / `getData` を使う。
/// 2箇所に同じ資格情報が載るので、**どちらかで rotation したら必ずもう片方へ
/// 伝播させること**（`background_task_handler.dart` / `home_screen.dart`）。
const String foregroundTokenStorageKey = 'token';

/// 同上、refresh token 側。
const String foregroundRefreshTokenStorageKey = 'refreshToken';

class SessionStorage {
  static const _storage = FlutterSecureStorage();

  /// `refreshToken` は **必須キー**。これを持たないセッションは access token を
  /// 取り直せず、失効した時点で無言で壊れる（socket 接続も HTTP API も通らなくなる）。
  /// 欠落していたら未ログインとして扱い、再ログインさせるほうが安全。
  static const _requiredKeys = [
    'token',
    'refreshToken',
    'userId',
    'userName',
    'userEmail',
    'onboardingRequired',
  ];

  /// `provider` は **必須キーにしない**。必須にすると、この機能より前に
  /// ログインした端末は読み込み時に null 判定でセッションごと消える。
  /// 欠落時の扱いは [AuthSession.fromStorageMap] 側で google に寄せている。
  static const _optionalKeys = ['streamerId', 'tiktokHandle', 'verified', 'provider'];

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
