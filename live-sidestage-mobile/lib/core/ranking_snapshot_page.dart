import '../models/gift_ranking_entry.dart';

/// REST 1ページ分と ranking snapshot を合成した結果。
class RankingSnapshotPage {
  const RankingSnapshotPage({
    required this.users,
    required this.userCount,
    required this.hasMore,
  });

  final List<GiftRankingEntry> users;
  final int userCount;
  final bool hasMore;
}

/// 当日 live snapshot / acknowledgeResync は先頭ページだけ、または全件。
/// snapshot 件数で userCount / hasMore を潰すと当日の無限スクロールが止まる。
RankingSnapshotPage mergeRankingSnapshotPage({
  required List<GiftRankingEntry> snapshotUsers,
  required List<GiftRankingEntry> loadedUsers,
  int? restUserCount,
  int emptyWindowSize = 50,
}) {
  final userCount = _max3(
    snapshotUsers.length,
    loadedUsers.length,
    restUserCount ?? 0,
  );

  final window = loadedUsers.isNotEmpty
      ? loadedUsers.length
      : snapshotUsers.length < emptyWindowSize
          ? snapshotUsers.length
          : emptyWindowSize;

  final List<GiftRankingEntry> nextUsers;
  if (snapshotUsers.length >= window) {
    nextUsers = snapshotUsers.sublist(0, window);
  } else {
    final topUids = {for (final u in snapshotUsers) u.tiktokUid};
    final combined = [
      ...snapshotUsers,
      ...loadedUsers.where((u) => !topUids.contains(u.tiktokUid)),
    ];
    nextUsers = combined.length > window ? combined.sublist(0, window) : combined;
  }

  final previousByUid = {for (final u in loadedUsers) u.tiktokUid: u};
  final mergedUsers = [
    for (final u in nextUsers)
      if (u.profileImageUrl == null &&
          previousByUid[u.tiktokUid]?.profileImageUrl != null)
        u.copyWith(
          profileImageUrl: previousByUid[u.tiktokUid]!.profileImageUrl,
        )
      else
        u,
  ];

  return RankingSnapshotPage(
    users: mergedUsers,
    userCount: userCount,
    hasMore: mergedUsers.length < userCount,
  );
}

int _max3(int a, int b, int c) {
  final ab = a > b ? a : b;
  return ab > c ? ab : c;
}