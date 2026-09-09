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

/// サーバー(server.js の io.use())が unauthorized 系エラーに付与する `err.data` の値。
/// 未知のcodeは無視し、サーバーから届いた message をそのまま表示する(下位互換)。
const Map<String, String> _socketErrorMessages = {
  'INVALID_TOKEN': 'アカウントの認証に失敗しました。ログインし直してください。',
  // 通常は [CommentFeed.onTokenExpired] で無言に取り直すので表示されない。
  // 再発行に失敗したときだけユーザーの目に触れる。
  'TOKEN_EXPIRED': 'ログインの有効期限が切れています。ログインし直してください。',
  'STREAMER_NOT_REGISTERED': 'TikTokアカウントの連携が完了していません。',
  'INVALID_OVERLAY_TOKEN': 'オーバーレイの認証に失敗しました。',
  'MISSING_CREDENTIALS': 'アカウントの認証情報が見つかりません。ログインし直してください。',
};

/// server.js の CONNECT_ERROR パケット `{message, data}` から `data`（エラーコード）を取り出す。
String? _socketErrorCode(dynamic err) {
  if (err is! Map) return null;
  final code = err['data'];
  return code is String ? code : null;
}

/// socket.io の connect_error / error に載る値から表示メッセージを組み立てる。
///
/// server.js の CONNECT_ERROR パケットは `{message, data}` 形式(socket.io-clientの
/// protocol 4/5)。data に既知のcodeがあれば日本語文言に差し替え、無ければ従来どおり
/// message(またはerr自体)を透過表示する。
String _describeSocketError(dynamic err, String fallbackPrefix) {
  if (err is Map) {
    final code = _socketErrorCode(err);
    if (code != null) {
      final known = _socketErrorMessages[code];
      if (known != null) return known;
    }
    final message = err['message'];
    if (message != null) return '$fallbackPrefix: $message';
  }
  return '$fallbackPrefix: $err';
}

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

  /// access token が失効していた（サーバーが `TOKEN_EXPIRED` を返した）ときに
  /// 新しい access token を取り直す手続き。取り直せなければ null を返す。
  ///
  /// **コンストラクタ引数ではなく public な mutable フィールド。** [CommentFeed] は
  /// メイン/背景の両 Isolate から引数なしで生成されており、生成箇所ごとに再発行の
  /// 手段が違う（メインは [SessionController]、背景は自前の HTTP POST）ため、
  /// `connect()` の前に呼び出し側が代入する形にしてある。
  Future<String?> Function()? onTokenExpired;

  /// サーバーが `STREAMER_NOT_REGISTERED`（TikTok 未連携）を返したとき。
  /// **リトライしても解消しない**ので、購読側は再接続を止めて導線を出すこと。
  void Function()? onStreamerNotRegistered;

  /// このソケット接続（＝直近の接続成功以降）で既に1回 token を取り直したか。
  /// 取り直した直後の token でまた `TOKEN_EXPIRED` になった場合に、
  /// 再発行と再接続を無限に繰り返さないための歯止め。接続に成功したら解除する。
  bool _tokenRefreshAttempted = false;

  /// 再発行が進行中。socket.io は再接続のたびに `connect_error` を投げるので、
  /// これが無いと1回の失効で再発行が何本も走る。
  bool _tokenRefreshInFlight = false;

  void connect(String token) {
    disconnect();

    status = SocketStatus.connecting;
    errorMessage = null;
    notifyListeners();

    final socket = io.io(
      liveAnalyticsBaseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          // socket.io v4 標準の `auth` ハンドシェイクペイロード。
          // **`query` には載せない** — `query.token` はオーバーレイ認証が使用中で、
          // サーバー側(server.js の io.use())で分岐が衝突する。
          .setAuth({'token': token})
          .disableAutoConnect()
          .build(),
    );

    socket.onConnect((_) {
      status = SocketStatus.connected;
      errorMessage = null;
      // 繋がった時点で「この token は有効」。次に失効したときのために歯止めを解除する。
      _tokenRefreshAttempted = false;
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
      final code = _socketErrorCode(err);

      // TikTok 未連携。リトライで解消しないので、購読側に後始末を任せる。
      if (code == 'STREAMER_NOT_REGISTERED') {
        status = SocketStatus.error;
        errorMessage = _describeSocketError(err, '接続エラー');
        notifyListeners();
        onStreamerNotRegistered?.call();
        return;
      }

      // access token の失効。**まず無言で取り直す。** 取り直せなかったときだけ
      // エラーとして見せる(_refreshAndReconnect の中)。
      final refresh = onTokenExpired;
      if (code == 'TOKEN_EXPIRED' && refresh != null && !_tokenRefreshAttempted) {
        _tokenRefreshAttempted = true;
        status = SocketStatus.connecting;
        errorMessage = null;
        notifyListeners();
        unawaited(_refreshAndReconnect(refresh));
        return;
      }

      status = SocketStatus.error;
      errorMessage = _describeSocketError(err, '接続エラー');
      notifyListeners();
    });

    socket.onError((err) {
      status = SocketStatus.error;
      errorMessage = _describeSocketError(err, 'エラー');
      notifyListeners();
    });

    _socket = socket;
    socket.connect();
  }

  /// `TOKEN_EXPIRED` を受けて access token を取り直し、新しい token で張り直す。
  ///
  /// `withTokenRefresh`（HTTP 側）と同じ「失効 → 再発行 → 1回だけ再試行」の形。
  /// 再発行できなければ、その事実をエラーとして見せる（無言で繋がらないままにしない）。
  Future<void> _refreshAndReconnect(Future<String?> Function() refresh) async {
    if (_tokenRefreshInFlight) return;
    _tokenRefreshInFlight = true;
    try {
      final token = await refresh();
      if (token == null) {
        status = SocketStatus.error;
        errorMessage = _socketErrorMessages['TOKEN_EXPIRED'];
        notifyListeners();
        return;
      }
      // connect() は歯止め(_tokenRefreshAttempted)を落とさない。落とすと、
      // 取り直した token でまた失効扱いされたときに無限ループになる。
      connect(token);
    } catch (e) {
      status = SocketStatus.error;
      errorMessage = '認証の更新に失敗しました: $e';
      notifyListeners();
    } finally {
      _tokenRefreshInFlight = false;
    }
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
