import 'package:flutter/material.dart';

import '../../core/feature_status.dart';

/// タブごとの状態バー。エラーは**ラベル付きで全部並べる**。
///
/// 1本に合成（`a ?? b ?? c`）すると後続が隠れる。この画面のエラー表示は
/// 「ユーザーがスクリーンショットを撮って問い合わせに使う」ためのものなので、
/// 出せる情報を落とさない。同じ理由で ellipsis せず折り返し、選択もできるようにする。
class FeatureStatusBar extends StatelessWidget {
  const FeatureStatusBar({
    super.key,
    required this.status,
    this.errors = const [],
    this.notice,
  });

  final FeatureStatus status;

  /// `('接続', 'サーバーに繋がりません')` のような (ラベル, 本文) の並び。
  /// **アプリ側で起きているエラー**だけを入れる（この有無が「エラー」状態を決める）。
  final List<(String, String)> errors;

  /// TikTok 側の事情。レート制限や再接続待ちなど、**こちらの不具合ではない**もの。
  ///
  /// エラー（赤）にはしない。配信者から見ると「配信開始待ち」の理由でしかなく、
  /// 赤くすると自分のアプリが壊れていると誤解する。
  final String? notice;

  @override
  Widget build(BuildContext context) {
    final color = status.color;
    final noticeText = notice;

    return Container(
      width: double.infinity,
      color: color.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.circle, size: 10, color: color),
              const SizedBox(width: 8),
              Text(status.label),
            ],
          ),
          if (noticeText != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: SelectableText(
                noticeText,
                style: const TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ),
          for (final (label, message) in errors)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: SelectableText(
                '$label: $message',
                style: const TextStyle(color: Colors.red, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}

/// タブごとの開始/停止ボタン。押すとその機能の有効状態が変わり、
/// TikTok への接続は「読み上げ・効果音のどちらかが有効か」から導出される。
class FeatureStartButton extends StatelessWidget {
  const FeatureStartButton({
    super.key,
    required this.started,
    required this.busy,
    required this.onToggle,
  });

  final bool started;
  final bool busy;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          // busy は両タブ共通。片方の遷移中にもう片方を押させると、
          // 双方が「サービスは止まっている」と判断して二重に起動しうる。
          onPressed: busy ? null : () => onToggle(!started),
          style: FilledButton.styleFrom(
            backgroundColor: started ? Colors.red : null,
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
          icon: busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              : Icon(started ? Icons.stop : Icons.play_arrow),
          label: Text(started ? '停止' : '開始'),
        ),
      ),
    );
  }
}
