import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/comment_feed.dart';
import '../core/session_controller.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final session = context.read<SessionController>().session;
      final apiKey = session?.streamer?.apiKey;
      if (apiKey != null) {
        context.read<CommentFeed>().connect(apiKey);
      }
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
    final feed = context.watch<CommentFeed>();

    return Scaffold(
      appBar: AppBar(
        title: Text('@${session?.streamer?.tiktokId ?? ''}'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'ログアウト',
            onPressed: () async {
              context.read<CommentFeed>().disconnect();
              await context.read<SessionController>().logout();
            },
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: _statusColor(feed.status).withValues(alpha: 0.12),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                Icon(Icons.circle, size: 10, color: _statusColor(feed.status)),
                const SizedBox(width: 8),
                Text(_statusLabel(feed.status)),
                if (feed.errorMessage != null) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      feed.errorMessage!,
                      style: const TextStyle(color: Colors.red, fontSize: 12),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ],
            ),
          ),
          Expanded(
            child: feed.comments.isEmpty
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
                    itemCount: feed.comments.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final c = feed.comments[index];
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
}
