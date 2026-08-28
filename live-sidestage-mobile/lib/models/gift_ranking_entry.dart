import '../core/url_validation.dart';

/// 貢献タブ(ユーザー別コイン数ランキング)の1行。
///
/// バトル履歴タブの貢献者展開でも同じ形状のデータが返るため、専用モデルを
/// 作らずこれを再利用する(サーバー側 `GiftAnalyticsUser` に対応)。
class GiftRankingEntry {
  final String uniqueId;
  final String nickname;
  final String? profileImageUrl;
  final int giftCount;
  final int totalDiamonds;
  final DateTime? lastGiftAt;

  const GiftRankingEntry({
    required this.uniqueId,
    required this.nickname,
    this.profileImageUrl,
    required this.giftCount,
    required this.totalDiamonds,
    this.lastGiftAt,
  });

  static GiftRankingEntry? tryParse(Object? value) {
    if (value is! Map) return null;
    final uniqueId = value['uniqueId'];
    if (uniqueId is! String || uniqueId.isEmpty) return null;

    final nickname = value['nickname'];
    final giftCount = value['giftCount'];
    final totalDiamonds = value['totalDiamonds'];

    return GiftRankingEntry(
      uniqueId: uniqueId,
      nickname: nickname is String && nickname.isNotEmpty ? nickname : uniqueId,
      profileImageUrl: parseImageUrl(value['profileImageUrl']),
      giftCount: giftCount is int ? giftCount : 0,
      totalDiamonds: totalDiamonds is int ? totalDiamonds : 0,
      lastGiftAt: DateTime.tryParse(value['lastGiftAt'] as String? ?? ''),
    );
  }
}
