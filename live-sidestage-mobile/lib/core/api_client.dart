import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/auth_session.dart';

const String liveAnalyticsBaseUrl = 'https://liveanalytics-production.up.railway.app';

class ApiException implements Exception {
  final String message;
  ApiException(this.message);

  @override
  String toString() => message;
}

class LiveAnalyticsApi {
  Future<AuthSession> register({
    required String name,
    required String email,
    required String password,
    required String tiktokId,
  }) {
    return _postAuth('/api/mobile/auth/register', {
      'name': name,
      'email': email,
      'password': password,
      'tiktokId': tiktokId,
    });
  }

  Future<AuthSession> login({
    required String email,
    required String password,
  }) {
    return _postAuth('/api/mobile/auth/login', {
      'email': email,
      'password': password,
    });
  }

  Future<AuthSession> _postAuth(String path, Map<String, String> body) async {
    final http.Response response;
    try {
      response = await http
          .post(
            Uri.parse('$liveAnalyticsBaseUrl$path'),
            headers: {'Content-Type': 'application/json'},
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

    if (data['streamer'] == null) {
      throw ApiException('このアカウントにはTikTok配信者情報が登録されていません。');
    }

    return AuthSession.fromJson(data);
  }
}
