import 'package:flutter/material.dart';

import '../../core/feature_status.dart';
import 'gradient_kit.dart';

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

    // 光彩(comp `.status.deco`): 白カード + 状態色のドット + 右上の装飾グラデーション円。
    // **地の色は状態色にしない。** 状態伝達はドットが担い(Signal-Only Color Rule)、
    // 面は他のカードと同じ card 色で揃える(`_kosai-tokens.md`)。
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
      decoration: BoxDecoration(
        color: kosaiCardColor(context),
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(color: Color(0x599B6BFF), blurRadius: 16, offset: Offset(0, 6), spreadRadius: -12),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: Stack(
          children: [
            Positioned(
              right: -14,
              top: -18,
              child: Opacity(
                opacity: 0.14,
                child: Container(
                  width: 60,
                  height: 60,
                  decoration: const BoxDecoration(gradient: KosaiPalette.border, shape: BoxShape.circle),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(shape: BoxShape.circle, color: color),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          status.label,
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                      ),
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
            ),
          ],
        ),
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
    this.labelPrefix,
  });

  final bool started;
  final bool busy;
  final ValueChanged<bool> onToggle;

  /// 設定の状態そのものが開始を許さない（未来バージョンの設定を読んでいる）。
  /// [busy] と違い、待っても解消しない。
  final bool blocked;

  /// ボタンに出す文言。サウンドタブは「効果音を開始/停止」のように機能名を含める。
  final String? labelPrefix;

  @override
  Widget build(BuildContext context) {
    final prefix = labelPrefix ?? '';
    // 光彩(comp `.btn-primary-grad`): 全幅グラデーションpill + glow影。
    // 開始中(=停止ボタン)だけは状態伝達のため error 単色にする。
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
      child: KosaiPrimaryButton(
        label: started ? '$prefix停止' : '$prefix開始',
        icon: started ? Icons.stop : Icons.play_arrow,
        busy: busy,
        color: started ? Theme.of(context).colorScheme.error : null,
        // busy は両タブ共通。片方の遷移中にもう片方を押させると、
        // 双方が「サービスは止まっている」と判断して二重に起動しうる。
        onPressed: busy || blocked ? null : () => onToggle(!started),
      ),
    );
  }
}
