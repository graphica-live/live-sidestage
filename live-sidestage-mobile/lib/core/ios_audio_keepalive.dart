import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// iOS でだけ使う。無音を鳴らし続けて AVAudioSession を保持し、画面オフ中も
/// プロセスを生かしておくためのもの。
///
/// なぜ必要か:
/// iOS には Android の Foreground Service に相当する常駐手段が無く、長時間の
/// バックグラウンド実行を正当化できる枠は実質 `UIBackgroundModes: audio` しかない。
/// そしてこの枠が効くのは**実際にオーディオをレンダリングしている間だけ**。
/// ライブのコメントは断続的で数分間何も来ないことが普通にあるので、その無音区間で
/// 止まってしまう。
///
/// さらに audioplayers_darwin は再生中のプレイヤーがゼロになった時点で
/// `activateAudioSession(active: anyIsPlaying)` によりセッション自体を落とす
/// (AudioplayersDarwinPlugin.swift の controlAudioSession)。つまり読み上げが
/// 1件終わるたびにセッションが解除される。無音ループを1本流しておけば
/// `anyIsPlaying` が常に true になり、この解除も起きない。
///
/// **サービス稼働中だけ流すこと。** アプリ起動中ずっと鳴らしっぱなしにすると、
/// バッテリーの無駄であるうえ、App Store の「バックグラウンド音声は可聴コンテンツの
/// ためのもの」という要件から外れる。読み上げという可聴機能が動いている間の
/// 無音区間を埋める、という位置づけを守る。
///
/// バックグラウンドエンジン側(CommentSpeechTaskHandler)から使う。UI 側のエンジンに
/// 置いてはいけない。audioplayers のプラグインはエンジンごとに独立していて
/// `anyIsPlaying` の判定もエンジン単位なので、生かしたいエンジンで鳴らす必要がある。
class IosAudioKeepAlive {
  AudioPlayer? _player;
  Timer? _watchdog;

  /// 進行中の start / stop。**必ずこの鎖に繋いで直列化する。**
  ///
  /// 以前は `_starting` フラグで start の二重実行だけを防いでいたが、それだと
  /// **start の最中に stop が来たときに stop が先に抜ける**。あとから start が
  /// 完了して `_player` を書き戻すので、「停止したのに無音ループが鳴り続ける」
  /// 状態になる。バッテリーの無駄であるうえ、可聴コンテンツを伴わない
  /// バックグラウンド音声は App Store 2.5.4 の要件からも外れる。
  ///
  /// 機能のON/OFFに紐づけると連打でこの経路を踏みやすくなるので、順序を保証する。
  Future<void> _chain = Future.value();

  static const Duration _watchdogInterval = Duration(seconds: 30);

  /// 無音ループ用の AudioContext。効果音側(SoundPlayerPool.playbackContext)と
  /// 同じ `playback` + `mixWithOthers` にそろえる。iOS では setAudioContext が
  /// アプリ全体へ適用されるため、ここだけ別の値にすると他の再生の鳴り方が変わる。
  static final AudioContext _context = AudioContext(
    iOS: AudioContextIOS(
      category: AVAudioSessionCategory.playback,
      options: const {AVAudioSessionOptions.mixWithOthers},
    ),
  );

  bool get isRunning => _player != null;

  Future<void> start() => _serialize(_start);

  Future<void> stop() => _serialize(_stop);

  /// 直前の start / stop が終わってから走らせる。1つが失敗しても鎖は切らない。
  Future<void> _serialize(Future<void> Function() action) {
    final next = _chain.then((_) => action()).catchError((Object e) {
      debugPrint('[keepalive] 処理に失敗: $e');
    });
    _chain = next;
    return next;
  }

  Future<void> _start() async {
    if (!Platform.isIOS || _player != null) return;
    try {
      final file = await _ensureSilenceFile();
      final player = AudioPlayer();
      await player.setAudioContext(_context);
      await player.setReleaseMode(ReleaseMode.loop);
      await player.setVolume(0);
      await player.play(DeviceFileSource(file.path));
      _player = player;

      // 通話や Siri の割り込みで止められることがある。プロセスが生きている
      // 範囲では再開を試みる。suspend まで行かれた場合はここも動かないので、
      // これは万能の復帰手段ではない。
      _watchdog = Timer.periodic(_watchdogInterval, (_) async {
        final p = _player;
        if (p == null) return;
        if (p.state == PlayerState.playing) return;
        try {
          await p.resume();
        } catch (e) {
          debugPrint('[keepalive] 無音ループの再開に失敗: $e');
        }
      });
    } catch (e) {
      // ここで失敗しても読み上げ自体は動く(前面にいる限り)。
      // 落とさずログだけ残す。
      debugPrint('[keepalive] 無音ループを開始できませんでした: $e');
      await _disposePlayer();
    }
  }

  Future<void> _stop() async {
    _watchdog?.cancel();
    _watchdog = null;
    await _disposePlayer();
  }

  Future<void> _disposePlayer() async {
    final player = _player;
    _player = null;
    if (player == null) return;
    try {
      await player.stop();
      await player.dispose();
    } catch (e) {
      debugPrint('[keepalive] 無音ループの停止に失敗: $e');
    }
  }

  /// 無音の wav を一時ディレクトリへ用意する。アセットに置かず生成するのは、
  /// 213MB ある既存アセットにこれ以上足さないため。1秒ぶんで約 88KB。
  Future<File> _ensureSilenceFile() async {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/keepalive_silence.wav');
    if (await file.exists() && await file.length() > 0) return file;
    await file.writeAsBytes(_buildSilentWav());
    return file;
  }

  /// 44.1kHz / 16bit / mono / 1秒 の無音 PCM wav。
  static Uint8List _buildSilentWav() {
    const int sampleRate = 44100;
    const int channels = 1;
    const int bitsPerSample = 16;
    const int seconds = 1;

    const int byteRate = sampleRate * channels * bitsPerSample ~/ 8;
    const int blockAlign = channels * bitsPerSample ~/ 8;
    const int dataSize = byteRate * seconds;

    final bytes = BytesBuilder();
    void ascii(String s) => bytes.add(s.codeUnits);
    void u32(int v) => bytes.add(Uint8List(4)..buffer.asByteData().setUint32(0, v, Endian.little));
    void u16(int v) => bytes.add(Uint8List(2)..buffer.asByteData().setUint16(0, v, Endian.little));

    ascii('RIFF');
    u32(36 + dataSize);
    ascii('WAVE');
    ascii('fmt ');
    u32(16); // PCM の fmt チャンクサイズ
    u16(1); // PCM
    u16(channels);
    u32(sampleRate);
    u32(byteRate);
    u16(blockAlign);
    u16(bitsPerSample);
    ascii('data');
    u32(dataSize);
    bytes.add(Uint8List(dataSize)); // 全ゼロ = 無音

    return bytes.toBytes();
  }
}
