import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../models/battle_event.dart';
import '../models/comment.dart';
import '../models/follow_event.dart';
import '../models/gift_event.dart';
import '../models/listener_status.dart';
import 'api_client.dart' show liveAnalyticsBaseUrl;
import 'token_refresh_result.dart';

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

/// 新規sync機能(ランキング・ギフト履歴・バトル履歴)のschemaVersion定数。
/// 既存のsupportedChatEventSchemaVersionと独立している。
/// 将来的にいずれかの機能だけスキーマを上げたい場合に他を巻き込まないため。
const int supportedRankingSchemaVersion = 1;
const int supportedGiftHistorySchemaVersion = 1;
const int supportedBattleHistorySchemaVersion = 1;

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

  /// 新規sync機能: 貢献ランキングのsnapshotイベント。
  final StreamController<Map<String, dynamic>> _rankingSnapshotController =
      StreamController<Map<String, dynamic>>.broadcast();

  /// 新規sync機能: ギフト履歴のappendイベント。
  final StreamController<Map<String, dynamic>> _giftHistoryAppendController =
      StreamController<Map<String, dynamic>>.broadcast();

  /// 新規sync機能: バトル履歴のupsertイベント。
  final StreamController<Map<String, dynamic>> _battleHistoryUpsertController =
      StreamController<Map<String, dynamic>>.broadcast();

  Stream<Comment> get onComment => _commentController.stream;
  Stream<GiftEvent> get onGift => _giftController.stream;
  Stream<FollowEvent> get onFollow => _followController.stream;
  Stream<ListenerStatus> get onListener => _listenerController.stream;
  Stream<BattleEvent> get onBattle => _battleController.stream;

  /// 貢献ランキングのsnapshot受信。ペイロードは呼び出し側でパースする。
  Stream<Map<String, dynamic>> get onRankingSnapshot => _rankingSnapshotController.stream;

  /// ギフト履歴のappend受信。ペイロードは呼び出し側でパースする。
  Stream<Map<String, dynamic>> get onGiftHistoryAppend => _giftHistoryAppendController.stream;

  /// バトル履歴のupsert受信。ペイロードは呼び出し側でパースする。
  Stream<Map<String, dynamic>> get onBattleHistoryUpsert => _battleHistoryUpsertController.stream;

  /// socket が繋がった（張り直した）タイミング。
  ///
  /// 接続直後は listener の現在値を持っていない。サーバーは接続時にスナップショットを
  /// 送らない（状態変化のときだけ push する）ので、**繋がったら端末側から取りに行く**。
  final StreamController<void> _connectedController = StreamController<void>.broadcast();

  Stream<void> get onConnected => _connectedController.stream;

  /// access token が失効していた（サーバーが `TOKEN_EXPIRED` を返した）ときに
  /// 新しい access token を取り直す手続き。結果は [TokenRefreshResult] で返す
  /// （`null` には潰さない — 恒久失効(再ログイン要)と一時的失敗(再試行可)を
  /// 呼び出し側で区別するため）。
  ///
  /// **コンストラクタ引数ではなく public な mutable フィールド。** [CommentFeed] は
  /// メイン/背景の両 Isolate から引数なしで生成されており、生成箇所ごとに再発行の
  /// 手段が違う（メインは [SessionController]、背景は自前の HTTP POST）ため、
  /// `connect()` の前に呼び出し側が代入する形にしてある。
  Future<TokenRefreshResult> Function()? onTokenExpired;

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

  /// 直近に [connect] へ渡された token。**前回と異なる token が渡されたら
  /// [_tokenRefreshAttempted] を解除する**（新しい token には新しい試行予算を
  /// 与える）。`lifecycle resumed` 等で同じ token のまま再 connect された場合は
  /// 解除しない（無限ループ防止を維持）。
  String? _lastConnectToken;

  /// [connect] / [disconnect] / [dispose] のたびに進む世代。進行中の再発行
  /// （[_refreshAndReconnect]）が完了したとき、この値が変わっていれば
  /// 「別の接続へ切り替わった後」なので結果を捨てる（古い token で connect する
  /// 競合を防ぐ）。
  int _connectGeneration = 0;

  /// 一時的失敗(通信断・5xx)後の再試行タイマー。恒久失効や接続成功で cancel する。
  Timer? _retryTimer;

  static const Duration _initialRetryDelay = Duration(seconds: 5);
  static const Duration _maxRetryDelay = Duration(seconds: 60);

  /// 次に一時的失敗したときの再試行までの待ち時間。指数バックオフで伸び、
  /// 接続成功時に初期値へ戻る。
  Duration _retryDelay = _initialRetryDelay;

  void connect(String token) {
    // 外部(SessionController等)から新しい token で呼ばれた場合は新しい
    // 試行予算を与える。同じ token の再 connect（lifecycle resumed 等）では
    // 歯止めを解除しない。**refresh成功後の再接続([_refreshAndReconnect])は
    // ここで一旦リセットされるが、呼び出し元が直後に明示的に立て直す**
    // （サーバーが取り直した token も拒否し続ける異常時の無限ループ防止）。
    if (token != _lastConnectToken) {
      _tokenRefreshAttempted = false;
    }
    _lastConnectToken = token;

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
      // 接続できたのでバックオフを初期値へ戻す。
      _retryDelay = _initialRetryDelay;
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

    socket.on('chat:ranking:snapshot', (data) {
      // schemaVersionは機能ごとに独立した検証。既存イベント(chat:gift等)と
      // 別の定数を使い、将来的な互換性を維持する。
      final envelope = _decodeRealtime(
        data,
        supportedRankingSchemaVersion,
        'ranking snapshot',
      );
      if (envelope != null) _rankingSnapshotController.add(envelope);
    });

    socket.on('chat:gift-history:append', (data) {
      final envelope = _decodeRealtime(
        data,
        supportedGiftHistorySchemaVersion,
        'gift-history append',
      );
      if (envelope != null) _giftHistoryAppendController.add(envelope);
    });

    socket.on('chat:battle-history:upsert', (data) {
      final envelope = _decodeRealtime(
        data,
        supportedBattleHistorySchemaVersion,
        'battle-history upsert',
      );
      if (envelope != null) _battleHistoryUpsertController.add(envelope);
    });

    socket.onDisconnect((_) {
      status = SocketStatus.disconnected;
      notifyListeners();
    });

    // handleConnectError は socket.io-client の自動再接続からも呼ばれうる。
    // disconnect()/dispose() 後に登録解除前のイベントが配送されても、登録時の
    // 世代と現在の世代が変わっていれば無視する(古い socket からの遅延イベント対策)。
    final registeredGeneration = _connectGeneration;
    socket.onConnectError((err) {
      if (_connectGeneration != registeredGeneration) return;
      handleConnectError(err);
    });

    socket.onError((err) {
      status = SocketStatus.error;
      errorMessage = _describeSocketError(err, 'エラー');
      notifyListeners();
    });

    _socket = socket;
    socket.connect();
  }

  /// `connect_error` パケットの処理本体。テストから直接叩けるように
  /// `socket.onConnectError` から分離してある。
  @visibleForTesting
  void handleConnectError(dynamic err) {
    final code = _socketErrorCode(err);

    // TikTok 未連携。リトライで解消しないので、購読側に後始末を任せる。
    if (code == 'STREAMER_NOT_REGISTERED') {
      status = SocketStatus.error;
      errorMessage = _describeSocketError(err, '接続エラー');
      notifyListeners();
      onStreamerNotRegistered?.call();
      return;
    }

    final refresh = onTokenExpired;
    if (code == 'TOKEN_EXPIRED' && refresh != null) {
      if (_tokenRefreshInFlight || (_retryTimer?.isActive ?? false)) {
        // 既に再発行が進行中、またはバックオフ待機中。
        // socket.io-client は自動再接続するため、待機中にも connect_error が
        // 届きうる。ここで即時refreshすると指数バックオフが無意味になるので、
        // 結果/タイマー発火に任せて connecting のまま待つ
        // （ここでエラー文言を出すと、成功するはずの再試行の直前で
        // 一瞬 TOKEN_EXPIRED が見えてしまう）。
        status = SocketStatus.connecting;
        errorMessage = null;
        notifyListeners();
        return;
      }
      if (!_tokenRefreshAttempted) {
        // access token の失効。**まず無言で取り直す。** 取り直せなかったときだけ
        // エラーとして見せる(_refreshAndReconnect の中)。
        _tokenRefreshAttempted = true;
        status = SocketStatus.connecting;
        errorMessage = null;
        notifyListeners();
        unawaited(_refreshAndReconnect(refresh));
        return;
      }
      // 取り直した token でもまた TOKEN_EXPIRED。無限ループ防止のため、
      // 下の通常のエラー表示(TOKEN_EXPIRED 文言)へ落ちる。
    }

    status = SocketStatus.error;
    errorMessage = _describeSocketError(err, '接続エラー');
    notifyListeners();
  }

  /// `TOKEN_EXPIRED` を受けて access token を取り直し、新しい token で張り直す。
  ///
  /// `withTokenRefresh`（HTTP 側）と同じ「失効 → 再発行 → 1回だけ再試行」の形。
  /// **結果の種別で分岐する**（[TokenRefreshResult] 参照）――
  /// 恒久失効(再ログイン要)だけをエラーとして見せ、一時的失敗(通信断・5xx)は
  /// バックオフ付きで再試行する（ここで一律に諦めると、一時的な失敗でも
  /// 「ログインの有効期限が切れています」と誤表示してしまう）。
  Future<void> _refreshAndReconnect(Future<TokenRefreshResult> Function() refresh) async {
    if (_tokenRefreshInFlight) return;
    _tokenRefreshInFlight = true;
    // この再発行がどの接続世代で始まったかを覚えておく。完了時に世代が
    // 進んでいたら（別の connect/disconnect が割り込んだ）結果は捨てる。
    final generation = _connectGeneration;
    try {
      final TokenRefreshResult result;
      try {
        result = await refresh();
      } catch (e) {
        if (generation == _connectGeneration) {
          _scheduleRetry(error: e);
        }
        return;
      }
      if (generation != _connectGeneration) return;

      switch (result) {
        case TokenRefreshed(token: final token):
          // 取り直した新token は _lastConnectToken と異なるので、connect() 内部の
          // 歯止めリセットが働いてしまう。**それを直後に打ち消す** ——
          // 打ち消さないと、サーバーが取り直した token も TOKEN_EXPIRED で
          // 拒否し続ける異常時に無限ループ(refresh乱発)になる。
          connect(token);
          _tokenRefreshAttempted = true;
        case TokenRefreshRejected():
          // refresh token 自体が失効。再試行しても直らないので、再ログインを
          // 促す文言のまま止める。
          status = SocketStatus.error;
          errorMessage = _socketErrorMessages['TOKEN_EXPIRED'];
          notifyListeners();
        case TokenRefreshFailed():
          // 通信断・5xx等の一時的失敗。再ログイン扱いにせず、バックオフ付きで
          // 再試行する。
          _scheduleRetry();
      }
    } finally {
      _tokenRefreshInFlight = false;
    }
  }

  /// 一時的失敗のあと、バックオフ付きで再発行を再試行する。
  void _scheduleRetry({Object? error}) {
    // ここで歯止め(_tokenRefreshAttempted)を解除しない。解除すると、バックオフ
    // 待機中に socket.io-client の自動再接続が連続で TOKEN_EXPIRED を投げた
    // 場合、handleConnectError がタイマーを無視して即時 refresh してしまう
    // （待機中は上の `_retryTimer?.isActive` チェックで抑止している。解除は
    // タイマー発火時にのみ行う）。
    status = SocketStatus.error;
    errorMessage = error == null
        ? 'サーバーに接続できません。通信状態を確認して再接続しています。'
        : '認証の更新に失敗しました。再接続しています: $error';
    notifyListeners();

    final generation = _connectGeneration;
    final delay = _retryDelay;
    final next = _retryDelay * 2;
    _retryDelay = next > _maxRetryDelay ? _maxRetryDelay : next;

    _retryTimer?.cancel();
    _retryTimer = Timer(delay, () {
      if (generation != _connectGeneration) return;
      final refresh = onTokenExpired;
      if (refresh == null) return;
      status = SocketStatus.connecting;
      errorMessage = null;
      notifyListeners();
      _tokenRefreshAttempted = true;
      unawaited(_refreshAndReconnect(refresh));
    });
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

  /// 新規sync機能(ランキング・ギフト履歴・バトル履歴)用のdecode。
  ///
  /// 既存の_decodeと同様の構造だが、schemaVersion定数を引数で指定できる。
  /// これにより機能ごとに独立したバージョン管理が可能。
  Map<String, dynamic>? _decodeRealtime(
    Object? data,
    int supportedSchemaVersion,
    String eventKind,
  ) {
    try {
      if (data is! Map) return _malformed('$eventKind: not a map');

      final map = Map<String, dynamic>.from(data);

      final version = map['schemaVersion'];
      if (version is! int) return _malformed('$eventKind: missing schemaVersion');
      if (version > supportedSchemaVersion) {
        debugPrint('[feed] 未対応の schemaVersion=$version の$eventKindイベントを無視しました');
        return null;
      }

      return map;
    } catch (e) {
      return _malformed('$eventKind: $e');
    }
  }

  T? _malformed<T>(String reason) {
    malformedEventCount++;
    debugPrint('[feed] 不正なイベントを1件破棄しました: $reason');
    return null;
  }

  void disconnect() {
    // 進行中の再発行が完了したときに古い接続へ結果を適用しないよう世代を進め、
    // 一時失敗の再試行タイマーも止める。
    _connectGeneration++;
    _retryTimer?.cancel();
    _retryTimer = null;
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
    _rankingSnapshotController.close();
    _giftHistoryAppendController.close();
    _battleHistoryUpsertController.close();
    super.dispose();
  }
}
