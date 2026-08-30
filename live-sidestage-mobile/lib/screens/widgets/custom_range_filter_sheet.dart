import 'package:flutter/material.dart';

import '../../core/analytics_period.dart';

/// サーバー側([range-limits.ts](../../../../live-sidestage-analytics/src/lib/range-limits.ts))の
/// MAX_RANGE_DAYSと必ず一致させること。無効な範囲を選んだまま放置すると、その範囲が
/// 「現在」を含む場合にライブ通知のたびにサーバーへ400を繰り返しうるため、クライアント側でも
/// 事前に弾く。
const int _maxRangeDays = 366;

typedef CustomRangeFilterResult = ({DateTimeRange? range, bool cleared});

/// 開始・終了日時によるカスタム範囲フィルタのボトムシートを開く。
///
/// 戻り値:
/// - `null` — キャンセル(閉じるだけ、状態変更なし)
/// - `(range: null, cleared: true)` — 「クリア」押下(custom filter解除)
/// - `(range: range, cleared: false)` — 「適用」押下(rangeはUTC)
Future<CustomRangeFilterResult?> showCustomRangeFilterSheet(
  BuildContext context, {
  DateTimeRange? initial,
}) {
  return showModalBottomSheet<CustomRangeFilterResult>(
    context: context,
    isScrollControlled: true,
    builder: (context) => _CustomRangeFilterSheet(initial: initial),
  );
}

class _CustomRangeFilterSheet extends StatefulWidget {
  const _CustomRangeFilterSheet({this.initial});

  final DateTimeRange? initial;

  @override
  State<_CustomRangeFilterSheet> createState() => _CustomRangeFilterSheetState();
}

class _CustomRangeFilterSheetState extends State<_CustomRangeFilterSheet> {
  // JST壁時計の年月日時分を、UTCフラグ付きDateTimeの「成分」として保持する
  // (jstWallClockFromUtc/jstWallClockToUtcが読み書きする形とそろえる。端末ローカルの
  // DateTime(...)コンストラクタは経由しない)。
  DateTime? _start;
  DateTime? _end;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    if (initial != null) {
      _start = jstWallClockFromUtc(initial.start);
      _end = jstWallClockFromUtc(initial.end);
    }
  }

  bool get _canApply {
    final start = _start;
    final end = _end;
    if (start == null || end == null) return false;
    if (!start.isBefore(end)) return false;
    return end.difference(start) <= const Duration(days: _maxRangeDays);
  }

  bool get _canClear => widget.initial != null || _start != null || _end != null;

  Future<void> _pickStart() async {
    final picked = await _pickJstWallClock(context, initial: _start);
    if (picked == null || !mounted) return;
    setState(() => _start = picked);
  }

  Future<void> _pickEnd() async {
    final picked = await _pickJstWallClock(context, initial: _end);
    if (picked == null || !mounted) return;
    // 選択した分の末尾(秒=59.999)に丸める。分単位ピッカーの粒度による取りこぼしを避けるため。
    setState(() {
      _end = DateTime.utc(picked.year, picked.month, picked.day, picked.hour, picked.minute, 59, 999);
    });
  }

  void _apply() {
    final start = _start;
    final end = _end;
    if (start == null || end == null) return;
    Navigator.of(context).pop((
      range: DateTimeRange(start: jstWallClockToUtc(start), end: jstWallClockToUtc(end)),
      cleared: false,
    ));
  }

  void _clear() => Navigator.of(context).pop((range: null, cleared: true));

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: 16 + MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('詳細フィルタ', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 8),
            _DateTimeRow(label: '開始日時', value: _start, onTap: _pickStart),
            _DateTimeRow(label: '終了日時', value: _end, onTap: _pickEnd),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _canClear ? _clear : null,
                    child: const Text('クリア'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: _canApply ? _apply : null,
                    child: const Text('適用'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _DateTimeRow extends StatelessWidget {
  const _DateTimeRow({required this.label, required this.value, required this.onTap});

  final String label;

  /// JST壁時計(UTCフラグ付きDateTimeの成分として保持)。未選択ならnull。
  final DateTime? value;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      subtitle: Text(value == null ? '未設定' : _format(value!)),
      trailing: const Icon(Icons.edit_calendar_outlined),
      onTap: onTap,
    );
  }

  static String _format(DateTime jst) {
    final y = jst.year.toString().padLeft(4, '0');
    final m = jst.month.toString().padLeft(2, '0');
    final d = jst.day.toString().padLeft(2, '0');
    final hh = jst.hour.toString().padLeft(2, '0');
    final mi = jst.minute.toString().padLeft(2, '0');
    return '$y/$m/$d $hh:$mi';
  }
}

/// showDatePicker → showTimePicker の順に開き、結果を「JST壁時計の成分を持つUTCフラグ付き
/// DateTime」として返す(端末ローカルのDateTime(...)コンストラクタは経由しない)。
/// どちらかでキャンセルされたらnull。
Future<DateTime?> _pickJstWallClock(BuildContext context, {DateTime? initial}) async {
  final now = DateTime.now();
  final firstDate = DateTime(now.year - 5);
  final lastDate = DateTime(now.year + 5, 12, 31);
  final fallbackDate = DateTime(now.year, now.month, now.day);
  final initialDate = initial != null ? DateTime(initial.year, initial.month, initial.day) : fallbackDate;

  final date = await showDatePicker(
    context: context,
    initialDate: initialDate.isBefore(firstDate)
        ? firstDate
        : (initialDate.isAfter(lastDate) ? lastDate : initialDate),
    firstDate: firstDate,
    lastDate: lastDate,
  );
  if (date == null || !context.mounted) return null;

  final initialTime = initial != null ? TimeOfDay(hour: initial.hour, minute: initial.minute) : TimeOfDay.now();
  final time = await showTimePicker(context: context, initialTime: initialTime);
  if (time == null) return null;

  return DateTime.utc(date.year, date.month, date.day, time.hour, time.minute);
}
