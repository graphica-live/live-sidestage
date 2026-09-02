import 'dart:async';

import 'package:flutter/material.dart';

import '../screens/subscription_screen.dart';

const Duration _upgradeNoticeDuration = Duration(seconds: 3);
const Duration _lockedNoticeDuration = Duration(seconds: 2);

Timer? _timedSnackBarTimer;

/// **`SnackBar.duration`任せにしない。** 実機検証(Pixel 7a, Impeller/Vulkan)で、
/// `SnackBar`の自動非表示は内部でvsyncベースの`AnimationController`を使っており、
/// 表示直後に画面が完全に静止する設定画面のようなケースでは新しいフレームが
/// スケジュールされず`duration`が過ぎても消えない実機挙動を確認した。`Timer`
/// (vsyncに依存しないwall-clockタイマー)で`removeCurrentSnackBar()`
/// (アニメーション無しの即時除去)を明示的に呼ぶ。表示中に別の案内が
/// 出た場合に備えてタイマー自体もキャンセルする。
void _showTimedSnackBar(BuildContext context, SnackBar snackBar, Duration duration) {
  final messenger = ScaffoldMessenger.of(context);
  _timedSnackBarTimer?.cancel();
  messenger.hideCurrentSnackBar();
  messenger.showSnackBar(snackBar);
  _timedSnackBarTimer = Timer(duration, messenger.removeCurrentSnackBar);
}

/// ロックされた機能をタップしたときの案内。常時表示にはせず、一定時間で自動的に消す
/// (以前は画面ごとに常時表示の警告行を持っていたが、消えないとの指摘を受けてタップ時表示に変更)。
void showUpgradeRequiredNotice(BuildContext context, String message) {
  _showTimedSnackBar(
    context,
    SnackBar(
      content: Text(message),
      duration: _upgradeNoticeDuration,
      action: SnackBarAction(
        label: 'アップグレード',
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => const SubscriptionScreen()),
        ),
      ),
    ),
    _upgradeNoticeDuration,
  );
}

/// アップグレード導線を伴わない、一時的な案内(例: 運用中は変更できない旨)。
void showTimedNotice(BuildContext context, String message) {
  _showTimedSnackBar(
    context,
    SnackBar(content: Text(message), duration: _lockedNoticeDuration),
    _lockedNoticeDuration,
  );
}
