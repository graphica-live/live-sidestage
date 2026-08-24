class StreamerInfo {
  final String id;
  final String tiktokId;
  final String apiKey;
  final bool verified;

  StreamerInfo({
    required this.id,
    required this.tiktokId,
    required this.apiKey,
    required this.verified,
  });

  factory StreamerInfo.fromJson(Map<String, dynamic> json) => StreamerInfo(
        id: json['id'] as String,
        tiktokId: json['tiktokId'] as String,
        apiKey: json['apiKey'] as String,
        verified: json['verified'] as bool? ?? false,
      );
}

/// どの認証プロバイダでこのセッションを取ったか。
///
/// サーバーは返さない（端末はどちらのエンドポイントを叩いたか知っている）。
/// 保持しているのは **ログアウトと無言リフレッシュの分岐に要る**ため。
/// Google には `signInSilently` があるが Apple には相当するものが無い。
enum AuthProvider {
  google,
  apple;

  static AuthProvider? tryParse(String? value) {
    for (final provider in AuthProvider.values) {
      if (provider.name == value) return provider;
    }
    return null;
  }
}

class AuthSession {
  final String token;
  final String userId;
  final String userName;
  final String userEmail;
  final bool onboardingRequired;
  final AuthProvider provider;
  final StreamerInfo? streamer;

  AuthSession({
    required this.token,
    required this.userId,
    required this.userName,
    required this.userEmail,
    required this.onboardingRequired,
    required this.provider,
    this.streamer,
  });

  factory AuthSession.fromJson(Map<String, dynamic> json, {required AuthProvider provider}) {
    final user = json['user'] as Map<String, dynamic>;
    final streamerJson = json['streamer'] as Map<String, dynamic>?;
    return AuthSession(
      token: json['token'] as String,
      userId: user['id'] as String,
      userName: user['name'] as String? ?? '',
      userEmail: user['email'] as String? ?? '',
      onboardingRequired: json['onboardingRequired'] as bool? ?? streamerJson == null,
      provider: provider,
      streamer: streamerJson != null ? StreamerInfo.fromJson(streamerJson) : null,
    );
  }

  AuthSession withStreamer({required String token, required StreamerInfo streamer}) {
    return AuthSession(
      token: token,
      userId: userId,
      userName: userName,
      userEmail: userEmail,
      onboardingRequired: false,
      provider: provider,
      streamer: streamer,
    );
  }

  Map<String, String> toStorageMap() => {
        'token': token,
        'userId': userId,
        'userName': userName,
        'userEmail': userEmail,
        'onboardingRequired': onboardingRequired.toString(),
        'provider': provider.name,
        if (streamer != null) 'streamerId': streamer!.id,
        if (streamer != null) 'tiktokId': streamer!.tiktokId,
        if (streamer != null) 'apiKey': streamer!.apiKey,
        if (streamer != null) 'verified': streamer!.verified.toString(),
      };

  factory AuthSession.fromStorageMap(Map<String, String> map) {
    final hasStreamer = map.containsKey('streamerId');
    // provider の追加より前に入れた端末には保存されていない。そのころは
    // Google しか無かったので、欠落は google とみなす（ここを必須キーに
    // すると、更新した瞬間に既存ユーザーのセッションが全部消える）。
    // 一方、知らない値が入っているのは保存データの破損なので読み込まない。
    final provider = map.containsKey('provider')
        ? AuthProvider.tryParse(map['provider'])
        : AuthProvider.google;
    if (provider == null) {
      throw const FormatException('保存されたセッションの認証プロバイダが不正です');
    }

    return AuthSession(
      token: map['token']!,
      userId: map['userId']!,
      userName: map['userName']!,
      userEmail: map['userEmail']!,
      onboardingRequired: map['onboardingRequired'] == 'true',
      provider: provider,
      streamer: hasStreamer
          ? StreamerInfo(
              id: map['streamerId']!,
              tiktokId: map['tiktokId']!,
              apiKey: map['apiKey']!,
              verified: map['verified'] == 'true',
            )
          : null,
    );
  }
}
