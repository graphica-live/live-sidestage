import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/sound_engine.dart';
import 'package:live_sidestage_mobile/models/app_config.dart';
import 'package:live_sidestage_mobile/models/gift_event.dart';

/// 再生要求を記録するだけの fake。完了タイミングをテスト側で制御する。
class FakePlayer {
  final List<String> played = [];
  final List<double> volumes = [];
  final List<Completer<void>> _pending = [];
  bool autoComplete = true;

  Future<void> call(String filePath, double volume) {
    played.add(filePath);
    volumes.add(volume);
    if (autoComplete) return Future.value();
    final completer = Completer<void>();
    _pending.add(completer);
    return completer.future;
  }

  int get inFlight => _pending.where((c) => !c.isCompleted).length;

  void completeAll() {
    for (final c in List.of(_pending)) {
      if (!c.isCompleted) c.complete();
    }
  }
}

GiftSound giftSound(
  String id, {
  String giftName = '',
  String? fileName,
  int volume = 100,
  bool enabled = true,
}) {
  return GiftSound(
    id: id,
    giftName: giftName,
    giftLabel: giftName,
    fileName: fileName ?? '$id.mp3',
    soundName: id,
    volume: volume,
    enabled: enabled,
  );
}

AppConfig configWith({
  List<GiftSound> gifts = const [],
  bool enabled = true,
  int masterVolume = 100,
}) {
  return AppConfig(
    sound: SoundConfig(enabled: enabled, masterVolume: masterVolume, gifts: gifts),
  );
}

GiftEvent gift({
  String giftName = 'rose',
  int totalCoins = 1,
  int delta = 1,
  bool isCombo = false,
  String? comboId,
  String uniqueId = 'user_a',
  bool baselineReset = false,
  int repeatCount = 1,
}) {
  return GiftEvent(
    streamerId: 's',
    uniqueId: uniqueId,
    nickname: uniqueId,
    profilePictureUrl: null,
    giftName: giftName,
    giftId: 'g1',
    diamondCount: 1,
    repeatCount: repeatCount,
    delta: delta,
    totalCoins: totalCoins,
    baselineReset: baselineReset,
    isCombo: isCombo,
    repeatEnd: false,
    comboId: comboId,
    occurredAt: DateTime.now(),
  );
}

/// 再生は非同期なので、キュー待ちの分はイベントループを回さないと進まない。
Future<void> settle() => pumpEventQueue(times: 50);

void main() {
  late FakePlayer player;

  /// 存在しないことにするファイル名。resolvePath が null を返す。
  final missing = <String>{};

  SoundEngine engineFor(
    AppConfig config, {
    int maxConcurrent = 4,
    int maxQueueLength = 32,
    int maxPlaybacksPerEvent = 10,
  }) {
    final engine = SoundEngine(
      play: player.call,
      resolvePath: (fileName) => missing.contains(fileName) ? null : '/sounds/$fileName',
      maxConcurrent: maxConcurrent,
      maxQueueLength: maxQueueLength,
      maxPlaybacksPerEvent: maxPlaybacksPerEvent,
    );
    engine.applyConfig(config);
    return engine;
  }

  setUp(() {
    player = FakePlayer();
    missing.clear();
  });

  group('ギフト名の一致', () {
    test('giftName が空なら任意のギフトに一致する', () async {
      final engine = engineFor(configWith(gifts: [giftSound('a')]));
      engine.handleGift(gift(giftName: 'anything'));
      await settle();
      expect(player.played, ['/sounds/a.mp3']);
    });

    test('giftName が一致しなければ鳴らない', () async {
      final engine = engineFor(configWith(gifts: [giftSound('a', giftName: 'rose')]));
      engine.handleGift(gift(giftName: 'galaxy'));
      await settle();
      expect(player.played, isEmpty);
    });

    test('giftName が一致すれば鳴る', () async {
      final engine = engineFor(configWith(gifts: [giftSound('a', giftName: 'rose')]));
      engine.handleGift(gift(giftName: 'rose'));
      await settle();
      expect(player.played, ['/sounds/a.mp3']);
    });

    test('同じギフトに複数登録すると設定順に全部鳴る', () async {
      final engine = engineFor(configWith(gifts: [
        giftSound('a', giftName: 'rose'),
        giftSound('b', giftName: 'rose'),
        giftSound('c', giftName: 'galaxy'),
      ]));
      engine.handleGift(gift(giftName: 'rose'));
      await settle();
      expect(player.played, ['/sounds/a.mp3', '/sounds/b.mp3']);
    });

    test('無効にした行は鳴らない', () async {
      final engine = engineFor(configWith(gifts: [
        giftSound('a', giftName: 'rose', enabled: false),
        giftSound('b', giftName: 'rose'),
      ]));
      engine.handleGift(gift(giftName: 'rose'));
      await settle();
      expect(player.played, ['/sounds/b.mp3']);
    });

    test('効果音全体がOFFなら鳴らない', () async {
      final engine = engineFor(configWith(gifts: [giftSound('a')], enabled: false));
      engine.handleGift(gift());
      await settle();
      expect(player.played, isEmpty);
    });
  });

  group('まとめ投げ', () {
    test('同じ comboId は1回しか鳴らない', () async {
      final engine = engineFor(configWith(gifts: [giftSound('a')]));
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 1));
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 3));
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 2));
      await settle();
      expect(player.played, ['/sounds/a.mp3']);
    });

    test('別の comboId なら改めて鳴る', () async {
      final engine = engineFor(configWith(gifts: [giftSound('a')]));
      engine.handleGift(gift(isCombo: true, comboId: 'c1'));
      engine.handleGift(gift(isCombo: true, comboId: 'c2'));
      await settle();
      expect(player.played, hasLength(2));
    });

    test('comboId が null のコンボは抑止されない（サーバー側で dedup 済み）', () async {
      final engine = engineFor(configWith(gifts: [giftSound('a')]));
      engine.handleGift(gift(isCombo: true, comboId: null));
      engine.handleGift(gift(isCombo: true, comboId: null));
      await settle();
      expect(player.played, hasLength(2));
    });

    test('delta が大きくても1回しか鳴らない', () async {
      final engine = engineFor(configWith(gifts: [giftSound('a')]));
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 50));
      await settle();
      expect(player.played, hasLength(1));
    });

    test('非コンボの連続ギフトはその都度鳴る', () async {
      final engine = engineFor(configWith(gifts: [giftSound('a')]));
      engine.handleGift(gift());
      engine.handleGift(gift());
      await settle();
      expect(player.played, hasLength(2));
    });

    test('コンボ記憶の上限を超えると古いキーが忘れられる', () async {
      final engine = SoundEngine(
        play: player.call,
        resolvePath: (fileName) => '/sounds/$fileName',
        comboMemorySize: 2,
      )..applyConfig(configWith(gifts: [giftSound('a')]));

      engine.handleGift(gift(isCombo: true, comboId: 'c1'));
      engine.handleGift(gift(isCombo: true, comboId: 'c2'));
      engine.handleGift(gift(isCombo: true, comboId: 'c3')); // ここで c1 が押し出される
      engine.handleGift(gift(isCombo: true, comboId: 'c1')); // 忘れているので再度鳴る
      await settle();
      expect(player.played, hasLength(4));
    });
  });

  group('音量', () {
    test('個別音量 × 全体音量', () async {
      final engine = engineFor(
        configWith(gifts: [giftSound('a', volume: 50)], masterVolume: 50),
      );
      engine.handleGift(gift());
      await settle();
      expect(player.volumes.single, closeTo(0.25, 0.0001));
    });
  });

  group('欠損ファイル', () {
    test('実ファイルが無い行は飛ばし、他の行は鳴る', () async {
      missing.add('a.mp3');
      final engine = engineFor(configWith(gifts: [
        giftSound('a', giftName: 'rose'),
        giftSound('b', giftName: 'rose'),
      ]));
      engine.handleGift(gift(giftName: 'rose'));
      await settle();
      expect(player.played, ['/sounds/b.mp3']);
    });

    test('欠損した行は再生予算を消費しない', () async {
      missing.addAll(['a.mp3', 'b.mp3']);
      final engine = engineFor(
        configWith(gifts: [
          giftSound('a', giftName: 'rose'),
          giftSound('b', giftName: 'rose'),
          giftSound('c', giftName: 'rose'),
        ]),
        maxPlaybacksPerEvent: 1,
      );
      engine.handleGift(gift(giftName: 'rose'));
      await settle();
      expect(player.played, ['/sounds/c.mp3']);
      expect(engine.overflowCount, 0);
    });
  });

  group('上限', () {
    test('1イベントの再生上限を超えた分は鳴らさず overflow に数える', () async {
      final engine = engineFor(
        configWith(gifts: [
          for (var i = 0; i < 5; i++) giftSound('g$i', giftName: 'rose'),
        ]),
        maxPlaybacksPerEvent: 3,
      );
      engine.handleGift(gift(giftName: 'rose'));
      await settle();
      expect(player.played, ['/sounds/g0.mp3', '/sounds/g1.mp3', '/sounds/g2.mp3']);
      expect(engine.overflowCount, 2);
    });

    test('キューが溢れたら古いものから捨てる', () async {
      player.autoComplete = false;
      final engine = engineFor(
        configWith(gifts: [giftSound('a')]),
        maxConcurrent: 1,
        maxQueueLength: 2,
      );
      for (var i = 0; i < 6; i++) {
        engine.handleGift(gift());
      }
      await settle();
      // 1件が再生中、2件がキュー、残りは捨てられる。
      expect(player.inFlight, 1);
      expect(engine.droppedCount, greaterThan(0));
      player.completeAll();
    });

    test('同時再生数を超えない', () async {
      player.autoComplete = false;
      final engine = engineFor(
        configWith(gifts: [for (var i = 0; i < 5; i++) giftSound('g$i')]),
        maxConcurrent: 2,
      );
      engine.handleGift(gift());
      await settle();
      expect(player.inFlight, 2);
      player.completeAll();
    });
  });

  group('診断', () {
    test('baselineReset を数える', () async {
      final engine = engineFor(configWith(gifts: [giftSound('a')]));
      engine.handleGift(gift(baselineReset: true, repeatCount: 8));
      await settle();
      expect(engine.baselineResetCount, 1);
      expect(player.played, hasLength(1));
    });

    test('直近に鳴らしたギフト名を保持する', () async {
      final engine = engineFor(
        configWith(gifts: [giftSound('a', giftName: 'rose')]),
      );
      engine.handleGift(gift(giftName: 'rose'));
      await settle();
      expect(engine.lastGiftName, 'rose');
    });

    test('再生に失敗してもエンジンは動き続ける', () async {
      var first = true;
      final engine = SoundEngine(
        play: (path, volume) {
          if (first) {
            first = false;
            return Future.error(StateError('boom'));
          }
          return player.call(path, volume);
        },
        resolvePath: (fileName) => '/sounds/$fileName',
      )..applyConfig(configWith(gifts: [giftSound('a')]));

      engine.handleGift(gift());
      await settle();
      expect(engine.errorMessage, isNotNull);

      engine.handleGift(gift());
      await settle();
      expect(player.played, ['/sounds/a.mp3']);
    });
  });

}
