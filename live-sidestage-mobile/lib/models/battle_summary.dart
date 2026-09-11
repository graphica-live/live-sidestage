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

/// 対戦相手の情報。**tiktokHandle は null になりうる**(相手roomが未登録、または
/// tiktokUidベースで相手を特定できなかった場合)。
class BattleOpponent {
  /// 本人が変更できる @ハンドル。表示とプロフィール導線専用。
  final String? tiktokHandle;
  final String? avatarUrl;

  /// 3人以上のバトルでの自分以外の参加者数。1v1なら常に1。
  final int count;

  const BattleOpponent({this.tiktokHandle, this.avatarUrl, required this.count});

  static BattleOpponent? tryParse(Object? value) {
    if (value is! Map) return null;
    final count = value['count'];
    final tiktokHandle = value['tiktokHandle'];
    final avatarUrl = value['avatarUrl'];
    return BattleOpponent(
      tiktokHandle: tiktokHandle is String && tiktokHandle.isNotEmpty ? tiktokHandle : null,
      avatarUrl: avatarUrl is String && avatarUrl.isNotEmpty ? avatarUrl : null,
      count: count is int && count > 0 ? count : 1,
    );
  }
}

/// 陣営1メンバー分。サーバーの`BattleParticipant`と対応する。
class BattleParticipant {
  /// TikTokの不変な数値ID。同一性・選択状態のキーはこれ。
  final String tiktokUid;
  final String? avatarUrl;

  /// 本人が変更できる @ハンドル。取れなければnull。3陣営以上のとき、陣営ラベルに使う
  /// (2陣営までは従来どおり[BattleSummary.opponent]側のtiktokHandleを使う)。
  final String? tiktokHandle;
  final String? nickname;

  const BattleParticipant({
    required this.tiktokUid,
    this.avatarUrl,
    this.tiktokHandle,
    this.nickname,
  });

  static BattleParticipant? tryParse(Object? value) {
    if (value is! Map) return null;
    final tiktokUid = value['tiktokUid'];
    if (tiktokUid is! String || tiktokUid.isEmpty) return null;
    final avatarUrl = value['avatarUrl'];
    final tiktokHandle = value['tiktokHandle'];
    final nickname = value['nickname'];
    return BattleParticipant(
      tiktokUid: tiktokUid,
      avatarUrl: avatarUrl is String && avatarUrl.isNotEmpty ? avatarUrl : null,
      tiktokHandle: tiktokHandle is String && tiktokHandle.isNotEmpty ? tiktokHandle : null,
      nickname: nickname is String && nickname.isNotEmpty ? nickname : null,
    );
  }

  static List<BattleParticipant>? tryParseList(Object? value) {
    if (value is! List) return null;
    return value.map(BattleParticipant.tryParse).whereType<BattleParticipant>().toList();
  }
}

/// 再生不可の理由。サーバーの`isReplayable()`(`battle-replay.ts`)が返す4値+未知値。
enum BattleReplayUnavailableReason {
  notFinalized,
  noScorePoints,
  windowInvalid,
  participantsInvalid,
  unknown;

  static BattleReplayUnavailableReason tryParse(Object? value) {
    switch (value) {
      case 'not_finalized':
        return BattleReplayUnavailableReason.notFinalized;
      case 'no_score_points':
        return BattleReplayUnavailableReason.noScorePoints;
      case 'window_invalid':
        return BattleReplayUnavailableReason.windowInvalid;
      case 'participants_invalid':
        return BattleReplayUnavailableReason.participantsInvalid;
      default:
        return BattleReplayUnavailableReason.unknown;
    }
  }
}

/// 再生可否。サーバーが古く`replay`自体を返さない場合は[available]をfalseにフォールバックする。
class BattleReplayAvailability {
  final bool available;
  final BattleReplayUnavailableReason? reason;

  const BattleReplayAvailability({required this.available, this.reason});

  static const BattleReplayAvailability unavailable = BattleReplayAvailability(available: false, reason: null);

  static BattleReplayAvailability tryParse(Object? value) {
    if (value is! Map) return unavailable;
    final available = value['available'] == true;
    if (!available) {
      return BattleReplayAvailability(available: false, reason: BattleReplayUnavailableReason.tryParse(value['reason']));
    }
    return const BattleReplayAvailability(available: true, reason: null);
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

  /// 再生可否。サーバーが古ければ`available: false`にフォールバックする。
  final BattleReplayAvailability replay;

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
    this.replay = BattleReplayAvailability.unavailable,
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
      replay: BattleReplayAvailability.tryParse(value['replay']),
    );
  }

  /// [BattleHistorySyncStore.acknowledgeResync]へ渡すMap形式。[tryParse]の逆変換。
  Map<String, dynamic> toMap() {
    return {
      'battleId': battleId,
      'startedAt': startedAt?.toIso8601String(),
      'status': switch (status) {
        BattleStatus.live => 'live',
        BattleStatus.finished => 'finished',
        BattleStatus.cutShort => 'cut_short',
        BattleStatus.unknown => 'unknown',
      },
      'opponent': opponent == null
          ? null
          : {
              'tiktokHandle': opponent!.tiktokHandle,
              'avatarUrl': opponent!.avatarUrl,
              'count': opponent!.count,
            },
      'selfTeam': selfTeam?.map(_participantToMap).toList(),
      'opponentTeam': opponentTeam?.map(_participantToMap).toList(),
      'teams': teams
          ?.map((t) => {
                'index': t.index,
                'isSelf': t.isSelf,
                'score': t.score,
                'participants': t.participants.map(_participantToMap).toList(),
              })
          .toList(),
      'selfScore': selfScore,
      'opponentScore': opponentScore,
      'replay': {
        'available': replay.available,
        'reason': switch (replay.reason) {
          null => null,
          BattleReplayUnavailableReason.notFinalized => 'not_finalized',
          BattleReplayUnavailableReason.noScorePoints => 'no_score_points',
          BattleReplayUnavailableReason.windowInvalid => 'window_invalid',
          BattleReplayUnavailableReason.participantsInvalid => 'participants_invalid',
          BattleReplayUnavailableReason.unknown => 'unknown',
        },
      },
    };
  }

  static Map<String, dynamic> _participantToMap(BattleParticipant p) {
    return {
      'tiktokUid': p.tiktokUid,
      'avatarUrl': p.avatarUrl,
      'tiktokHandle': p.tiktokHandle,
      'nickname': p.nickname,
    };
  }
}
