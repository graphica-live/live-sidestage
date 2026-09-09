class StreamerInfo {
  final String id;
  final String tiktokHandle;
  final bool verified;

  StreamerInfo({
    required this.id,
    required this.tiktokHandle,
    required this.verified,
  });

  factory StreamerInfo.fromJson(Map<String, dynamic> json) => StreamerInfo(
        id: json['id'] as String,
        tiktokHandle: json['tiktokHandle'] as String,
        verified: json['verified'] as bool? ?? false,
      );
}

/// どの認証プロバイダでこのセッションを取ったか。
///
/// サーバーは返さない（端末はどちらのエンドポイントを叩いたか知っている）。
/// **トークンの再発行には使わない** — access token の再発行は全プロバイダ共通の
/// refresh token 交換（`/api/mobile/auth/refresh`）で行う。ここで保持しているのは
/// ログアウト時に Google 側のサインアウトを呼ぶかの分岐と、設定画面のアカウント表示のため。
enum AuthProvider {
  google,
  apple,
  email;

  static AuthProvider? tryParse(String? value) {
    for (final provider in AuthProvider.values) {
      if (provider.name == value) return provider;
    }
    return null;
  }
}

class AuthSession {
  /// 短命の access token（mobile JWT）。HTTP API と socket.io の両方で使う。
  final String token;

  /// 長命の refresh token。`/api/mobile/auth/refresh` で access token を
  /// 取り直すときに提示する。**サーバー側は1回使い切り(rotation)** なので、
  /// 再発行に成功したら必ず新しい値で置き換えて保存すること。
  final String refreshToken;

  final String userId;
  final String userName;
  final String userEmail;
  final bool onboardingRequired;
  final AuthProvider provider;
  final StreamerInfo? streamer;

  AuthSession({
    required this.token,
    required this.refreshToken,
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
      // 必須。ログイン系エンドポイントは必ず refresh token を返す。
      refreshToken: json['refreshToken'] as String,
      userId: user['id'] as String,
      userName: user['name'] as String? ?? '',
      userEmail: user['email'] as String? ?? '',
      onboardingRequired: json['onboardingRequired'] as bool? ?? streamerJson == null,
      provider: provider,
      streamer: streamerJson != null ? StreamerInfo.fromJson(streamerJson) : null,
    );
  }

  /// オンボーディング完了 / TikTok ID 変更。サーバーは access token だけを
  /// 再発行する（`signMobileToken` 直接呼び出し）ので、**refresh token は据え置く**。
  AuthSession withStreamer({required String token, required StreamerInfo streamer}) {
    return AuthSession(
      token: token,
      refreshToken: refreshToken,
      userId: userId,
      userName: userName,
      userEmail: userEmail,
      onboardingRequired: false,
      provider: provider,
      streamer: streamer,
    );
  }

  /// refresh token の rotation 結果を取り込む。
  ///
  /// **access token と refresh token は必ず対で差し替える。** 片方だけ更新すると、
  /// 次の再発行で無効化済みの refresh token を提示することになり、サーバー側の
  /// reuse 検知で family ごと失効させられる（＝不要な強制ログアウト）。
  AuthSession withTokens({required String token, required String refreshToken}) {
    return AuthSession(
      token: token,
      refreshToken: refreshToken,
      userId: userId,
      userName: userName,
      userEmail: userEmail,
      onboardingRequired: onboardingRequired,
      provider: provider,
      streamer: streamer,
    );
  }

  Map<String, String> toStorageMap() => {
        'token': token,
        'refreshToken': refreshToken,
        'userId': userId,
        'userName': userName,
        'userEmail': userEmail,
        'onboardingRequired': onboardingRequired.toString(),
        'provider': provider.name,
        if (streamer != null) 'streamerId': streamer!.id,
        if (streamer != null) 'tiktokHandle': streamer!.tiktokHandle,
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
      // **必須キー。** refresh token を持たないセッションは access token を
      // 取り直せず、失効した瞬間に無言で壊れる。持っていない保存データは
      // [SessionStorage.load] 側で null（＝未ログイン）として扱う。
      refreshToken: map['refreshToken']!,
      userId: map['userId']!,
      userName: map['userName']!,
      userEmail: map['userEmail']!,
      onboardingRequired: map['onboardingRequired'] == 'true',
      provider: provider,
      streamer: hasStreamer
          ? StreamerInfo(
              id: map['streamerId']!,
              tiktokHandle: map['tiktokHandle']!,
              verified: map['verified'] == 'true',
            )
          : null,
    );
  }
}
