import 'package:flutter/material.dart';

import '../../core/analytics_period.dart';
import '../../core/upgrade_notice.dart';
import 'gradient_kit.dart';

/// 貢献/ギフト履歴/バトル履歴タブ共通の期間選択バー(日/週/月/年/カスタム + ◀/▶)。
///
/// 描画は光彩(Kosai)のchip row(`.impeccable/approved/_kosai-tokens.md` §5)。
/// **API・状態遷移ロジックは光彩化前(SegmentedButton時代)から変えていない。**
/// `SegmentedButton`ではpill形+選択中グラデーションを再現できないため描画だけ差し替えた。
class PeriodSelectorBar extends StatelessWidget {
  const PeriodSelectorBar({
    super.key,
    required this.selection,
    required this.rangeLabel,
    required this.onChanged,
    this.enabled = true,
    this.customRangeActive = false,
    this.filterActive = false,
    this.onOpenCustomRangeFilter,
    this.onShiftCustomRange,
    this.extendedRangeAllowed = true,
  });

  final AnalyticsPeriodSelection selection;

  /// 画面に出す期間ラベル。サーバーが返した dateRange から呼び出し側が組み立てる
  /// (JST日付とend-inclusive/exclusiveの扱いがエンドポイントごとに違うため、
  /// このウィジェット自身では計算しない)。
  final String rangeLabel;

  final ValueChanged<AnalyticsPeriodSelection> onChanged;

  /// 読み込み中は連打によるリクエストの取り違えを避けるため操作を止める。
  final bool enabled;

  /// 開始・終了日時による詳細フィルタ(カスタム範囲)が適用中かどうか。true の間は
  /// サーバーへ送るのがcustom rangeかperiod/dateかを一意にするため、日/週/月の切替を
  /// 無効化する。◀/▶は[onShiftCustomRange]があれば無効化せず、そちらへ回す
  /// (でないと詳細フィルタ中に身動きが取れなくなり、解除方法もわかりにくいため)。
  /// 詳細フィルタボタン自体は(再度開いて調整・解除できるよう)常に有効のまま。
  final bool customRangeActive;

  /// 詳細フィルタ(日時範囲・リスナー名のいずれか)が適用中かどうか。アイコンの着色のみに使う。
  final bool filterActive;

  /// 詳細フィルタボタン押下時のコールバック。nullなら詳細フィルタボタン自体を出さない。
  final VoidCallback? onOpenCustomRangeFilter;

  /// [customRangeActive]中に◀/▶が押されたときのコールバック。引数`true`は▶(現在表示中の
  /// 終了日時の次の日へ)、`false`は◀(開始日時の前日へ)。呼び出し側はここで日時範囲フィルタを
  /// 解除して該当日の`day`選択へ切り替える(リスナー名フィルタは維持する)。nullなら
  /// [customRangeActive]中は◀/▶を無効化したままにする。
  final ValueChanged<bool>? onShiftCustomRange;

  /// FREEプランではmonth/yearを選べない(履歴の遡り期間制限)。選択自体は拒否せず、
  /// 押されたらアップグレード誘導を出す(§14と同じ「onPressedをnullにしない」方針)。
  final bool extendedRangeAllowed;

  bool _isExtendedPeriod(AnalyticsPeriod p) => p == AnalyticsPeriod.month || p == AnalyticsPeriod.year;

  @override
  Widget build(BuildContext context) {
    final periodControlsEnabled = enabled && !customRangeActive;
    final canShiftCustomRange = enabled && customRangeActive && onShiftCustomRange != null;
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 2, 16, 0),
          child: Row(
            children: [
              for (final p in AnalyticsPeriod.values) ...[
                KosaiChip(
                  label: p.label,
                  selected: !customRangeActive && selection.period == p,
                  locked: !extendedRangeAllowed && _isExtendedPeriod(p),
                  dimmed: !enabled,
                  // **押せなくしない。** 押されたら理由(ロック/カスタム適用中)を伝える。
                  onTap: !enabled
                      ? null
                      : () {
                          if (!extendedRangeAllowed && _isExtendedPeriod(p)) {
                            showUpgradeRequiredNotice(context, '月・年での表示はPRO/ULTRAプランで利用できます');
                            return;
                          }
                          if (!periodControlsEnabled) {
                            showTimedNotice(context, 'カスタム期間の適用中です。「カスタム」から解除してください');
                            return;
                          }
                          onChanged(selection.withPeriod(p));
                        },
                ),
                const SizedBox(width: 6),
              ],
              if (onOpenCustomRangeFilter != null)
                KosaiChip(
                  label: 'カスタム',
                  selected: filterActive,
                  dashed: true,
                  dimmed: !enabled,
                  onTap: enabled ? onOpenCustomRangeFilter : null,
                ),
            ],
          ),
        ),
        // 期間の送り(◀/▶)と現在の範囲ラベル。**compには描かれていないが既存機能なので残す**
        // (`_kosai-tokens.md` §5)。
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 0),
          child: Row(
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left, size: 20),
                color: sub,
                tooltip: '前の期間',
                onPressed: periodControlsEnabled
                    ? () => onChanged(selection.shiftPrevious())
                    : (canShiftCustomRange ? () => onShiftCustomRange!(false) : null),
              ),
              Expanded(
                child: Text(
                  rangeLabel,
                  textAlign: TextAlign.center,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right, size: 20),
                color: sub,
                tooltip: '次の期間',
                onPressed: periodControlsEnabled
                    ? () => onChanged(selection.shiftNext())
                    : (canShiftCustomRange ? () => onShiftCustomRange!(true) : null),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
