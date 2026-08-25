import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:provider/provider.dart';

import '../core/app_config_store.dart';
import '../core/comment_feed.dart' show SocketStatus;
import '../core/feature_status.dart';
import '../core/session_controller.dart';
import '../main.dart' show startCallback;
import '../models/comment.dart';
import 'tabs/settings_tab.dart';
import 'tabs/sound_tab.dart';
import 'tabs/tts_tab.dart';

/// 背景Isolateから届く読み上げ状態。
class SpeechState {
  final bool initialized;
  final bool enabled;
  final bool randomVoice;
  final String? nowSpeakingCharacterName;
  final String? errorMessage;

  const SpeechState({
    this.initialized = false,
    this.enabled = true,
    this.randomVoice = true,
    this.nowSpeakingCharacterName,
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

class _HomeScreenState extends State<HomeScreen> {
  final List<Comment> _comments = [];
  final ScrollController _scrollController = ScrollController();

  int _tabIndex = 0;

  SocketStatus _status = SocketStatus.disconnected;
  String? _connectionError;

  bool _serviceRunning = false;
  bool _serviceBusy = false;

  SpeechState _speech = const SpeechState();
  SoundState _sound = const SoundState();
  ListenerState _listener = const ListenerState();

  // TikTok ID変更後、LIVE Sidestage Analytics側のWorkerが新しい部屋(TiktokRoom)へ接続し直すまでの猶予。
  // サーバーは60秒間隔のreconcileループでしか部屋の切り替えを反映しないため、
  // 変更直後にコメントが止まって見えるのを「確認中」として明示する。
  static const Duration _roomSwitchGrace = Duration(seconds: 60);

  Timer? _roomSwitchTimer;
  DateTime? _roomSwitchDeadline;
  String? _switchingToTiktokId;

  @override
  void initState() {
    super.initState();
    FlutterForegroundTask.addTaskDataCallback(_onTaskData);
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncRunningStatus());
  }

  // ── サービスの状態と設定フラグの同期 ────────────────────────────────────────

  /// **不変条件: `serviceRunning == (ttsEnabled || soundEnabled)`。**
  ///
  /// サービスが止まっているなら、どの機能も動いていない。保存値を実態へ合わせておかないと
  /// 「停止中なのに保存値は両方ON」という状態が残り、そこから片方だけ開始したつもりでも
  /// もう片方まで一緒に起動する。[AppConfig] の既定値が両方 true なので、初回起動の
  /// 既存ユーザーもここで正規化される。
  Future<void> _syncRunningStatus() async {
    final store = context.read<AppConfigStore>();
    final running = await FlutterForegroundTask.isRunningService;
    if (!mounted) return;
    setState(() => _serviceRunning = running);
    if (!running) {
      await store.setFeatureMask(tts: false, sound: false);
    }
  }

  /// 開始/停止ボタンの実体。**設定の保存とサービス遷移を1本の直列処理にまとめる。**
  ///
  /// `_serviceBusy` は最初の await より前に立てる。保存を待っている隙にもう一方のタブから
  /// 操作されると、両方が「サービスは止まっている」と判断して二重に起動しうる。
  Future<void> _toggleFeature({required bool isTts, required bool enable}) async {
    if (_serviceBusy) return;
    setState(() => _serviceBusy = true);

    // context は最初の await より前に読んでおく。await をまたいで触ると、
    // 画面が破棄されたあとに参照しうる。
    final store = context.read<AppConfigStore>();
    final apiKey = context.read<SessionController>().session?.streamer?.apiKey;

    try {
      final running = await FlutterForegroundTask.isRunningService;

      if (enable) {
        if (!running) {
          // 停止中からの開始。**押した機能だけ**を有効にする。
          await store.setFeatureMask(tts: isTts, sound: !isTts);
          final started = await _startService(apiKey: apiKey, store: store);
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
  Future<bool> _startService({required String? apiKey, required AppConfigStore store}) async {
    if (apiKey == null) {
      _showMessage('TikTokアカウントの登録が完了していないため開始できません。');
      return false;
    }

    if (await FlutterForegroundTask.checkNotificationPermission() != NotificationPermission.granted) {
      await FlutterForegroundTask.requestNotificationPermission();
    }
    if (!await FlutterForegroundTask.isIgnoringBatteryOptimizations) {
      await FlutterForegroundTask.requestIgnoreBatteryOptimization();
    }

    await FlutterForegroundTask.saveData(key: 'apiKey', value: apiKey);

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
    return '接続中です（読み上げ・効果音は停止中）';
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

  Future<void> changeTiktokId() async {
    final controller = context.read<SessionController>();
    final store = context.read<AppConfigStore>();
    final newId = await showDialog<String>(
      context: context,
      builder: (context) => _ChangeTiktokIdDialog(
        initialValue: controller.session?.streamer?.tiktokId ?? '',
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

    final ok = await controller.changeTiktokId(newId);
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
      _switchingToTiktokId = tiktokId;
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
      _switchingToTiktokId = null;
    });
  }

  void _onTaskData(Object data) {
    if (data is! Map) return;
    final map = Map<String, dynamic>.from(data);

    switch (map['type']) {
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

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>().session;
    final store = context.watch<AppConfigStore>();
    final ttsEnabled = store.config.ttsEnabled;
    final soundEnabled = store.sound.enabled;

    return Scaffold(
      appBar: AppBar(title: Text('@${session?.streamer?.tiktokId ?? ''}')),
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
                  switchingToTiktokId: _switchingToTiktokId,
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
                SettingsTab(
                  speech: _speech,
                  onChangeTiktokId: changeTiktokId,
                  onBeforeLogout: _stopService,
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (index) => setState(() => _tabIndex = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.record_voice_over_outlined), selectedIcon: Icon(Icons.record_voice_over), label: 'TTS'),
          NavigationDestination(icon: Icon(Icons.music_note_outlined), selectedIcon: Icon(Icons.music_note), label: 'サウンド'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: '設定'),
        ],
      ),
    );
  }

  @override
  void dispose() {
    FlutterForegroundTask.removeTaskDataCallback(_onTaskData);
    _roomSwitchTimer?.cancel();
    _scrollController.dispose();
    super.dispose();
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

class _ChangeTiktokIdDialog extends StatefulWidget {
  const _ChangeTiktokIdDialog({required this.initialValue});

  final String initialValue;

  @override
  State<_ChangeTiktokIdDialog> createState() => _ChangeTiktokIdDialogState();
}

class _ChangeTiktokIdDialogState extends State<_ChangeTiktokIdDialog> {
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
