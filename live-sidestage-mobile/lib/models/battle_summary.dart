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

/// 陣営1メンバー分。サーバーの`BattleParticipant`と対応する。
class BattleParticipant {
  final String anchorId;
  final String? avatarUrl;

  /// 相手が登録済みならそのtiktokId。未登録ならnull。3陣営以上のとき、陣営ラベルに使う
  /// (2陣営までは従来どおり[BattleSummary.opponent]側のtiktokIdを使う)。
  final String? tiktokId;
  final String? nickName;

  const BattleParticipant({required this.anchorId, this.avatarUrl, this.tiktokId, this.nickName});

  static BattleParticipant? tryParse(Object? value) {
    if (value is! Map) return null;
    final anchorId = value['anchorId'];
    if (anchorId is! String || anchorId.isEmpty) return null;
    final avatarUrl = value['avatarUrl'];
    final tiktokId = value['tiktokId'];
    final nickName = value['nickName'];
    return BattleParticipant(
      anchorId: anchorId,
      avatarUrl: avatarUrl is String && avatarUrl.isNotEmpty ? avatarUrl : null,
      tiktokId: tiktokId is String && tiktokId.isNotEmpty ? tiktokId : null,
      nickName: nickName is String && nickName.isNotEmpty ? nickName : null,
    );
  }

  static List<BattleParticipant>? tryParseList(Object? value) {
    if (value is! List) return null;
    return value.map(BattleParticipant.tryParse).whereType<BattleParticipant>().toList();
  }
}

/// 陣営1つ分。サーバーの`BattleTeam`と対応する。**陣営数は2に限らない**
/// (3陣営以上のマルチバトルはここでしか個別のスコアを取れない)。
///
/// [index] が0の陣営が自分。[score] は陣営内メンバーのスコア合計で、1人も観測
/// できていなければnull。
class BattleTeam {
  final int index;
  final bool isSelf;
  final String? score;
  final List<BattleParticipant> participants;

  const BattleTeam({
    required this.index,
    required this.isSelf,
    required this.score,
    required this.participants,
  });

  static BattleTeam? tryParse(Object? value) {
    if (value is! Map) return null;
    final index = value['index'];
    if (index is! int) return null;
    final score = value['score'];
    return BattleTeam(
      index: index,
      isSelf: value['isSelf'] == true,
      score: score is String && score.isNotEmpty ? score : null,
      participants: BattleParticipant.tryParseList(value['participants']) ?? const [],
    );
  }

  /// 陣営が2つ未満なら「陣営表示」は成立しないのでnullを返す(呼び出し側は
  /// 従来のselfTeam/opponentTeam表示へフォールバックする)。
  static List<BattleTeam>? tryParseList(Object? value) {
    if (value is! List) return null;
    final teams = value.map(BattleTeam.tryParse).whereType<BattleTeam>().toList();
    if (teams.length < 2) return null;
    return teams;
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

  /// 陣営ごとの内訳。**3陣営以上のバトルはここでしかスコアを分けられない**
  /// (トップレベルの[opponentScore]は1vs1のときしか入らない)。
  /// 2陣営のときは[selfTeam]/[opponentTeam]と同じ内容になる。
  /// サーバーが古い(このフィールドを返さない)場合はnull。
  final List<BattleTeam>? teams;
  final String? selfScore;
  final String? opponentScore;

  const BattleSummary({
    required this.battleId,
    this.startedAt,
    required this.status,
    this.opponent,
    this.selfTeam,
    this.opponentTeam,
    this.teams,
    this.selfScore,
    this.opponentScore,
  });

  /// 自陣以外の陣営スコアの最大値。3陣営以上で[opponentScore]がnullのときの
  /// 「相手側スコア」の代わりに使う(勝敗判定・しきい値フィルタ)。
  String? get maxOtherTeamScore {
    final list = teams;
    if (list == null) return null;
    BigInt? max;
    for (final t in list) {
      if (t.isSelf) continue;
      final value = BigInt.tryParse(t.score ?? '');
      if (value == null) continue;
      if (max == null || value > max) max = value;
    }
    return max?.toString();
  }

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
      teams: BattleTeam.tryParseList(value['teams']),
      selfScore: value['selfScore'] as String?,
      opponentScore: value['opponentScore'] as String?,
    );
  }
}
