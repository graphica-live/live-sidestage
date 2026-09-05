import '../core/url_validation.dart';

/// ギフト履歴タブの1行。
class GiftHistoryEvent {
  final String id;
  final String uniqueId;
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
    required this.uniqueId,
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
    final uniqueId = value['uniqueId'];
    final giftName = value['giftName'];
    if (id is! String || id.isEmpty) return null;
    if (uniqueId is! String || uniqueId.isEmpty) return null;
    if (giftName is! String || giftName.isEmpty) return null;

    final nickname = value['nickname'];
    final giftId = value['giftId'];
    final repeatCount = value['repeatCount'];
    final totalDiamonds = value['totalDiamonds'];

    return GiftHistoryEvent(
      id: id,
      uniqueId: uniqueId,
      nickname: nickname is String && nickname.isNotEmpty ? nickname : uniqueId,
      profileImageUrl: parseImageUrl(value['profileImageUrl']),
      giftId: giftId is int ? giftId : 0,
      giftName: giftName,
      giftPictureUrl: parseImageUrl(value['giftPictureUrl']),
      repeatCount: repeatCount is int ? repeatCount : 0,
      totalDiamonds: totalDiamonds is int ? totalDiamonds : 0,
      receivedAt: DateTime.tryParse(value['receivedAt'] as String? ?? ''),
    );
  }
}
