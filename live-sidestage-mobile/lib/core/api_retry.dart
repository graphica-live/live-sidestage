import 'api_client.dart';

/// 401(トークン失効)を1回だけ無言リフレッシュしてから再試行する汎用ヘルパー。
///
/// `gift_sound_edit_screen.dart` の `fetchGiftCandidatesWithRefresh` と同じパターンを
/// 汎用化したもの。既存の専用実装はそのまま残し、無理に統合しない。
///
/// **403(権限不足)はリフレッシュ対象にしない。** トークンが有効なまま権限だけ無い状態は
/// 再ログインでは解決せず、`isUnauthorized` と混同すると無言サインインを無駄に繰り返す
/// ([ApiException.isForbidden] 参照)。
Future<T> withTokenRefresh<T>({
  required Future<T> Function(String token) call,
  required String token,
  required Future<String?> Function() refreshToken,
}) async {
  try {
    return await call(token);
  } on ApiException catch (e) {
    if (!e.isUnauthorized) rethrow;
    final refreshed = await refreshToken();
    if (refreshed == null) rethrow;
    return call(refreshed);
  }
}
