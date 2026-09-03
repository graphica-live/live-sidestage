import 'dart:async' show TimeoutException;
import 'dart:convert';
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show debugPrint, visibleForTesting;
import 'package:http/http.dart' as http;

import '../models/account_status.dart';
import '../models/auth_session.dart';
import '../models/battle_summary.dart';
import '../models/gift_history_event.dart';
import '../models/gift_ranking_entry.dart';
import '../models/listener_status.dart';
import 'app_version.dart';
import 'url_validation.dart';

/// バックエンドのベースURL。既定は Railway 本番。
///
/// 開発時にローカルの analytics へ向けたいときは
/// `--dart-define=API_BASE_URL=http://localhost:3000` を渡す
/// （端末からPCへ届かせるには `adb reverse tcp:3000 tcp:3000` が要る）。
/// 平文HTTPは debug ビルドのマニフェストでのみ許可している。
const String liveAnalyticsBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'https://api.livesidestage.com',
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

/// iOSネイティブでAppleサインインを有効にするビルドフラグ。
///
/// iOSのネイティブフローはAndroidと違い、クライアント側に渡すべき固有の設定値が
/// 無い(client_idはXcodeビルドに焼き込まれるBundle IDで、Dart側は関知しない)。
/// それでも「Apple Developer Program の entitlement とサーバーの
/// `APPLE_BUNDLE_ID` 設定が両方揃うまでボタンを出さない」という既存の
/// fail-closed方針を保つため、Android同様に明示的なビルドフラグでゲートする。
///
/// ```
/// flutter build ios --release --dart-define=APPLE_SIGN_IN_IOS_ENABLED=true
/// ```
const bool appleSignInIosEnabled = bool.fromEnvironment('APPLE_SIGN_IN_IOS_ENABLED');

/// Apple サインインを画面に出してよいか。
///
/// - iOS: [appleSignInIosEnabled] だけを見る(Services ID/redirect URIはAndroid専用の概念)。
/// - Android: **Services ID と https の redirect URI が両方揃っていること**を条件にする。
///   片方だけでは authorize が必ず失敗するので、押せてしまう状態を作らない。
bool get isAppleSignInConfigured {
  if (Platform.isIOS) return appleSignInIosEnabled;
  if (appleServicesId.isEmpty) return false;
  final uri = Uri.tryParse(appleRedirectUri);
  return uri != null && uri.scheme == 'https' && uri.host.isNotEmpty;
}

/// 502/503/504やタイムアウトなど、サーバー側の一時的な不調で表示する文言。
/// 原因(コールドスタート/デプロイ中/過負荷等)を問わず「今は繋がらないが
/// 恒久故障ではない」ことだけをITリテラシーの低い利用者にも伝える。
const String _serverBusyMessage = 'サーバーが混み合っているか、一時的に応答できない状態です。\n'
    '時間をおいてから、もう一度お試しください。';

class ApiException implements Exception {
  final String message;

  /// HTTPステータス。通信自体に失敗した場合は null。
  final int? statusCode;

  ApiException(this.message, {this.statusCode});

  /// トークンが無効・期限切れ。再ログイン(またはトークン再取得)が必要。
  bool get isUnauthorized => statusCode == 401;

  /// トークンは有効だが、その操作を行う権限(プラン等)が無い。
  /// **再ログインでは解決しない。** isUnauthorizedと混同すると、権限不足なだけの
  /// 操作でGoogleの無言サインインを繰り返し試みることになる。
  bool get isForbidden => statusCode == 403;

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

  /// TikTok 公式の日本語表示名。カタログに無いギフト（部屋固有のサブスクギフト、
  /// 自由入力）や、まだ日本語化されていないギフトでは null。
  /// **表示専用。[name] の代わりに保存してはいけない。**
  final String? labelJa;

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
    this.labelJa,
  });

  /// コイン数が1種類しかない候補。自由入力やテストから作るとき用。
  const GiftCandidate.single({
    required this.name,
    required this.label,
    required int diamondCount,
    this.seen = false,
    this.imageUrl,
    this.labelJa,
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

    // 旧サーバーは labelJa を返さない。欠落は null（英語表記のまま）として扱う。
    final labelJa = value['labelJa'];

    return GiftCandidate(
      name: name,
      label: label is String && label.isNotEmpty ? label : name,
      labelJa: labelJa is String && labelJa.isNotEmpty ? labelJa : null,
      // 壊れた組み合わせ（min > max）が来ても順序だけは保証する。
      minDiamondCount: min <= max ? min : max,
      maxDiamondCount: min <= max ? max : min,
      seen: value['seen'] == true,
      imageUrl: parseImageUrl(value['imageUrl']),
    );
  }
}

/// 候補一覧から「一致キー（英語）→ 日本語表示名」を作る。[GiftNameJa.updateFromServer] へ渡す用。
///
/// 日本語名を持たない候補は落とす。落としても [GiftNameJa] 側は既存の値を消さないので、
/// 一部のギフトだけ日本語化されていない状態でも他の日本語名は保たれる。
Map<String, String> giftLabelJaMap(Iterable<GiftCandidate> gifts) {
  return {
    for (final gift in gifts)
      if (gift.labelJa != null && gift.labelJa!.isNotEmpty) gift.name: gift.labelJa!,
  };
}

typedef DateRange = ({String start, String end});

DateRange _parseDateRange(Object? value) {
  final map = value is Map ? value : const {};
  return (start: map['start'] as String? ?? '', end: map['end'] as String? ?? '');
}

/// period/date(日・週・月の既存経路)とstartDatetime/endDatetime(開始・終了日時による
/// カスタム範囲)の2系統のクエリパラメータ組み立てを1箇所に共通化する。
/// startDatetime/endDatetimeを両方指定した場合はそちらを優先し、period/dateは送らない。
///
/// 片方だけの指定は呼び出し側の実装ミスとして早期に検出する(3タブの配線はどちらも
/// 渡すか両方nullかのどちらかにしかならない設計なので、通常は到達しないアサーション)。
@visibleForTesting
Map<String, String> rangeParams({
  required String period,
  required String date,
  DateTime? startDatetime,
  DateTime? endDatetime,
}) {
  if (startDatetime == null && endDatetime == null) {
    return {'period': period, 'date': date};
  }
  if (startDatetime == null || endDatetime == null) {
    throw ArgumentError('startDatetimeとendDatetimeは両方指定するか、両方省略してください');
  }
  return {
    'startDatetime': startDatetime.toUtc().toIso8601String(),
    'endDatetime': endDatetime.toUtc().toIso8601String(),
  };
}

class GiftRankingResult {
  final List<GiftRankingEntry> users;
  final DateRange dateRange;
  final ({int giftCount, int totalDiamonds}) total;
  final bool verified;

  const GiftRankingResult({
    required this.users,
    required this.dateRange,
    required this.total,
    required this.verified,
  });
}

class GiftHistoryResult {
  final List<GiftHistoryEvent> events;
  final DateRange dateRange;
  final ({int count, int diamonds}) total;
  final bool hasMore;
  final bool verified;

  const GiftHistoryResult({
    required this.events,
    required this.dateRange,
    required this.total,
    required this.hasMore,
    required this.verified,
  });
}

class BattleListResult {
  final List<BattleSummary> battles;
  final DateRange dateRange;
  final bool hasMore;
  final bool verified;

  const BattleListResult({
    required this.battles,
    required this.dateRange,
    required this.hasMore,
    required this.verified,
  });
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
      // サーバーはclientKindでclient_id(Services ID/Bundle ID)とredirect_uriの
      // 有無を切り替える(apple-auth.ts の resolveClient)。iOSネイティブでは
      // redirect_uriを送るとinvalid_grantになるため、ここを誤ると必ず失敗する。
      'clientKind': Platform.isIOS ? 'ios' : 'android',
      'givenName': ?givenName,
      'familyName': ?familyName,
    });
    return AuthSession.fromJson(data, provider: AuthProvider.apple);
  }

  /// メールアドレス+パスワードでの新規登録。確認メールは送らない
  /// (登録直後にログイン済み状態になる)。
  Future<AuthSession> registerWithEmail({
    required String email,
    required String password,
  }) async {
    final data = await _post('/api/mobile/auth/email/register', {
      'email': email,
      'password': password,
    });
    return AuthSession.fromJson(data, provider: AuthProvider.email);
  }

  /// メールアドレス+パスワードでのログイン。
  Future<AuthSession> loginWithEmail({
    required String email,
    required String password,
  }) async {
    final data = await _post('/api/mobile/auth/email/login', {
      'email': email,
      'password': password,
    });
    return AuthSession.fromJson(data, provider: AuthProvider.email);
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

  /// 貢献タブ(ユーザー別コイン数ランキング)。[users] は既にコイン数降順でソート済み
  /// (配列インデックス+1がそのまま順位になる)。
  Future<GiftRankingResult> fetchGiftRanking({
    required String token,
    required String period,
    required String date,
    DateTime? startDatetime,
    DateTime? endDatetime,
    String? listenerQuery,
  }) async {
    final query = Uri(
      queryParameters: {
        ...rangeParams(
          period: period,
          date: date,
          startDatetime: startDatetime,
          endDatetime: endDatetime,
        ),
        if (listenerQuery != null && listenerQuery.isNotEmpty) 'listenerQuery': listenerQuery,
      },
    ).query;
    final data = await _send('GET', '/api/mobile/analytics/ranking?$query', null, token: token);
    final users = data['users'];
    return GiftRankingResult(
      users: users is List ? users.map(GiftRankingEntry.tryParse).whereType<GiftRankingEntry>().toList() : const [],
      dateRange: _parseDateRange(data['dateRange']),
      total: (
        giftCount: (data['total']?['giftCount'] as int?) ?? 0,
        totalDiamonds: (data['total']?['totalDiamonds'] as int?) ?? 0,
      ),
      verified: data['verified'] == true,
    );
  }

  /// ギフト履歴タブ。[hasMore] が true なら「期間全体」ではなく「直近[limit]件」であることを示す。
  Future<GiftHistoryResult> fetchGiftHistory({
    required String token,
    required String period,
    required String date,
    int limit = 50,
    DateTime? startDatetime,
    DateTime? endDatetime,
    String? listenerQuery,
  }) async {
    final query = Uri(
      queryParameters: {
        ...rangeParams(
          period: period,
          date: date,
          startDatetime: startDatetime,
          endDatetime: endDatetime,
        ),
        'limit': '$limit',
        if (listenerQuery != null && listenerQuery.isNotEmpty) 'listenerQuery': listenerQuery,
      },
    ).query;
    final data = await _send('GET', '/api/mobile/analytics/gift-history?$query', null, token: token);
    final events = data['events'];
    return GiftHistoryResult(
      events: events is List ? events.map(GiftHistoryEvent.tryParse).whereType<GiftHistoryEvent>().toList() : const [],
      dateRange: _parseDateRange(data['dateRange']),
      total: (
        count: (data['total']?['count'] as int?) ?? 0,
        diamonds: (data['total']?['diamonds'] as int?) ?? 0,
      ),
      hasMore: data['hasMore'] == true,
      verified: data['verified'] == true,
    );
  }

  /// バトル履歴タブの一覧。
  Future<BattleListResult> fetchBattles({
    required String token,
    required String period,
    required String date,
    DateTime? startDatetime,
    DateTime? endDatetime,
    String? listenerQuery,
  }) async {
    final query = Uri(
      queryParameters: {
        ...rangeParams(
          period: period,
          date: date,
          startDatetime: startDatetime,
          endDatetime: endDatetime,
        ),
        if (listenerQuery != null && listenerQuery.isNotEmpty) 'listenerQuery': listenerQuery,
      },
    ).query;
    final data = await _send('GET', '/api/mobile/analytics/battles?$query', null, token: token);
    final battles = data['battles'];
    return BattleListResult(
      battles: battles is List ? battles.map(BattleSummary.tryParse).whereType<BattleSummary>().toList() : const [],
      dateRange: _parseDateRange(data['dateRange']),
      hasMore: data['hasMore'] == true,
      verified: data['verified'] == true,
    );
  }

  /// バトル区間の貢献者展開。貢献タブ(ランキング)と同じ形状のデータを返す。
  Future<List<GiftRankingEntry>> fetchBattleContributors({
    required String token,
    required String battleId,
  }) async {
    final data = await _send(
      'GET',
      '/api/mobile/analytics/battles/${Uri.encodeComponent(battleId)}/contributors',
      null,
      token: token,
    );
    final contributors = data['contributors'];
    if (contributors is! List) return const [];
    return contributors.map(GiftRankingEntry.tryParse).whereType<GiftRankingEntry>().toList();
  }

  /// TikTok Live 接続の状態。socket の `chat:listener` が落ちても収束させるための保険。
  ///
  /// 背景 Isolate から呼ぶので **JWT ではなく apiKey** で認証する
  /// （背景側は apiKey しか持っていない）。部屋が未割り当てなら null を返す。
  Future<ListenerStatus?> fetchListenerStatus({required String apiKey}) async {
    final data = await _send('GET', '/api/mobile/listener-status', null, apiKey: apiKey);
    final listener = data['listener'];
    if (listener is! Map) return null;
    return ListenerStatus.tryParse(Map<String, dynamic>.from(listener));
  }

  /// 実効プラン・機能可否・強制アップデート判定に使う起動時の状態。
  ///
  /// **これはUIの出し分け用の参照情報であって、権限の最終防衛線ではない。**
  /// 実際の機能可否は毎回サーバー側が判定する(このAPIの値をキャッシュして
  /// クライアント側だけで権限判定に使わないこと)。
  Future<AccountStatus> fetchAccountStatus({required String token}) async {
    final data = await _send('GET', '/api/mobile/me', null, token: token);
    return AccountStatus.fromJson(data);
  }

  /// アカウント削除。サーバー側でUserをcascade削除する(Account/Session/Subscription等)。
  /// 既に削除済みのUserのtokenで呼んでも200(冪等)を返すので、再送時もエラー扱いしなくてよい。
  Future<void> deleteAccount({required String token}) async {
    await _send('DELETE', '/api/mobile/account', null, token: token);
  }

  /// Google Play購入フローの開始。サーバーが発行する[obfuscatedAccountId]を
  /// `GooglePlayPurchaseParam.applicationUserName`へそのまま渡す(横流し防止のため)。
  ///
  /// 既に有効なプランを持つユーザーが呼ぶと409(isForbiddenではなくApiException)になる —
  /// これは「エラー」ではなく「復元不要、既に反映済み」を意味する。呼び出し側
  /// (billing_service.dart)はstatusCode 409を専用に扱うこと。
  Future<String> initGoogleBilling({required String token}) async {
    final data = await _send('POST', '/api/mobile/billing/google/init', const {}, token: token);
    return data['obfuscatedAccountId'] as String;
  }

  /// Google Playの購入トークンをサーバーへ送って検証・反映する。
  /// 成功後は[fetchAccountStatus]で最新のplanを取り直すこと(このAPI自体は
  /// 更新後のプランを返さない)。
  Future<void> verifyGooglePurchase({
    required String token,
    required String purchaseToken,
  }) async {
    await _send(
      'POST',
      '/api/mobile/billing/google/verify-purchase',
      {'purchaseToken': purchaseToken},
      token: token,
    );
  }

  /// Apple IAP購入フローの開始。サーバーが発行する[appAccountToken](UUID)を
  /// `PurchaseParam.applicationUserName`へそのまま渡す(StoreKit2のappAccountTokenとして
  /// transactionに載る。横流し防止のため)。
  ///
  /// 既に有効なプランを持つユーザーが呼ぶと409(isForbiddenではなくApiException)になる —
  /// これは「エラー」ではなく「復元不要、既に反映済み」を意味する。呼び出し側
  /// (apple_billing_service.dart)はstatusCode 409を専用に扱うこと。
  Future<String> initAppleBilling({required String token}) async {
    final data = await _send('POST', '/api/mobile/billing/apple/init', const {}, token: token);
    return data['appAccountToken'] as String;
  }

  /// Appleのtransaction IDをサーバーへ送って検証・反映する。[transactionId]は
  /// `PurchaseDetails.purchaseID`(現在のtransaction id。originalTransactionIdとは
  /// 更新・復元時に異なりうるため、original側の解決はサーバーに委ねる)。
  /// 成功後は[fetchAccountStatus]で最新のplanを取り直すこと(このAPI自体は
  /// 更新後のプランを返さない)。
  Future<void> verifyApplePurchase({
    required String token,
    required String transactionId,
  }) async {
    await _send(
      'POST',
      '/api/mobile/billing/apple/verify-purchase',
      {'transactionId': transactionId},
      token: token,
    );
  }

  /// 事後通知SnackBarの「閉じる」操作。他の既読化と同様ベストエフォート
  /// (失敗してもUIは閉じたままでよい。次回起動時に再表示されるだけ)。
  Future<void> acknowledgeMergeNotice({required String token, required String logId}) async {
    await _send('POST', '/api/mobile/recent-merge/ack', {'logId': logId}, token: token);
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, String> body, {String? token}) {
    return _send('POST', path, body, token: token);
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path,
    Map<String, String>? body, {
    String? token,
    String? apiKey,
  }) async {
    final http.Response response;
    try {
      final uri = Uri.parse('$liveAnalyticsBaseUrl$path');
      final headers = {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
        'x-api-key': ?apiKey,
        // 偽装可能な自己申告値なので権限判定には使わない(サーバー側も現状読まない)。
        // 将来「このバージョン未満は拒否」を足すときの配管として、まず送る側だけ用意する。
        'X-App-Version': ?AppVersion.current,
      };
      final encodedBody = body == null ? null : jsonEncode(body);
      final request = switch (method) {
        'GET' => http.get(uri, headers: headers),
        'PATCH' => http.patch(uri, headers: headers, body: encodedBody),
        'DELETE' => http.delete(uri, headers: headers, body: encodedBody),
        _ => http.post(uri, headers: headers, body: encodedBody),
      };
      response = await request.timeout(const Duration(seconds: 20));
    } on TimeoutException {
      // サーバーが詰まっている/コールドスタート中などで応答が返ってこない状態。
      // 通信環境の問題ではないので、切り分けが要らない易しい文言にする。
      throw ApiException(_serverBusyMessage);
    } catch (e) {
      throw ApiException('サーバーに接続できませんでした。通信環境を確認してください。(${e.runtimeType})');
    }

    // Railwayが再起動中/デプロイ中に502等を返すとJSONではなくHTMLのエラーページになる。
    // 利用者には「一時的な不調」とだけ伝え、切り分け用の詳細は開発者向けにログへ残す。
    if (response.statusCode >= 500) {
      debugPrint(
        '[api_client] HTTP ${response.statusCode} at $path: ${_snippet(response.bodyBytes)}',
      );
      throw ApiException(_serverBusyMessage, statusCode: response.statusCode);
    }

    final Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(response.bodyBytes));
    } catch (_) {
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
        decoded['error'] as String? ?? _fallbackMessageForStatus(response.statusCode),
        statusCode: response.statusCode,
      );
    }

    return decoded;
  }

  /// サーバーが `error` フィールドを返さなかった4xxのための保険。
  /// 通常のAPIは全て `error` にメッセージ文字列を入れて返すため、ここに来るのは想定外の応答のみ。
  static String _fallbackMessageForStatus(int statusCode) {
    switch (statusCode) {
      case 401:
        return 'ログインの有効期限が切れています。再度ログインしてください。';
      case 403:
        return 'この操作を行う権限がありません。';
      case 404:
        return '対象のデータが見つかりませんでした。';
      default:
        return 'エラーが発生しました ($statusCode)';
    }
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
