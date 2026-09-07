import 'gift_ranking_entry.dart';

/// 陣営内1参加者分の貢献者内訳。サーバーの`BattleTeamParticipantContributors`と対応する。
class BattleTeamParticipantContributors {
  final String anchorId;
  final String displayName;
  final String? captureStatus;
  final String? partialNote;
  final String? battleScore;
  final int observedGiftTotal;
  final List<GiftRankingEntry> contributors;

  const BattleTeamParticipantContributors({
    required this.anchorId,
    required this.displayName,
    this.captureStatus,
    this.partialNote,
    this.battleScore,
    required this.observedGiftTotal,
    required this.contributors,
  });

  static BattleTeamParticipantContributors? tryParse(Object? value) {
    if (value is! Map) return null;
    final anchorId = value['anchorId'];
    if (anchorId is! String || anchorId.isEmpty) return null;
    final displayName = value['displayName'];
    final observedGiftTotal = value['observedGiftTotal'];
    final contributors = value['contributors'];

    return BattleTeamParticipantContributors(
      anchorId: anchorId,
      displayName: displayName is String && displayName.isNotEmpty ? displayName : anchorId,
      captureStatus: value['captureStatus'] as String?,
      partialNote: value['partialNote'] as String?,
      battleScore: value['battleScore'] as String?,
      observedGiftTotal: observedGiftTotal is int ? observedGiftTotal : 0,
      contributors: contributors is List
          ? contributors.map(GiftRankingEntry.tryParse).whereType<GiftRankingEntry>().toList()
          : const [],
    );
  }

  static List<BattleTeamParticipantContributors> tryParseList(Object? value) {
    if (value is! List) return const [];
    return value.map(BattleTeamParticipantContributors.tryParse).whereType<BattleTeamParticipantContributors>().toList();
  }
}

/// 陣営1つ分の貢献者内訳。サーバーの`BattleTeamContributors`と対応する。
///
/// [selectorMode] が `"individual"` の陣営(相手が3陣営以上に分かれる乱戦の統合列)は、
/// [contributors]/[battleScore]/[captureStatus]等が[participants]の既定選択者(先頭)の値を
/// そのまま複製したものになる。UIは常に[participants]内の選択中1人を表示する。
class BattleTeamContributors {
  final int index;
  final bool isSelf;
  final String displayName;
  final String? captureStatus;
  final String? partialNote;
  final String? battleScore;
  final int observedGiftTotal;
  final List<GiftRankingEntry> contributors;
  final List<BattleTeamParticipantContributors> participants;
  final String selectorMode; // "aggregate" | "individual"

  const BattleTeamContributors({
    required this.index,
    required this.isSelf,
    required this.displayName,
    this.captureStatus,
    this.partialNote,
    this.battleScore,
    required this.observedGiftTotal,
    required this.contributors,
    required this.participants,
    required this.selectorMode,
  });

  bool get isIndividual => selectorMode == 'individual';

  static BattleTeamContributors? tryParse(Object? value) {
    if (value is! Map) return null;
    final index = value['index'];
    if (index is! int) return null;
    final displayName = value['displayName'];
    final observedGiftTotal = value['observedGiftTotal'];
    final contributors = value['contributors'];
    final selectorMode = value['selectorMode'];

    return BattleTeamContributors(
      index: index,
      isSelf: value['isSelf'] == true,
      displayName: displayName is String && displayName.isNotEmpty ? displayName : '?',
      captureStatus: value['captureStatus'] as String?,
      partialNote: value['partialNote'] as String?,
      battleScore: value['battleScore'] as String?,
      observedGiftTotal: observedGiftTotal is int ? observedGiftTotal : 0,
      contributors: contributors is List
          ? contributors.map(GiftRankingEntry.tryParse).whereType<GiftRankingEntry>().toList()
          : const [],
      participants: BattleTeamParticipantContributors.tryParseList(value['participants']),
      selectorMode: selectorMode is String && selectorMode.isNotEmpty ? selectorMode : 'aggregate',
    );
  }

  /// 陣営が2つ未満なら陣営別表示は成立しない(呼び出し側は既存フラット一覧へフォールバックする)。
  static List<BattleTeamContributors>? tryParseList(Object? value) {
    if (value is! List) return null;
    final teams = value.map(BattleTeamContributors.tryParse).whereType<BattleTeamContributors>().toList();
    if (teams.length < 2) return null;
    return teams;
  }
}
