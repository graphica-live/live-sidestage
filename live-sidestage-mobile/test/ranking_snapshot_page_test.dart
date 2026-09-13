import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/ranking_snapshot_page.dart';
import 'package:live_sidestage_mobile/models/gift_ranking_entry.dart';

GiftRankingEntry _entry(
  String uid, {
  String? profileImageUrl,
}) {
  return GiftRankingEntry(
    tiktokUid: uid,
    nickname: uid,
    profileImageUrl: profileImageUrl,
    giftCount: 1,
    totalDiamonds: 10,
  );
}

List<GiftRankingEntry> _uids(int count, {String prefix = 'u'}) {
  return List.generate(count, (i) => _entry('$prefix$i'));
}

void main() {
  group('mergeRankingSnapshotPage', () {
    test('REST userCount=1900, snapshot 50, loaded 50', () {
      final merged = mergeRankingSnapshotPage(
        snapshotUsers: _uids(50, prefix: 's'),
        loadedUsers: _uids(50, prefix: 'l'),
        restUserCount: 1900,
      );
      expect(merged.userCount, 1900);
      expect(merged.users.length, 50);
      expect(merged.hasMore, isTrue);
    });

    test('REST 1900, snapshot 1900, loaded 50 — window stays 50', () {
      final merged = mergeRankingSnapshotPage(
        snapshotUsers: _uids(1900),
        loadedUsers: _uids(50),
        restUserCount: 1900,
      );
      expect(merged.users.length, 50);
      expect(merged.userCount, 1900);
      expect(merged.hasMore, isTrue);
    });

    test('REST 1900, snapshot 50, loaded 150 — tail from loaded', () {
      final snapshot = _uids(50, prefix: 's');
      final loaded = [
        ..._uids(50, prefix: 's'),
        ..._uids(100, prefix: 't'),
      ];
      final merged = mergeRankingSnapshotPage(
        snapshotUsers: snapshot,
        loadedUsers: loaded,
        restUserCount: 1900,
      );
      expect(merged.users.length, 150);
      expect(merged.hasMore, isTrue);
      expect(merged.users.take(50).map((e) => e.tiktokUid), snapshot.map((e) => e.tiktokUid));
    });

    test('loaded empty + snapshot 1900 — capped window', () {
      final merged = mergeRankingSnapshotPage(
        snapshotUsers: _uids(1900),
        loadedUsers: const [],
        restUserCount: 1900,
      );
      expect(merged.users.length, 50);
      expect(merged.userCount, greaterThanOrEqualTo(1900));
      expect(merged.hasMore, isTrue);
    });

    test('preserves avatar URL from loaded when snapshot row is null', () {
      final merged = mergeRankingSnapshotPage(
        snapshotUsers: [_entry('u1', profileImageUrl: null)],
        loadedUsers: [_entry('u1', profileImageUrl: 'https://example.com/a.jpg')],
        restUserCount: 1,
      );
      expect(merged.users.single.profileImageUrl, 'https://example.com/a.jpg');
    });

    test('does not overwrite snapshot avatar URL with loaded', () {
      final merged = mergeRankingSnapshotPage(
        snapshotUsers: [_entry('u1', profileImageUrl: 'https://snap.example/s.jpg')],
        loadedUsers: [_entry('u1', profileImageUrl: 'https://loaded.example/l.jpg')],
        restUserCount: 1,
      );
      expect(merged.users.single.profileImageUrl, 'https://snap.example/s.jpg');
    });

    test('loaded.length >= userCount → hasMore false', () {
      final merged = mergeRankingSnapshotPage(
        snapshotUsers: _uids(50),
        loadedUsers: _uids(50),
        restUserCount: 50,
      );
      expect(merged.userCount, 50);
      expect(merged.users.length, 50);
      expect(merged.hasMore, isFalse);
    });

    test('restUserCount=50 but snapshot 51 raises userCount', () {
      final merged = mergeRankingSnapshotPage(
        snapshotUsers: _uids(51),
        loadedUsers: const [],
        restUserCount: 50,
      );
      expect(merged.userCount, 51);
    });

    test('先頭ページsnapshotに新規uidが混ざっても窓長を超えない', () {
      final loaded = [_entry('a'), _entry('b'), _entry('c'), _entry('d')];
      final snapshot = [_entry('x'), _entry('a')];
      final merged = mergeRankingSnapshotPage(
        snapshotUsers: snapshot,
        loadedUsers: loaded,
        restUserCount: 10,
      );
      expect(merged.users.length, 4);
      expect(merged.users.map((u) => u.tiktokUid).toList(), ['x', 'a', 'b', 'c']);
      expect(merged.hasMore, isTrue);
    });
  });
}
