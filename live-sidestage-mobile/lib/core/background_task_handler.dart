import 'dart:async';

import 'package:flutter_foreground_task/flutter_foreground_task.dart';

import '../models/comment.dart';
import 'comment_feed.dart';
import 'speech_queue.dart';

/// Foreground Service上の専用Isolateで動作し、Socket.IO接続とVOICEVOX読み上げを
/// UIの有無/画面オン・オフに関係なく継続させる。CommentFeed/SpeechQueueControllerは
/// Flutter widgetに依存しない素のDartクラスなので変更なしでここに移設できる。
class CommentSpeechTaskHandler extends TaskHandler {
  final CommentFeed _commentFeed = CommentFeed();
  final SpeechQueueController _speechQueue = SpeechQueueController();

  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {
    _commentFeed.addListener(_pushStatus);
    _commentFeed.onComment.listen(_pushComment);
    _speechQueue.addListener(_pushSpeechState);

    final apiKey = await FlutterForegroundTask.getData<String>(key: 'apiKey');
    if (apiKey != null) {
      _commentFeed.connect(apiKey);
    }

    _speechQueue.listenTo(_commentFeed);
    unawaited(_speechQueue.initialize());

    _pushStatus();
    _pushSpeechState();
  }

  @override
  void onRepeatEvent(DateTime timestamp) {
    _pushStatus();
    _pushSpeechState();
  }

  @override
  void onReceiveData(Object data) {
    if (data is! Map) return;
    switch (data['command']) {
      case 'toggleMute':
        _speechQueue.toggleEnabled();
      case 'setRandom':
        _speechQueue.randomVoice = data['value'] as bool;
    }
  }

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {
    _commentFeed.disconnect();
    _speechQueue.dispose();
  }

  void _pushStatus() {
    FlutterForegroundTask.sendDataToMain({
      'type': 'status',
      'status': _commentFeed.status.name,
      'errorMessage': _commentFeed.errorMessage,
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
