import '../core/url_validation.dart';

/// ギフト履歴タブの1行。
class GiftHistoryEvent {
  final String id;

  /// TikTokの不変な数値ID。同一性・リストkey用。
  final String tiktokUid;

  /// 本人が変更できる @ハンドル。**TikTokUser 行が無ければサーバーは null を返す**ので
  /// nullable。プロフィール導線はこれが null/空のときに出さない。
  final String? tiktokHandle;

  /// 表示名。サーバーの nickname が無ければ tiktokHandle → tiktokUid の順で埋める。
  final String nickname;
  final String? profileImageUrl;
  final int giftId;
  final String giftName;
  final String? giftPictureUrl;
  final int repeatCount;

  final int totalDiamonds;

  final DateTime? receivedAt;

  const GiftHistoryEvent({
    required this.id,
    required this.tiktokUid,
    this.tiktokHandle,
    required this.nickname,
    this.profileImageUrl,
    required this.giftId,
    required this.giftName,
    this.giftPictureUrl,
    required this.repeatCount,
    required this.totalDiamonds,
    this.receivedAt,
  });

  static GiftHistoryEvent? tryParse(Object? value) {
    if (value is! Map) return null;
    final id = value['id'];
    final tiktokUid = value['tiktokUid'];
    final giftName = value['giftName'];
    if (id is! String || id.isEmpty) return null;
    if (tiktokUid is! String || tiktokUid.isEmpty) return null;
    if (giftName is! String || giftName.isEmpty) return null;

    final rawHandle = value['tiktokHandle'];
    final tiktokHandle = rawHandle is String && rawHandle.isNotEmpty ? rawHandle : null;
    final nickname = value['nickname'];
    final giftId = value['giftId'];
    final repeatCount = value['repeatCount'];
    final totalDiamonds = value['totalDiamonds'];

    return GiftHistoryEvent(
      id: id,
      tiktokUid: tiktokUid,
      tiktokHandle: tiktokHandle,
      nickname: nickname is String && nickname.isNotEmpty ? nickname : (tiktokHandle ?? tiktokUid),
      profileImageUrl: parseImageUrl(value['profileImageUrl']),
      giftId: giftId is int ? giftId : 0,
      giftName: giftName,
      giftPictureUrl: parseImageUrl(value['giftPictureUrl']),
      repeatCount: repeatCount is int ? repeatCount : 0,
      totalDiamonds: totalDiamonds is int ? totalDiamonds : 0,
      receivedAt: DateTime.tryParse(value['receivedAt'] as String? ?? ''),
    );
  }

  /// [GiftHistorySyncStore.acknowledgeResync]へ渡すMap形式。[tryParse]の逆変換。
  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'tiktokUid': tiktokUid,
      'tiktokHandle': tiktokHandle,
      'nickname': nickname,
      'profileImageUrl': profileImageUrl,
      'giftId': giftId,
      'giftName': giftName,
      'giftPictureUrl': giftPictureUrl,
      'repeatCount': repeatCount,
      'totalDiamonds': totalDiamonds,
      'receivedAt': receivedAt?.toIso8601String(),
    };
  }
}
