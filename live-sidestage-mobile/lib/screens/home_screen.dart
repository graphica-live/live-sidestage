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
  SocketStatus _status = SocketStatus.disconnected;
  String? _connectionError;

  bool _speechInitialized = false;
  bool _speechEnabled = true;
  bool _randomVoice = true;
  String? _nowSpeakingCharacterName;
  String? _speechError;

  @override
  void initState() {
    super.initState();
    FlutterForegroundTask.addTaskDataCallback(_onTaskData);
    WidgetsBinding.instance.addPostFrameCallback((_) => _startBackgroundService());
  }

  Future<void> _startBackgroundService() async {
    final apiKey = context.read<SessionController>().session?.streamer?.apiKey;
    if (apiKey == null) return;

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
          _speechEnabled = map['enabled'] as bool? ?? true;
          _randomVoice = map['randomVoice'] as bool? ?? true;
          _nowSpeakingCharacterName = map['nowSpeakingCharacterName'] as String?;
          _speechError = map['errorMessage'] as String?;
        });
      case 'comment':
        setState(() {
          _comments.insert(0, Comment.fromJson(map));
          if (_comments.length > 200) {
            _comments.removeRange(200, _comments.length);
          }
        });
    }
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
            icon: Icon(_speechEnabled ? Icons.volume_up : Icons.volume_off),
            tooltip: _speechEnabled ? '読み上げをミュート' : '読み上げを再開',
            onPressed: () => FlutterForegroundTask.sendDataToTask({'command': 'toggleMute'}),
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
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            child: Row(
              children: [
                const Text('ランダムボイス', style: TextStyle(fontSize: 13)),
                Switch(
                  value: _randomVoice,
                  onChanged: _speechInitialized
                      ? (value) => FlutterForegroundTask.sendDataToTask({'command': 'setRandom', 'value': value})
                      : null,
                ),
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
          Expanded(
            child: _comments.isEmpty
                ? const Center(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        '配信を開始すると、ここにコメントが表示されます\n（登録直後は反映まで最大60秒ほどかかります）',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.grey),
                      ),
                    ),
                  )
                : ListView.separated(
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
    super.dispose();
  }
}
