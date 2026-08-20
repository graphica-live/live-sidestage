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

class AuthSession {
  final String token;
  final String userId;
  final String userName;
  final String userEmail;
  final bool onboardingRequired;
  final StreamerInfo? streamer;

  AuthSession({
    required this.token,
    required this.userId,
    required this.userName,
    required this.userEmail,
    required this.onboardingRequired,
    this.streamer,
  });

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>;
    final streamerJson = json['streamer'] as Map<String, dynamic>?;
    return AuthSession(
      token: json['token'] as String,
      userId: user['id'] as String,
      userName: user['name'] as String? ?? '',
      userEmail: user['email'] as String? ?? '',
      onboardingRequired: json['onboardingRequired'] as bool? ?? streamerJson == null,
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
      streamer: streamer,
    );
  }

  Map<String, String> toStorageMap() => {
        'token': token,
        'userId': userId,
        'userName': userName,
        'userEmail': userEmail,
        'onboardingRequired': onboardingRequired.toString(),
        if (streamer != null) 'streamerId': streamer!.id,
        if (streamer != null) 'tiktokId': streamer!.tiktokId,
        if (streamer != null) 'apiKey': streamer!.apiKey,
        if (streamer != null) 'verified': streamer!.verified.toString(),
      };

  factory AuthSession.fromStorageMap(Map<String, String> map) {
    final hasStreamer = map.containsKey('streamerId');
    return AuthSession(
      token: map['token']!,
      userId: map['userId']!,
      userName: map['userName']!,
      userEmail: map['userEmail']!,
      onboardingRequired: map['onboardingRequired'] == 'true',
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
