import 'dart:async';
import 'dart:collection';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../models/app_config.dart';
import '../models/comment.dart';
import '../models/follow_event.dart';
import '../models/gift_event.dart';
import 'comment_feed.dart';

/// 1音を鳴らし、再生完了で完了する Future を返す。
///
/// [SoundEngine] は同時呼び出し数を [SoundEngine.maxConcurrent] 以下に抑えるので、
/// 実装側は N 個のプレイヤーを使い回すだけでよい（呼ばれた時点で必ず空きがある）。
typedef PlaySound = Future<void> Function(String filePath, double volume);

/// 音源ID → 実ファイルパス。存在しなければ null。
typedef ResolveSoundPath = String? Function(SoundAsset asset);

/// 1つのトリガー発火で鳴らす音のまとまり。
///
/// sequential のトリガーは複数音源を「順に」鳴らす必要があるため、
/// グループ単位で1つのプレイヤーを占有して直列再生する。
/// グループ同士は並行に鳴る。
@immutable
class _PlaybackGroup {
  final String triggerId;
  final List<_PlaybackItem> items;
  const _PlaybackGroup(this.triggerId, this.items);
}

@immutable
class _PlaybackItem {
  final String filePath;
  final double volume;
  const _PlaybackItem(this.filePath, this.volume);
}

/// 直近に鳴った音の記録（UI表示・診断用）。
@immutable
class SoundEngineState {
  final bool enabled;
  final String? lastTriggerName;
  final int droppedCount;
  final int baselineResetCount;
  final String? errorMessage;

  const SoundEngineState({
    required this.enabled,
    this.lastTriggerName,
    this.droppedCount = 0,
    this.baselineResetCount = 0,
    this.errorMessage,
  });
}

class SoundEngine extends ChangeNotifier {
  SoundEngine({
    required this.play,
    required this.resolvePath,
    this.maxConcurrent = 4,
    this.maxQueueLength = 32,
    this.maxPlaybacksPerEvent = 10,
    this.comboMemorySize = 200,
    Random? random,
  }) : _random = random ?? Random();

  /// 1音を鳴らす実装。テストでは fake を差し込む。
  final PlaySound play;

  /// 音源IDから実ファイルパスを引く実装。テストでは fake を差し込む。
  final ResolveSoundPath resolvePath;

  final Random _random;

  /// 同時に鳴らせるグループ数（= AudioPlayer の数）。
  final int maxConcurrent;

  /// 待ち行列の上限。溢れたら古いものから捨てる。
  final int maxQueueLength;

  /// 1つのソースイベントから鳴らす音の総数の上限。
  ///
  /// `delta × sequential音源数 × マッチしたトリガー数` に展開されるので、
  /// 展開「後」に数える。トリガーごとに上限を持たせるとこの上限を迂回できてしまう。
  final int maxPlaybacksPerEvent;

  /// まとめ投げ1回判定のために覚えておく (triggerId, comboId) の件数。
  final int comboMemorySize;

  AppConfig _config = const AppConfig();
  StreamSubscription<Comment>? _commentSub;
  StreamSubscription<GiftEvent>? _giftSub;
  StreamSubscription<FollowEvent>? _followSub;

  final Queue<_PlaybackGroup> _queue = Queue();
  int _active = 0;
  bool _disposed = false;

  /// 既に発火済みの (triggerId, comboId)。挿入順の LRU。
  final LinkedHashSet<String> _firedCombos = LinkedHashSet();

  String? lastTriggerName;
  int droppedCount = 0;
  int baselineResetCount = 0;
  String? errorMessage;

  bool get enabled => _config.sound.enabled;

  SoundEngineState get state => SoundEngineState(
        enabled: enabled,
        lastTriggerName: lastTriggerName,
        droppedCount: droppedCount,
        baselineResetCount: baselineResetCount,
        errorMessage: errorMessage,
      );

  void applyConfig(AppConfig config) {
    _config = config;
    if (!config.sound.enabled) _queue.clear();
    notifyListeners();
  }

  AppConfig get config => _config;

  void listenTo(CommentFeed feed) {
    _commentSub?.cancel();
    _giftSub?.cancel();
    _followSub?.cancel();
    _commentSub = feed.onComment.listen(handleComment);
    _giftSub = feed.onGift.listen(handleGift);
    _followSub = feed.onFollow.listen(handleFollow);
  }

  // ── イベント入口 ────────────────────────────────────────────────────────────

  void handleGift(GiftEvent event) {
    if (event.baselineReset) {
      // サーバー側の状態が失われた復帰tick。delta は 1 に切り詰められているので
      // 鳴らす回数は少なめになる。原因を追えるよう記録だけ残す。
      baselineResetCount++;
      debugPrint('[sound] baselineReset のギフトを受信: ${event.giftName} repeat=${event.repeatCount}');
    }
    _run(
      eventType: SoundEventType.gift,
      userId: event.uniqueId,
      giftName: event.giftName,
      totalCoins: event.totalCoins,
      comment: '',
      gift: event,
    );
  }

  void handleComment(Comment comment) {
    _run(
      eventType: SoundEventType.comment,
      userId: comment.uniqueId,
      giftName: '',
      totalCoins: 0,
      comment: comment.comment.trim().toLowerCase(),
    );
  }

  void handleFollow(FollowEvent event) {
    _run(
      eventType: SoundEventType.follow,
      userId: event.uniqueId,
      giftName: '',
      totalCoins: 0,
      comment: '',
    );
  }

  /// トリガー編集画面の「テスト発火」用。条件判定を通さず指定の音源だけ鳴らす。
  void testPlay(List<String> soundIds, {SoundPlayMode playMode = SoundPlayMode.sequential}) {
    final items = _resolveItems(soundIds, playMode);
    if (items.isEmpty) return;
    _enqueue(_PlaybackGroup('__test__', items));
  }

  // ── トリガー判定 ────────────────────────────────────────────────────────────

  /// desktop の tryRunEffectTriggers 相当。
  void _run({
    required SoundEventType eventType,
    required String userId,
    required String giftName,
    required int totalCoins,
    required String comment,
    GiftEvent? gift,
  }) {
    if (_disposed) return;
    final sound = _config.sound;
    if (!sound.enabled) return;

    final disabledCategoryIds = sound.categories
        .where((c) => !c.enabled)
        .map((c) => c.id)
        .toSet();

    final ordered = _orderedTriggers(sound, disabledCategoryIds);

    // 1つのソースイベント全体で使える再生回数の予算。
    var budget = maxPlaybacksPerEvent;

    for (final trigger in ordered) {
      if (budget <= 0) break;
      if (!_matches(trigger, eventType, userId, giftName, totalCoins, comment)) continue;

      final repeats = _repeatCountFor(trigger, gift);
      if (repeats <= 0) continue;

      final items = _resolveItems(trigger.soundIds, trigger.playMode);
      if (items.isEmpty) continue;

      for (var i = 0; i < repeats; i++) {
        if (budget <= 0) break;
        // 予算に収まる範囲だけ切り出す（グループ途中で切れても鳴らせる分は鳴らす）。
        final slice = items.length <= budget ? items : items.sublist(0, budget);
        budget -= slice.length;
        _enqueue(_PlaybackGroup(trigger.id, slice));
      }

      lastTriggerName = trigger.name.isEmpty ? trigger.id : trigger.name;
    }

    notifyListeners();
  }

  /// 発火順はカテゴリの表示順 → 同一カテゴリ内はトリガーの並び順（desktop と同じ）。
  ///
  /// desktop は JS の `Array.prototype.sort` が安定ソートであることに依存しているが、
  /// **Dart の `List.sort` は安定ではない**ので、元インデックスを明示的な
  /// tie-breaker に入れて同順位の順序を確定させる。
  List<SoundTrigger> _orderedTriggers(SoundConfig sound, Set<String> disabledCategoryIds) {
    final categoryOrder = <String, int>{};
    for (var i = 0; i < sound.categories.length; i++) {
      categoryOrder[sound.categories[i].id] = i;
    }

    final indexed = <MapEntry<int, SoundTrigger>>[];
    for (var i = 0; i < sound.triggers.length; i++) {
      final t = sound.triggers[i];
      if (!t.enabled) continue;
      if (t.soundIds.isEmpty) continue;
      if (disabledCategoryIds.contains(t.categoryId)) continue;
      indexed.add(MapEntry(i, t));
    }

    // カテゴリ一覧に無いカテゴリは末尾へ回す（desktop の categoryOrderIndex.size 相当）。
    int orderOf(SoundTrigger t) => categoryOrder[t.categoryId] ?? categoryOrder.length;

    indexed.sort((a, b) {
      final byCategory = orderOf(a.value).compareTo(orderOf(b.value));
      if (byCategory != 0) return byCategory;
      return a.key.compareTo(b.key);
    });

    return indexed.map((e) => e.value).toList(growable: false);
  }

  /// desktop の matchesEffectTrigger 相当。
  bool _matches(
    SoundTrigger trigger,
    SoundEventType eventType,
    String userId,
    String giftName,
    int totalCoins,
    String comment,
  ) {
    if (trigger.eventType != eventType) return false;

    if (eventType == SoundEventType.gift) {
      // giftName が空 = 任意のギフトに一致。
      if (trigger.giftName.isNotEmpty && trigger.giftName != giftName) return false;
      if (trigger.minCoins > 0 && totalCoins < trigger.minCoins) return false;
    }

    if (eventType == SoundEventType.comment && trigger.commentMode == SoundCommentMode.exact) {
      if (trigger.commentText.isEmpty || trigger.commentText != comment) return false;
    }

    if (trigger.userIds.isNotEmpty && !trigger.userIds.contains(userId)) return false;

    return true;
  }

  /// このトリガーを何回鳴らすか。
  int _repeatCountFor(SoundTrigger trigger, GiftEvent? gift) {
    if (gift == null) return 1;

    if (gift.isCombo && trigger.treatGiftComboAsSingle) {
      // comboId が null のイベントはサーバー側で dedup 済みの単発。
      // ここで記録すると、以後の groupId 欠落コンボをすべて抑止してしまう。
      if (gift.comboId == null) return 1;

      final key = '${trigger.id}|${gift.comboId}';
      if (_firedCombos.contains(key)) return 0;
      _firedCombos.add(key);
      while (_firedCombos.length > comboMemorySize) {
        _firedCombos.remove(_firedCombos.first);
      }
      return 1;
    }

    return gift.delta > 0 ? gift.delta : 1;
  }

  List<_PlaybackItem> _resolveItems(List<String> soundIds, SoundPlayMode playMode) {
    final assets = <SoundAsset>[];
    for (final id in soundIds) {
      for (final asset in _config.sound.assets) {
        if (asset.id == id) {
          assets.add(asset);
          break;
        }
      }
    }
    if (assets.isEmpty) return const [];

    // desktop と同じ意味論: random は1つだけ選び、sequential は全て順に鳴らす。
    final selected =
        playMode == SoundPlayMode.random ? [assets[_random.nextInt(assets.length)]] : assets;

    final master = _config.sound.masterVolume / 100.0;
    final items = <_PlaybackItem>[];
    for (final asset in selected) {
      final path = resolvePath(asset);
      if (path == null) continue; // 参照先が消えている音源は黙って飛ばす
      items.add(_PlaybackItem(path, (asset.volume / 100.0) * master));
    }
    return items;
  }

  // ── 再生スケジューリング ────────────────────────────────────────────────────

  void _enqueue(_PlaybackGroup group) {
    if (_queue.length >= maxQueueLength) {
      // 溢れたら古いものから捨てる。詰まっているときは新しい音の方が状況に合っている。
      _queue.removeFirst();
      droppedCount++;
    }
    _queue.add(group);
    _pump();
  }

  void _pump() {
    while (_active < maxConcurrent && _queue.isNotEmpty) {
      final group = _queue.removeFirst();
      _active++;
      unawaited(_playGroup(group));
    }
  }

  Future<void> _playGroup(_PlaybackGroup group) async {
    try {
      // グループ内は直列。sequential のトリガーで音が重ならないようにする。
      for (final item in group.items) {
        if (_disposed) break;
        await play(item.filePath, item.volume);
      }
    } catch (e) {
      errorMessage = '再生に失敗しました: $e';
      notifyListeners();
    } finally {
      _active--;
      if (!_disposed) _pump();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _commentSub?.cancel();
    _giftSub?.cancel();
    _followSub?.cancel();
    _queue.clear();
    super.dispose();
  }
}
