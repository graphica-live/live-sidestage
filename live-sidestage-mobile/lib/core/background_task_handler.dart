import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

import '../models/app_config.dart';
import '../models/comment.dart';
import '../models/listener_status.dart';
import 'api_client.dart';
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

  // ── TikTok側の配信状態 ─────────────────────────────────────────────────────
  //
  // 取得経路は2つ。**socket の push を主、HTTP を保険にする。**
  //   - push: `chat:listener`。状態が変わった瞬間に届く
  //   - poll: `GET /api/mobile/listener-status`。push は Worker crash や Web 障害で
  //           落ちうるので、定期的に取り直して必ず収束させる
  //
  // どちらも `(roomId, revision)` で新旧を判定する。**壁時計は比較しない。**
  final LiveAnalyticsApi _api = LiveAnalyticsApi();
  String? _apiKey;
  ListenerStatus? _listener;

  StreamSubscription<ListenerStatus>? _listenerSub;
  StreamSubscription<void>? _connectedSub;
  Timer? _reconcileTimer;

  /// 進行中/予約済みのリコンサイルを識別する。onDestroy 後に返ってきた応答を捨て、
  /// 古い世代がタイマーを張り直すのも防ぐ。
  int _reconcileGeneration = 0;
  bool _reconcileInFlight = false;

  /// サーバーがこのAPIを持っていない(旧サーバー)。push だけで動かす。
  bool _reconcileUnsupported = false;

  /// 直近にコメント/ギフト/フォローを受け取った時刻。
  ///
  /// **単調時計を使う。** 端末の時刻設定変更やNTP補正で巻き戻ると、
  /// 「直近にイベントが来た」の判定が壊れる。
  final Stopwatch _sinceLastEvent = Stopwatch();

  static const Duration _reconcileInterval = Duration(minutes: 5);
  static const Duration _reconcileRetryInterval = Duration(seconds: 30);

  /// この時間内にイベントを受け取っていれば、サーバーの状態がどうであれ配信中とみなす。
  static const Duration _recentEventWindow = Duration(seconds: 60);

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
      resolvePath: (fileName) => _soundLibrary.resolvePathSync(fileName, _soundsDir!),
    );
    engine.addListener(_pushSoundState);
    _soundEngine = engine;

    // 永続ストレージから読むのはここだけ。以降はapplyConfigコマンドで受け取る。
    final raw = await FlutterForegroundTask.getData<String>(key: appConfigStorageKey);
    final decoded = AppConfig.tryDecode(raw);
    _config = decoded ?? const AppConfig();
    _applyConfig(_config);

    // 設定を解釈できたときだけ孤児ファイルを掃除する。壊れたJSONや未対応の
    // 未来バージョンで既定値へ落ちた状態で掃除すると、ユーザーの音源を全部消す。
    if (decoded != null) {
      unawaited(
        _soundLibrary
            .pruneOrphans(decoded.sound.gifts.map((g) => g.fileName))
            .catchError((Object e) {
          debugPrint('[sound] 孤児ファイルの掃除に失敗: $e');
          return 0;
        }),
      );
    }

    _speechQueue.listenTo(_commentFeed);
    engine.listenTo(_commentFeed);

    // 配信中の判定は最終的にサーバーが持つが、**イベントが1件でも届いていれば
    // それ自体が配信中の証拠**なので、push/poll を待たずに反映する。
    _commentFeed.onComment.listen((_) => _markEventReceived());
    _commentFeed.onGift.listen((_) => _markEventReceived());
    _commentFeed.onFollow.listen((_) => _markEventReceived());

    _listenerSub = _commentFeed.onListener.listen(_applyListener);
    // socket が張り直るたびに取り直す。切れている間の push は受け取れていない。
    _connectedSub = _commentFeed.onConnected.listen((_) => _scheduleReconcile(Duration.zero));

    final apiKey = await FlutterForegroundTask.getData<String>(key: 'apiKey');
    _apiKey = apiKey;
    if (apiKey != null) {
      _commentFeed.connect(apiKey);
    }

    // **socket 接続より後、かつ await しない。** HTTPのタイムアウトは20秒あるので、
    // ここで待つとコメント受信の開始がそのぶん遅れる。
    _scheduleReconcile(Duration.zero);

    _pushStatus();
    _pushSpeechState();
    _pushSoundState();
    _pushListenerState();
  }

  @override
  void onRepeatEvent(DateTime timestamp) {
    _pushStatus();
    _pushSpeechState();
    _pushSoundState();
    _pushListenerState();
  }

  // ── TikTok側の配信状態 ─────────────────────────────────────────────────────

  void _markEventReceived() {
    _sinceLastEvent
      ..reset()
      ..start();
    _pushListenerState();
  }

  bool get _hasRecentEvent =>
      _sinceLastEvent.isRunning && _sinceLastEvent.elapsed < _recentEventWindow;

  /// push / poll のどちらから来た観測も、ここで**古ければ捨てる**。
  void _applyListener(ListenerStatus next) {
    final current = _listener;
    if (current != null && !current.isSupersededBy(next)) return;
    _listener = next;
    _pushListenerState();
  }

  void _scheduleReconcile(Duration delay) {
    if (_reconcileUnsupported) return;
    _reconcileTimer?.cancel();
    final generation = _reconcileGeneration;
    _reconcileTimer = Timer(delay, () {
      // onDestroy 後や、別の世代がすでに走り始めている場合は何もしない。
      if (generation != _reconcileGeneration) return;
      unawaited(_reconcile(generation));
    });
  }

  /// **single-flight。** 5分間隔に対してHTTPのタイムアウトは20秒だが、
  /// socket 再接続が続くと短い間隔で重ねて呼ばれうる。
  Future<void> _reconcile(int generation) async {
    if (_reconcileInFlight) return;
    final apiKey = _apiKey;
    if (apiKey == null) return;

    _reconcileInFlight = true;
    var nextDelay = _reconcileInterval;
    try {
      final status = await _api.fetchListenerStatus(apiKey: apiKey);
      if (generation != _reconcileGeneration) return;
      if (status != null) _applyListener(status);
    } on ApiException catch (e) {
      if (generation != _reconcileGeneration) return;
      if (e.statusCode == 404 || e.statusCode == 405) {
        // 旧サーバー。叩き続けても意味がないので止める。push だけで動かす。
        debugPrint('[listener] サーバーが listener-status を持っていないため取得を停止します');
        _reconcileUnsupported = true;
        return;
      }
      // 一時的な失敗。前回値は保持したまま、短い間隔で再試行する。
      debugPrint('[listener] 状態の取得に失敗: $e');
      nextDelay = _reconcileRetryInterval;
    } finally {
      _reconcileInFlight = false;
      if (generation == _reconcileGeneration) _scheduleReconcile(nextDelay);
    }
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
        if (revision > _config.revision) {
          _config = AppConfig.tryDecode(json) ?? _config;
          _applyConfig(_config);
        }
        // 古い・同じ revision でも必ず現在の revision を返す。返さないと
        // UI 側が「反映待ち」のまま止まり、音源ファイルの削除も進まない。
        FlutterForegroundTask.sendDataToMain({'type': 'configAck', 'revision': _config.revision});
      case 'testPlaySound':
        // まだ設定に入っていない音源も鳴らせるよう、ファイル名を直接受け取る。
        // 設定経由ではないぶん検証はこちら側でも行う（resolvePathSync も再検証する）。
        final fileName = data['fileName'];
        final volume = data['volume'];
        if (fileName is! String || !SoundLibrary.isSafeFileName(fileName)) return;
        _soundEngine?.testPlayFile(fileName, volume is int ? volume.clamp(0, 100) : 100);
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
    // 世代を進めてから止める。進行中のHTTPが後から返ってきても適用されず、
    // タイマーの張り直しも起きない。
    _reconcileGeneration++;
    _reconcileTimer?.cancel();
    _reconcileTimer = null;
    await _listenerSub?.cancel();
    await _connectedSub?.cancel();

    _commentFeed.disconnect();
    _speechQueue.dispose();
    _soundEngine?.dispose();
    await _soundPlayers.dispose();
    _soundLibrary.dispose();
  }

  void _pushListenerState() {
    final listener = _listener;
    // イベントが届いている間は、サーバーの観測より現実を優先する。
    // push が落ちていても、あるいは古い error が残っていても、実際に鳴っている以上は配信中。
    final recent = _hasRecentEvent;
    FlutterForegroundTask.sendDataToMain({
      'type': 'listener',
      'live': recent || (listener?.live ?? false),
      'status': listener?.activity,
      'problem': recent ? null : listener?.problem,
    });
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
      'lastGiftName': state.lastGiftName,
      'droppedCount': state.droppedCount,
      'overflowCount': state.overflowCount,
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
