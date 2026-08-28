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
  });

  final AnalyticsPeriodSelection selection;

  /// 画面に出す期間ラベル。サーバーが返した dateRange から呼び出し側が組み立てる
  /// (JST日付とend-inclusive/exclusiveの扱いがエンドポイントごとに違うため、
  /// このウィジェット自身では計算しない)。
  final String rangeLabel;

  final ValueChanged<AnalyticsPeriodSelection> onChanged;

  /// 読み込み中は連打によるリクエストの取り違えを避けるため操作を止める。
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Column(
        children: [
          SegmentedButton<AnalyticsPeriod>(
            segments: [
              for (final p in AnalyticsPeriod.values) ButtonSegment(value: p, label: Text(p.label)),
            ],
            selected: {selection.period},
            onSelectionChanged: enabled
                ? (selected) => onChanged(selection.withPeriod(selected.first))
                : null,
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left),
                onPressed: enabled ? () => onChanged(selection.shiftPrevious()) : null,
              ),
              Text(rangeLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
              IconButton(
                icon: const Icon(Icons.chevron_right),
                onPressed: enabled ? () => onChanged(selection.shiftNext()) : null,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
