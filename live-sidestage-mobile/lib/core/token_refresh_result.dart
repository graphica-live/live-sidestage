import 'api_client.dart';

/// access token 再発行の結果。
///
/// **`null` に潰さない。** refresh token 自体が失効した（再ログインが要る）のか、
/// 通信断・5xx等の一時的な失敗（再試行すれば直りうる）なのかを呼び出し側が
/// 区別できるようにするための型。socket の `TOKEN_EXPIRED` 表示・再試行の
/// 契機はこの区別に依存する（[ApiException.isRefreshTokenRejected] 参照）。
sealed class TokenRefreshResult {
  const TokenRefreshResult();

  /// 成功時のみ非null。
  String? get token => null;
}

/// 再発行に成功した。
final class TokenRefreshed extends TokenRefreshResult {
  const TokenRefreshed(this._token);

  final String _token;

  @override
  String get token => _token;
}

/// refresh token 自体が使えない（失効・reuse検知）。**再試行しても直らない。**
/// 再ログインへ倒してよい。
final class TokenRefreshRejected extends TokenRefreshResult {
  const TokenRefreshRejected(this.error);

  final Object error;
}

/// 通信断・5xx・想定外の失敗。**一時的。** 再試行すれば直りうるので、
/// 呼び出し側は再ログイン扱いにせず後で取り直すこと。
final class TokenRefreshFailed extends TokenRefreshResult {
  const TokenRefreshFailed(this.error);

  final Object error;
}

/// [LiveAnalyticsApi.refreshAccessToken] が投げた例外から結果種別を判定する。
///
/// [ApiException.isRefreshTokenRejected] のときだけ [TokenRefreshRejected]。
/// それ以外（通信断・5xx・型不一致等の想定外例外を含む）は [TokenRefreshFailed]
/// として一時的失敗に倒す。
TokenRefreshResult tokenRefreshResultFromError(Object e) {
  if (e is ApiException && e.isRefreshTokenRejected) {
    return TokenRefreshRejected(e);
  }
  return TokenRefreshFailed(e);
}
