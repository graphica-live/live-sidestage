import 'dart:async';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/sound_engine.dart';
import 'package:live_sidestage_mobile/models/app_config.dart';
import 'package:live_sidestage_mobile/models/comment.dart';
import 'package:live_sidestage_mobile/models/follow_event.dart';
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

/// 常に同じ値を返す Random（random 再生モードの検証用）。
class FixedRandom implements Random {
  FixedRandom(this.value);
  final int value;
  @override
  bool nextBool() => false;
  @override
  double nextDouble() => 0;
  @override
  int nextInt(int max) => value % max;
}

SoundAsset asset(String id, {int volume = 100}) =>
    SoundAsset(id: id, name: id, fileName: '$id.mp3', source: SoundSourceKind.local, volume: volume);

SoundTrigger trigger(
  String id, {
  String categoryId = 'cat',
  List<String> soundIds = const ['s1'],
  SoundEventType eventType = SoundEventType.gift,
  String giftName = '',
  int minCoins = 0,
  bool treatGiftComboAsSingle = true,
  SoundCommentMode commentMode = SoundCommentMode.any,
  String commentText = '',
  List<String> userIds = const [],
  bool enabled = true,
  SoundPlayMode playMode = SoundPlayMode.sequential,
}) {
  return SoundTrigger(
    id: id,
    name: id,
    categoryId: categoryId,
    enabled: enabled,
    soundIds: soundIds,
    playMode: playMode,
    eventType: eventType,
    giftName: giftName,
    minCoins: minCoins,
    treatGiftComboAsSingle: treatGiftComboAsSingle,
    commentMode: commentMode,
    commentText: commentText,
    userIds: userIds,
  );
}

AppConfig configWith({
  List<SoundCategory> categories = const [SoundCategory(id: 'cat', name: 'cat')],
  List<SoundTrigger> triggers = const [],
  List<SoundAsset> assets = const [],
  bool enabled = true,
  int masterVolume = 100,
}) {
  return AppConfig(
    sound: SoundConfig(
      enabled: enabled,
      masterVolume: masterVolume,
      categories: categories,
      triggers: triggers,
      assets: assets,
    ),
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

Comment comment(String text, {String uniqueId = 'user_a'}) => Comment(
      streamerId: 's',
      uniqueId: uniqueId,
      nickname: uniqueId,
      profilePictureUrl: null,
      comment: text,
      receivedAt: DateTime.now(),
    );

/// 再生はグループ単位の非同期処理なので、2音目以降とキュー待ちの分は
/// イベントループを回さないと進まない。アサーション前に必ず通す。
Future<void> settle() => pumpEventQueue(times: 50);

void main() {
  late FakePlayer player;

  SoundEngine engineFor(AppConfig config, {Random? random, int maxConcurrent = 4, int maxQueueLength = 32}) {
    final engine = SoundEngine(
      play: player.call,
      resolvePath: (a) => '/sounds/${a.fileName}',
      random: random,
      maxConcurrent: maxConcurrent,
      maxQueueLength: maxQueueLength,
    );
    engine.applyConfig(config);
    return engine;
  }

  setUp(() => player = FakePlayer());

  group('カテゴリ', () {
    test('カテゴリが無効ならトリガーは発火しない', () {
      final engine = engineFor(configWith(
        categories: const [SoundCategory(id: 'cat', name: 'cat', enabled: false)],
        triggers: [trigger('t1')],
        assets: [asset('s1')],
      ));
      engine.handleGift(gift());
      expect(player.played, isEmpty);
    });

    test('サウンド全体が無効なら発火しない', () {
      final engine = engineFor(configWith(
        enabled: false,
        triggers: [trigger('t1')],
        assets: [asset('s1')],
      ));
      engine.handleGift(gift());
      expect(player.played, isEmpty);
    });
  });

  group('ギフト条件', () {
    test('giftName が空なら任意のギフトに一致する', () {
      final engine = engineFor(configWith(triggers: [trigger('t1')], assets: [asset('s1')]));
      engine.handleGift(gift(giftName: 'なんでも'));
      expect(player.played, ['/sounds/s1.mp3']);
    });

    test('giftName 指定時は一致しなければ発火しない', () {
      final engine = engineFor(
        configWith(triggers: [trigger('t1', giftName: 'rose')], assets: [asset('s1')]),
      );
      engine.handleGift(gift(giftName: 'galaxy'));
      expect(player.played, isEmpty);
    });

    test('minCoins は境界値(totalCoins == minCoins)で発火する', () {
      final engine = engineFor(
        configWith(triggers: [trigger('t1', minCoins: 100)], assets: [asset('s1')]),
      );
      engine.handleGift(gift(totalCoins: 100));
      expect(player.played, hasLength(1));
    });

    test('minCoins 未満では発火しない', () {
      final engine = engineFor(
        configWith(triggers: [trigger('t1', minCoins: 100)], assets: [asset('s1')]),
      );
      engine.handleGift(gift(totalCoins: 99));
      expect(player.played, isEmpty);
    });

    test('userIds 指定時は対象ユーザーのみ発火する', () {
      final engine = engineFor(
        configWith(triggers: [trigger('t1', userIds: ['vip'])], assets: [asset('s1')]),
      );
      engine.handleGift(gift(uniqueId: 'other'));
      expect(player.played, isEmpty);
      engine.handleGift(gift(uniqueId: 'vip'));
      expect(player.played, hasLength(1));
    });
  });

  group('コメント条件', () {
    test('any は任意のコメントに反応する', () {
      final engine = engineFor(configWith(
        triggers: [trigger('t1', eventType: SoundEventType.comment)],
        assets: [asset('s1')],
      ));
      engine.handleComment(comment('こんばんは'));
      expect(player.played, hasLength(1));
    });

    test('exact は完全一致のみ反応する（大文字小文字は無視）', () {
      final engine = engineFor(configWith(
        triggers: [
          trigger('t1',
              eventType: SoundEventType.comment,
              commentMode: SoundCommentMode.exact,
              commentText: 'hello')
        ],
        assets: [asset('s1')],
      ));
      engine.handleComment(comment('hello world'));
      expect(player.played, isEmpty);
      engine.handleComment(comment('HELLO'));
      expect(player.played, hasLength(1));
    });

    test('ギフトトリガーはコメントで発火しない', () {
      final engine = engineFor(configWith(triggers: [trigger('t1')], assets: [asset('s1')]));
      engine.handleComment(comment('test'));
      expect(player.played, isEmpty);
    });
  });

  test('フォロートリガーはフォローイベントで発火する', () {
    final engine = engineFor(configWith(
      triggers: [trigger('t1', eventType: SoundEventType.follow)],
      assets: [asset('s1')],
    ));
    engine.handleFollow(FollowEvent(
      streamerId: 's',
      uniqueId: 'u',
      nickname: 'u',
      profilePictureUrl: null,
      occurredAt: DateTime.now(),
    ));
    expect(player.played, hasLength(1));
  });

  group('発火順', () {
    test('カテゴリ表示順 → 同一カテゴリ内はトリガー順（Dart の sort は不安定なので tie-breaker 必須）', () async {
      final engine = engineFor(configWith(
        categories: const [
          SoundCategory(id: 'first', name: 'first'),
          SoundCategory(id: 'second', name: 'second'),
        ],
        triggers: [
          trigger('b', categoryId: 'second', soundIds: ['sb']),
          trigger('a1', categoryId: 'first', soundIds: ['sa1']),
          trigger('a2', categoryId: 'first', soundIds: ['sa2']),
        ],
        assets: [asset('sb'), asset('sa1'), asset('sa2')],
      ));

      engine.handleGift(gift());
      await settle();
      expect(player.played, ['/sounds/sa1.mp3', '/sounds/sa2.mp3', '/sounds/sb.mp3']);
    });

    test('同一カテゴリ内の多数トリガーでも登録順が保たれる', () async {
      final many = List.generate(12, (i) => trigger('t$i', soundIds: ['s$i']));
      final engine = engineFor(configWith(
        triggers: many,
        assets: List.generate(12, (i) => asset('s$i')),
      ));

      engine.handleGift(gift());
      await settle();
      // 予算 10 で切られるが、順序は登録順のまま。
      expect(player.played, List.generate(10, (i) => '/sounds/s$i.mp3'));
    });
  });

  group('複数音源の再生モード', () {
    test('sequential は登録した音源を全て順に鳴らす', () async {
      final engine = engineFor(configWith(
        triggers: [trigger('t1', soundIds: ['s1', 's2', 's3'])],
        assets: [asset('s1'), asset('s2'), asset('s3')],
      ));
      engine.handleGift(gift());
      await settle();
      expect(player.played, ['/sounds/s1.mp3', '/sounds/s2.mp3', '/sounds/s3.mp3']);
    });

    test('random は1つだけ選ぶ', () {
      final engine = engineFor(
        configWith(
          triggers: [trigger('t1', soundIds: ['s1', 's2', 's3'], playMode: SoundPlayMode.random)],
          assets: [asset('s1'), asset('s2'), asset('s3')],
        ),
        random: FixedRandom(1),
      );
      engine.handleGift(gift());
      expect(player.played, ['/sounds/s2.mp3']);
    });

    test('参照先が消えている音源は飛ばす', () {
      final engine = SoundEngine(
        play: player.call,
        resolvePath: (a) => a.id == 's2' ? null : '/sounds/${a.fileName}',
      )..applyConfig(configWith(
          triggers: [trigger('t1', soundIds: ['s1', 's2'])],
          assets: [asset('s1'), asset('s2')],
        ));
      engine.handleGift(gift());
      expect(player.played, ['/sounds/s1.mp3']);
    });
  });

  group('コンボ', () {
    test('treatGiftComboAsSingle=true は同じ comboId で1回だけ発火する', () {
      final engine = engineFor(configWith(triggers: [trigger('t1')], assets: [asset('s1')]));
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 1));
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 3));
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 2));
      expect(player.played, hasLength(1));
    });

    test('別の comboId なら改めて発火する', () {
      final engine = engineFor(configWith(triggers: [trigger('t1')], assets: [asset('s1')]));
      engine.handleGift(gift(isCombo: true, comboId: 'c1'));
      engine.handleGift(gift(isCombo: true, comboId: 'c2'));
      expect(player.played, hasLength(2));
    });

    test('同一コンボに複数トリガーがマッチしたら全部発火する（キーがトリガー横断だと後続が抑止される）', () async {
      final engine = engineFor(configWith(
        triggers: [trigger('t1', soundIds: ['s1']), trigger('t2', soundIds: ['s2'])],
        assets: [asset('s1'), asset('s2')],
      ));
      engine.handleGift(gift(isCombo: true, comboId: 'c1'));
      await settle();
      expect(player.played, ['/sounds/s1.mp3', '/sounds/s2.mp3']);
    });

    test('comboId が null（サーバーで dedup 済みの単発）は記録せず、連続しても抑止されない', () async {
      final engine = engineFor(configWith(triggers: [trigger('t1')], assets: [asset('s1')]));
      engine.handleGift(gift(isCombo: true, comboId: null));
      engine.handleGift(gift(isCombo: true, comboId: null));
      engine.handleGift(gift(isCombo: true, comboId: null));
      await settle();
      expect(player.played, hasLength(3));
    });

    test('treatGiftComboAsSingle=false は delta 回だけ発火する', () async {
      final engine = engineFor(configWith(
        triggers: [trigger('t1', treatGiftComboAsSingle: false)],
        assets: [asset('s1')],
      ));
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 3));
      await settle();
      expect(player.played, hasLength(3));
    });

    test('コンボ記憶が上限を超えても、直近のコンボは抑止され続ける', () {
      final engine = SoundEngine(
        play: player.call,
        resolvePath: (a) => '/sounds/${a.fileName}',
        comboMemorySize: 2,
      )..applyConfig(configWith(triggers: [trigger('t1')], assets: [asset('s1')]));

      engine.handleGift(gift(isCombo: true, comboId: 'c1'));
      engine.handleGift(gift(isCombo: true, comboId: 'c2'));
      engine.handleGift(gift(isCombo: true, comboId: 'c3'));
      player.played.clear();

      // 直近2件(c2, c3)は抑止され、押し出された c1 だけ再発火する。
      engine.handleGift(gift(isCombo: true, comboId: 'c3'));
      engine.handleGift(gift(isCombo: true, comboId: 'c2'));
      expect(player.played, isEmpty);
      engine.handleGift(gift(isCombo: true, comboId: 'c1'));
      expect(player.played, hasLength(1));
    });
  });

  group('総再生回数の上限', () {
    test('delta × 音源数 × トリガー数 を展開した後の合計で上限を適用する', () async {
      final engine = engineFor(configWith(
        triggers: [
          trigger('t1', soundIds: ['s1', 's2'], treatGiftComboAsSingle: false),
          trigger('t2', soundIds: ['s1', 's2'], treatGiftComboAsSingle: false),
        ],
        assets: [asset('s1'), asset('s2')],
      ));

      // 展開すると 2トリガー × delta 5 × 2音源 = 20 回。上限 10 で打ち切る。
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 5));
      await settle();
      expect(player.played, hasLength(10));
    });

    test('上限は1イベントごとにリセットされる', () async {
      final engine = engineFor(configWith(
        triggers: [trigger('t1', soundIds: ['s1'], treatGiftComboAsSingle: false)],
        assets: [asset('s1')],
      ));
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 20));
      await settle();
      expect(player.played, hasLength(10));
      engine.handleGift(gift(isCombo: true, comboId: 'c2', delta: 20));
      await settle();
      expect(player.played, hasLength(20));
    });
  });

  group('再生スケジューリング', () {
    test('同時再生数は maxConcurrent を超えない', () async {
      player.autoComplete = false;
      final engine = engineFor(
        configWith(
          triggers: [trigger('t1', soundIds: ['s1'], treatGiftComboAsSingle: false)],
          assets: [asset('s1')],
        ),
        maxConcurrent: 2,
      );

      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 6));
      await Future<void>.delayed(Duration.zero);

      expect(player.inFlight, 2);
      expect(player.played, hasLength(2));
    });

    test('再生が終わるとキューから次を取り出す', () async {
      player.autoComplete = false;
      final engine = engineFor(
        configWith(
          triggers: [trigger('t1', soundIds: ['s1'], treatGiftComboAsSingle: false)],
          assets: [asset('s1')],
        ),
        maxConcurrent: 2,
      );

      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 4));
      await Future<void>.delayed(Duration.zero);
      expect(player.played, hasLength(2));

      player.completeAll();
      await Future<void>.delayed(Duration.zero);
      expect(player.played, hasLength(4));
    });

    test('キューが溢れたら古いものから捨ててカウントする', () async {
      player.autoComplete = false;
      final engine = engineFor(
        configWith(
          triggers: [trigger('t1', soundIds: ['s1'], treatGiftComboAsSingle: false)],
          assets: [asset('s1')],
        ),
        maxConcurrent: 1,
        maxQueueLength: 2,
      );

      // 1つ再生中 + キュー2件が上限。イベントを重ねて溢れさせる。
      engine.handleGift(gift(isCombo: true, comboId: 'c1', delta: 5));
      await Future<void>.delayed(Duration.zero);
      engine.handleGift(gift(isCombo: true, comboId: 'c2', delta: 5));
      await Future<void>.delayed(Duration.zero);

      expect(engine.droppedCount, greaterThan(0));
    });

    test('sequential のグループ内は直列に鳴る（重ならない）', () async {
      player.autoComplete = false;
      final engine = engineFor(configWith(
        triggers: [trigger('t1', soundIds: ['s1', 's2', 's3'])],
        assets: [asset('s1'), asset('s2'), asset('s3')],
      ));

      engine.handleGift(gift());
      await Future<void>.delayed(Duration.zero);
      // グループは1プレイヤーを占有するので、最初の1音だけ鳴っている。
      expect(player.played, ['/sounds/s1.mp3']);

      player.completeAll();
      await Future<void>.delayed(Duration.zero);
      expect(player.played, ['/sounds/s1.mp3', '/sounds/s2.mp3']);
    });
  });

  group('音量', () {
    test('音源音量 × マスター音量 を掛けた値で再生する', () {
      final engine = engineFor(configWith(
        triggers: [trigger('t1')],
        assets: [asset('s1', volume: 50)],
        masterVolume: 50,
      ));
      engine.handleGift(gift());
      expect(player.volumes.single, closeTo(0.25, 0.0001));
    });
  });

  test('baselineReset のギフトは記録されるが通常どおり鳴らす', () {
    final engine = engineFor(configWith(triggers: [trigger('t1')], assets: [asset('s1')]));
    engine.handleGift(gift(baselineReset: true, isCombo: true, comboId: 'c1', repeatCount: 8));
    expect(player.played, hasLength(1));
    expect(engine.baselineResetCount, 1);
  });

  test('存在しない音源IDだけを参照するトリガーは何も鳴らさない（例外にしない）', () {
    final engine = engineFor(configWith(
      triggers: [trigger('t1', soundIds: ['missing'])],
      assets: [asset('s1')],
    ));
    engine.handleGift(gift());
    expect(player.played, isEmpty);
  });
}
