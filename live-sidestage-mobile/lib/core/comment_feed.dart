import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../models/battle_event.dart';
import '../models/comment.dart';
import '../models/follow_event.dart';
import '../models/gift_event.dart';
import '../models/listener_status.dart';
import 'api_client.dart' show liveAnalyticsBaseUrl;

enum SocketStatus { disconnected, connecting, connected, error }

/// gift / follow が付けてくる契約バージョン。これより新しいものは解釈できないので無視する。
/// chat:comment だけは配信形式を変えていないため schemaVersion を持たない(legacy扱い)。
const int supportedChatEventSchemaVersion = 1;

class CommentFeed extends ChangeNotifier {
  io.Socket? _socket;

  SocketStatus status = SocketStatus.disconnected;
  String? errorMessage;
  final List<Comment> comments = [];

  /// 解析に失敗して捨てたイベント数。UI側の診断用。
  int malformedEventCount = 0;

  final StreamController<Comment> _commentController = StreamController<Comment>.broadcast();
  final StreamController<GiftEvent> _giftController = StreamController<GiftEvent>.broadcast();
  final StreamController<FollowEvent> _followController = StreamController<FollowEvent>.broadcast();
  final StreamController<ListenerStatus> _listenerController =
      StreamController<ListenerStatus>.broadcast();
  final StreamController<BattleEvent> _battleController = StreamController<BattleEvent>.broadcast();

  Stream<Comment> get onComment => _commentController.stream;
  Stream<GiftEvent> get onGift => _giftController.stream;
  Stream<FollowEvent> get onFollow => _followController.stream;
  Stream<ListenerStatus> get onListener => _listenerController.stream;
  Stream<BattleEvent> get onBattle => _battleController.stream;

  /// socket が繋がった（張り直した）タイミング。
  ///
  /// 接続直後は listener の現在値を持っていない。サーバーは接続時にスナップショットを
  /// 送らない（状態変化のときだけ push する）ので、**繋がったら端末側から取りに行く**。
  final StreamController<void> _connectedController = StreamController<void>.broadcast();

  Stream<void> get onConnected => _connectedController.stream;

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
      // 再接続のたびに発火する。切れている間の状態変化は push で受け取れていないので、
      // ここを合図に listener 状態を取り直す。
      _connectedController.add(null);
    });

    socket.on('chat:comment', (data) {
      // chat:comment には schemaVersion が無い(既存の配信形式を変えていない)。
      final comment = _decode(data, Comment.tryParse, requireSchemaVersion: false);
      if (comment == null) return;
      comments.insert(0, comment);
      if (comments.length > 200) {
        comments.removeRange(200, comments.length);
      }
      notifyListeners();
      _commentController.add(comment);
    });

    socket.on('chat:gift', (data) {
      final gift = _decode(data, GiftEvent.tryParse);
      if (gift != null) _giftController.add(gift);
    });

    socket.on('chat:follow', (data) {
      final follow = _decode(data, FollowEvent.tryParse);
      if (follow != null) _followController.add(follow);
    });

    socket.on('chat:listener', (data) {
      final listener = _decode(data, ListenerStatus.tryParse);
      if (listener != null) _listenerController.add(listener);
    });

    socket.on('chat:battle', (data) {
      final battle = _decode(data, BattleEvent.tryParse);
      if (battle != null) _battleController.add(battle);
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

  /// socket から届いた生データを安全にモデルへ変換する。
  ///
  /// `Map<String, dynamic>.from(data)` 自体が型不一致で投げうるので、
  /// tryParse だけでなくこの変換も含めて丸ごと保護する。ここで例外を漏らすと
  /// socket_io_client の購読 callback が壊れ、以降のイベントを一切受け取れなくなる。
  T? _decode<T>(
    Object? data,
    T? Function(Map<String, dynamic>) parse, {
    bool requireSchemaVersion = true,
  }) {
    try {
      if (data is! Map) return _malformed('not a map');

      final map = Map<String, dynamic>.from(data);

      if (requireSchemaVersion) {
        final version = map['schemaVersion'];
        if (version is! int) return _malformed('missing schemaVersion');
        if (version > supportedChatEventSchemaVersion) {
          debugPrint('[feed] 未対応の schemaVersion=$version のイベントを無視しました');
          return null;
        }
      }

      final parsed = parse(map);
      if (parsed == null) return _malformed('required field missing');
      return parsed;
    } catch (e) {
      return _malformed('$e');
    }
  }

  T? _malformed<T>(String reason) {
    malformedEventCount++;
    debugPrint('[feed] 不正なイベントを1件破棄しました: $reason');
    return null;
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
    _commentController.close();
    _giftController.close();
    _followController.close();
    _listenerController.close();
    _battleController.close();
    _connectedController.close();
    super.dispose();
  }
}
