import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/realtime_sync.dart';

void main() {
  group('VersionTracker', () {
    test('初期状態で受け取ったsnapshotは適用してよい', () {
      final tracker = VersionTracker();
      final envelope = SyncEnvelope<Map<String, dynamic>>(
        schemaVersion: 1,
        streamerId: 'test-streamer',
        kind: 'snapshot',
        bootId: 'boot-1',
        epoch: 0,
        version: 1,
        payload: {},
      );

      final result = tracker.check(envelope);

      expect(result.canApply, isTrue);
      expect(tracker.lastBootId, equals('boot-1'));
      expect(tracker.lastVersion, equals(1));
    });

    test('期待どおりの次versionは適用できる', () {
      final tracker = VersionTracker(
        lastBootId: 'boot-1',
        lastEpoch: 0,
        lastVersion: 5,
      );
      final envelope = SyncEnvelope<Map<String, dynamic>>(
        schemaVersion: 1,
        streamerId: 'test-streamer',
        kind: 'append',
        bootId: 'boot-1',
        epoch: 0,
        version: 6,
        payload: {},
      );

      final result = tracker.check(envelope);

      expect(result.canApply, isTrue);
      expect(tracker.lastVersion, equals(6));
    });

    test('epoch進行時は適用せずsnapshot要求', () {
      final tracker = VersionTracker(
        lastBootId: 'boot-1',
        lastEpoch: 0,
        lastVersion: 5,
      );
      final envelope = SyncEnvelope<Map<String, dynamic>>(
        schemaVersion: 1,
        streamerId: 'test-streamer',
        kind: 'snapshot',
        bootId: 'boot-1',
        epoch: 1, // epochが進んでいる
        version: 0,
        payload: {},
      );

      final result = tracker.check(envelope);

      expect(result.snapshotRequired, isTrue);
      expect(tracker.lastEpoch, equals(0)); // 更新されない
    });

    test('version欠損時はsnapshot要求', () {
      final tracker = VersionTracker(
        lastBootId: 'boot-1',
        lastEpoch: 0,
        lastVersion: 5,
      );
      final envelope = SyncEnvelope<Map<String, dynamic>>(
        schemaVersion: 1,
        streamerId: 'test-streamer',
        kind: 'append',
        bootId: 'boot-1',
        epoch: 0,
        version: 10, // 6-9が欠落
        payload: {},
      );

      final result = tracker.check(envelope);

      expect(result.snapshotRequired, isTrue);
      expect(tracker.lastVersion, equals(5)); // 更新されない
    });

    test('古いversion(重複再送)は無視', () {
      final tracker = VersionTracker(
        lastBootId: 'boot-1',
        lastEpoch: 0,
        lastVersion: 5,
      );
      final envelope = SyncEnvelope<Map<String, dynamic>>(
        schemaVersion: 1,
        streamerId: 'test-streamer',
        kind: 'append',
        bootId: 'boot-1',
        epoch: 0,
        version: 3, // 既に受け取ったバージョン
        payload: {},
      );

      final result = tracker.check(envelope);

      expect(result.ignoreDuplicate, isTrue);
      expect(tracker.lastVersion, equals(5)); // 更新されない
    });

    test('bootId不一致時は無条件でfull resyncを要求', () {
      final tracker = VersionTracker(
        lastBootId: 'boot-1',
        lastEpoch: 0,
        lastVersion: 5,
      );
      // bootIdが変わった(web再起動)
      final envelope = SyncEnvelope<Map<String, dynamic>>(
        schemaVersion: 1,
        streamerId: 'test-streamer',
        kind: 'append',
        bootId: 'boot-2', // 異なるbootId
        epoch: 0,
        version: 3, // versionが古いが無視される
        payload: {},
      );

      final result = tracker.check(envelope);

      expect(result.fullResyncRequired, isTrue);
      expect(tracker.lastBootId, equals('boot-1')); // 更新されない
      expect(tracker.lastVersion, equals(5)); // 更新されない
    });

    test('最初のbootIdはnullから設定される', () {
      final tracker = VersionTracker(); // lastBootId = null
      final envelope = SyncEnvelope<Map<String, dynamic>>(
        schemaVersion: 1,
        streamerId: 'test-streamer',
        kind: 'snapshot',
        bootId: 'boot-1',
        epoch: 0,
        version: 1,
        payload: {},
      );

      // nullとの比較なのでfullResyncRequiredにはならない
      final result = tracker.check(envelope);

      expect(result.canApply, isTrue);
    });

    test('reset()でトラッカーが初期化される', () {
      final tracker = VersionTracker(
        lastBootId: 'boot-1',
        lastEpoch: 1,
        lastVersion: 10,
      );

      tracker.reset();

      expect(tracker.lastBootId, isNull);
      expect(tracker.lastEpoch, equals(0));
      expect(tracker.lastVersion, equals(0));
    });

    test('複数streamerId間での独立性確認', () {
      final tracker1 = VersionTracker(lastVersion: 5);
      final tracker2 = VersionTracker(lastVersion: 100);

      final envelope1 = SyncEnvelope<Map<String, dynamic>>(
        schemaVersion: 1,
        streamerId: 'streamer-1',
        kind: 'append',
        bootId: 'boot-1',
        epoch: 0,
        version: 6,
        payload: {},
      );

      final envelope2 = SyncEnvelope<Map<String, dynamic>>(
        schemaVersion: 1,
        streamerId: 'streamer-2',
        kind: 'append',
        bootId: 'boot-1',
        epoch: 0,
        version: 101,
        payload: {},
      );

      expect(tracker1.check(envelope1).canApply, isTrue);
      expect(tracker2.check(envelope2).canApply, isTrue);

      expect(tracker1.lastVersion, equals(6));
      expect(tracker2.lastVersion, equals(101));
    });
  });
}
