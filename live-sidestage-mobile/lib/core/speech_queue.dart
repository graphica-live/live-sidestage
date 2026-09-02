import 'dart:async';
import 'dart:collection';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../models/comment.dart';
import '../models/voice_catalog.dart';
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

  // ── FREEプランの自動インターバル ─────────────────────────────────────────
  //
  // FREEプランは100件読み上げるごとに5分間、新規コメントの読み上げを止める。
  // isFreePlan は背景Isolate起動時(onStart)に、UI Isolate側で永続化された
  // plan + mobileBetaActiveから一度だけ合成して設定される(account_status_store.dart、
  // background_task_handler.dart参照)。mobileβが有効な間はこの制限をバイパスする。
  // サービス稼働中のプラン変更はリアルタイム反映しない(次回「開始」時に反映)。

  static const int _freeIntervalThreshold = 100;
  static const Duration _freeIntervalCooldown = Duration(minutes: 5);

  bool _isFreePlan = false;
  int _spokenSinceCooldown = 0;
  final Stopwatch _intervalCooldownWatch = Stopwatch();

  bool get isFreePlan => _isFreePlan;

  set isFreePlan(bool value) {
    if (_isFreePlan == value) return;
    _isFreePlan = value;
    if (!value) _resetInterval();
  }

  void _resetInterval() {
    _spokenSinceCooldown = 0;
    _intervalCooldownWatch
      ..stop()
      ..reset();
  }

  /// クールダウン中かどうか。経過していれば自動的にリセットして false を返す。
  bool get _intervalActive {
    if (!_intervalCooldownWatch.isRunning) return false;
    if (_intervalCooldownWatch.elapsed < _freeIntervalCooldown) return true;
    _resetInterval();
    return false;
  }

  /// 1件読み上げ終わるたびに呼ぶ。FREEプランで閾値に達したらクールダウンを開始する。
  void _recordSpoken() {
    if (!_isFreePlan) return;
    _spokenSinceCooldown++;
    if (_spokenSinceCooldown >= _freeIntervalThreshold) {
      _spokenSinceCooldown = 0;
      _intervalCooldownWatch
        ..reset()
        ..start();
    }
  }

  /// 今読み上げ中のコメントを isolate をまたいで識別するためのキー
  /// ([Comment.identityKey])。UI側がハイライト対象の行を判定するのに使う。
  String? nowSpeakingCommentKey;

  /// 読み上げ待ちが尽きてからクレジット表記を消すまでの猶予。
  /// 再生完了と同時に消すと、コメントが途切れがちな配信では表記が一瞬で
  /// 消えてしまい、VOICEVOX のクレジット表示として成立しない。
  static const Duration _characterNameLinger = Duration(seconds: 5);

  Timer? _clearCharacterNameTimer;

  // VoicePoolはinitialize()完了まで存在しないので、それまでの設定値をここに保持する。
  // 以前はpoolがnullのときsetterが何もせず、初期化前に設定した値が捨てられていた
  // (TTSを後からONにする遅延初期化でも同じ経路を通る)。
  bool _desiredRandomVoice = true;

  bool get randomVoice => _voicePool?.randomEnabled ?? _desiredRandomVoice;

  set randomVoice(bool value) {
    _desiredRandomVoice = value;
    _voicePool?.randomEnabled = value;
    notifyListeners();
  }

  /// ランダムボイスがOFFのときに読み上げるボイス。[randomVoice] と同じ理由で
  /// 初期化前の値もここに残す。
  int _desiredFixedStyleId = VoiceCatalog.defaultStyleId;

  int get fixedStyleId => _voicePool?.fixedStyleId ?? _desiredFixedStyleId;

  set fixedStyleId(int value) {
    _desiredFixedStyleId = value;
    _voicePool?.fixedStyleId = value;
    notifyListeners();
  }

  /// 読み上げ音量。0-100。
  ///
  /// VOICEVOX の volumeScale ではなく再生側で掛ける。合成は次のコメントを
  /// 先読みしているので、合成時に適用すると音量変更が1件遅れて効く。
  int _volume = 100;

  /// 読み上げ速度(%)。50-200。合成時に渡すので、**先読み済みの1件には効かない**。
  int speed = 100;

  int get volume => _volume;

  set volume(int value) {
    final clamped = value < 0 ? 0 : (value > 100 ? 100 : value);
    if (_volume == clamped) return;
    _volume = clamped;
    notifyListeners();
  }

  Future<void> initialize() async {
    if (initialized) return;
    try {
      await _engine.initialize();
      _voicePool = VoicePool(_engine.voices)
        ..randomEnabled = _desiredRandomVoice
        ..fixedStyleId = _desiredFixedStyleId;
      initialized = true;
      errorMessage = null;
    } catch (e) {
      errorMessage = 'VOICEVOXの初期化に失敗しました: $e';
    }
    notifyListeners();
  }

  void listenTo(CommentFeed feed) {
    _subscription?.cancel();
    _subscription = feed.onComment.listen(_enqueue);
  }

  void toggleEnabled() => setEnabled(!enabled);

  void setEnabled(bool value) {
    if (enabled == value) return;
    enabled = value;
    if (!enabled) {
      _queue.clear();
    } else {
      // 有効化し直したら過去のエラーは持ち越さない。UI 側でエラーは
      // ステータス表示の最優先なので、消さないと一度の失敗で永久に赤くなる。
      errorMessage = null;
    }
    notifyListeners();
  }

  void _enqueue(Comment comment) {
    if (!initialized || !enabled) return;
    // 読み上げる中身が無いコメントはVOICEVOXに渡さない。エモートだけの発言、
    // TikTokの絵文字 `[微笑]` だけ、素の絵文字だけ、はすべてここで落ちる
    // ([Comment.speechText] 参照)。空文字を合成すると中身の無いwavになり、
    // 再生時に PlatformException で落ちる。**Android/iOS 共通の経路。**
    //
    // 読み上げないだけで、画面には [Comment.displayText] がもとの本文を出すので
    // 消えたようには見えない。
    //
    // **_processQueue 側ではなくここで止めること。** 先読み合成は次の1件を先に
    // 合成するので、向こうで弾いても空文字が合成へ渡る経路が残る。
    if (comment.speechText.isEmpty) return;
    // FREEプランのクールダウン中は新規コメントを読み上げない(既存キューに積まず無視する)。
    if (_isFreePlan && _intervalActive) return;
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
        wav = (prefetchedFor == comment)
            ? await prefetched!
            : await _engine.synthesize(comment.speechText, styleId, speedScale: speed / 100.0);
      } on TtsSynthesisException catch (e) {
        // 読み方を作れなかっただけなら黙って飛ばす。[Comment.speechText] の
        // 絵文字除去は正規表現なので取りこぼしがあり、**新しい絵文字が来るたびに
        // 配信中へ赤いエラーを出すことになる**。次のコメントは普通に読める。
        if (e.isUnreadableText) {
          debugPrint('[tts] 読み方を作れないコメントを飛ばしました: ${comment.speechText}');
          continue;
        }
        errorMessage = '読み上げに失敗しました: $e';
        notifyListeners();
        continue;
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
        prefetched = _engine.synthesize(next.speechText, nextStyleId, speedScale: speed / 100.0);
      } else {
        prefetchedFor = null;
        prefetched = null;
      }

      _setNowSpeaking(pool.characterNameForStyleId(styleId), comment.identityKey);
      await _play(wav);
      _recordSpoken();
    }

    _scheduleCharacterNameClear();
    _processing = false;
  }

  void _setNowSpeaking(String? name, String? commentKey) {
    _clearCharacterNameTimer?.cancel();
    _clearCharacterNameTimer = null;
    nowSpeakingCharacterName = name;
    nowSpeakingCommentKey = commentKey;
    notifyListeners();
  }

  /// 次に読むコメントが無くなったときだけ、猶予を置いてから表記を消す。
  /// 猶予中に次のコメントが届けば [_setNowSpeaking] がタイマーを畳んで
  /// 新しい名前・キーへ差し替えるので、表記は途切れない。
  void _scheduleCharacterNameClear() {
    if (nowSpeakingCharacterName == null) return;
    _clearCharacterNameTimer?.cancel();
    _clearCharacterNameTimer = Timer(_characterNameLinger, () {
      _clearCharacterNameTimer = null;
      nowSpeakingCharacterName = null;
      nowSpeakingCommentKey = null;
      notifyListeners();
    });
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
      // 再生ごとに設定し直す。設定変更は再生中でも入るため。
      await _player.setVolume(_volume / 100.0);
      await _player.play(DeviceFileSource(file.path));
      await completer.future;
      // 1件でも最後まで鳴れば直前のエラーは解消している。残すと
      // ステータス表示が永久に「エラー」のままになる。
      if (errorMessage != null) {
        errorMessage = null;
        notifyListeners();
      }
    } catch (e) {
      errorMessage = '再生に失敗しました: $e';
      notifyListeners();
    } finally {
      unawaited(file.delete().catchError((_) => file));
    }
  }

  @override
  void dispose() {
    _clearCharacterNameTimer?.cancel();
    _subscription?.cancel();
    _player.dispose();
    _engine.dispose();
    super.dispose();
  }
}
