import '../core/url_validation.dart';

/// 貢献タブの行を展開したときに出す、送信者1人ぶんの「ギフト名別」内訳1件。
/// サーバー側 `GiftBreakdownEntry`(gift-breakdown.ts)と対応する。
class GiftBreakdownEntry {
  final int giftId;
  final String giftName;
  final String? giftPictureUrl;
  final int repeatCount;
  final int totalDiamonds;

  const GiftBreakdownEntry({
    required this.giftId,
    required this.giftName,
    this.giftPictureUrl,
    required this.repeatCount,
    required this.totalDiamonds,
  });

  static GiftBreakdownEntry? tryParse(Object? value) {
    if (value is! Map) return null;
    final giftId = value['giftId'];
    final giftName = value['giftName'];
    if (giftId is! int || giftName is! String) return null;
    final repeatCount = value['repeatCount'];
    final totalDiamonds = value['totalDiamonds'];

    return GiftBreakdownEntry(
      giftId: giftId,
      giftName: giftName,
      giftPictureUrl: parseImageUrl(value['giftPictureUrl']),
      repeatCount: repeatCount is int ? repeatCount : 0,
      totalDiamonds: totalDiamonds is int ? totalDiamonds : 0,
    );
  }
}

/// 明細(Gift)が残っている期間でしか内訳を出せない。90日を超えた分はロールアップにしか
/// 残っておらず、ギフト名別の粒度が無いため([detailAvailable]がfalseになる)。
class GiftBreakdownCoverage {
  final bool detailAvailable;
  final bool partial;
  final String? rawFrom;

  const GiftBreakdownCoverage({required this.detailAvailable, required this.partial, this.rawFrom});

  static GiftBreakdownCoverage tryParse(Object? value) {
    if (value is! Map) return const GiftBreakdownCoverage(detailAvailable: false, partial: false);
    return GiftBreakdownCoverage(
      detailAvailable: value['detailAvailable'] == true,
      partial: value['partial'] == true,
      rawFrom: value['rawFrom'] as String?,
    );
  }
}

/// 貢献タブの行展開1回ぶんの結果。サーバー側 `GiftBreakdownResult`と対応する。
class GiftBreakdownResult {
  final List<GiftBreakdownEntry> gifts;
  final GiftBreakdownCoverage coverage;

  const GiftBreakdownResult({required this.gifts, required this.coverage});

  static GiftBreakdownResult tryParse(Object? value) {
    if (value is! Map) {
      return const GiftBreakdownResult(
        gifts: [],
        coverage: GiftBreakdownCoverage(detailAvailable: false, partial: false),
      );
    }
    final gifts = value['gifts'];
    return GiftBreakdownResult(
      gifts: gifts is List ? gifts.map(GiftBreakdownEntry.tryParse).whereType<GiftBreakdownEntry>().toList() : const [],
      coverage: GiftBreakdownCoverage.tryParse(value['coverage']),
    );
  }
}
