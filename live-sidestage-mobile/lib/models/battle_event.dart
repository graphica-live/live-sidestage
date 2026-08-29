/// LIVE Sidestage Analytics が `chat:battle` として配信するバトル終了通知。
/// サーバー側(chat-feed.ts の ChatBattlePayload)と対になる契約。
///
/// **スコアやホスト情報は持たない。** 届いたことだけが意味を持つトリガー通知で、
/// 端末はこれをきっかけにバトル履歴タブを取り直す(REST の queryBattles が正)。
/// [startedAt] は必須 — バトル履歴タブは「今日」ではなく**バトルの開始日**で
/// 期間判定する(深夜0時をまたぐバトルが「今日」判定だと漏れるため)。
class BattleEvent {
  final String streamerId;
  final String battleId;
  final DateTime startedAt;
  final DateTime endedAt;

  BattleEvent({
    required this.streamerId,
    required this.battleId,
    required this.startedAt,
    required this.endedAt,
  });

  /// 解析できない場合は null を返す([GiftEvent.tryParse] と同じ理由)。
  static BattleEvent? tryParse(Map<String, dynamic> json) {
    final streamerId = json['streamerId'];
    final battleId = json['battleId'];
    if (streamerId is! String || battleId is! String) return null;

    final startedAt = DateTime.tryParse(json['startedAt'] as String? ?? '');
    final endedAt = DateTime.tryParse(json['endedAt'] as String? ?? '');
    if (startedAt == null || endedAt == null) return null;

    return BattleEvent(
      streamerId: streamerId,
      battleId: battleId,
      startedAt: startedAt,
      endedAt: endedAt,
    );
  }
}
