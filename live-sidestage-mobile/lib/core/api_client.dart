import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/auth_session.dart';

/// バックエンドのベースURL。既定は Railway 本番。
///
/// 開発時にローカルの analytics へ向けたいときは
/// `--dart-define=API_BASE_URL=http://localhost:3000` を渡す
/// （端末からPCへ届かせるには `adb reverse tcp:3000 tcp:3000` が要る）。
/// 平文HTTPは debug ビルドのマニフェストでのみ許可している。
const String liveAnalyticsBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://liveanalytics-production.up.railway.app',
);

// LIVE Sidestage Analyticsバックエンドの GOOGLE_CLIENT_ID と同じ値(ウェブ アプリケーション種別のクライアントID)。
// バックエンドは idToken の audience をこの値で検証するため、両者が一致していないと必ず認証に失敗する。
// Android OAuthクライアントも同一Google Cloudプロジェクト(515259769901)に登録されている必要がある。
const String googleServerClientId =
    '515259769901-5ek9vjrlflpldj01eqo6dop7iu7v8l7f.apps.googleusercontent.com';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);

  @override
  String toString() => message;
}

class LiveAnalyticsApi {
  Future<AuthSession> authenticateWithGoogle({required String idToken}) async {
    final data = await _post('/api/mobile/auth/google', {'idToken': idToken});
    return AuthSession.fromJson(data);
  }

  Future<(String token, StreamerInfo streamer)> registerStreamer({
    required String token,
    required String tiktokId,
  }) async {
    final data = await _send(
      'POST',
      '/api/mobile/streamer',
      {'tiktokId': tiktokId},
      token: token,
    );
    return (
      data['token'] as String,
      StreamerInfo.fromJson(data['streamer'] as Map<String, dynamic>),
    );
  }

  Future<StreamerInfo> updateTiktokId({
    required String token,
    required String tiktokId,
  }) async {
    final data = await _send(
      'PATCH',
      '/api/mobile/streamer',
      {'tiktokId': tiktokId},
      token: token,
    );
    return StreamerInfo.fromJson(data['streamer'] as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, String> body, {String? token}) {
    return _send('POST', path, body, token: token);
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path,
    Map<String, String> body, {
    String? token,
  }) async {
    final http.Response response;
    try {
      final uri = Uri.parse('$liveAnalyticsBaseUrl$path');
      final headers = {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };
      final encodedBody = jsonEncode(body);
      final request = switch (method) {
        'PATCH' => http.patch(uri, headers: headers, body: encodedBody),
        _ => http.post(uri, headers: headers, body: encodedBody),
      };
      response = await request.timeout(const Duration(seconds: 20));
    } catch (_) {
      throw ApiException('サーバーに接続できませんでした。通信環境を確認してください。');
    }

    final Map<String, dynamic> data;
    try {
      data = jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException('サーバーの応答を解析できませんでした。');
    }

    if (response.statusCode >= 400) {
      throw ApiException(data['error'] as String? ?? 'エラーが発生しました (${response.statusCode})');
    }

    return data;
  }
}
