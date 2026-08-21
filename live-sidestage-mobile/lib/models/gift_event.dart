/// LIVE Sidestage Analytics が `chat:gift` として配信するギフトイベント。
///
/// サーバー側(chat-feed.ts の ChatGiftPayload)と対になる契約。
/// フィールドを増やすときは両方を同時に変えること。
class GiftEvent {
  final String streamerId;
  final String uniqueId;
  final String nickname;
  final String? profilePictureUrl;

  /// trim + 小文字化済み。[GiftSound.giftName] と直接比較してよい。
  final String giftName;
  final String? giftId;
  final int diamondCount;

  /// このtick時点の累計連打数。
  final int repeatCount;

  /// 今回のtickで新たに増えた回数。
  ///
  /// まとめ投げは1コンボにつき1回しか鳴らさないので、効果音側はこの値を使わない。
  /// サーバー契約の一部なので受け取って保持だけする（診断とログ用）。
  final int delta;

  /// diamondCount * repeatCount。コイン数の累計側の値。
  final int totalCoins;

  /// サーバー側の状態が失われた後の復帰tickなら true（delta が 1 に切り詰められている）。
  final bool baselineReset;

  final bool isCombo;
  final bool repeatEnd;

  /// コンボ識別子。groupId が無いギフトでは null で、その場合サーバー側で
  /// dedup 済みの単発イベントとして扱う（重複発火の抑止に使ってはいけない）。
  final String? comboId;

  final DateTime occurredAt;

  GiftEvent({
    required this.streamerId,
    required this.uniqueId,
    required this.nickname,
    required this.profilePictureUrl,
    required this.giftName,
    required this.giftId,
    required this.diamondCount,
    required this.repeatCount,
    required this.delta,
    required this.totalCoins,
    required this.baselineReset,
    required this.isCombo,
    required this.repeatEnd,
    required this.comboId,
    required this.occurredAt,
  });

  /// 解析できない場合は null を返す。
  ///
  /// socket の購読 callback の中で例外を投げると、以降のイベント受信ごと壊れる。
  /// 不正な1件だけ捨てて配信を継続できるよう、例外ではなく null で返す。
  static GiftEvent? tryParse(Map<String, dynamic> json) {
    final streamerId = json['streamerId'];
    final uniqueId = json['uniqueId'];
    if (streamerId is! String || uniqueId is! String) return null;

    return GiftEvent(
      streamerId: streamerId,
      uniqueId: uniqueId,
      nickname: json['nickname'] as String? ?? uniqueId,
      profilePictureUrl: json['profilePictureUrl'] as String?,
      giftName: json['giftName'] as String? ?? '',
      giftId: json['giftId'] as String?,
      diamondCount: _asInt(json['diamondCount']),
      repeatCount: _asInt(json['repeatCount'], fallback: 1),
      delta: _asInt(json['delta'], fallback: 1),
      totalCoins: _asInt(json['totalCoins']),
      baselineReset: json['baselineReset'] == true,
      isCombo: json['isCombo'] == true,
      repeatEnd: json['repeatEnd'] == true,
      comboId: json['comboId'] as String?,
      occurredAt: DateTime.tryParse(json['occurredAt'] as String? ?? '') ?? DateTime.now(),
    );
  }
}

int _asInt(Object? value, {int fallback = 0}) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return fallback;
}
