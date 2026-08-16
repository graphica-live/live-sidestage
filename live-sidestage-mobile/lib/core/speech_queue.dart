import 'dart:async';
import 'dart:collection';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../models/comment.dart';
import 'comment_feed.dart';
import 'tts_engine.dart';
import 'voice_pool.dart';

/// 受信したコメントをVOICEVOXで順番に読み上げるキュー。
/// コメント投稿者ごとのボイス割り当ては[VoicePool]が担う。
class SpeechQueueController extends ChangeNotifier {
  final TtsEngine _engine = TtsEngine();
  final AudioPlayer _player = AudioPlayer();
  final Queue<Comment> _queue = Queue();

  VoicePool? _voicePool;
  StreamSubscription<Comment>? _subscription;
  bool _processing = false;

  bool initialized = false;
  bool enabled = true;
  String? errorMessage;
  String? nowSpeakingCharacterName;

  bool get randomVoice => _voicePool?.randomEnabled ?? true;

  set randomVoice(bool value) {
    final pool = _voicePool;
    if (pool == null) return;
    pool.randomEnabled = value;
    notifyListeners();
  }

  Future<void> initialize() async {
    try {
      await _engine.initialize();
      _voicePool = VoicePool(_engine.voices);
      initialized = true;
    } catch (e) {
      errorMessage = 'VOICEVOXの初期化に失敗しました: $e';
    }
    notifyListeners();
  }

  void listenTo(CommentFeed feed) {
    _subscription?.cancel();
    _subscription = feed.onComment.listen(_enqueue);
  }

  void toggleEnabled() {
    enabled = !enabled;
    if (!enabled) _queue.clear();
    notifyListeners();
  }

  void _enqueue(Comment comment) {
    if (!initialized || !enabled) return;
    _queue.add(comment);
    unawaited(_processQueue());
  }

  Future<void> _processQueue() async {
    if (_processing) return;
    _processing = true;

    Comment? prefetchedFor;
    Future<Uint8List>? prefetched;

    while (_queue.isNotEmpty) {
      final comment = _queue.removeFirst();
      final pool = _voicePool!;
      final styleId = pool.effectiveStyleId(comment.uniqueId);

      Uint8List wav;
      try {
        wav = (prefetchedFor == comment) ? await prefetched! : await _engine.synthesize(comment.comment, styleId);
      } catch (e) {
        errorMessage = '読み上げに失敗しました: $e';
        notifyListeners();
        continue;
      }

      // 次のコメントの合成を先読みしておく(再生中の待ち時間を短縮)。
      if (_queue.isNotEmpty) {
        final next = _queue.first;
        final nextStyleId = pool.effectiveStyleId(next.uniqueId);
        prefetchedFor = next;
        prefetched = _engine.synthesize(next.comment, nextStyleId);
      } else {
        prefetchedFor = null;
        prefetched = null;
      }

      nowSpeakingCharacterName = pool.characterNameForStyleId(styleId);
      notifyListeners();
      await _play(wav);
    }

    nowSpeakingCharacterName = null;
    notifyListeners();
    _processing = false;
  }

  Future<void> _play(Uint8List wav) async {
    final tempDir = await getTemporaryDirectory();
    final file = File('${tempDir.path}/tts_${DateTime.now().microsecondsSinceEpoch}.wav');
    await file.writeAsBytes(wav);

    try {
      final completer = Completer<void>();
      late final StreamSubscription<void> sub;
      sub = _player.onPlayerComplete.listen((_) {
        sub.cancel();
        if (!completer.isCompleted) completer.complete();
      });
      await _player.play(DeviceFileSource(file.path));
      await completer.future;
    } catch (e) {
      errorMessage = '再生に失敗しました: $e';
      notifyListeners();
    } finally {
      unawaited(file.delete().catchError((_) => file));
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _player.dispose();
    _engine.dispose();
    super.dispose();
  }
}
