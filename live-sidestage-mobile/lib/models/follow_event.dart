/// LIVE Sidestage Analytics が `chat:follow` として配信するフォローイベント。
/// サーバー側(chat-feed.ts の ChatFollowPayload)と対になる契約。
class FollowEvent {
  final String streamerId;

  /// TikTokの不変な数値ID。同一性の判定はこれで行う。
  final String tiktokUid;

  /// 本人が変更できる @ハンドル。表示とプロフィール導線専用。
  final String tiktokHandle;
  final String nickname;
  final String? profilePictureUrl;
  final DateTime occurredAt;

  FollowEvent({
    required this.streamerId,
    required this.tiktokUid,
    required this.tiktokHandle,
    required this.nickname,
    required this.profilePictureUrl,
    required this.occurredAt,
  });

  /// 解析できない場合は null を返す（[GiftEvent.tryParse] と同じ理由）。
  static FollowEvent? tryParse(Map<String, dynamic> json) {
    final streamerId = json['streamerId'];
    final tiktokUid = json['tiktokUid'];
    if (streamerId is! String || tiktokUid is! String || tiktokUid.isEmpty) return null;
    final tiktokHandle = json['tiktokHandle'] as String? ?? '';

    return FollowEvent(
      streamerId: streamerId,
      tiktokUid: tiktokUid,
      tiktokHandle: tiktokHandle,
      nickname: json['nickname'] as String? ?? (tiktokHandle.isNotEmpty ? tiktokHandle : tiktokUid),
      profilePictureUrl: json['profilePictureUrl'] as String?,
      occurredAt: DateTime.tryParse(json['occurredAt'] as String? ?? '') ?? DateTime.now(),
    );
  }
}
