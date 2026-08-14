import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../models/comment.dart';
import 'api_client.dart' show liveAnalyticsBaseUrl;

enum SocketStatus { disconnected, connecting, connected, error }

class CommentFeed extends ChangeNotifier {
  io.Socket? _socket;

  SocketStatus status = SocketStatus.disconnected;
  String? errorMessage;
  final List<Comment> comments = [];

  void connect(String apiKey) {
    disconnect();

    status = SocketStatus.connecting;
    errorMessage = null;
    notifyListeners();

    final socket = io.io(
      liveAnalyticsBaseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setQuery({'apiKey': apiKey})
          .disableAutoConnect()
          .build(),
    );

    socket.onConnect((_) {
      status = SocketStatus.connected;
      errorMessage = null;
      notifyListeners();
    });

    socket.on('chat:comment', (data) {
      if (data is Map) {
        comments.insert(0, Comment.fromJson(Map<String, dynamic>.from(data)));
        if (comments.length > 200) {
          comments.removeRange(200, comments.length);
        }
        notifyListeners();
      }
    });

    socket.onDisconnect((_) {
      status = SocketStatus.disconnected;
      notifyListeners();
    });

    socket.onConnectError((err) {
      status = SocketStatus.error;
      errorMessage = '接続エラー: $err';
      notifyListeners();
    });

    socket.onError((err) {
      status = SocketStatus.error;
      errorMessage = 'エラー: $err';
      notifyListeners();
    });

    _socket = socket;
    socket.connect();
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
    status = SocketStatus.disconnected;
  }

  void clearComments() {
    comments.clear();
    notifyListeners();
  }

  @override
  void dispose() {
    disconnect();
    super.dispose();
  }
}
