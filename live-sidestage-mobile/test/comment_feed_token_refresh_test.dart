import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/comment_feed.dart';
import 'package:live_sidestage_mobile/core/token_refresh_result.dart';

/// `handleConnectError` を直接叩いて `TOKEN_EXPIRED` の分岐を検証する。
///
/// **`connect()` は呼ばない**（実 socket を張るため単体テスト環境では使えない）。
/// 代わりに `onTokenExpired` を差し替え、`_tokenRefreshAttempted` 相当の歯止めと
/// バックオフ再試行の契機だけを確認する。
void main() {
  /// server.js の CONNECT_ERROR パケット形式 `{message, data}`。
  final tokenExpiredErr = {'message': 'unauthorized', 'data': 'TOKEN_EXPIRED'};

  test('一時的失敗(通信断・5xx)では TOKEN_EXPIRED 文言を出さず、バックオフ後に再試行する', () {
    fakeAsync((async) {
      final feed = CommentFeed();
      var refreshCalls = 0;
      feed.onTokenExpired = () async {
        refreshCalls++;
        return const TokenRefreshFailed('サーバーに接続できませんでした');
      };

      feed.handleConnectError(tokenExpiredErr);
      async.flushMicrotasks();

      expect(refreshCalls, 1);
      expect(feed.status, SocketStatus.error);
      expect(feed.errorMessage, isNot(contains('ログインの有効期限')));

      // 初回バックオフ(5秒)より前には再試行しない。
      async.elapse(const Duration(seconds: 4));
      expect(refreshCalls, 1);

      // 5秒経過で再試行する。
      async.elapse(const Duration(seconds: 2));
      async.flushMicrotasks();
      expect(refreshCalls, 2);

      feed.dispose();
    });
  });

  test('refresh token 失効(TokenRefreshRejected)は TOKEN_EXPIRED 文言のまま、再試行しない', () {
    fakeAsync((async) {
      final feed = CommentFeed();
      var refreshCalls = 0;
      feed.onTokenExpired = () async {
        refreshCalls++;
        return const TokenRefreshRejected('失効');
      };

      feed.handleConnectError(tokenExpiredErr);
      async.flushMicrotasks();

      expect(refreshCalls, 1);
      expect(feed.status, SocketStatus.error);
      expect(feed.errorMessage, contains('ログインの有効期限が切れています'));

      // 恒久失効なのでタイマーは仕込まれない。十分待っても再試行しない。
      async.elapse(const Duration(seconds: 120));
      expect(refreshCalls, 1);

      feed.dispose();
    });
  });

  test('再発行が進行中の connect_error では文言を出さず connecting のまま待つ', () {
    fakeAsync((async) {
      final feed = CommentFeed();
      var refreshCalls = 0;
      feed.onTokenExpired = () async {
        refreshCalls++;
        // すぐには解決しない(in-flight中の2回目を観測するため)。
        await Future<void>.delayed(const Duration(seconds: 1));
        return const TokenRefreshFailed('timeout');
      };

      feed.handleConnectError(tokenExpiredErr);
      async.flushMicrotasks();
      expect(refreshCalls, 1);
      expect(feed.status, SocketStatus.connecting);

      // 同じ接続中に2回目の connect_error が来ても、文言を出さず connecting を維持する。
      feed.handleConnectError(tokenExpiredErr);
      async.flushMicrotasks();
      expect(refreshCalls, 1, reason: '進行中のrefreshを重複して呼ばない');
      expect(feed.status, SocketStatus.connecting);
      expect(feed.errorMessage, isNull);

      async.elapse(const Duration(seconds: 1));
      async.flushMicrotasks();

      feed.dispose();
    });
  });

  test('バックオフ待機中に再度 TOKEN_EXPIRED を受けても、タイマーを無視して即時refreshしない', () {
    fakeAsync((async) {
      final feed = CommentFeed();
      var refreshCalls = 0;
      feed.onTokenExpired = () async {
        refreshCalls++;
        return const TokenRefreshFailed('一時的');
      };

      feed.handleConnectError(tokenExpiredErr);
      async.flushMicrotasks();
      expect(refreshCalls, 1);

      // socket.io-client の自動再接続で、バックオフ待機中にもう一度
      // TOKEN_EXPIRED が届く(code-review finding是正の再発防止)。
      feed.handleConnectError(tokenExpiredErr);
      async.flushMicrotasks();
      expect(refreshCalls, 1, reason: 'バックオフタイマーを無視して即時refreshしてはいけない');

      // 初回バックオフ(5秒)が過ぎたら、タイマー経由で1回だけ再試行する。
      async.elapse(const Duration(seconds: 5));
      async.flushMicrotasks();
      expect(refreshCalls, 2);

      feed.dispose();
    });
  });

  test('disconnect すると再試行タイマーが止まる', () {
    fakeAsync((async) {
      final feed = CommentFeed();
      var refreshCalls = 0;
      feed.onTokenExpired = () async {
        refreshCalls++;
        return const TokenRefreshFailed('一時的');
      };

      feed.handleConnectError(tokenExpiredErr);
      async.flushMicrotasks();
      expect(refreshCalls, 1);

      feed.disconnect();

      // タイマーが止まっているので、5秒を過ぎても再試行は起きない。
      async.elapse(const Duration(seconds: 10));
      expect(refreshCalls, 1);

      feed.dispose();
    });
  });
}
