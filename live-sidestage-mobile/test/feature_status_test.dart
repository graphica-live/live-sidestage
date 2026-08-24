import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/comment_feed.dart' show SocketStatus;
import 'package:live_sidestage_mobile/core/feature_status.dart';

FeatureStatus resolve({
  bool enabled = true,
  bool serviceRunning = true,
  SocketStatus socket = SocketStatus.connected,
  bool live = false,
  bool hasError = false,
}) {
  return resolveFeatureStatus(
    enabled: enabled,
    serviceRunning: serviceRunning,
    socket: socket,
    live: live,
    hasError: hasError,
  );
}

void main() {
  group('resolveFeatureStatus', () {
    test('機能が無効なら停止中', () {
      expect(resolve(enabled: false), FeatureStatus.stopped);
    });

    test('サービスが動いていなければ、機能が有効でも停止中', () {
      expect(resolve(serviceRunning: false), FeatureStatus.stopped);
    });

    // 「開始済み」= enabled && serviceRunning。アプリ起動直後は保存値が両方 true でも
    // サービスは止まっているので、必ず停止中から始まる。
    test('停止中はエラーや接続状態より優先する', () {
      expect(
        resolve(enabled: false, hasError: true, socket: SocketStatus.error),
        FeatureStatus.stopped,
      );
      expect(
        resolve(serviceRunning: false, hasError: true, live: true),
        FeatureStatus.stopped,
      );
    });

    test('エラーは接続状態より優先する', () {
      expect(resolve(hasError: true), FeatureStatus.error);
      expect(resolve(hasError: true, live: true), FeatureStatus.error);
      expect(
        resolve(hasError: true, socket: SocketStatus.connecting),
        FeatureStatus.error,
      );
    });

    test('socketが繋がっていなければ接続中', () {
      expect(resolve(socket: SocketStatus.connecting), FeatureStatus.connecting);
      expect(resolve(socket: SocketStatus.disconnected), FeatureStatus.connecting);
      // socket が error でも hasError が立っていなければ接続中どまり。
      // エラー本文の有無で判定を分ける（表示するものが無いのに「エラー」と出さない）。
      expect(resolve(socket: SocketStatus.error), FeatureStatus.connecting);
    });

    test('socket接続済みでTikTok未配信なら配信開始待ち', () {
      expect(resolve(live: false), FeatureStatus.waitingForLive);
    });

    test('socket接続済みでTikTok配信中なら配信中', () {
      expect(resolve(live: true), FeatureStatus.live);
    });

    // liveはサーバー由来の情報なので、socketが繋がる前は信用しない。
    test('socket未接続のときはliveでも配信中にしない', () {
      expect(
        resolve(live: true, socket: SocketStatus.connecting),
        FeatureStatus.connecting,
      );
    });
  });

  group('FeatureStatusDisplay', () {
    test('ラベルは5状態ぶん揃っている', () {
      expect(FeatureStatus.stopped.label, '停止中');
      expect(FeatureStatus.connecting.label, '接続中');
      expect(FeatureStatus.waitingForLive.label, '配信開始待ち');
      expect(FeatureStatus.live.label, '配信中');
      expect(FeatureStatus.error.label, 'エラー');
    });

    test('接続中と配信開始待ちは同じオレンジ', () {
      expect(FeatureStatus.connecting.color, FeatureStatus.waitingForLive.color);
      expect(FeatureStatus.connecting.color, Colors.orange);
    });

    test('停止中はグレー、配信中はグリーン、エラーはレッド', () {
      expect(FeatureStatus.stopped.color, Colors.grey);
      expect(FeatureStatus.live.color, Colors.green);
      expect(FeatureStatus.error.color, Colors.red);
    });
  });
}
