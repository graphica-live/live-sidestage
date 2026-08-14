class AuthSession {
  final String token;
  final String userId;
  final String userName;
  final String userEmail;
  final String streamerId;
  final String tiktokId;
  final String apiKey;
  final bool verified;

  AuthSession({
    required this.token,
    required this.userId,
    required this.userName,
    required this.userEmail,
    required this.streamerId,
    required this.tiktokId,
    required this.apiKey,
    required this.verified,
  });

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    final user = json['user'] as Map<String, dynamic>;
    final streamer = json['streamer'] as Map<String, dynamic>;
    return AuthSession(
      token: json['token'] as String,
      userId: user['id'] as String,
      userName: user['name'] as String? ?? '',
      userEmail: user['email'] as String? ?? '',
      streamerId: streamer['id'] as String,
      tiktokId: streamer['tiktokId'] as String,
      apiKey: streamer['apiKey'] as String,
      verified: streamer['verified'] as bool? ?? false,
    );
  }

  Map<String, String> toStorageMap() => {
        'token': token,
        'userId': userId,
        'userName': userName,
        'userEmail': userEmail,
        'streamerId': streamerId,
        'tiktokId': tiktokId,
        'apiKey': apiKey,
        'verified': verified.toString(),
      };

  factory AuthSession.fromStorageMap(Map<String, String> map) {
    return AuthSession(
      token: map['token']!,
      userId: map['userId']!,
      userName: map['userName']!,
      userEmail: map['userEmail']!,
      streamerId: map['streamerId']!,
      tiktokId: map['tiktokId']!,
      apiKey: map['apiKey']!,
      verified: map['verified'] == 'true',
    );
  }
}
