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
  final String? avatarUrl;

  /// 3人以上のバトルでの自分以外の参加者数。1v1なら常に1。
  final int count;

  const BattleOpponent({this.tiktokId, this.avatarUrl, required this.count});

  static BattleOpponent? tryParse(Object? value) {
    if (value is! Map) return null;
    final count = value['count'];
    final tiktokId = value['tiktokId'];
    final avatarUrl = value['avatarUrl'];
    return BattleOpponent(
      tiktokId: tiktokId is String && tiktokId.isNotEmpty ? tiktokId : null,
      avatarUrl: avatarUrl is String && avatarUrl.isNotEmpty ? avatarUrl : null,
      count: count is int && count > 0 ? count : 1,
    );
  }
}

/// 左右split表示(vs)1メンバー分。サーバーの`BattleParticipant`と対応する。
class BattleParticipant {
  final String anchorId;
  final String? avatarUrl;

  const BattleParticipant({required this.anchorId, this.avatarUrl});

  static BattleParticipant? tryParse(Object? value) {
    if (value is! Map) return null;
    final anchorId = value['anchorId'];
    if (anchorId is! String || anchorId.isEmpty) return null;
    final avatarUrl = value['avatarUrl'];
    return BattleParticipant(
      anchorId: anchorId,
      avatarUrl: avatarUrl is String && avatarUrl.isNotEmpty ? avatarUrl : null,
    );
  }

  static List<BattleParticipant>? tryParseList(Object? value) {
    if (value is! List) return null;
    return value.map(BattleParticipant.tryParse).whereType<BattleParticipant>().toList();
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

  /// 左右split表示用。selfTeamは自分を含む1件以上、opponentTeamも1件以上
  /// (1vs1・チーム戦が解決できた場合)。対戦相手不明・チーム未解決の場合は
  /// どちらもnull(UIは[opponent]でフォールバック表示する)。
  final List<BattleParticipant>? selfTeam;
  final List<BattleParticipant>? opponentTeam;
  final String? selfScore;
  final String? opponentScore;

  const BattleSummary({
    required this.battleId,
    this.startedAt,
    required this.status,
    this.opponent,
    this.selfTeam,
    this.opponentTeam,
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
      selfTeam: BattleParticipant.tryParseList(value['selfTeam']),
      opponentTeam: BattleParticipant.tryParseList(value['opponentTeam']),
      selfScore: value['selfScore'] as String?,
      opponentScore: value['opponentScore'] as String?,
    );
  }
}
