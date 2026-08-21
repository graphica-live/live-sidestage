import 'dart:async';

import 'package:audioplayers/audioplayers.dart';

/// 効果音用の AudioPlayer プール。
///
/// [SoundEngine] が同時呼び出し数を size 以下に抑えるので、呼ばれた時点で必ず
/// 空きプレイヤーがある。ここは「空きを1つ取って鳴らし、終わったら返す」だけでよい。
///
/// TTS 側（SpeechQueueController が持つ AudioPlayer）とは完全に別インスタンス。
/// 読み上げ中でも効果音を重ねて鳴らすため。
class SoundPlayerPool {
  SoundPlayerPool({this.size = 4});

  final int size;
  final List<AudioPlayer> _idle = [];
  bool _disposed = false;

  /// Android の audio focus 設定。
  ///
  /// audioplayers の既定は `AndroidAudioFocus.gain` で、再生のたびに
  /// AUDIOFOCUS_GAIN を要求する。そのままだと効果音を鳴らすたびに
  /// TTS 側のプレイヤーがフォーカスを失って止まってしまう。
  /// 効果音は「他の音に重ねて鳴らすもの」なのでフォーカスを取りに行かない。
  static final AudioContext _context = AudioContext(
    android: const AudioContextAndroid(
      isSpeakerphoneOn: false,
      stayAwake: true,
      contentType: AndroidContentType.sonification,
      usageType: AndroidUsageType.assistanceSonification,
      audioFocus: AndroidAudioFocus.none,
    ),
    iOS: AudioContextIOS(
      category: AVAudioSessionCategory.playback,
      options: const {AVAudioSessionOptions.mixWithOthers},
    ),
  );

  Future<AudioPlayer> _acquire() async {
    if (_idle.isNotEmpty) return _idle.removeLast();
    final player = AudioPlayer();
    await player.setAudioContext(_context);
    await player.setReleaseMode(ReleaseMode.stop);
    return player;
  }

  void _release(AudioPlayer player) {
    if (_disposed) {
      player.dispose();
      return;
    }
    if (_idle.length >= size) {
      player.dispose();
      return;
    }
    _idle.add(player);
  }

  /// 1音を鳴らし、再生完了で戻る。[SoundEngine] の `play` に渡す。
  Future<void> play(String filePath, double volume) async {
    if (_disposed) return;
    final player = await _acquire();
    try {
      final completer = Completer<void>();
      late final StreamSubscription<void> sub;
      sub = player.onPlayerComplete.listen((_) {
        sub.cancel();
        if (!completer.isCompleted) completer.complete();
      });
      await player.setVolume(volume.clamp(0.0, 1.0));
      await player.play(DeviceFileSource(filePath));
      await completer.future;
    } finally {
      _release(player);
    }
  }

  Future<void> dispose() async {
    _disposed = true;
    for (final player in List.of(_idle)) {
      await player.dispose();
    }
    _idle.clear();
  }
}
