import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:provider/provider.dart';

import '../core/app_config_store.dart';
import '../core/comment_feed.dart' show SocketStatus;
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

  Future<void> _syncRunningStatus() async {
    final running = await FlutterForegroundTask.isRunningService;
    if (!mounted) return;
    setState(() => _serviceRunning = running);
  }

  // 稼働中はForeground Serviceで画面オフ/バックグラウンドでも継続する。
  // 停止中はサービスを完全に止め、アプリがタスクKillされても問題ない状態にする。
  Future<void> _startService() async {
    final apiKey = context.read<SessionController>().session?.streamer?.apiKey;
    if (apiKey == null) return;

    setState(() => _serviceBusy = true);

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

    if (!await FlutterForegroundTask.isRunningService) {
      // dataSync は付けない。Android 15 以降 24時間あたり6時間でタイムアウトし、
      // 長時間の配信待受が途中で止まるため（AndroidManifest.xml のコメント参照）。
      await FlutterForegroundTask.startService(
        serviceTypes: [ForegroundServiceTypes.mediaPlayback],
        notificationTitle: 'Live Sidestage',
        notificationText: _notificationText(),
        callback: startCallback,
      );
    }

    if (!mounted) return;
    setState(() {
      _serviceRunning = true;
      _serviceBusy = false;
    });
  }

  String _notificationText() {
    final config = context.read<AppConfigStore>().config;
    final tts = config.ttsEnabled;
    final sound = config.sound.enabled;
    if (tts && sound) return 'コメント読み上げと効果音が動作中です';
    if (tts) return 'コメントを読み上げ中です';
    if (sound) return '効果音が動作中です';
    return '接続中です（読み上げ・効果音は停止中）';
  }

  Future<void> _stopService() async {
    setState(() => _serviceBusy = true);
    await FlutterForegroundTask.stopService();
    if (!mounted) return;
    setState(() {
      _serviceRunning = false;
      _serviceBusy = false;
      _status = SocketStatus.disconnected;
      _connectionError = null;
      _speech = const SpeechState();
      _sound = const SoundState();
    });
  }

  Future<void> changeTiktokId() async {
    final controller = context.read<SessionController>();
    final newId = await showDialog<String>(
      context: context,
      builder: (context) => _ChangeTiktokIdDialog(
        initialValue: controller.session?.streamer?.tiktokId ?? '',
      ),
    );
    if (newId == null || newId.isEmpty) return;
    if (!mounted) return;

    if (_serviceRunning) {
      await _stopService();
      if (!mounted) return;
    }

    final ok = await controller.changeTiktokId(newId);
    if (!mounted) return;
    if (ok) {
      _beginRoomSwitchGrace(newId);
    } else if (controller.errorMessage != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(controller.errorMessage!)),
      );
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
      case 'configAck':
        final revision = map['revision'];
        if (revision is int) context.read<AppConfigStore>().onAck(revision);
      case 'serviceTimeout':
        setState(() => _serviceRunning = false);
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

  String _statusLabel(SocketStatus status) {
    switch (status) {
      case SocketStatus.connecting:
        return '接続中…';
      case SocketStatus.connected:
        return '接続中（コメント受信可能）';
      case SocketStatus.disconnected:
        return '切断されています';
      case SocketStatus.error:
        return 'エラー';
    }
  }

  Color _statusColor(SocketStatus status) {
    switch (status) {
      case SocketStatus.connected:
        return Colors.green;
      case SocketStatus.connecting:
        return Colors.orange;
      case SocketStatus.disconnected:
        return Colors.grey;
      case SocketStatus.error:
        return Colors.red;
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>().session;

    return Scaffold(
      appBar: AppBar(title: Text('@${session?.streamer?.tiktokId ?? ''}')),
      body: Column(
        children: [
          _ConnectionStatusBar(
            label: _statusLabel(_status),
            color: _statusColor(_status),
            errorMessage: _connectionError,
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _serviceBusy ? null : (_serviceRunning ? _stopService : _startService),
                style: FilledButton.styleFrom(
                  backgroundColor: _serviceRunning ? Colors.red : null,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                icon: _serviceBusy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : Icon(_serviceRunning ? Icons.stop : Icons.play_arrow),
                label: Text(_serviceRunning ? '停止' : '開始'),
              ),
            ),
          ),
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
                  serviceRunning: _serviceRunning,
                  roomSwitching: _roomSwitching,
                  switchingToTiktokId: _switchingToTiktokId,
                ),
                SoundTab(sound: _sound),
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

/// ホーム画面上部に常駐する接続状態バー。
class _ConnectionStatusBar extends StatelessWidget {
  const _ConnectionStatusBar({required this.label, required this.color, this.errorMessage});

  final String label;
  final Color color;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: color.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          Icon(Icons.circle, size: 10, color: color),
          const SizedBox(width: 8),
          Text(label),
          if (errorMessage != null) ...[
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                errorMessage!,
                style: const TextStyle(color: Colors.red, fontSize: 12),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ],
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
