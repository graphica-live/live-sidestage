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

  /// 解析できない場合は null を返す。
  ///
  /// 以前は必須フィールドを直接castしていたため、想定外の型が1件混ざるだけで
  /// socketの購読callbackが例外で落ち、以降のコメントを受け取れなくなっていた。
  /// 不正な1件だけ捨てて受信を継続する。
  static Comment? tryParse(Map<String, dynamic> json) {
    final streamerId = json['streamerId'];
    final uniqueId = json['uniqueId'];
    if (streamerId is! String || uniqueId is! String) return null;

    return Comment(
      streamerId: streamerId,
      uniqueId: uniqueId,
      nickname: json['nickname'] as String? ?? uniqueId,
      profilePictureUrl: json['profilePictureUrl'] as String?,
      comment: json['comment'] as String? ?? '',
      receivedAt: DateTime.tryParse(json['receivedAt'] as String? ?? '') ?? DateTime.now(),
    );
  }
}
