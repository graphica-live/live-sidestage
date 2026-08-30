import 'package:flutter/material.dart';

import '../../core/analytics_period.dart';

/// 貢献/ギフト履歴/バトル履歴タブ共通の期間選択バー(日/週/月 + ◀/▶)。
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
  /// サーバーへ送るのがcustom rangeかperiod/dateかを一意にするため、日/週/月の切替と
  /// ◀/▶を無効化する。詳細フィルタボタン自体は(再度開いて調整・解除できるよう)
  /// 常に有効のまま。
  final bool customRangeActive;

  /// 詳細フィルタ(日時範囲・リスナー名のいずれか)が適用中かどうか。アイコンの着色のみに使う。
  final bool filterActive;

  /// 詳細フィルタボタン押下時のコールバック。nullなら詳細フィルタボタン自体を出さない。
  final VoidCallback? onOpenCustomRangeFilter;

  @override
  Widget build(BuildContext context) {
    final periodControlsEnabled = enabled && !customRangeActive;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Column(
        children: [
          SizedBox(
            width: double.infinity,
            child: Stack(
              alignment: Alignment.center,
              clipBehavior: Clip.none,
              children: [
                SegmentedButton<AnalyticsPeriod>(
                  segments: [
                    for (final p in AnalyticsPeriod.values) ButtonSegment(value: p, label: Text(p.label)),
                  ],
                  selected: {selection.period},
                  onSelectionChanged: periodControlsEnabled
                      ? (selected) => onChanged(selection.withPeriod(selected.first))
                      : null,
                ),
                if (onOpenCustomRangeFilter != null)
                  Positioned(
                    right: 0,
                    child: IconButton(
                      icon: Icon(
                        Icons.tune,
                        color: filterActive ? Theme.of(context).colorScheme.primary : null,
                      ),
                      tooltip: '詳細フィルタ',
                      onPressed: enabled ? onOpenCustomRangeFilter : null,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left),
                onPressed: periodControlsEnabled ? () => onChanged(selection.shiftPrevious()) : null,
              ),
              Expanded(
                child: Text(
                  rangeLabel,
                  textAlign: TextAlign.center,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right),
                onPressed: periodControlsEnabled ? () => onChanged(selection.shiftNext()) : null,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
