import '../core/url_validation.dart';

/// 貢献タブ(ユーザー別コイン数ランキング)の1行。
///
/// バトル履歴タブの貢献者展開でも同じ形状のデータが返るため、専用モデルを
/// 作らずこれを再利用する(サーバー側 `GiftAnalyticsUser` に対応)。
class GiftRankingEntry {
  /// TikTokの不変な数値ID。集計・同一性・リストkeyはこれ。
  final String tiktokUid;

  /// 本人が変更できる @ハンドル。**TikTokUser 行が無ければサーバーは null を返す**ので
  /// nullable。プロフィール導線はこれが null のときに出さない。
  final String? tiktokHandle;

  /// 表示名。サーバーの nickname が無ければ tiktokHandle → tiktokUid の順で埋める。
  final String nickname;
  final String? profileImageUrl;
  final int giftCount;
  final int totalDiamonds;
  final DateTime? lastGiftAt;

  const GiftRankingEntry({
    required this.tiktokUid,
    this.tiktokHandle,
    required this.nickname,
    this.profileImageUrl,
    required this.giftCount,
    required this.totalDiamonds,
    this.lastGiftAt,
  });

  static GiftRankingEntry? tryParse(Object? value) {
    if (value is! Map) return null;
    final tiktokUid = value['tiktokUid'];
    if (tiktokUid is! String || tiktokUid.isEmpty) return null;

    final rawHandle = value['tiktokHandle'];
    final tiktokHandle = rawHandle is String && rawHandle.isNotEmpty ? rawHandle : null;
    final nickname = value['nickname'];
    final giftCount = value['giftCount'];
    final totalDiamonds = value['totalDiamonds'];

    return GiftRankingEntry(
      tiktokUid: tiktokUid,
      tiktokHandle: tiktokHandle,
      nickname: nickname is String && nickname.isNotEmpty ? nickname : (tiktokHandle ?? tiktokUid),
      profileImageUrl: parseImageUrl(value['profileImageUrl']),
      giftCount: giftCount is int ? giftCount : 0,
      totalDiamonds: totalDiamonds is int ? totalDiamonds : 0,
      lastGiftAt: DateTime.tryParse(value['lastGiftAt'] as String? ?? ''),
    );
  }

  /// [RankingSyncStore.acknowledgeResync]へ渡すMap形式。[tryParse]の逆変換。
  Map<String, dynamic> toMap() {
    return {
      'tiktokUid': tiktokUid,
      'tiktokHandle': tiktokHandle,
      'nickname': nickname,
      'profileImageUrl': profileImageUrl,
      'giftCount': giftCount,
      'totalDiamonds': totalDiamonds,
      'lastGiftAt': lastGiftAt?.toIso8601String(),
    };
  }
}
