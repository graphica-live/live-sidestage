/// LIVE Sidestage Analytics が `chat:follow` として配信するフォローイベント。
/// サーバー側(chat-feed.ts の ChatFollowPayload)と対になる契約。
class FollowEvent {
  final String streamerId;
  final String uniqueId;
  final String nickname;
  final String? profilePictureUrl;
  final DateTime occurredAt;

  FollowEvent({
    required this.streamerId,
    required this.uniqueId,
    required this.nickname,
    required this.profilePictureUrl,
    required this.occurredAt,
  });

  /// 解析できない場合は null を返す（[GiftEvent.tryParse] と同じ理由）。
  static FollowEvent? tryParse(Map<String, dynamic> json) {
    final streamerId = json['streamerId'];
    final uniqueId = json['uniqueId'];
    if (streamerId is! String || uniqueId is! String) return null;

    return FollowEvent(
      streamerId: streamerId,
      uniqueId: uniqueId,
      nickname: json['nickname'] as String? ?? uniqueId,
      profilePictureUrl: json['profilePictureUrl'] as String?,
      occurredAt: DateTime.tryParse(json['occurredAt'] as String? ?? '') ?? DateTime.now(),
    );
  }
}
