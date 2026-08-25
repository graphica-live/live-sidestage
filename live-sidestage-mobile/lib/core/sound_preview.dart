import 'dart:async';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';

import '../models/app_config.dart';
import 'sound_library.dart';
import 'sound_player_pool.dart';

/// テスト再生の実再生部。テストでは fake を差し込む。
abstract class PreviewPlayer {
  /// 1音を鳴らす。**再生の開始まで**で戻り、鳴り終わりは待たない。
  Future<void> play(String filePath, double volume);

  /// メモリ上の音源を鳴らす。まだ端末に取り込んでいない検索結果の試聴に使う。
  /// 契約は [play] と同じで、再生の開始までで戻る。
  Future<void> playBytes(Uint8List bytes, double volume);

  /// 鳴っている音を止める。鳴っていなければ何もしない。
  Future<void> stop();

  Future<void> dispose();
}

/// audioplayers による既定の [PreviewPlayer]。
///
/// プレイヤーは1つだけ持つ。テスト再生は「今聴きたい1音」なので重ねる必要がなく、
/// 重ねられるようにすると連打のぶんだけ AudioPlayer が増える。
class AudioPlayerPreview implements PreviewPlayer {
  /// 生成中の Future をそのまま持つ。連打で2つ作らないため。
  Future<AudioPlayer>? _player;
  bool _disposed = false;

  Future<AudioPlayer> _ensurePlayer() {
    return _player ??= () async {
      final player = AudioPlayer();
      // 効果音と同じ設定で鳴らす。ここがずれると「テストでは鳴ったのに本番で鳴らない」になる。
      await player.setAudioContext(SoundPlayerPool.playbackContext);
      await player.setReleaseMode(ReleaseMode.stop);
      return player;
    }();
  }

  @override
  Future<void> play(String filePath, double volume) =>
      _playSource(DeviceFileSource(filePath), volume);

  @override
  Future<void> playBytes(Uint8List bytes, double volume) =>
      _playSource(BytesSource(bytes), volume);

  Future<void> _playSource(Source source, double volume) async {
    if (_disposed) return;
    final player = await _ensurePlayer();
    if (_disposed) return;
    await player.setVolume(volume.clamp(0.0, 1.0));
    await player.play(source);
  }

  @override
  Future<void> stop() async {
    final pending = _player;
    if (pending == null) return;
    await (await pending).stop();
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    final pending = _player;
    _player = null;
    if (pending == null) return;
    final player = await pending;
    await player.stop();
    await player.dispose();
  }
}

/// 編集画面の「テスト再生」。
///
/// ギフト受信時の再生は foreground service の Isolate（[SoundEngine]）が行うが、
/// テスト再生は**「開始」していなくても鳴らせる必要がある**ので UI 側で完結させる。
/// サービスの稼働状態で経路を分けず、常にこちらで鳴らす。分けると同じ機能に
/// 2経路が残り、片方だけ壊れていても気づけない。
///
/// そのぶん、鳴っている音はサービス側のキュー（同時再生数・取りこぼし制御）の
/// 外側になる。稼働中にテスト再生すると、ギフトで鳴っている音に重なる。
///
/// - 連打は latest-wins。前の音を止めてから鳴らし直す
/// - 画面を離れたら [dispose] で止める。編集画面は保存されなかった音源ファイルを
///   dispose で削除するので、止められないと消したファイルを鳴らし続けることになる。
///   音源には長さの上限が無い（[SoundLibrary.maxFileBytes] だけ）
class SoundPreview {
  SoundPreview({required this.library, PreviewPlayer? player})
      : player = player ?? AudioPlayerPreview();

  final SoundLibrary library;

  /// 実再生の担当。テストでは fake を差し込む。
  final PreviewPlayer player;

  bool _disposed = false;

  /// 再生要求ごとに進める。await から戻ったときに、自分がまだ最新の要求か判定する。
  int _generation = 0;

  /// 鳴らす。表示すべきエラーがあればそのメッセージを、無ければ null を返す。
  ///
  /// 画面を離れた後や、より新しい要求に追い越された場合も null を返す（もう表示先が無い）。
  Future<String?> play({
    required String fileName,
    required int volume,
    required int masterVolume,
  }) async {
    if (_disposed) return null;
    // 設定は端末内の JSON なので通常は安全だが、壊れた設定が入りうる。
    if (!SoundLibrary.isSafeFileName(fileName)) {
      return '音源ファイルが見つかりませんでした。';
    }

    final generation = ++_generation;
    try {
      final dir = await library.soundsDirectory();
      if (_isStale(generation)) return null;

      final path = library.resolvePathSync(fileName, dir);
      if (path == null) return '音源ファイルが見つかりませんでした。';

      await player.stop();
      if (_isStale(generation)) return null;

      await player.play(path, (volume / 100.0) * (masterVolume / 100.0));
      // 鳴らし始めるまでの間に画面を離れていたら、鳴らしっぱなしにしない。
      if (_isStale(generation)) await player.stop();
      return null;
    } catch (e) {
      if (_isStale(generation)) return null;
      return '再生に失敗しました: $e';
    }
  }

  /// 検索結果を**取り込む前に**鳴らす。表示すべきエラーがあればそのメッセージを返す。
  ///
  /// 端末にはまだ何も無いので、配布元から取ってきたバイト列をそのまま鳴らす
  /// （[SoundLibrary.fetchPreviewBytes]）。取得は毎回行う。
  ///
  /// ギフトごとの音量（[GiftSound.volume]）はこの時点で存在しないので、全体音量だけを掛ける。
  ///
  /// [play] と同じ latest-wins。取得している間に別の音を押された・止められた・画面を
  /// 離れた場合は、取れても鳴らさない。
  Future<String?> playRemote({
    required RemoteSound sound,
    required SoundSourceKind source,
    required int masterVolume,
  }) async {
    if (_disposed) return null;

    final generation = ++_generation;
    try {
      final bytes = await library.fetchPreviewBytes(sound: sound, source: source);
      if (_isStale(generation)) return null;

      await player.stop();
      if (_isStale(generation)) return null;

      await player.playBytes(bytes, masterVolume / 100.0);
      // 鳴らし始めるまでの間に画面を離れていたら、鳴らしっぱなしにしない。
      if (_isStale(generation)) await player.stop();
      return null;
    } on SoundLibraryException catch (e) {
      // 通信失敗・許可外ホスト・サイズ超過。そのまま出せる日本語になっている。
      return _isStale(generation) ? null : e.message;
    } catch (e) {
      if (_isStale(generation)) return null;
      return '再生に失敗しました: $e';
    }
  }

  /// 鳴っている音を止める。音源を差し替えたときなど。
  Future<void> stop() async {
    // 進行中の再生要求も無効にする。止めた直後に鳴り始めては意味がない。
    _generation++;
    await player.stop();
  }

  bool _isStale(int generation) => _disposed || generation != _generation;

  Future<void> dispose() async {
    _disposed = true;
    _generation++;
    await player.dispose();
  }
}
