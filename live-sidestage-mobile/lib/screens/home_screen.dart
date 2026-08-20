import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:provider/provider.dart';

import '../core/comment_feed.dart' show SocketStatus;
import '../core/session_controller.dart';
import '../main.dart' show startCallback;
import '../models/comment.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final List<Comment> _comments = [];
  final ScrollController _scrollController = ScrollController();
  SocketStatus _status = SocketStatus.disconnected;
  String? _connectionError;

  bool _serviceRunning = false;
  bool _serviceBusy = false;

  bool _speechInitialized = false;
  bool _randomVoice = true;
  String? _nowSpeakingCharacterName;
  String? _speechError;

  // TikTok ID変更後、LiveAnalytics側のWorkerが新しい部屋(TiktokRoom)へ接続し直すまでの猶予。
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

  // 読み上げ中はForeground Serviceで画面オフ/バックグラウンドでも継続する。
  // 停止中はサービスを完全に止め、アプリがタスクKillされても問題ない状態にする。
  Future<void> _startReading() async {
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
        channelId: 'tikcaption_reader_speech',
        channelName: 'コメント読み上げ',
        channelDescription: 'TikTok Liveのコメントを画面オフでも読み上げ続けます',
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
      await FlutterForegroundTask.startService(
        serviceTypes: [ForegroundServiceTypes.dataSync, ForegroundServiceTypes.mediaPlayback],
        notificationTitle: 'TikCaptionReader',
        notificationText: 'コメントを読み上げ中です',
        callback: startCallback,
      );
    }

    if (!mounted) return;
    setState(() {
      _serviceRunning = true;
      _serviceBusy = false;
    });
  }

  Future<void> _stopReading() async {
    setState(() => _serviceBusy = true);
    await FlutterForegroundTask.stopService();
    if (!mounted) return;
    setState(() {
      _serviceRunning = false;
      _serviceBusy = false;
      _status = SocketStatus.disconnected;
      _connectionError = null;
      _speechInitialized = false;
      _nowSpeakingCharacterName = null;
      _speechError = null;
    });
  }

  Future<void> _changeTiktokId() async {
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
      await _stopReading();
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
          _speechInitialized = map['initialized'] as bool? ?? false;
          _randomVoice = map['randomVoice'] as bool? ?? true;
          _nowSpeakingCharacterName = map['nowSpeakingCharacterName'] as String?;
          _speechError = map['errorMessage'] as String?;
        });
      case 'comment':
        _endRoomSwitchGrace();
        final wasNearBottom = _isNearBottom();
        setState(() {
          _comments.add(Comment.fromJson(map));
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
      appBar: AppBar(
        title: Text('@${session?.streamer?.tiktokId ?? ''}'),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit),
            tooltip: 'TikTok IDを変更',
            onPressed: _changeTiktokId,
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'ログアウト',
            onPressed: () async {
              await FlutterForegroundTask.stopService();
              if (!context.mounted) return;
              await context.read<SessionController>().logout();
            },
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: _statusColor(_status).withValues(alpha: 0.12),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                Icon(Icons.circle, size: 10, color: _statusColor(_status)),
                const SizedBox(width: 8),
                Text(_statusLabel(_status)),
                if (_connectionError != null) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _connectionError!,
                      style: const TextStyle(color: Colors.red, fontSize: 12),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _serviceBusy ? null : (_serviceRunning ? _stopReading : _startReading),
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
                label: Text(_serviceRunning ? '読み上げ停止' : '読み上げ開始'),
              ),
            ),
          ),
          if (_serviceRunning)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Row(
                children: [
                  const Text('ランダムボイス', style: TextStyle(fontSize: 13)),
                  // SwitchはVOICEVOX初期化完了後(=常にonChangedありの状態)で
                  // 初めてマウントする。準備中の無効状態からのちに有効化すると、
                  // FlutterのSwitchが色の再描画に失敗しONなのにOFF色のまま
                  // 固まる不具合があったため。
                  if (_speechInitialized)
                    Switch(
                      value: _randomVoice,
                      onChanged: (value) =>
                          FlutterForegroundTask.sendDataToTask({'command': 'setRandom', 'value': value}),
                    )
                  else
                    const SizedBox(width: 34, height: 34),
                  const Spacer(),
                  if (!_speechInitialized && _speechError == null)
                    const Text('VOICEVOX準備中…', style: TextStyle(fontSize: 12, color: Colors.grey)),
                  if (_nowSpeakingCharacterName != null)
                    Text(
                      'VOICEVOX:$_nowSpeakingCharacterName',
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                    ),
                  if (_speechError != null)
                    Expanded(
                      child: Text(
                        _speechError!,
                        style: const TextStyle(fontSize: 11, color: Colors.red),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
              ),
            ),
          if (_roomSwitching)
            Container(
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
                      '配信情報を確認中…（あと$_roomSwitchRemainingSeconds秒）',
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),
          Expanded(
            child: _comments.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        _roomSwitching
                            ? '@${_switchingToTiktokId ?? ''} への切り替えをサーバーが反映中です\n（最大60秒。「読み上げ開始」を押しておけば、反映され次第コメントが流れ始めます）'
                            : '「読み上げ開始」を押すと、ここにコメントが表示されます\n（登録直後は反映まで最大60秒ほどかかります）',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.grey),
                      ),
                    ),
                  )
                : ListView.separated(
                    controller: _scrollController,
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: _comments.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final c = _comments[index];
                      return ListTile(
                        leading: CircleAvatar(
                          backgroundImage: c.profilePictureUrl != null
                              ? NetworkImage(c.profilePictureUrl!)
                              : null,
                          child: c.profilePictureUrl == null ? const Icon(Icons.person) : null,
                        ),
                        title: Text(c.nickname),
                        subtitle: Text(c.comment),
                      );
                    },
                  ),
          ),
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
