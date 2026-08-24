import 'package:flutter/material.dart';

import 'comment_feed.dart' show SocketStatus;

/// TTS / 効果音それぞれのタブに出すステータス。
///
/// 「開始済み」= `enabled && serviceRunning`。設定値だけで判断しないのは、
/// [AppConfig] の既定値が両方 true で、サービスを止めても false に戻らないため。
/// アプリ起動時にサービスが動いていなければ両フラグを false へ正規化する
/// （home_screen.dart の `_syncRunningStatus`）ので、この2つは常に一致する。
enum FeatureStatus {
  /// この機能が無効、またはサービスが動いていない。
  stopped,

  /// サービスは動いているが、LIVE Sidestage Analytics へまだ繋がっていない。
  connecting,

  /// サーバーには繋がっているが、TikTok 側の配信がまだ始まっていない。
  waitingForLive,

  /// TikTok の配信に接続できている。
  live,

  /// 接続・読み上げ・効果音・TikTok接続 のいずれかがエラー。
  error,
}

/// 判定順に意味がある。
///
/// - 停止中が最優先。止まっている機能に接続状態を出しても意味がない
/// - エラーは接続状態より優先する。繋がっていても鳴っていなければ用を成さない
/// - `live` かどうかは socket が繋がって初めて意味を持つ（サーバー由来の情報なので）
FeatureStatus resolveFeatureStatus({
  required bool enabled,
  required bool serviceRunning,
  required SocketStatus socket,
  required bool live,
  required bool hasError,
}) {
  if (!enabled || !serviceRunning) return FeatureStatus.stopped;
  if (hasError) return FeatureStatus.error;
  if (socket != SocketStatus.connected) return FeatureStatus.connecting;
  return live ? FeatureStatus.live : FeatureStatus.waitingForLive;
}

extension FeatureStatusDisplay on FeatureStatus {
  String get label {
    switch (this) {
      case FeatureStatus.stopped:
        return '停止中';
      case FeatureStatus.connecting:
        return '接続中';
      case FeatureStatus.waitingForLive:
        return '配信開始待ち';
      case FeatureStatus.live:
        return '配信中';
      case FeatureStatus.error:
        return 'エラー';
    }
  }

  Color get color {
    switch (this) {
      case FeatureStatus.stopped:
        return Colors.grey;
      // 接続中と配信開始待ちは同じオレンジ。どちらも「まだ本番ではないが動いている」
      // 段階で、ユーザーが取るべき行動も同じ（待つ）。
      case FeatureStatus.connecting:
      case FeatureStatus.waitingForLive:
        return Colors.orange;
      case FeatureStatus.live:
        return Colors.green;
      case FeatureStatus.error:
        return Colors.red;
    }
  }
}
