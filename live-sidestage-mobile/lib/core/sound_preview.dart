import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';

import '../models/app_config.dart';
import 'sound_library.dart';
import 'sound_player_pool.dart';

/// テスト再生の実再生部。テストでは fake を差し込む。
abstract class PreviewPlayer {
  /// 1音を鳴らす。**再生の開始まで**で戻り、鳴り終わりは待たない。
  Future<void> play(String filePath, double volume);

  /// メモリ上の音源を鳴らす。まだ端末に取り込んでいない検索結果の試聴に使う。
  /// 契約は [play] と同じで、再生の開始までで戻る。
  ///
  /// [extension] は iOS で一時ファイルへ書くときの拡張子。AVURLAsset が形式を
  /// 拡張子から推測するので、間違えると鳴らない。
  Future<void> playBytes(Uint8List bytes, double volume, {String extension = '.mp3'});

  /// 鳴っている音を止める。鳴っていなければ何もしない。
  Future<void> stop();

  Future<void> dispose();
}

/// 試聴用の一時ファイル置き場。**iOS でしか使わない。**
///
/// 置き場所は `<tmp>/sound_preview/` の**専用サブディレクトリ**。tmp 直下には
/// [IosAudioKeepAlive] の `keepalive_silence.wav`（画面オフ読み上げの生命線）と
/// 読み上げの `tts_<usec>.wav` がいるので、**掃除でそこを巻き込むと機能が丸ごと止まる**。
/// `FilePicker.clearTemporaryFiles()` を呼んではいけないのと同じ理由で、自前の掃除でも
/// tmp 直下は絶対に触らない。
class PreviewTempStore {
  PreviewTempStore({Directory? overrideDirectory}) : _override = overrideDirectory;

  final Directory? _override;
  Directory? _dir;
  int _seq = 0;
  bool _swept = false;

  /// 発行済みで、まだ消していないファイル。seq の昇順。
  final List<({int seq, File file})> _staged = [];

  Future<Directory> _directory() async {
    final existing = _dir;
    if (existing != null) return existing;
    final base = _override ?? Directory('${(await getTemporaryDirectory()).path}/sound_preview');
    if (!await base.exists()) await base.create(recursive: true);
    _dir = base;
    return base;
  }

  /// バイト列を新しいファイルへ書き、そのパスを返す。
  ///
  /// **毎回ちがうファイル名にすること。** audioplayers の darwin 実装
  /// (`WrappedMediaPlayer.setSourceUrl`) は `self.url != url` のときだけ AVPlayerItem を
  /// 作り直すので、**同じパスを上書きしても前の音がそのまま鳴る**。しかも
  /// `ReleaseMode.stop` では `stop()` しても url が残るため、使い回すと毎回必ず誤爆する。
  Future<({int seq, String path})> stage(Uint8List bytes, String extension) async {
    final dir = await _directory();
    final seq = ++_seq;
    final file = File('${dir.path}/prev_$seq$extension');
    await file.writeAsBytes(bytes, flush: true);
    _staged.add((seq: seq, file: file));
    return (seq: seq, path: file.path);
  }

  /// [seq] より**古いものだけ**を消す。
  ///
  /// 「全部消してから書く」にはできない。連打で `playBytes` 同士が interleave するため、
  /// 古い要求の後始末が**新しい要求の再生予定ファイルを消す**事故が起きる。
  Future<void> deleteOlderThan(int seq) async {
    final targets = _staged.where((e) => e.seq < seq).toList(growable: false);
    _staged.removeWhere((e) => e.seq < seq);
    for (final entry in targets) {
      await _delete(entry.file);
    }
  }

  /// 特定の1件だけ消す。再生に失敗した要求の後始末。
  Future<void> deleteSeq(int seq) async {
    final targets = _staged.where((e) => e.seq == seq).toList(growable: false);
    _staged.removeWhere((e) => e.seq == seq);
    for (final entry in targets) {
      await _delete(entry.file);
    }
  }

  Future<void> deleteAll() async {
    final targets = List.of(_staged);
    _staged.clear();
    for (final entry in targets) {
      await _delete(entry.file);
    }
  }

  /// アプリが強制終了して [deleteAll] が走らなかった分を回収する。初回の [stage] 前に1回だけ。
  ///
  /// **年齢で守ること。** 無条件に全消しすると、理論上は別インスタンスが今まさに
  /// 鳴らそうとしているファイルまで消してしまう。
  Future<void> sweepStale({Duration olderThan = const Duration(hours: 1)}) async {
    if (_swept) return;
    _swept = true;
    try {
      final dir = await _directory();
      final threshold = DateTime.now().subtract(olderThan);
      await for (final entity in dir.list()) {
        if (entity is! File) continue;
        final stat = await entity.stat();
        if (stat.modified.isAfter(threshold)) continue;
        await _delete(entity);
      }
    } catch (_) {
      // 掃除は best-effort。失敗しても試聴は続けられる。
    }
  }

  Future<void> _delete(File file) async {
    try {
      if (await file.exists()) await file.delete();
    } catch (_) {
      // 消せなくても鳴らすことには影響しない。次回の sweepStale が拾う。
    }
  }
}

/// audioplayers による既定の [PreviewPlayer]。
///
/// プレイヤーは1つだけ持つ。テスト再生は「今聴きたい1音」なので重ねる必要がなく、
/// 重ねられるようにすると連打のぶんだけ AudioPlayer が増える。
class AudioPlayerPreview implements PreviewPlayer {
  AudioPlayerPreview({PreviewTempStore? tempStore, bool? bytesViaFile})
      : _tempStore = tempStore ?? PreviewTempStore(),
        // iOS は audioplayers の setSourceBytes が未実装なので一時ファイル経由にする。
        // 注入できるようにしてあるのはテストのため。
        _bytesViaFile = bytesViaFile ?? Platform.isIOS;

  final PreviewTempStore _tempStore;
  final bool _bytesViaFile;

  /// 生成中の Future をそのまま持つ。連打で2つ作らないため。
  Future<AudioPlayer>? _player;
  bool _disposed = false;

  Future<AudioPlayer> _ensurePlayer() async {
    final existing = _player;
    if (existing != null) return existing;

    final player = AudioPlayer();
    final pending = _configure(player);
    _player = pending;
    try {
      return await pending;
    } catch (_) {
      // 失敗した Future を持ち続けると、以降この画面では二度と鳴らせなくなる。
      // 作りかけのプレイヤーごと捨てて、次の要求で作り直せるようにする。
      if (identical(_player, pending)) _player = null;
      await player.dispose().catchError((_) {});
      rethrow;
    }
  }

  Future<AudioPlayer> _configure(AudioPlayer player) async {
    // 効果音と同じ設定で鳴らす。ここがずれると「テストでは鳴ったのに本番で鳴らない」になる。
    await player.setAudioContext(SoundPlayerPool.playbackContext);
    await player.setReleaseMode(ReleaseMode.stop);
    return player;
  }

  @override
  Future<void> play(String filePath, double volume) =>
      _playSource(DeviceFileSource(filePath), volume);

  /// iOS だけ一時ファイル経由で鳴らす。
  ///
  /// audioplayers の darwin 実装は `setSourceBytes` を**明示的に未実装として弾く**
  /// （`AudioplayersDarwinPlugin.swift`: "setSourceBytes is not currently implemented on iOS"）。
  /// Android はそのまま [BytesSource] を通る — **こちらのコードパスは1行も変えていない。**
  ///
  /// [SoundLibrary.fetchPreviewBytes] は「ファイルには書かない」と決めているが、それは
  /// 「どの要求が作ったファイルを、いつ誰が消すか」が**要求ごとに散る**ことを避けるため。
  /// ここではファイルの寿命を**プレイヤーの寿命に一致させ**、後始末をこのクラスだけに
  /// 閉じ込めているので、その懸念は生じない。[SoundPreview] の generation 機構には触らない。
  @override
  Future<void> playBytes(Uint8List bytes, double volume, {String extension = '.mp3'}) async {
    if (!_bytesViaFile) {
      await _playSource(BytesSource(bytes), volume);
      return;
    }

    await _tempStore.sweepStale();
    final staged = await _tempStore.stage(bytes, extension);
    try {
      await _playSource(DeviceFileSource(staged.path), volume);
    } catch (_) {
      await _tempStore.deleteSeq(staged.seq);
      rethrow;
    }
    // **自分より新しいファイルは消さない。** 連打で追い越されている場合、
    // それは今まさに鳴ろうとしている音源。
    await _tempStore.deleteOlderThan(staged.seq);
  }

  Future<void> _playSource(Source source, double volume) async {
    if (_disposed) return;
    final player = await _ensurePlayer();
    if (_disposed) return;
    await player.setVolume(volume.clamp(0.0, 1.0));
    await player.play(source);
  }

  // 停止と破棄は best-effort。プレイヤーを用意できていなければ止める音も無いので、
  // ここで投げると「鳴らせなかった」だけでなく、呼び出し側（画面遷移や dispose）まで
  // 巻き込んで壊れる。
  @override
  Future<void> stop() async {
    final pending = _player;
    if (pending == null) return;
    try {
      await (await pending).stop();
    } catch (_) {
      // 鳴っていないのと同じ。
    }
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    // 一時ファイルの寿命はプレイヤーと同じ。ここで必ず消す。
    await _tempStore.deleteAll();
    final pending = _player;
    _player = null;
    if (pending == null) return;
    try {
      final player = await pending;
      await player.stop();
      await player.dispose();
    } catch (_) {
      // 用意に失敗したプレイヤーは _ensurePlayer が始末している。
    }
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

  /// 最後に鳴らし始めた要求の世代。[_afterPlay] が「止めてよい音か」を見るのに使う。
  int _playingGeneration = 0;

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
      await _afterPlay(generation);
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

      await player.playBytes(
        bytes,
        masterVolume / 100.0,
        extension: SoundLibrary.previewExtensionOf(sound.mp3Url),
      );
      await _afterPlay(generation);
      return null;
    } on SoundLibraryException catch (e) {
      // 通信失敗・許可外ホスト・サイズ超過。そのまま出せる日本語になっている。
      return _isStale(generation) ? null : e.message;
    } catch (e) {
      if (_isStale(generation)) return null;
      return '再生に失敗しました: $e';
    }
  }

  /// 鳴らし始めた直後の後始末。
  ///
  /// 鳴り始めるまでの間に画面を離れた・別の音を押されたなら、鳴らしっぱなしにしない。
  /// ただし**自分より後に鳴り始めた音があれば触らない** — プレイヤーは1つしか無いので、
  /// 追い越された側が無条件に止めると、最新の音を消してしまう。
  Future<void> _afterPlay(int generation) async {
    if (!_isStale(generation)) {
      _playingGeneration = generation;
      return;
    }
    if (_playingGeneration < generation) await player.stop();
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
