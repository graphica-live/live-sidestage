import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/auth_session.dart';

const String liveAnalyticsBaseUrl = 'https://liveanalytics-production.up.railway.app';

// TODO: Google Cloud ConsoleでこのAndroidアプリ用のOAuthクライアントを作成し、
// パッケージ名 com.liveanalytics.tikcaption_reader とdebug/releaseのSHA-1指紋を登録すること。
// 下記の値はLiveAnalyticsバックエンドの .env にあるWeb用 GOOGLE_CLIENT_ID と同じ値にする。
const String googleServerClientId = 'YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com';

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
    final data = await _post(
      '/api/mobile/streamer',
      {'tiktokId': tiktokId},
      token: token,
    );
    return (
      data['token'] as String,
      StreamerInfo.fromJson(data['streamer'] as Map<String, dynamic>),
    );
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, String> body, {String? token}) async {
    final http.Response response;
    try {
      response = await http
          .post(
            Uri.parse('$liveAnalyticsBaseUrl$path'),
            headers: {
              'Content-Type': 'application/json',
              if (token != null) 'Authorization': 'Bearer $token',
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 20));
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
