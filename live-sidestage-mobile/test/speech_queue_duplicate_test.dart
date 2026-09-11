import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/speech_queue.dart';
import 'package:live_sidestage_mobile/models/comment.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // SpeechQueueControllerのコンストラクタがAudioPlayer()を生成するため、
  // audioplayersのMethodChannelをモックしないとMissingPluginExceptionになる。
  const audioplayersGlobalChannel = MethodChannel('xyz.luan/audioplayers.global');
  const audioplayersChannel = MethodChannel('xyz.luan/audioplayers');
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(audioplayersGlobalChannel, (call) async => null);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(audioplayersChannel, (call) async => null);
  });

  group('SpeechQueueController._enqueue の重複判定統合', () {
    late SpeechQueueController controller;
    final now = DateTime(2024, 1, 1, 12, 0, 0);

    Comment buildComment(String text) {
      return Comment(
        streamerId: 'streamer1',
        tiktokUid: 'uid1',
        tiktokHandle: '@user',
        nickname: 'User',
        profilePictureUrl: null,
        comment: text,
        receivedAt: now,
      );
    }

    setUp(() {
      controller = SpeechQueueController()
        ..initialized = true
        ..debugSkipProcessing = true;
    });

    test('duplicateSkipEnabled=true: 短時間の同一内容3連投で3件目はキューに積まれない', () {
      controller.duplicateSkipEnabled = true;
      controller.debugEnqueue(buildComment('hello'));
      controller.debugEnqueue(buildComment('hello'));
      controller.debugEnqueue(buildComment('hello'));
      expect(controller.debugQueueLength, 2);
    });

    test('duplicateSkipEnabled=false: 同一内容の連投でも全件キューに積まれる', () {
      controller.duplicateSkipEnabled = false;
      controller.debugEnqueue(buildComment('hello'));
      controller.debugEnqueue(buildComment('hello'));
      controller.debugEnqueue(buildComment('hello'));
      expect(controller.debugQueueLength, 3);
    });

    test('speechTextが空のコメントは重複判定に到達せず弾かれる(既存動作の回帰確認)', () {
      controller.duplicateSkipEnabled = true;
      controller.debugEnqueue(buildComment('😀'));
      expect(controller.debugQueueLength, 0);
    });

    test('FREEプランのクールダウン中は重複していない新規コメントも積まれない(判定順序の回帰確認)', () {
      controller.duplicateSkipEnabled = true;
      controller.debugStartFreeIntervalCooldown();
      controller.debugEnqueue(buildComment('hello'));
      expect(controller.debugQueueLength, 0);
    });
  });
}
