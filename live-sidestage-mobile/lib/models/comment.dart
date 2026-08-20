class Comment {
  final String streamerId;
  final String uniqueId;
  final String nickname;
  final String? profilePictureUrl;
  final String comment;
  final DateTime receivedAt;

  Comment({
    required this.streamerId,
    required this.uniqueId,
    required this.nickname,
    required this.profilePictureUrl,
    required this.comment,
    required this.receivedAt,
  });

  factory Comment.fromJson(Map<String, dynamic> json) {
    return Comment(
      streamerId: json['streamerId'] as String,
      uniqueId: json['uniqueId'] as String,
      nickname: json['nickname'] as String,
      profilePictureUrl: json['profilePictureUrl'] as String?,
      comment: json['comment'] as String,
      receivedAt: DateTime.tryParse(json['receivedAt'] as String? ?? '') ?? DateTime.now(),
    );
  }
}
