import 'dart:async';
import 'dart:collection';

import 'package:flutter/foundation.dart';

import '../models/app_config.dart';
import '../models/gift_event.dart';
import 'comment_feed.dart';

/// 1音を鳴らし、再生完了で完了する Future を返す。
///
/// [SoundEngine] は同時呼び出し数を [SoundEngine.maxConcurrent] 以下に抑えるので、
/// 実装側は N 個のプレイヤーを使い回すだけでよい（呼ばれた時点で必ず空きがある）。
typedef PlaySound = Future<void> Function(String filePath, double volume);

/// `sounds/` 配下のファイル名 → 実ファイルパス。存在しなければ null。
typedef ResolveSoundPath = String? Function(String fileName);

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

  /// 直近に鳴らしたギフトの表記。
  final String? lastGiftName;

  /// キューが詰まって捨てた件数。
  final int droppedCount;

  /// 1イベントの上限([SoundEngine.maxPlaybacksPerEvent])を超えて鳴らせなかった件数。
  final int overflowCount;

  final int baselineResetCount;
  final String? errorMessage;

  const SoundEngineState({
    required this.enabled,
    this.lastGiftName,
    this.droppedCount = 0,
    this.overflowCount = 0,
    this.baselineResetCount = 0,
    this.errorMessage,
  });
}

/// ギフトを受けて効果音を鳴らす。
///
/// 判定は「ギフト名が一致するか」だけ。コイン数・対象ユーザー・コメント・
/// フォローといった条件は持たない。まとめ投げ（コンボ）は常に1回にまとめる。
class SoundEngine extends ChangeNotifier {
  SoundEngine({
    required this.play,
    required this.resolvePath,
    this.maxConcurrent = 4,
    this.maxQueueLength = 32,
    this.maxPlaybacksPerEvent = 10,
    this.comboMemorySize = 200,
  });

  /// 1音を鳴らす実装。テストでは fake を差し込む。
  final PlaySound play;

  /// ファイル名から実ファイルパスを引く実装。テストでは fake を差し込む。
  final ResolveSoundPath resolvePath;

  /// 同時に鳴らせる音の数（= AudioPlayer の数）。
  final int maxConcurrent;

  /// 待ち行列の上限。溢れたら古いものから捨てる。
  final int maxQueueLength;

  /// 1つのギフトイベントから鳴らす音の総数の上限。
  ///
  /// 同じギフト名に何件でも音を割り当てられるので、上限を超えた分は鳴らさず
  /// [SoundEngineState.overflowCount] に数える。設定順の先頭から優先する。
  final int maxPlaybacksPerEvent;

  /// まとめ投げ1回判定のために覚えておく (giftSoundId, comboId) の件数。
  final int comboMemorySize;

  AppConfig _config = const AppConfig();
  StreamSubscription<GiftEvent>? _giftSub;

  final Queue<_PlaybackItem> _queue = Queue();
  int _active = 0;
  bool _disposed = false;

  /// 既に発火済みの (giftSoundId, comboId)。挿入順の LRU。
  final LinkedHashSet<String> _firedCombos = LinkedHashSet();

  String? lastGiftName;
  int droppedCount = 0;
  int overflowCount = 0;
  int baselineResetCount = 0;
  String? errorMessage;

  bool get enabled => _config.sound.enabled;

  SoundEngineState get state => SoundEngineState(
        enabled: enabled,
        lastGiftName: lastGiftName,
        droppedCount: droppedCount,
        overflowCount: overflowCount,
        baselineResetCount: baselineResetCount,
        errorMessage: errorMessage,
      );

  void applyConfig(AppConfig config) {
    final wasEnabled = _config.sound.enabled;
    _config = config;
    if (!config.sound.enabled) {
      _queue.clear();
    } else if (!wasEnabled) {
      // 有効化し直したら過去のエラーは持ち越さない。UI 側でエラーは
      // ステータス表示の最優先なので、消さないと一度の失敗で永久に赤くなる。
      errorMessage = null;
    }
    notifyListeners();
  }

  AppConfig get config => _config;

  void listenTo(CommentFeed feed) {
    _giftSub?.cancel();
    _giftSub = feed.onGift.listen(handleGift);
  }

  // ── イベント入口 ────────────────────────────────────────────────────────────

  void handleGift(GiftEvent event) {
    if (_disposed) return;
    final sound = _config.sound;
    if (!sound.enabled) return;

    if (event.baselineReset) {
      // サーバー側の状態が失われた復帰tick。delta は 1 に切り詰められているので
      // 鳴らす回数は少なめになる。原因を追えるよう記録だけ残す。
      baselineResetCount++;
      debugPrint('[sound] baselineReset のギフトを受信: ${event.giftName} repeat=${event.repeatCount}');
    }

    var budget = maxPlaybacksPerEvent;
    var fired = false;

    for (final gift in sound.gifts) {
      if (!gift.enabled) continue;
      // giftName が空 = 任意のギフトに一致。
      if (gift.giftName.isNotEmpty && gift.giftName != event.giftName) continue;
      if (!_shouldFire(gift, event)) continue;

      if (budget <= 0) {
        overflowCount++;
        continue;
      }

      final path = resolvePath(gift.fileName);
      // 参照先のファイルが消えている行は黙って飛ばす。予算も消費しない。
      if (path == null) continue;

      budget--;
      fired = true;
      lastGiftName = gift.displayGiftName;
      _enqueue(_PlaybackItem(path, (gift.volume / 100.0) * (sound.masterVolume / 100.0)));
    }

    if (fired || overflowCount > 0) notifyListeners();
  }

  /// まとめ投げ(コンボ)は1コンボにつき1回だけ鳴らす。
  ///
  /// `comboId` が null のイベントはサーバー側で dedup 済みの単発なので、
  /// ここで記録すると以後の groupId 欠落コンボをすべて抑止してしまう。
  bool _shouldFire(GiftSound gift, GiftEvent event) {
    if (!event.isCombo) return true;
    final comboId = event.comboId;
    if (comboId == null) return true;

    final key = '${gift.id}|$comboId';
    if (_firedCombos.contains(key)) return false;
    _firedCombos.add(key);
    while (_firedCombos.length > comboMemorySize) {
      _firedCombos.remove(_firedCombos.first);
    }
    return true;
  }

  // ── 再生スケジューリング ────────────────────────────────────────────────────

  void _enqueue(_PlaybackItem item) {
    if (_queue.length >= maxQueueLength) {
      // 溢れたら古いものから捨てる。詰まっているときは新しい音の方が状況に合っている。
      _queue.removeFirst();
      droppedCount++;
    }
    _queue.add(item);
    _pump();
  }

  void _pump() {
    while (_active < maxConcurrent && _queue.isNotEmpty) {
      final item = _queue.removeFirst();
      _active++;
      unawaited(_playOne(item));
    }
  }

  Future<void> _playOne(_PlaybackItem item) async {
    try {
      await play(item.filePath, item.volume);
      // 1件でも鳴れば直前のエラーは解消している。残すとステータス表示が
      // 永久に「エラー」のままになる。
      if (errorMessage != null) {
        errorMessage = null;
        notifyListeners();
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
    _giftSub?.cancel();
    _queue.clear();
    super.dispose();
  }
}
