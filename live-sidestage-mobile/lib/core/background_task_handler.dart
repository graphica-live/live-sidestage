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
import 'ios_audio_keepalive.dart';
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

  /// iOS専用。無音を流し続けて AVAudioSession を保持し、コメントが途切れている間も
  /// プロセスを生かす。Androidは Foreground Service が生存を担うので使わない。
  final IosAudioKeepAlive _keepAlive = IosAudioKeepAlive();

  SoundEngine? _soundEngine;
  Directory? _soundsDir;
  AppConfig _config = const AppConfig();

  // ── 開始ボタン押下後、ライブが一定時間始まらなければ自動停止 ──────────────────
  //
  // _config（UIとのrevision同期の正本 = ユーザーの「意思」）は自動停止時に
  // 一切書き換えない。実行系（speechQueue/soundEngine/iOS keepalive）へ渡す
  // 設定は、常に「意思」と _autoStopLatched を合成した実効設定を通す
  // （_applyEffectiveConfig）。この分離により、UIから届く通常の設定変更と
  // 自動停止の間の ordering race を避ける。

  /// true の間は _config の値に関わらず読み上げ・効果音を鳴らさない。
  /// onStart で永続フラグから復元することがあるので、初期値の意味は
  /// 「前回セッションで自動停止していたか」も兼ねる。
  bool _autoStopLatched = false;

  /// 直近に適用した意思で、読み上げ・効果音のどちらかが有効だったか。
  /// false → true の立ち上がりだけを「開始ボタンを押した」とみなす
  /// （TTS/サウンドを集約した1つの状態として扱う。個別の開始ボタンごとに
  /// タイマーを分けない設計は確定仕様）。
  bool _wasFeatureEnabled = false;

  /// 「開始」からの経過時間。単調時計（_sinceLastEvent と同じ理由 — 端末の
  /// 時刻変更やNTP補正の影響を受けないため）。
  final Stopwatch _sinceFeatureEnabled = Stopwatch();

  /// このセッション（直近の「開始」以降）で一度でもライブ中と判定されたか。
  /// true なら自動停止しない。次の「開始」でリセットする。
  bool _everLiveSinceEnabled = false;

  static const Duration _noLiveAutoStopTimeout = Duration(minutes: 60);

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
    // **OSが勝手に復活させたサービスは、待機状態なら即座に自分で終わる。**
    //
    // Android は stopWithTask: false のとき START_STICKY で再起動し、タスクを
    // スワイプで消しても1秒後の再起動アラームが仕掛けられる(プラグインの
    // ForegroundService.kt)。読み上げも効果音も無効な「待機」でこれが起きると、
    // ユーザーが止める手段の無い無音の常駐サービスが残る。
    //
    // developer 起動(アプリからの明示的な開始)は対象外。ここで止めると
    // 待機起動そのものができなくなる。
    if (starter == TaskStarter.system) {
      final raw = await FlutterForegroundTask.getData<String>(key: appConfigStorageKey);
      final config = AppConfig.tryDecode(raw);
      if (config != null && !config.ttsEnabled && !config.sound.enabled) {
        debugPrint('[service] 待機状態でOSに再起動されたため自分で停止します');
        await FlutterForegroundTask.stopService();
        return;
      }
    }

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

    // OS都合でこのTaskHandlerが再生成された場合に備え、前回セッションで
    // 自動停止していた事実を永続フラグから復元する。
    //
    // **_wasFeatureEnabledも同時に揃えること。** ラッチだけ復元して
    // _wasFeatureEnabled=falseのままだと、直後の_applyConfigが
    // 「意思がON（まだUIが収束していない）」を新しい開始の立ち上がりと誤認し、
    // ラッチと永続フラグの両方を即座に解除してしまう
    // （自動停止の事実がUIへ二度と伝わらなくなる）。
    _autoStopLatched =
        await FlutterForegroundTask.getData<bool>(key: autoStopPendingStorageKey) == true;
    _wasFeatureEnabled = _autoStopLatched;

    _applyConfig(_config);

    // 設定を解釈できたときだけ孤児ファイルを掃除する。壊れたJSONや未対応の
    // 未来バージョンで既定値へ落ちた状態で掃除すると、ユーザーの音源を全部消す。
    //
    // keep するのは**全セットを横断した**参照。選択中セットだけを渡すと、
    // 裏のセットが使っているファイルを孤児と誤判定して消してしまう。
    if (decoded != null) {
      unawaited(
        _soundLibrary
            .pruneOrphans(decoded.sound.referencedFileNames)
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
    // 貢献・ギフト履歴タブが取り直すきっかけ。**数値は送らない** — 数字の正は
    // サーバーの集計だけで、端末で積算するとDBと恒久的にズレる（gift_activity.dart）。
    // 契約を増やさないため type だけの最小ペイロードにしてある。
    _commentFeed.onGift.listen((_) => FlutterForegroundTask.sendDataToMain({'type': 'gift'}));
    _commentFeed.onFollow.listen((_) => _markEventReceived());
    // バトル終了(またはEND後のスコア確定)の即時表示。ギフトと同じくtypeだけの
    // 最小ペイロード — 表示に使う値はバトル履歴タブがREST(queryBattles)で取り直す。
    _commentFeed.onBattle.listen((event) {
      _markEventReceived();
      FlutterForegroundTask.sendDataToMain({
        'type': 'battle',
        'startedAt': event.startedAt.toIso8601String(),
      });
    });

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
    _checkNoLiveAutoStop();
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
      // UI から「前面へ戻った」と教わる。背景 Isolate には lifecycle が配られない
      // (headless エンジンなので)ため、知る手段がこれしかない。
      //
      // iOS は背面で suspend されるので、復帰直後は socket が切れているか、
      // 切れたことにまだ気づいていない。ping timeout を待つと数十秒空くので、
      // ここで張り直しと状態の取り直しを促す。
      case 'lifecycle':
        if (data['state'] != 'resumed') return;
        final apiKey = _apiKey;
        if (apiKey != null && _commentFeed.status != SocketStatus.connected) {
          _commentFeed.connect(apiKey);
        }
        _scheduleReconcile(Duration.zero);
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
    }
  }

  /// UIから届いた「意思」を受け取り、_configの更新・自動停止タイマーの
  /// 起動/停止制御を行ってから、実行系へ反映する（_applyEffectiveConfig）。
  void _applyConfig(AppConfig config) {
    _config = config;

    final featureEnabled = config.ttsEnabled || config.sound.enabled;
    if (featureEnabled && !_wasFeatureEnabled) {
      // 「開始」。新しいセッションとしてタイマー・everLive・ラッチをリセットする。
      _sinceFeatureEnabled
        ..reset()
        ..start();
      _everLiveSinceEnabled = false;
      _setAutoStopLatched(false);
    } else if (!featureEnabled) {
      _sinceFeatureEnabled.stop();
    }
    _wasFeatureEnabled = featureEnabled;

    _applyEffectiveConfig();
  }

  /// 実際に speechQueue / soundEngine / iOS keepalive へ反映する設定
  /// （「意思」と自動停止ラッチを合成したもの）。_config自体は変更しない。
  void _applyEffectiveConfig() {
    final effective = _autoStopLatched
        ? _config.copyWith(ttsEnabled: false, sound: _config.sound.copyWith(enabled: false))
        : _config;

    _soundEngine?.applyConfig(effective);
    _speechQueue.setEnabled(effective.ttsEnabled);
    _speechQueue.randomVoice = effective.randomVoice;
    _speechQueue.fixedStyleId = effective.fixedStyleId;
    _speechQueue.volume = effective.ttsVolume;
    _speechQueue.speed = effective.ttsSpeed;

    // **無音キープアライブはサービスの稼働ではなく「音を出す機能」に紐づける。**
    //
    // iOS の flutter_foreground_task は Android の Foreground Service のような
    // 生存保証を持たない（ios/Classes/service/ForegroundTask.swift はアプリ内の
    // headless エンジンとタイマーだけ）。画面オフ中の生存を実際に支えているのは
    // `UIBackgroundModes: audio` と、この無音ループが AVAudioSession を握り続けて
    // いることだけ。したがって紐づけ先をここへ移しても、画面オフ継続の因果は
    // 変わらない（開始ボタン＝必ず前面、で start される点も同じ）。
    //
    // 逆に、音を出さない待機状態で鳴らし続けてはいけない。バッテリーの無駄で
    // あるうえ、App Store 2.5.4 の「バックグラウンド音声は可聴コンテンツのため」
    // という位置づけから外れる。
    if (Platform.isIOS) {
      final wantsAudio = effective.ttsEnabled || effective.sound.enabled;
      unawaited(wantsAudio ? _keepAlive.start() : _keepAlive.stop());
    }

    // VOICEVOXの初期化は重い。TTSがOFFのままサウンドだけ使う運用では走らせない。
    if (effective.ttsEnabled && !_speechQueue.initialized) {
      unawaited(_speechQueue.initialize());
    }
  }

  /// 60分経ってもライブが始まらなければ、読み上げ・効果音を自動停止する。
  ///
  /// **_config（意思）は書き換えない。** 実行系だけ_autoStopLatchedで止め、
  /// 自動停止の事実はUI Isolateへ非同期に伝える（_notifyAutoStop）。
  void _checkNoLiveAutoStop() {
    if (_autoStopLatched || _everLiveSinceEnabled) return;
    if (!_sinceFeatureEnabled.isRunning) return;
    if (_sinceFeatureEnabled.elapsed < _noLiveAutoStopTimeout) return;

    _sinceFeatureEnabled.stop();
    _autoStopLatched = true;
    _applyEffectiveConfig(); // 実行系を即座に止める
    unawaited(_notifyAutoStop());
  }

  /// 自動停止の事実を永続化してからUIへ通知する。
  ///
  /// **保存 → 通知の順を守ること。** 逆順だと、UIが通知を受けて永続フラグを
  /// 読みに行ったタイミングで、まだ保存が完了していない理論上のraceがある。
  Future<void> _notifyAutoStop() async {
    await FlutterForegroundTask.saveData(key: autoStopPendingStorageKey, value: true);
    await FlutterForegroundTask.updateService(notificationText: idleNotificationText);
    FlutterForegroundTask.sendDataToMain({'type': 'noLiveAutoStop'});
  }

  /// 「開始」（意思の立ち上がり）でラッチを解除するとき用。
  void _setAutoStopLatched(bool value) {
    if (_autoStopLatched == value) return;
    _autoStopLatched = value;
    unawaited(FlutterForegroundTask.saveData(key: autoStopPendingStorageKey, value: value));
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

    // 停止したら無音ループも確実に止める。残すとバッテリーを食い続けるうえ、
    // 「可聴コンテンツのためのバックグラウンド音声」という位置づけからも外れる。
    if (Platform.isIOS) await _keepAlive.stop();

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
    final live = recent || (listener?.live ?? false);
    // 一度でもライブ中と判定できたら、このセッションでは自動停止しない。
    if (live) _everLiveSinceEnabled = true;
    FlutterForegroundTask.sendDataToMain({
      'type': 'listener',
      'live': live,
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
      'nowSpeakingCommentKey': _speechQueue.nowSpeakingCommentKey,
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
      // メインisolate側は同じ Comment.tryParse で復元する。ここを足し忘れると
      // 画面に出る側だけエモートが消える(受信自体は成功しているので気づきにくい)。
      'emotes': c.emotesToMaps(),
    });
  }
}
