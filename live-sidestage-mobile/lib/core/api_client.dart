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

/// Apple Developer Portal の **Services ID**（Bundle ID ではない）。
///
/// Android にはネイティブの Apple 認証が無く、Custom Tab で web フローを回すため
/// client_id は Services ID になる。バックエンドの `APPLE_SERVICES_ID` と同じ値でないと
/// `aud` の検証に必ず落ちる。
///
/// **空のままだとログイン画面に Apple のボタンを出さない。** Apple 側の設定が
/// 済むまでは押しても必ず失敗するので、ビルド時に値を渡すことを有効化の条件にしている。
///
/// ```
/// flutter build apk --release \
///   --dart-define=APPLE_SERVICES_ID=com.liveanalytics.live-sidestage.signin \
///   --dart-define=APPLE_REDIRECT_URI=https://HOST/api/mobile/auth/apple/callback
/// ```
const String appleServicesId = String.fromEnvironment('APPLE_SERVICES_ID');

/// Apple Developer Portal に Return URL として登録した URL と**完全一致**させる。
/// バックエンドの `APPLE_REDIRECT_URI` とも一致していないと code 交換が invalid_grant になる。
const String appleRedirectUri = String.fromEnvironment(
  'APPLE_REDIRECT_URI',
  defaultValue: '$liveAnalyticsBaseUrl/api/mobile/auth/apple/callback',
);

/// Apple サインインを画面に出してよいか。
bool get isAppleSignInConfigured => appleServicesId.isNotEmpty;

class ApiException implements Exception {
  final String message;

  /// HTTPステータス。通信自体に失敗した場合は null。
  /// 401/403 を「一覧が取れない」ではなく「再ログインが必要」として扱うために使う。
  final int? statusCode;

  ApiException(this.message, {this.statusCode});

  bool get isUnauthorized => statusCode == 401 || statusCode == 403;

  @override
  String toString() => message;
}

/// ピッカーに出すギフト候補。
///
/// コイン数を1つの値ではなく **範囲** で持つ。TikTok のカタログには同じ名前で
/// コイン数の違うギフトが存在する（`freestyle` は 1 コインと 1800 コインの両方が実在する）。
/// 一致キーは名前なのでどちらが飛んできても同じ音が鳴る。単一の値として見せると
/// 「大物ギフト用」に仕込んだ音が安いギフトでも鳴る、という誤解を招く。
class GiftCandidate {
  /// 一致キー（trim + 小文字化済み）。そのまま [GiftSound.giftName] に入れる。
  final String name;

  /// 画面に出す表記（TikTok の元の大文字小文字）。
  final String label;

  /// この名前で存在しうるコイン数の下限。
  final int minDiamondCount;

  /// 同上、上限。[minDiamondCount] と同じなら価格は1種類。
  final int maxDiamondCount;

  /// 自分の部屋で受け取ったことがあるか。サーバーが見るのは直近の履歴だけなので、
  /// 厳密には「最近受け取った」の意味。
  final bool seen;

  /// ギフトのアイコン。サーバー側で TikTok の画像 CDN に限定済み。
  /// 取れないギフト（カタログに画像が無い・自由入力）では null。
  final String? imageUrl;

  const GiftCandidate({
    required this.name,
    required this.label,
    required this.minDiamondCount,
    required this.maxDiamondCount,
    this.seen = false,
    this.imageUrl,
  });

  /// コイン数が1種類しかない候補。自由入力やテストから作るとき用。
  const GiftCandidate.single({
    required this.name,
    required this.label,
    required int diamondCount,
    this.seen = false,
    this.imageUrl,
  })  : minDiamondCount = diamondCount,
        maxDiamondCount = diamondCount;

  bool get hasCoinRange => minDiamondCount != maxDiamondCount;

  /// [min]〜[max] のコイン帯と重なるか。範囲同士の重なりで判定する
  /// （下限だけ・上限だけを見ると価格違いのあるギフトが帯から漏れる）。
  bool overlapsCoins(int min, int? max) {
    if (maxDiamondCount < min) return false;
    return max == null || minDiamondCount <= max;
  }

  static GiftCandidate? tryParse(Object? value) {
    if (value is! Map) return null;
    final name = value['name'];
    if (name is! String || name.isEmpty) return null;
    final label = value['label'];

    // 旧サーバーは diamondCount しか返さない。
    final fallback = value['diamondCount'];
    final base = fallback is int && fallback >= 0 ? fallback : 0;
    final rawMin = value['minDiamondCount'];
    final rawMax = value['maxDiamondCount'];
    final min = rawMin is int && rawMin >= 0 ? rawMin : base;
    final max = rawMax is int && rawMax >= 0 ? rawMax : base;

    return GiftCandidate(
      name: name,
      label: label is String && label.isNotEmpty ? label : name,
      // 壊れた組み合わせ（min > max）が来ても順序だけは保証する。
      minDiamondCount: min <= max ? min : max,
      maxDiamondCount: min <= max ? max : min,
      seen: value['seen'] == true,
      imageUrl: _parseImageUrl(value['imageUrl']),
    );
  }

  /// 画像URLとして受け入れてよい値か。
  ///
  /// サーバーが TikTok の画像 CDN に限定して返しているが、`Image.network` へそのまま
  /// 渡る値なので https だけは端末側でも確かめる（多層防御）。旧サーバーはキー自体を
  /// 返さないので、欠落は null として扱う。
  static String? _parseImageUrl(Object? value) {
    if (value is! String || value.isEmpty) return null;
    final uri = Uri.tryParse(value);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) return null;
    return value;
  }
}

class LiveAnalyticsApi {
  Future<AuthSession> authenticateWithGoogle({required String idToken}) async {
    final data = await _post('/api/mobile/auth/google', {'idToken': idToken});
    return AuthSession.fromJson(data, provider: AuthProvider.google);
  }

  /// Apple サインイン。**idToken ではなく authorizationCode を送る。**
  ///
  /// Android は Custom Tab の web フローなので、端末が受け取った応答は
  /// exported Activity 経由で第三者が差し込めてしまう。単回・短命な code を
  /// サーバーが Apple と交換して初めて認証が成立する。[nonce] は authorize 時に
  /// 端末が生成した値で、サーバーが id_token のクレームと完全一致を確認する。
  ///
  /// [givenName] / [familyName] は **初回認可のときしか Apple から返らない**。
  Future<AuthSession> authenticateWithApple({
    required String authorizationCode,
    required String nonce,
    String? givenName,
    String? familyName,
  }) async {
    final data = await _post('/api/mobile/auth/apple', {
      'authorizationCode': authorizationCode,
      'nonce': nonce,
      // 現状 Android のみ。iOS 版を出すときはここを 'ios' にする
      // （サーバーは client_id を Bundle ID に切り替え、redirect_uri を送らなくなる）。
      'clientKind': 'android',
      'givenName': ?givenName,
      'familyName': ?familyName,
    });
    return AuthSession.fromJson(data, provider: AuthProvider.apple);
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

  /// 直近に受け取ったギフトの候補一覧。空でもエラーではない
  /// （まだギフトを受け取っていない・部屋が未割り当て）。
  Future<List<GiftCandidate>> fetchGiftCandidates({required String token}) async {
    final data = await _send('GET', '/api/mobile/gifts', null, token: token);
    final gifts = data['gifts'];
    if (gifts is! List) return const [];
    return gifts.map(GiftCandidate.tryParse).whereType<GiftCandidate>().toList();
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, String> body, {String? token}) {
    return _send('POST', path, body, token: token);
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path,
    Map<String, String>? body, {
    String? token,
  }) async {
    final http.Response response;
    try {
      final uri = Uri.parse('$liveAnalyticsBaseUrl$path');
      final headers = {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      };
      final encodedBody = body == null ? null : jsonEncode(body);
      final request = switch (method) {
        'GET' => http.get(uri, headers: headers),
        'PATCH' => http.patch(uri, headers: headers, body: encodedBody),
        _ => http.post(uri, headers: headers, body: encodedBody),
      };
      response = await request.timeout(const Duration(seconds: 20));
    } catch (e) {
      throw ApiException('サーバーに接続できませんでした。通信環境を確認してください。(${e.runtimeType})');
    }

    final Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
      // Railwayのコールドスタート中などJSONではなくHTMLのエラーページが返ることがある。
      // 原因を切り分けられるよう、ステータスと本文の先頭を残す。以前はここで
      // 握り潰していたため、ログイン失敗時に何が起きたのか追えなかった。
      throw ApiException(
        'サーバーの応答を解析できませんでした (HTTP ${response.statusCode}): ${_snippet(response.bodyBytes)}',
        statusCode: response.statusCode,
      );
    }

    if (decoded is! Map<String, dynamic>) {
      throw ApiException(
        'サーバーの応答形式が想定と違います (HTTP ${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    if (response.statusCode >= 400) {
      throw ApiException(
        decoded['error'] as String? ?? 'エラーが発生しました (${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    return decoded;
  }

  /// エラー表示へ添えるための本文の先頭。HTMLがそのまま返ることがあるので
  /// タグと連続空白を潰したうえで切り詰める。
  static String _snippet(List<int> bodyBytes, {int maxLength = 80}) {
    var text = utf8.decode(bodyBytes, allowMalformed: true);
    text = text.replaceAll(RegExp(r'<[^>]*>'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
    if (text.isEmpty) return '(空の応答)';
    return text.length > maxLength ? '${text.substring(0, maxLength)}…' : text;
  }
}
