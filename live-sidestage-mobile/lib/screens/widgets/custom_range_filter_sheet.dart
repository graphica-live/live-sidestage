import 'package:flutter/material.dart';

import '../../core/analytics_period.dart';
import '../subscription_screen.dart';

/// サーバー側([range-limits.ts](../../../../live-sidestage-analytics/src/lib/range-limits.ts))の
/// MAX_RANGE_DAYSと必ず一致させること。無効な範囲を選んだまま放置すると、その範囲が
/// 「現在」を含む場合にライブ通知のたびにサーバーへ400を繰り返しうるため、クライアント側でも
/// 事前に弾く。
const int _maxRangeDays = 366;

typedef AdvancedFilterResult = ({DateTimeRange? range, String? listenerQuery, bool cleared});

void _showUpgradeNotice(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      duration: const Duration(seconds: 4),
      action: SnackBarAction(
        label: 'アップグレード',
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => const SubscriptionScreen()),
        ),
      ),
    ));
}

/// リスナー名・開始/終了日時による詳細フィルタのボトムシートを開く。
///
/// 戻り値:
/// - `null` — キャンセル(閉じるだけ、状態変更なし)
/// - `(range: null, listenerQuery: null, cleared: true)` — 「クリア」押下(フィルタ解除)
/// - `(range: range?, listenerQuery: query?, cleared: false)` — 「適用」押下
///   (range/listenerQueryのどちらか一方は非nullだが両方nullにはならない。rangeはUTC)
Future<AdvancedFilterResult?> showCustomRangeFilterSheet(
  BuildContext context, {
  DateTimeRange? initial,
  String? initialListenerQuery,
  bool extendedRangeAllowed = true,
  bool listenerFilterAllowed = true,
}) {
  return showModalBottomSheet<AdvancedFilterResult>(
    context: context,
    isScrollControlled: true,
    builder: (context) => _CustomRangeFilterSheet(
      initial: initial,
      initialListenerQuery: initialListenerQuery,
      extendedRangeAllowed: extendedRangeAllowed,
      listenerFilterAllowed: listenerFilterAllowed,
    ),
  );
}

class _CustomRangeFilterSheet extends StatefulWidget {
  const _CustomRangeFilterSheet({
    this.initial,
    this.initialListenerQuery,
    this.extendedRangeAllowed = true,
    this.listenerFilterAllowed = true,
  });

  final DateTimeRange? initial;
  final String? initialListenerQuery;

  /// FREEプランでは開始/終了日時による範囲指定を使えない(履歴の遡り期間制限)。
  final bool extendedRangeAllowed;

  /// FREEプランではリスナー名フィルタを使えない(入力欄は見せるが入力不可)。
  final bool listenerFilterAllowed;

  @override
  State<_CustomRangeFilterSheet> createState() => _CustomRangeFilterSheetState();
}

class _CustomRangeFilterSheetState extends State<_CustomRangeFilterSheet> {
  // JST壁時計の年月日時分を、UTCフラグ付きDateTimeの「成分」として保持する
  // (jstWallClockFromUtc/jstWallClockToUtcが読み書きする形とそろえる。端末ローカルの
  // DateTime(...)コンストラクタは経由しない)。
  DateTime? _start;
  DateTime? _end;
  late final TextEditingController _listenerController;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    if (initial != null) {
      _start = jstWallClockFromUtc(initial.start);
      _end = jstWallClockFromUtc(initial.end);
    }
    _listenerController = TextEditingController(text: widget.initialListenerQuery ?? '')
      ..addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _listenerController.dispose();
    super.dispose();
  }

  bool get _hasListener => _listenerController.text.trim().isNotEmpty;
  bool get _hasFullRange => _start != null && _end != null;
  bool get _hasPartialRange => (_start == null) != (_end == null);

  bool get _canApply {
    if (_hasPartialRange) return false;
    if (!_hasListener && !_hasFullRange) return false;
    if (_hasFullRange) {
      final start = _start!, end = _end!;
      if (!start.isBefore(end)) return false;
      if (end.difference(start) > const Duration(days: _maxRangeDays)) return false;
    }
    return true;
  }

  bool get _canClear =>
      widget.initial != null ||
      (widget.initialListenerQuery?.isNotEmpty ?? false) ||
      _start != null ||
      _end != null ||
      _hasListener;

  Future<void> _pickStart() async {
    final picked = await _pickJstWallClock(
      context,
      initial: _start,
      defaultTime: const TimeOfDay(hour: 0, minute: 0),
    );
    if (picked == null || !mounted) return;
    setState(() => _start = picked);
  }

  Future<void> _pickEnd() async {
    final picked = await _pickJstWallClock(
      context,
      initial: _end,
      defaultTime: const TimeOfDay(hour: 23, minute: 59),
    );
    if (picked == null || !mounted) return;
    // 選択した分の末尾(秒=59.999)に丸める。分単位ピッカーの粒度による取りこぼしを避けるため。
    setState(() {
      _end = DateTime.utc(picked.year, picked.month, picked.day, picked.hour, picked.minute, 59, 999);
    });
  }

  void _apply() {
    if (!_canApply) return;
    final range = _hasFullRange
        ? DateTimeRange(start: jstWallClockToUtc(_start!), end: jstWallClockToUtc(_end!))
        : null;
    final listenerQuery = _hasListener ? _listenerController.text.trim() : null;
    Navigator.of(context).pop((range: range, listenerQuery: listenerQuery, cleared: false));
  }

  void _clear() => Navigator.of(context).pop((range: null, listenerQuery: null, cleared: true));

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
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('詳細フィルタ', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              TextField(
                controller: _listenerController,
                readOnly: !widget.listenerFilterAllowed,
                onTap: widget.listenerFilterAllowed
                    ? null
                    : () => _showUpgradeNotice(context, 'リスナー名での絞り込みはPRO/ULTRAプランで利用できます'),
                decoration: InputDecoration(
                  labelText: 'リスナー名(ID またはプロフィール名)',
                  border: const OutlineInputBorder(),
                  hintText: widget.listenerFilterAllowed ? null : 'PRO/ULTRAプランで利用できます',
                  suffixIcon: widget.listenerFilterAllowed ? null : const Icon(Icons.lock_outline, size: 18),
                ),
              ),
              const SizedBox(height: 8),
              _DateTimeRow(
                label: '開始日時',
                value: _start,
                onTap: widget.extendedRangeAllowed
                    ? _pickStart
                    : () => _showUpgradeNotice(context, '日時範囲での絞り込みはPRO/ULTRAプランで利用できます'),
                locked: !widget.extendedRangeAllowed,
              ),
              _DateTimeRow(
                label: '終了日時',
                value: _end,
                onTap: widget.extendedRangeAllowed
                    ? _pickEnd
                    : () => _showUpgradeNotice(context, '日時範囲での絞り込みはPRO/ULTRAプランで利用できます'),
                locked: !widget.extendedRangeAllowed,
              ),
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
      ),
    );
  }
}

class _DateTimeRow extends StatelessWidget {
  const _DateTimeRow({required this.label, required this.value, required this.onTap, this.locked = false});

  final String label;

  /// JST壁時計(UTCフラグ付きDateTimeの成分として保持)。未選択ならnull。
  final DateTime? value;

  final VoidCallback onTap;

  /// FREEプランでロック中。タップは常に受け付ける(押されたら理由を伝える)。
  final bool locked;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: locked ? 0.6 : 1,
      child: ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(label),
        subtitle: Text(locked ? 'PRO/ULTRAプランで利用できます' : (value == null ? '未設定' : _format(value!))),
        trailing: Icon(locked ? Icons.lock_outline : Icons.edit_calendar_outlined),
        onTap: onTap,
      ),
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
Future<DateTime?> _pickJstWallClock(
  BuildContext context, {
  DateTime? initial,
  required TimeOfDay defaultTime,
}) async {
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

  final initialTime = initial != null ? TimeOfDay(hour: initial.hour, minute: initial.minute) : defaultTime;
  final time = await showTimePicker(context: context, initialTime: initialTime);
  if (time == null) return null;

  return DateTime.utc(date.year, date.month, date.day, time.hour, time.minute);
}
