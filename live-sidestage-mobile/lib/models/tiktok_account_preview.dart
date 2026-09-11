/// モバイル TikTok 連携確認シート用。Web `/api/verify/preview` と同じキー。
class TiktokAccountPreview {
  final String tiktokHandle;
  final String? nickname;
  final String? avatarUrl;
  final String? signature;
  final int? followingCount;
  final int? followerCount;

  const TiktokAccountPreview({
    required this.tiktokHandle,
    this.nickname,
    this.avatarUrl,
    this.signature,
    this.followingCount,
    this.followerCount,
  });

  factory TiktokAccountPreview.fromJson(Map<String, dynamic> json) => TiktokAccountPreview(
        tiktokHandle: json['tiktokHandle'] as String,
        nickname: json['nickname'] as String?,
        avatarUrl: json['avatarUrl'] as String?,
        signature: json['signature'] as String?,
        followingCount: (json['followingCount'] as num?)?.toInt(),
        followerCount: (json['followerCount'] as num?)?.toInt(),
      );
}
