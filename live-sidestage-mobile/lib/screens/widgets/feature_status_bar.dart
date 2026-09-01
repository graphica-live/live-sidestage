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
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: isDark ? 0.4 : 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // 機材のLEDらしく、ダークモードでは発光させる。ライトの筐体上では
              // 発光が目立ちすぎるため控えめ(shadowなし)にする。
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: color,
                  boxShadow: isDark
                      ? [BoxShadow(color: color.withValues(alpha: 0.7), blurRadius: 8, spreadRadius: 1)]
                      : const [],
                ),
              ),
              const SizedBox(width: 8),
              Text(status.label),
            ],
          ),
          if (noticeText != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: SelectableText(
                noticeText,
                style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ),
          for (final (label, message) in errors)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: SelectableText(
                '$label: $message',
                style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}

/// 保存済み設定が**このアプリより新しいバージョン**で作られていたときの警告。
///
/// このとき設定は一切保存できず、開始もできない
/// （[AppConfigStore.configFromFutureVersion]）。古いアプリで上書きすると、次の
/// サービス起動で孤児ファイルの掃除が走り、音源の実ファイルまで失われるため。
class ConfigTooNewBanner extends StatelessWidget {
  const ConfigTooNewBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final err = Theme.of(context).colorScheme.error;
    return Container(
      width: double.infinity,
      color: err.withValues(alpha: 0.12),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          Icon(
            Icons.warning_amber_rounded,
            size: 18,
            color: err,
            semanticLabel: '警告',
          ),
          const SizedBox(width: 8),
          Expanded(
            child: SelectableText(
              'このアプリより新しいバージョンで作られた設定です。'
              '設定を壊さないため、読み込みと変更を停止しています。アプリを更新してください。',
              style: TextStyle(fontSize: 12, color: err),
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
    this.blocked = false,
  });

  final bool started;
  final bool busy;
  final ValueChanged<bool> onToggle;

  /// 設定の状態そのものが開始を許さない（未来バージョンの設定を読んでいる）。
  /// [busy] と違い、待っても解消しない。
  final bool blocked;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          // busy は両タブ共通。片方の遷移中にもう片方を押させると、
          // 双方が「サービスは止まっている」と判断して二重に起動しうる。
          onPressed: busy || blocked ? null : () => onToggle(!started),
          style: FilledButton.styleFrom(
            backgroundColor: started ? Theme.of(context).colorScheme.error : null,
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
          icon: busy
              ? SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    // 開始ボタンはLEDグリーン背景でonPrimaryが暗色になるため、
                    // 白固定だとダークで背景に埋もれて見えなくなる。
                    color: started
                        ? Theme.of(context).colorScheme.onError
                        : Theme.of(context).colorScheme.onPrimary,
                  ),
                )
              : Icon(started ? Icons.stop : Icons.play_arrow),
          label: Text(started ? '停止' : '開始'),
        ),
      ),
    );
  }
}
