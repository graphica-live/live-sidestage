import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:provider/provider.dart';

import '../core/analytics_period.dart' show jstDateKeyOf;
import '../core/api_client.dart' show LiveAnalyticsApi, giftLabelJaMap;
import '../core/account_status_store.dart';
import '../core/app_config_store.dart';
import '../core/battle_activity.dart';
import '../core/comment_feed.dart' show CommentFeed, SocketStatus;
import '../core/feature_status.dart';
import '../core/gift_activity.dart';
import '../core/gift_name_ja.dart';
import '../core/session_controller.dart';
import '../core/session_storage.dart'
    show foregroundRefreshTokenStorageKey, foregroundTokenStorageKey;
import '../main.dart' show startCallback;
import '../models/auth_session.dart';
import '../models/comment.dart';
import 'gift_sound_edit_screen.dart' show fetchGiftCandidatesWithRefresh;
import 'subscription_screen.dart';
import 'tabs/battle_history_tab.dart';
import 'tabs/contribution_tab.dart';
import 'tabs/gift_history_tab.dart';
import 'tabs/settings_tab.dart';
import 'tabs/sound_tab.dart';
import 'tabs/tts_tab.dart';
import 'widgets/gradient_kit.dart';
import 'widgets/voicevox_terms.dart';

/// 背景Isolateから届く読み上げ状態。
class SpeechState {
  final bool initialized;
  final bool enabled;
  final bool randomVoice;
  final String? nowSpeakingCharacterName;

  /// 今読み上げ中のコメントの識別キー([Comment.identityKey])。
  /// バックグラウンドisolateとメインisolateは別インスタンスなので、
  /// [Comment]そのものではなくこのキーで同一性を判定する。
  final String? nowSpeakingCommentKey;
  final String? errorMessage;

  const SpeechState({
    this.initialized = false,
    this.enabled = true,
    this.randomVoice = true,
    this.nowSpeakingCharacterName,
    this.nowSpeakingCommentKey,
    this.errorMessage,
  });
}

/// 背景Isolateから届く効果音の状態。
class SoundState {
  final bool enabled;

  /// 直近に鳴らしたギフトの表記。
  final String? lastGiftName;

  final int droppedCount;

  /// 1回のギフトで鳴らせる上限を超えて鳴らせなかった件数。
  final int overflowCount;

  final String? errorMessage;

  const SoundState({
    this.enabled = true,
    this.lastGiftName,
    this.droppedCount = 0,
    this.overflowCount = 0,
    this.errorMessage,
  });
}

/// 背景Isolateから届く「TikTok側の配信状態」。
///
/// LIVE Sidestage Analytics の Worker が保持している TikTok Live 接続の状態で、
/// アプリ ↔ サーバー間の socket 接続とは別物。socket が繋がっていても
/// 配信者が配信を始めていなければ [live] は false になる。
class ListenerState {
  /// TikTok Live に接続できている(= 配信中)。
  final bool live;

  /// サーバー側の生の listenerStatus。診断用。
  final String? status;

  /// 接続エラーの内容。エラーでなければ null。
  final String? problem;

  const ListenerState({this.live = false, this.status, this.problem});
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

/// アプリを開いている間、音を出さずに socket だけ張る「待機」サービスを立てるか。
///
/// **問題が出たら false にすれば、待機を入れる前の挙動へ即座に戻せる。**
/// 待機はギフト受信での自動更新を成立させるためのもので、無くてもタブ切替と
/// 手動更新で数字は取れる（反映が遅いだけ）。
const bool _idleServiceEnabled = true;

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  final List<Comment> _comments = [];
  final ScrollController _scrollController = ScrollController();

  // 0=TTS, 1=サウンド, 2=設定, 3=貢献, 4=ギフト履歴, 5=バトル履歴
  int _tabIndex = 0;

  SocketStatus _status = SocketStatus.disconnected;
  String? _connectionError;

  bool _serviceRunning = false;
  bool _serviceBusy = false;

  SpeechState _speech = const SpeechState();
  SoundState _sound = const SoundState();
  ListenerState _listener = const ListenerState();

  /// オンボーディング後、初回だけTTSタブ上部に出す誘導バナー。
  bool _showFirstRunGuide = false;

  // TikTok ID変更後、LIVE Sidestage Analytics側のWorkerが新しい部屋(TiktokRoom)へ接続し直すまでの猶予。
  // サーバーは60秒間隔のreconcileループでしか部屋の切り替えを反映しないため、
  // 変更直後にコメントが止まって見えるのを「確認中」として明示する。
  static const Duration _roomSwitchGrace = Duration(seconds: 60);

  Timer? _roomSwitchTimer;
  DateTime? _roomSwitchDeadline;
  String? _switchingToTiktokHandle;

  /// 背景 Isolate へ最後に押し込んだ access token。同じ値を送り直さないための目印。
  String? _lastPushedToken;

  /// 背景 Isolate へ最後に押し込んだ refresh token。
  ///
  /// JWT は決定的署名のため、同一 payload・同一秒の `iat` で同時に2回発行されると
  /// access token 文字列が一致しうる（実測は稀だが、rotation の race で起こりうる）。
  /// access token だけの比較では、その場合に refresh token の更新が伝播漏れする。
  String? _lastPushedRefreshToken;

  SessionController? _sessions;

  @override
  void initState() {
    super.initState();
    FlutterForegroundTask.addTaskDataCallback(_onTaskData);
    WidgetsBinding.instance.addObserver(this);
    // メイン Isolate 側で rotation が起きたら背景 Isolate へ伝播させる。
    // **どちらのIsolateで再発行が起きても、もう片方へ必ず伝える** のが設計上の要件。
    _sessions = context.read<SessionController>()..addListener(_onSessionChanged);
    _lastPushedToken = _sessions?.session?.token;
    _lastPushedRefreshToken = _sessions?.session?.refreshToken;
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncRunningStatus());
    WidgetsBinding.instance.addPostFrameCallback((_) => _refreshGiftNames());
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkAutoStopPending());
    unawaited(_loadFirstRunGuideState());
  }

  // ── メイン Isolate ⇄ 背景 Isolate の token 同期 ──────────────────────────────
  //
  // 資格情報は2箇所に載っている（メイン: flutter_secure_storage、
  // 背景: FlutterForegroundTask のストレージ）。**片方で rotation したら必ず
  // もう片方へ伝播させる。** 伝えないと、相手側が無効化済みの refresh token を
  // 提示し、サーバーの reuse 検知で family ごと失効（＝不要な強制ログアウト）になる。

  /// セッションが更新された（rotation・ログイン・ログアウト）。
  void _onSessionChanged() {
    final session = _sessions?.session;
    if (session == null) {
      _lastPushedToken = null;
      _lastPushedRefreshToken = null;
      return;
    }
    if (session.token == _lastPushedToken &&
        session.refreshToken == _lastPushedRefreshToken) {
      return;
    }
    unawaited(_pushTokensToTask(session));
  }

  /// 背景 Isolate へ現在の token ペアを押し込む。
  Future<void> _pushTokensToTask(AuthSession session) async {
    _lastPushedToken = session.token;
    _lastPushedRefreshToken = session.refreshToken;
    await _saveTokensToTask(session);
    FlutterForegroundTask.sendDataToTask({
      'command': 'tokenRefreshed',
      'token': session.token,
      'refreshToken': session.refreshToken,
    });
  }

  /// 背景 Isolate 側の永続化（サービス起動時 `onStart` が読む値）を更新する。
  Future<void> _saveTokensToTask(AuthSession session) async {
    await FlutterForegroundTask.saveData(
      key: foregroundTokenStorageKey,
      value: session.token,
    );
    await FlutterForegroundTask.saveData(
      key: foregroundRefreshTokenStorageKey,
      value: session.refreshToken,
    );
  }

  Future<void> _loadFirstRunGuideState() async {
    final dismissed =
        await FlutterForegroundTask.getData<bool>(key: firstRunGuideDismissedStorageKey);
    if (!mounted) return;
    setState(() => _showFirstRunGuide = dismissed != true);
  }

  Future<void> _dismissFirstRunGuide() async {
    setState(() => _showFirstRunGuide = false);
    await FlutterForegroundTask.saveData(key: firstRunGuideDismissedStorageKey, value: true);
  }

  /// 起動時に一度だけ、サーバーからギフトの日本語名を取り直して端末へ貯める。
  ///
  /// **保存済みの効果音設定を日本語表示へ移行するのはこの経路。** ギフトピッカーを
  /// 開かないユーザーでも、アプリを起動するだけで一覧が日本語になる。
  ///
  /// 失敗は無視する。表示を良くするためだけの取得なので、貯めてあるぶんで描いて
  /// 次の起動かピッカーで取り直せばよい。
  Future<void> _refreshGiftNames() async {
    final sessions = context.read<SessionController>();
    final token = sessions.session?.token;
    if (token == null) return;
    try {
      final gifts = await fetchGiftCandidatesWithRefresh(
        api: LiveAnalyticsApi(),
        token: token,
        refreshToken: sessions.refreshToken,
      );
      await GiftNameJa.updateFromServer(giftLabelJaMap(gifts));
      if (!mounted) return;
      setState(() {}); // 貯めた日本語名で一覧を描き直す
    } catch (_) {
      // 通信断・401・サーバー障害。英語表記のままで動く。
    }
  }

  /// 待機サービスの寿命を「アプリを開いている間」に限る。
  ///
  /// **Android は待機を常駐させてはいけない。** stopWithTask: false のサービスは
  /// START_STICKY で復活し、タスクスワイプにも再起動アラームが仕掛けられる。
  /// 停止ボタンが音を止めるだけになった今、常駐させると**ユーザーがサービスを
  /// 止める手段が設定アプリの強制停止しか無くなる**。
  ///
  /// **iOS でも同じように畳む。** suspend されれば動作は止まるが、socket は明示的に
  /// 閉じないのでサーバーからは繋がったままに見える。音を出していないなら接続を
  /// 残す理由が無いので、こちらから切る。
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // 自動停止の収束チェックは _idleServiceEnabled のロールバックスイッチとは
    // 無関係に常に行う（待機サービスの仕組みとは独立した話のため）。
    if (state == AppLifecycleState.resumed) {
      unawaited(_checkAutoStopPending());
      // **前面復帰のたびに token を再同期する。** 背面にいる間に背景 Isolate 側で
      // rotation が起きていた場合、その通知(`tokenRefreshed`)は既に受け取って
      // セッションへ取り込まれている。ここで押し直すことで、逆にメイン側だけが
      // 新しい状態を持っている場合の desync も解消する（どちらが新しくても、
      // 猶予期間つきの rotation が正常な競合として吸収する）。
      final session = _sessions?.session;
      if (session != null) unawaited(_pushTokensToTask(session));
    }

    if (!_idleServiceEnabled) return;

    if (state == AppLifecycleState.resumed) {
      // 背面にいた間に socket が切れている。ping timeout を待つと数十秒空くので、
      // 背景へ張り直しを促す（背景 Isolate は自分が背面かを知れない）。
      FlutterForegroundTask.sendDataToTask({'command': 'lifecycle', 'state': 'resumed'});
      unawaited(_resumeIdleService());
      return;
    }

    if (state == AppLifecycleState.paused) {
      unawaited(_stopIdleServiceIfIdle());
    }
  }

  /// 前面へ戻ったのにサービスが居なければ待機を立て直す。
  Future<void> _resumeIdleService() async {
    if (await FlutterForegroundTask.isRunningService) return;
    if (!mounted) return;
    await _syncRunningStatus();
  }

  /// 背面へ回るとき、音を出していないなら待機は畳む。
  ///
  /// **読み上げ・効果音が動いているときは触らない。** それが画面オフ継続そのもので、
  /// ここで止めたら必須要件が壊れる。
  Future<void> _stopIdleServiceIfIdle() async {
    if (!mounted) return;
    final store = context.read<AppConfigStore>();
    if (store.config.ttsEnabled || store.sound.enabled) return;
    if (!await FlutterForegroundTask.isRunningService) return;
    await _stopService();
  }

  // ── サービスの状態と設定フラグの同期 ────────────────────────────────────────

  /// **不変条件: `機能有効 ⇒ サービス稼働`（逆は成り立たない）。**
  ///
  /// 以前は両向きの一致（`serviceRunning == (tts || sound)`）だったが、socket を
  /// 常に1本に保つため「音を出さずに socket だけ張る待機」を足した。サービスが
  /// 動いていても機能が両方 OFF のことがある。
  ///
  /// サービスが止まっているなら、どの機能も動いていない。保存値を実態へ合わせておかないと
  /// 「停止中なのに保存値は両方ON」という状態が残り、そこから片方だけ開始したつもりでも
  /// もう片方まで一緒に起動する。[AppConfig] の既定値が両方 true なので、初回起動の
  /// 既存ユーザーもここで正規化される。
  ///
  /// **正規化してから待機を立てること。** 順序を逆にすると、既定値の両方 true のまま
  /// サービスが起動して、アプリを開いただけで読み上げと効果音が走り出す。
  Future<void> _syncRunningStatus() async {
    final store = context.read<AppConfigStore>();
    final running = await FlutterForegroundTask.isRunningService;
    if (!mounted) return;
    setState(() => _serviceRunning = running);
    if (running) return;

    await store.setFeatureMask(tts: false, sound: false);
    if (!mounted || !_idleServiceEnabled) return;

    final session = context.read<SessionController>().session;
    final started = await _startService(session: session, store: store, idle: true);
    if (!mounted) return;
    setState(() => _serviceRunning = started);
  }

  /// 背景 Isolate が「60分ライブが始まらず自動停止した」ことを記録した
  /// フラグ([autoStopPendingStorageKey])を確認し、確定していれば UI 側の
  /// 正規の設定へ反映してスナックバーを出す。
  ///
  /// アプリ起動時・resume時の両方から呼ぶ（背景 Isolate が `sendDataToMain`
  /// した瞬間に UI が存在しない/購読していない場合に備えて、収束処理は
  /// 常にここへ集約する）。
  Future<void> _checkAutoStopPending() async {
    final pending = await FlutterForegroundTask.getData<bool>(key: autoStopPendingStorageKey);
    if (pending != true) return;
    if (!mounted) return;

    // 先に正規の設定へ反映してから、pendingフラグを消す。
    // 逆順だとフラグ消去後・保存完了前に終了した場合に収束できなくなる。
    await context.read<AppConfigStore>().setFeatureMask(tts: false, sound: false);
    await FlutterForegroundTask.saveData(key: autoStopPendingStorageKey, value: false);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('60分間ライブ配信が開始されなかったため、読み上げ・効果音を自動的に停止しました。'),
        duration: Duration(seconds: 8),
      ),
    );
  }

  /// 開始/停止ボタンの実体。**設定の保存とサービス遷移を1本の直列処理にまとめる。**
  ///
  /// `_serviceBusy` は最初の await より前に立てる。保存を待っている隙にもう一方のタブから
  /// 操作されると、両方が「サービスは止まっている」と判断して二重に起動しうる。
  Future<void> _toggleFeature({required bool isTts, required bool enable}) async {
    if (_serviceBusy) return;

    // 読み上げを初めて開始するときだけ VOICEVOX の利用条件を出す。モーダルなので
    // この間に他の操作は入らない。_serviceBusy を立てる前に出すのは、読んでいる間
    // 開始ボタンを「処理中」に見せないため。
    if (isTts && enable) {
      await showVoicevoxTermsDialogOnce(context);
      if (!mounted) return;
    }

    setState(() => _serviceBusy = true);

    // context は最初の await より前に読んでおく。await をまたいで触ると、
    // 画面が破棄されたあとに参照しうる。
    final store = context.read<AppConfigStore>();
    final session = context.read<SessionController>().session;

    try {
      final running = await FlutterForegroundTask.isRunningService;

      if (enable) {
        if (!running) {
          // 停止中からの開始。**押した機能だけ**を有効にする。
          await store.setFeatureMask(tts: isTts, sound: !isTts);
          final started = await _startService(session: session, store: store);
          if (!started) {
            await store.setFeatureMask(tts: false, sound: false);
          }
        } else {
          await store.setFeatureMask(
            tts: isTts || store.config.ttsEnabled,
            sound: !isTts || store.sound.enabled,
          );
          await _refreshNotification(store);
        }
      } else {
        final otherEnabled = isTts ? store.sound.enabled : store.config.ttsEnabled;
        if (otherEnabled) {
          await store.setFeatureMask(
            tts: isTts ? false : store.config.ttsEnabled,
            sound: isTts ? store.sound.enabled : false,
          );
          await _refreshNotification(store);
        } else if (_idleServiceEnabled) {
          // 最後の機能を止めても**サービスは残す**。socket を1本保ったままにして、
          // 貢献・ギフト履歴タブの自動更新を続けるため。ACK を返す相手が生き続けるので、
          // 保存してから通知文を追従させる順序でよい。
          await store.setFeatureMask(tts: false, sound: false);
          await _refreshNotification(store);
        } else {
          // 最後の機能を止める。**先にサービスを止めてから保存する。**
          // 逆順にすると AppConfigStore が「稼働中」と判断して背景へ applyConfig を送り、
          // ACK を待つ状態に入る。その直後にサービスを壊すと ACK が返らず、
          // syncPending が永久に残って音源ファイルの削除もブロックされる。
          await _stopService();
          await store.setFeatureMask(tts: false, sound: false);
        }
      }
    } finally {
      if (mounted) setState(() => _serviceBusy = false);
      // ローカル変数ではなく実状態を採り直す。
      await _syncRunningStatus();
    }
  }

  // 稼働中はForeground Serviceで画面オフ/バックグラウンドでも継続する。
  // 停止中はサービスを完全に止め、アプリがタスクKillされても問題ない状態にする。
  ///
  /// [idle] は「読み上げも効果音も無効なまま、socket のためだけに立てる」起動。
  /// **権限を要求せず、失敗しても何も言わない。** アプリを開いただけで許可ダイアログが
  /// 出るのは第一印象として悪いし、待機は「あれば貢献タブが自動更新される」という
  /// 上乗せなので、立てられなければ黙って諦めてよい(タブ切替と手動更新は生きている)。
  ///
  /// **ゲートは「TikTok が未連携か」で判定する（`session?.streamer == null`）。**
  /// 以前は「TikTok登録時にだけ発行される資格情報」の有無で判定していたが、
  /// access token は TikTok 連携前から常に存在する。そのまま置き換えると
  /// 未連携でもサービスが立ち上がり、
  /// サーバーに `STREAMER_NOT_REGISTERED` で弾かれ続ける。
  ///
  /// token / refreshToken は **必ず同じ [AuthSession] から対で取り出す。**
  /// 別々に受け取ると、片方だけ古い値を渡す事故が起こりうる（rotation 済みの
  /// refresh token を渡すと、背景 Isolate が reuse 検知に引っかかる）。
  Future<bool> _startService({
    required AuthSession? session,
    required AppConfigStore store,
    bool idle = false,
  }) async {
    if (session?.streamer == null) {
      if (!idle) _showMessage('TikTokアカウントの登録が完了していないため開始できません。');
      return false;
    }

    // iOSは通知を出さない設定(iosNotificationOptions.showNotification: false)なので
    // 許可を求める意味がなく、バッテリー最適化の除外はAndroid専用API。
    // iOSでの生存は UIBackgroundModes: audio と無音ループが担う。
    if (Platform.isAndroid && !idle) {
      if (await FlutterForegroundTask.checkNotificationPermission() != NotificationPermission.granted) {
        await FlutterForegroundTask.requestNotificationPermission();
      }
      if (!await FlutterForegroundTask.isIgnoringBatteryOptimizations) {
        await FlutterForegroundTask.requestIgnoreBatteryOptimization();
      }
    }

    await _saveTokensToTask(session!);

    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'live_sidestage_mobile_speech',
        channelName: 'コメント読み上げ・効果音',
        channelDescription: 'TikTok Liveのコメント読み上げと効果音を画面オフでも継続します',
      ),
      iosNotificationOptions: const IOSNotificationOptions(showNotification: false),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.repeat(30000),
        allowWakeLock: true,
        allowWifiLock: true,
        stopWithTask: false,
      ),
    );

    if (await FlutterForegroundTask.isRunningService) return true;

    // dataSync は付けない。Android 15 以降 24時間あたり6時間でタイムアウトし、
    // 長時間の配信待受が途中で止まるため（AndroidManifest.xml のコメント参照）。
    final result = await FlutterForegroundTask.startService(
      serviceTypes: [ForegroundServiceTypes.mediaPlayback],
      notificationTitle: 'LIVE Sidestage',
      notificationText: _notificationText(store),
      callback: startCallback,
    );

    // 結果を見ずに稼働中扱いすると、通知権限を拒否された端末などで
    // 「開始したのに何も起きない」状態のまま UI だけ動いてしまう。
    if (result is ServiceRequestFailure) {
      _showMessage('バックグラウンド動作を開始できませんでした: ${result.error}');
      return false;
    }
    return true;
  }

  /// 稼働中に有効な機能が変わったときの通知文の追従。
  /// [_notificationText] は startService 時にしか評価されないため、これが無いと古いまま残る。
  Future<void> _refreshNotification(AppConfigStore store) async {
    if (!await FlutterForegroundTask.isRunningService) return;
    await FlutterForegroundTask.updateService(notificationText: _notificationText(store));
  }

  String _notificationText(AppConfigStore store) {
    final config = store.config;
    final tts = config.ttsEnabled;
    final sound = config.sound.enabled;
    if (tts && sound) return 'コメント読み上げと効果音が動作中です';
    if (tts) return 'コメントを読み上げ中です';
    if (sound) return '効果音が動作中です';
    return idleNotificationText;
  }

  Future<void> _stopService() async {
    await FlutterForegroundTask.stopService();
    if (!mounted) return;
    setState(() {
      _serviceRunning = false;
      _status = SocketStatus.disconnected;
      _connectionError = null;
      _speech = const SpeechState();
      _sound = const SoundState();
      _listener = const ListenerState();
    });
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 6)),
    );
  }

  Future<void> changeTiktokHandle() async {
    final controller = context.read<SessionController>();
    final store = context.read<AppConfigStore>();
    final newId = await showDialog<String>(
      context: context,
      builder: (context) => _ChangeTiktokHandleDialog(
        initialValue: controller.session?.streamer?.tiktokHandle ?? '',
      ),
    );
    if (newId == null || newId.isEmpty) return;
    if (!mounted) return;

    // 部屋が変わるので接続を張り直す必要がある。停止経路と同じ後始末をして、
    // ユーザーに「開始」を押し直してもらう。
    if (_serviceRunning) {
      await _stopService();
      await store.setFeatureMask(tts: false, sound: false);
      if (!mounted) return;
    }

    final ok = await controller.changeTiktokHandle(newId);
    if (!mounted) return;
    if (ok) {
      _beginRoomSwitchGrace(newId);
    } else if (controller.errorMessage != null) {
      _showMessage(controller.errorMessage!);
    }
  }

  bool get _roomSwitching => _roomSwitchDeadline != null;

  int get _roomSwitchRemainingSeconds {
    final deadline = _roomSwitchDeadline;
    if (deadline == null) return 0;
    final remaining = deadline.difference(DateTime.now()).inSeconds;
    return remaining > 0 ? remaining : 0;
  }

  void _beginRoomSwitchGrace(String tiktokId) {
    _roomSwitchTimer?.cancel();
    setState(() {
      _switchingToTiktokHandle = tiktokId;
      _roomSwitchDeadline = DateTime.now().add(_roomSwitchGrace);
      // 旧IDのコメントは新しい配信と無関係なので破棄する。
      _comments.clear();
    });
    _roomSwitchTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (_roomSwitchRemainingSeconds <= 0) {
        _endRoomSwitchGrace();
      } else {
        setState(() {}); // 残り秒数の再描画
      }
    });
  }

  // 猶予の終了条件は「新しい部屋のコメントが1件届いた」か「60秒経過」。
  void _endRoomSwitchGrace() {
    if (_roomSwitchDeadline == null) return;
    _roomSwitchTimer?.cancel();
    _roomSwitchTimer = null;
    setState(() {
      _roomSwitchDeadline = null;
      _switchingToTiktokHandle = null;
    });
  }

  void _onTaskData(Object data) {
    if (data is! Map) return;
    final map = Map<String, dynamic>.from(data);

    switch (map['type']) {
      // ギフトが届いた。貢献・ギフト履歴タブが取り直すきっかけにするだけで、
      // ここでは何も描き直さない（setState 不要）。
      case 'gift':
        context.read<GiftActivityNotifier>().onGiftTick();
      // バトル終了(またはEND後のスコア確定)。バトル履歴タブが取り直すきっかけに
      // するだけで、ここでは何も描き直さない(setState不要)。
      case 'battle':
        final startedAtRaw = map['startedAt'] as String?;
        final startedAt = startedAtRaw != null ? DateTime.tryParse(startedAtRaw) : null;
        if (startedAt != null) {
          context.read<BattleActivityNotifier>().onBattleTick(jstDateKeyOf(startedAt));
        }
      // 背景Isolateが中継したpush envelope(方式A)。メインIsolate側の
      // CommentFeedは接続を持たないため、ここで受け取った生データを
      // そのまま(加工せず)注入する。パース・version整合性チェックは
      // 注入先のStream購読者(RankingSyncStore等)が行う。
      case 'rankingSnapshot':
        context.read<CommentFeed>().injectRankingSnapshot(map);
      case 'giftHistoryAppend':
        context.read<CommentFeed>().injectGiftHistoryAppend(map);
      case 'battleHistoryUpsert':
        context.read<CommentFeed>().injectBattleHistoryUpsert(map);
      case 'status':
        setState(() {
          _status = SocketStatus.values.firstWhere(
            (s) => s.name == map['status'],
            orElse: () => SocketStatus.disconnected,
          );
          _connectionError = map['errorMessage'] as String?;
        });
      case 'speech':
        setState(() {
          _speech = SpeechState(
            initialized: map['initialized'] as bool? ?? false,
            enabled: map['enabled'] as bool? ?? true,
            randomVoice: map['randomVoice'] as bool? ?? true,
            nowSpeakingCharacterName: map['nowSpeakingCharacterName'] as String?,
            nowSpeakingCommentKey: map['nowSpeakingCommentKey'] as String?,
            errorMessage: map['errorMessage'] as String?,
          );
        });
      case 'sound':
        setState(() {
          _sound = SoundState(
            enabled: map['enabled'] as bool? ?? true,
            lastGiftName: map['lastGiftName'] as String?,
            droppedCount: map['droppedCount'] as int? ?? 0,
            overflowCount: map['overflowCount'] as int? ?? 0,
            errorMessage: map['errorMessage'] as String?,
          );
        });
      case 'listener':
        setState(() {
          _listener = ListenerState(
            live: map['live'] as bool? ?? false,
            status: map['status'] as String?,
            problem: map['problem'] as String?,
          );
        });
      case 'configAck':
        final revision = map['revision'];
        if (revision is int) context.read<AppConfigStore>().onAck(revision);
      case 'serviceTimeout':
        setState(() => _serviceRunning = false);
        // 保存値も実態へ合わせる（不変条件の維持）。
        unawaited(context.read<AppConfigStore>().setFeatureMask(tts: false, sound: false));
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Androidの制限によりバックグラウンド動作が停止しました。もう一度「開始」を押してください。'),
            duration: Duration(seconds: 8),
          ),
        );
      case 'noLiveAutoStop':
        unawaited(_checkAutoStopPending());
      // 背景 Isolate が access token を取り直した。メイン側のセッションへ取り込む
      // （取り込まないと、次にメイン側が無効化済みの refresh token を提示して
      //  reuse 検知で強制ログアウトになる）。
      case 'tokenRefreshed':
        final token = map['token'];
        final refreshToken = map['refreshToken'];
        if (token is! String || refreshToken is! String) return;
        // 背景発の値なので、押し返さない（無限の往復を避ける）。
        _lastPushedToken = token;
        unawaited(
          context.read<SessionController>().adoptTokens(
                token: token,
                refreshToken: refreshToken,
              ),
        );
      // refresh token 自体が失効した（再発行では復帰できない）。**自動ログアウトはしない** ――
      // ユーザーの操作を伴わずにセッションを捨てると、通信環境の問題と区別が付かない
      // 見え方になる。再ログインを促すだけにとどめる。
      case 'authExpired':
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('ログインの有効期限が切れました。設定タブからログインし直してください。'),
            duration: Duration(seconds: 10),
          ),
        );
      // TikTok 未連携。背景 Isolate 側は既にサービスを畳んでいる。
      case 'streamerNotRegistered':
        setState(() => _serviceRunning = false);
        // 保存値も実態へ合わせる（「機能有効 ⇒ サービス稼働」の不変条件の維持）。
        unawaited(context.read<AppConfigStore>().setFeatureMask(tts: false, sound: false));
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('TikTokアカウントの連携が完了していないため停止しました。設定タブからTikTok IDを登録してください。'),
            duration: Duration(seconds: 10),
          ),
        );
      case 'comment':
        final comment = Comment.tryParse(map);
        if (comment == null) return;
        _endRoomSwitchGrace();
        final wasNearBottom = _isNearBottom();
        setState(() {
          _comments.add(comment);
          if (_comments.length > 200) {
            _comments.removeRange(0, _comments.length - 200);
          }
        });
        if (wasNearBottom) _scrollToBottomSoon();
    }
  }

  bool _isNearBottom() {
    if (!_scrollController.hasClients) return true;
    final position = _scrollController.position;
    return (position.maxScrollExtent - position.pixels) < 80;
  }

  void _scrollToBottomSoon() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  // ── タブへ渡すステータス ────────────────────────────────────────────────────

  /// 表示するエラーを (ラベル, 本文) で列挙する。
  ///
  /// 1本に合成せず全部並べる。ユーザーがスクリーンショットで問い合わせるための情報なので、
  /// 先頭のエラーで後続を隠さない。
  ///
  /// **TikTok 側の事情はここに入れない。** レート制限や再接続待ちは配信者から見れば
  /// 「配信開始待ち」の理由でしかなく、赤くすると自分のアプリが壊れたと誤解する。
  /// あちらは [_noticeFor] で補足として出す。
  List<(String, String)> _errorsFor({required bool isTts}) {
    final errors = <(String, String)>[];
    final connectionError = _connectionError;
    if (connectionError != null) errors.add(('接続', connectionError));

    final featureError = isTts ? _speech.errorMessage : _sound.errorMessage;
    if (featureError != null) errors.add((isTts ? '読み上げ' : '効果音', featureError));

    return errors;
  }

  /// TikTok 側で何が起きているかの補足。サーバーが listenerMessage に日本語で書いている。
  /// 開始していない機能には出さない（止めているのだから状況を出す意味がない）。
  String? _noticeFor({required bool enabled}) {
    if (!enabled || !_serviceRunning) return null;
    return _listener.problem;
  }

  FeatureStatus _statusFor({required bool isTts, required bool enabled}) {
    return resolveFeatureStatus(
      enabled: enabled,
      serviceRunning: _serviceRunning,
      socket: _status,
      live: _listener.live,
      hasError: _errorsFor(isTts: isTts).isNotEmpty,
    );
  }

  /// TikTok ID自動合流の事後通知。デフォルトの自動タイムアウト/スワイプでは
  /// 既読化しない — 明示的な「閉じる」アクションを押したときだけacknowledgeする
  /// (押されずに消えたら、次に設定タブを開いたときまた出る)。
  void _showRecentMergeNoticeIfAny() {
    final accountStatus = context.read<AccountStatusStore>();
    final notice = accountStatus.status.recentMerge;
    if (notice == null) return;

    final token = context.read<SessionController>().session?.token;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(notice.message),
        duration: const Duration(days: 1), // 自動では消さない。閉じるのはアクション押下のみ
        action: SnackBarAction(
          label: '閉じる',
          onPressed: () {
            if (token != null) {
              final sessions = context.read<SessionController>();
              accountStatus.acknowledgeRecentMerge(
                token: token,
                refreshToken: sessions.refreshToken,
              );
            }
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>().session;
    final store = context.watch<AppConfigStore>();
    final ttsEnabled = store.config.ttsEnabled;
    final soundEnabled = store.sound.enabled;
    final tiktokId = session?.streamer?.tiktokHandle;

    final accountStatus = context.watch<AccountStatusStore>();

    return Scaffold(
      appBar: AppBar(
        title: Text('@${session?.streamer?.tiktokHandle ?? ''}'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Center(child: _PlanBadge(label: accountStatus.status.planLabel)),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_roomSwitching)
            _RoomSwitchBanner(remainingSeconds: _roomSwitchRemainingSeconds),
          Expanded(
            // タブを切り替えてもコメントリストのスクロール位置とControllerを失わないようIndexedStack。
            child: IndexedStack(
              index: _tabIndex,
              children: [
                TtsTab(
                  comments: _comments,
                  scrollController: _scrollController,
                  speech: _speech,
                  status: _statusFor(isTts: true, enabled: ttsEnabled),
                  errors: _errorsFor(isTts: true),
                  notice: _noticeFor(enabled: ttsEnabled),
                  started: ttsEnabled && _serviceRunning,
                  busy: _serviceBusy,
                  onToggle: (enable) => _toggleFeature(isTts: true, enable: enable),
                  roomSwitching: _roomSwitching,
                  switchingToTiktokHandle: _switchingToTiktokHandle,
                  showFirstRunGuide: _showFirstRunGuide,
                  onDismissFirstRunGuide: _dismissFirstRunGuide,
                ),
                SoundTab(
                  sound: _sound,
                  status: _statusFor(isTts: false, enabled: soundEnabled),
                  errors: _errorsFor(isTts: false),
                  notice: _noticeFor(enabled: soundEnabled),
                  started: soundEnabled && _serviceRunning,
                  busy: _serviceBusy,
                  onToggle: (enable) => _toggleFeature(isTts: false, enable: enable),
                ),
                // TikTok ID変更時に旧IDのデータを残さないよう、tiktokIdをkeyにしてStateごと作り直す。
                //
                // **並びは下の destinations と1対1で対応させること。** ここの順番と
                // `_tabIndex == n` がずれると、開いていないタブが読み込みを始めたり、
                // 開いているタブが読み込まなくなったりする（例外は出ない）。
                ContributionTab(key: ValueKey('contribution-$tiktokId'), active: _tabIndex == 2),
                GiftHistoryTab(key: ValueKey('gift-history-$tiktokId'), active: _tabIndex == 3),
                BattleHistoryTab(key: ValueKey('battle-history-$tiktokId'), active: _tabIndex == 4),
                SettingsTab(
                  speech: _speech,
                  busy: _serviceBusy,
                  onChangeTiktokHandle: changeTiktokHandle,
                  onBeforeDeleteAccount: _stopService,
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (index) {
          setState(() => _tabIndex = index);
          // 設定タブ(index 5)を開いた時点でTikTok ID自動合流の事後通知が未読なら1回だけ出す。
          if (index == 5) _showRecentMergeNoticeIfAny();
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.record_voice_over_outlined), selectedIcon: Icon(Icons.record_voice_over), label: 'TTS'),
          NavigationDestination(icon: Icon(Icons.music_note_outlined), selectedIcon: Icon(Icons.music_note), label: 'サウンド'),
          NavigationDestination(icon: Icon(Icons.emoji_events_outlined), selectedIcon: Icon(Icons.emoji_events), label: '貢献'),
          NavigationDestination(icon: Icon(Icons.card_giftcard_outlined), selectedIcon: Icon(Icons.card_giftcard), label: 'ギフト'),
          NavigationDestination(icon: Icon(Icons.bolt_outlined), selectedIcon: Icon(Icons.bolt), label: 'バトル'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: '設定'),
        ],
      ),
    );
  }

  @override
  void dispose() {
    FlutterForegroundTask.removeTaskDataCallback(_onTaskData);
    _sessions?.removeListener(_onSessionChanged);
    WidgetsBinding.instance.removeObserver(this);
    _roomSwitchTimer?.cancel();
    _scrollController.dispose();
    super.dispose();
  }
}

/// AppBar右上のプラン表示。タップでプラン選択画面へ遷移する。
/// 表示文字列はanalytics(サーバー)の`planLabel`をそのまま出す — β表記("βFREE"等)を
/// 含めた組み立ての唯一の正本はサーバー側`getPlanDisplay`で、クライアントでは組み立て直さない。
class _PlanBadge extends StatelessWidget {
  const _PlanBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const SubscriptionScreen()),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
        decoration: const BoxDecoration(gradient: KosaiPalette.badge, borderRadius: BorderRadius.all(Radius.circular(999))),
        child: Text(
          label,
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 11),
        ),
      ),
    );
  }
}

class _RoomSwitchBanner extends StatelessWidget {
  const _RoomSwitchBanner({required this.remainingSeconds});

  final int remainingSeconds;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: Colors.orange.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          const SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.orange),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '配信情報を確認中…（あと$remainingSeconds秒）',
              style: const TextStyle(fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChangeTiktokHandleDialog extends StatefulWidget {
  const _ChangeTiktokHandleDialog({required this.initialValue});

  final String initialValue;

  @override
  State<_ChangeTiktokHandleDialog> createState() => _ChangeTiktokHandleDialogState();
}

class _ChangeTiktokHandleDialogState extends State<_ChangeTiktokHandleDialog> {
  final _formKey = GlobalKey<FormState>();
  late final _controller = TextEditingController(text: widget.initialValue);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('TikTok IDを変更'),
      content: Form(
        key: _formKey,
        child: TextFormField(
          controller: _controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'TikTok ID（@なし）'),
          validator: (v) => (v == null || v.trim().isEmpty) ? 'TikTok IDを入力してください' : null,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('キャンセル'),
        ),
        FilledButton(
          onPressed: () {
            if (!_formKey.currentState!.validate()) return;
            Navigator.of(context).pop(_controller.text.trim());
          },
          child: const Text('変更する'),
        ),
      ],
    );
  }
}
