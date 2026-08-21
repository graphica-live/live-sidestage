import 'dart:async';
import 'dart:io';

import 'package:flutter_foreground_task/flutter_foreground_task.dart';

import '../models/app_config.dart';
import '../models/comment.dart';
import 'app_config_store.dart';
import 'comment_feed.dart';
import 'sound_engine.dart';
import 'sound_library.dart';
import 'sound_player_pool.dart';
import 'speech_queue.dart';

/// Foreground Service上の専用Isolateで動作し、Socket.IO接続・VOICEVOX読み上げ・
/// 効果音再生をUIの有無/画面オン・オフに関係なく継続させる。
/// CommentFeed/SpeechQueueController/SoundEngineはFlutter widgetに依存しない
/// 素のDartクラスなので、そのままここに置ける。
class CommentSpeechTaskHandler extends TaskHandler {
  final CommentFeed _commentFeed = CommentFeed();
  final SpeechQueueController _speechQueue = SpeechQueueController();
  final SoundLibrary _soundLibrary = SoundLibrary();
  final SoundPlayerPool _soundPlayers = SoundPlayerPool();

  SoundEngine? _soundEngine;
  Directory? _soundsDir;
  AppConfig _config = const AppConfig();

  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {
    // 購読を先に張ってから接続する。逆順にすると、接続直後に届いたイベントを
    // 取りこぼす小さなraceが残る。
    _commentFeed.addListener(_pushStatus);
    _commentFeed.onComment.listen(_pushComment);
    _speechQueue.addListener(_pushSpeechState);

    _soundsDir = await _soundLibrary.soundsDirectory();
    final engine = SoundEngine(
      play: _soundPlayers.play,
      resolvePath: (asset) => _soundLibrary.resolvePathSync(asset, _soundsDir!),
    );
    engine.addListener(_pushSoundState);
    _soundEngine = engine;

    // 永続ストレージから読むのはここだけ。以降はapplyConfigコマンドで受け取る。
    _config = AppConfig.decode(await FlutterForegroundTask.getData<String>(key: appConfigStorageKey));
    _applyConfig(_config);

    _speechQueue.listenTo(_commentFeed);
    engine.listenTo(_commentFeed);

    final apiKey = await FlutterForegroundTask.getData<String>(key: 'apiKey');
    if (apiKey != null) {
      _commentFeed.connect(apiKey);
    }

    _pushStatus();
    _pushSpeechState();
    _pushSoundState();
  }

  @override
  void onRepeatEvent(DateTime timestamp) {
    _pushStatus();
    _pushSpeechState();
    _pushSoundState();
  }

  @override
  void onReceiveData(Object data) {
    if (data is! Map) return;
    switch (data['command']) {
      case 'applyConfig':
        final revision = data['revision'];
        final json = data['json'];
        if (revision is! int || json is! String) return;
        // 自分が持っているものより新しいときだけ適用する。連続編集で
        // 逆順に届いても古い設定が勝たない。
        if (revision <= _config.revision) return;
        _config = AppConfig.decode(json);
        _applyConfig(_config);
        FlutterForegroundTask.sendDataToMain({'type': 'configAck', 'revision': _config.revision});
      case 'testPlaySound':
        final ids = data['soundIds'];
        if (ids is! List) return;
        _soundEngine?.testPlay(ids.whereType<String>().toList());
    }
  }

  void _applyConfig(AppConfig config) {
    _soundEngine?.applyConfig(config);
    _speechQueue.setEnabled(config.ttsEnabled);
    _speechQueue.randomVoice = config.randomVoice;
    _speechQueue.volume = config.ttsVolume;

    // VOICEVOXの初期化は重い。TTSがOFFのままサウンドだけ使う運用では走らせない。
    if (config.ttsEnabled && !_speechQueue.initialized) {
      unawaited(_speechQueue.initialize());
    }
  }

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {
    if (isTimeout) {
      // Android 15+ では dataSync 型のforeground serviceが24時間あたり6時間で
      // タイムアウトする。mediaPlayback単独に寄せてあるので通常は起きないが、
      // 起きたときに黙って止まると「いつの間にか鳴らなくなっていた」になるため通知する。
      FlutterForegroundTask.sendDataToMain({'type': 'serviceTimeout'});
    }
    _commentFeed.disconnect();
    _speechQueue.dispose();
    _soundEngine?.dispose();
    await _soundPlayers.dispose();
    _soundLibrary.dispose();
  }

  void _pushStatus() {
    FlutterForegroundTask.sendDataToMain({
      'type': 'status',
      'status': _commentFeed.status.name,
      'errorMessage': _commentFeed.errorMessage,
      'malformedEventCount': _commentFeed.malformedEventCount,
    });
  }

  void _pushSpeechState() {
    FlutterForegroundTask.sendDataToMain({
      'type': 'speech',
      'initialized': _speechQueue.initialized,
      'enabled': _speechQueue.enabled,
      'randomVoice': _speechQueue.randomVoice,
      'nowSpeakingCharacterName': _speechQueue.nowSpeakingCharacterName,
      'errorMessage': _speechQueue.errorMessage,
    });
  }

  void _pushSoundState() {
    final engine = _soundEngine;
    if (engine == null) return;
    final state = engine.state;
    FlutterForegroundTask.sendDataToMain({
      'type': 'sound',
      'enabled': state.enabled,
      'lastTriggerName': state.lastTriggerName,
      'droppedCount': state.droppedCount,
      'baselineResetCount': state.baselineResetCount,
      'errorMessage': state.errorMessage,
    });
  }

  void _pushComment(Comment c) {
    FlutterForegroundTask.sendDataToMain({
      'type': 'comment',
      'streamerId': c.streamerId,
      'uniqueId': c.uniqueId,
      'nickname': c.nickname,
      'profilePictureUrl': c.profilePictureUrl,
      'comment': c.comment,
      'receivedAt': c.receivedAt.toIso8601String(),
    });
  }
}
