/// バトルの状態。サーバー(`BattleWindow["status"]`)の4値にそのまま対応する。
enum BattleStatus {
  live,
  finished,
  cutShort,
  unknown;

  static BattleStatus tryParse(Object? value) {
    switch (value) {
      case 'live':
        return BattleStatus.live;
      case 'finished':
        return BattleStatus.finished;
      case 'cut_short':
        return BattleStatus.cutShort;
      default:
        return BattleStatus.unknown;
    }
  }
}

/// 対戦相手の情報。**tiktokId は null になりうる**(相手roomが未登録、または
/// anchorIdベースで相手を特定できなかった場合)。
class BattleOpponent {
  final String? tiktokId;

  /// 3人以上のバトルでの自分以外の参加者数。1v1なら常に1。
  final int count;

  const BattleOpponent({this.tiktokId, required this.count});

  static BattleOpponent? tryParse(Object? value) {
    if (value is! Map) return null;
    final count = value['count'];
    final tiktokId = value['tiktokId'];
    return BattleOpponent(
      tiktokId: tiktokId is String && tiktokId.isNotEmpty ? tiktokId : null,
      count: count is int && count > 0 ? count : 1,
    );
  }
}

/// バトル履歴タブの1行。
///
/// **opponent・selfScore・opponentScore は全てnullableで、実際にnullになりうる。**
/// 相手が特定できない・スコアが未観測なケースがあるため、UIは「相手情報なし」
/// 「スコア不明」の表示分岐を必ず用意する。
///
/// スコアは最大30桁の数値文字列(TikTokのhostScoreをそのまま保持)。桁あふれを
/// 避けるため意図的に数値型へ変換せず String のまま持つ。
class BattleSummary {
  final String battleId;
  final DateTime? startedAt;
  final BattleStatus status;
  final BattleOpponent? opponent;
  final String? selfScore;
  final String? opponentScore;

  const BattleSummary({
    required this.battleId,
    this.startedAt,
    required this.status,
    this.opponent,
    this.selfScore,
    this.opponentScore,
  });

  static BattleSummary? tryParse(Object? value) {
    if (value is! Map) return null;
    final battleId = value['battleId'];
    if (battleId is! String || battleId.isEmpty) return null;

    return BattleSummary(
      battleId: battleId,
      startedAt: DateTime.tryParse(value['startedAt'] as String? ?? ''),
      status: BattleStatus.tryParse(value['status']),
      opponent: BattleOpponent.tryParse(value['opponent']),
      selfScore: value['selfScore'] as String?,
      opponentScore: value['opponentScore'] as String?,
    );
  }
}
