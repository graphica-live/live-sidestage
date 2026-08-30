import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/analytics_period.dart';
import '../../core/api_client.dart';
import '../../core/api_retry.dart';
import '../../core/gift_activity.dart';
import '../../core/session_controller.dart';
import '../gift_sound_edit_screen.dart' show GiftThumbnail;
import '../widgets/analytics_status.dart';
import '../widgets/custom_range_filter_sheet.dart';
import '../widgets/period_selector.dart';

/// ギフト履歴タブ。閲覧専用(Web版にあるリネーム・非表示機能はここでは提供しない)。
class GiftHistoryTab extends StatefulWidget {
  const GiftHistoryTab({super.key, required this.active});

  final bool active;

  @override
  State<GiftHistoryTab> createState() => _GiftHistoryTabState();
}

class _GiftHistoryTabState extends State<GiftHistoryTab> with WidgetsBindingObserver {
  final LiveAnalyticsApi _api = LiveAnalyticsApi();

  AnalyticsPeriodSelection _selection = AnalyticsPeriodSelection.today();
  DateTimeRange? _customRange;
  String? _listenerQuery;
  GiftHistoryResult? _result;
  String? _error;
  bool _loading = false;

  /// 見えていない間に届いたギフト。次に見えたとき／前面へ戻ったときに1回だけ取り直す。
  bool _dirty = false;
  bool _resumed = true;

  int _requestGeneration = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    context.read<GiftActivityNotifier>().addListener(_onGiftActivity);
    if (widget.active) _load();
  }

  @override
  void dispose() {
    context.read<GiftActivityNotifier>().removeListener(_onGiftActivity);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final resumed = state == AppLifecycleState.resumed;
    if (resumed == _resumed) return;
    _resumed = resumed;
    if (resumed) _flushDirty();
  }

  @override
  void didUpdateWidget(covariant GiftHistoryTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    // **一度きりにしない。** 見ていない間に配信が進んでいるので、タブへ戻るたび取り直す。
    if (!oldWidget.active && widget.active) _load(silent: _result != null);
  }

  void _onGiftActivity() {
    final customRange = _customRange;
    switch (giftAutoReloadAction(
      active: widget.active,
      resumed: _resumed,
      containsToday:
          customRange != null ? customRangeContainsNow(customRange) : _selection.containsJstToday(),
    )) {
      case GiftAutoReloadAction.ignore:
        break;
      case GiftAutoReloadAction.defer:
        _dirty = true;
      case GiftAutoReloadAction.reload:
        _load(silent: true);
    }
  }

  void _flushDirty() {
    final customRange = _customRange;
    final containsNow =
        customRange != null ? customRangeContainsNow(customRange) : _selection.containsJstToday();
    if (!_dirty || !widget.active || !containsNow) return;
    _dirty = false;
    _load(silent: true);
  }

  /// [silent] はギフト受信による自動更新。**読み込み中の表示を出さない。**
  /// 出すと期間セレクタが `enabled: !_loading` で点滅的に無効化され、操作を邪魔する。
  /// 失敗も黙って捨てる(既存の表示を残す) — 次のギフトか手動更新で拾い直せる。
  Future<void> _load({bool silent = false}) async {
    final generation = ++_requestGeneration;

    final sessions = context.read<SessionController>();
    final token = sessions.session?.token;
    if (token == null) return;

    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    final customRange = _customRange;
    try {
      final result = await withTokenRefresh(
        call: (t) => _api.fetchGiftHistory(
          token: t,
          period: _selection.period.apiValue,
          date: _selection.date,
          startDatetime: customRange?.start,
          endDatetime: customRange?.end,
          listenerQuery: _listenerQuery,
        ),
        token: token,
        refreshToken: sessions.refreshToken,
      );
      if (!mounted || generation != _requestGeneration) return;
      setState(() {
        _result = result;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted || generation != _requestGeneration) return;
      if (silent) {
        debugPrint('[gift-history] 自動更新に失敗: ${e.message}');
        return;
      }
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  void _onPeriodChanged(AnalyticsPeriodSelection selection) {
    setState(() => _selection = selection);
    _load();
  }

  Future<void> _openCustomRangeFilter() async {
    final result = await showCustomRangeFilterSheet(
      context,
      initial: _customRange,
      initialListenerQuery: _listenerQuery,
    );
    if (result == null) return;
    setState(() {
      _customRange = result.cleared ? null : result.range;
      _listenerQuery = result.cleared ? null : result.listenerQuery;
    });
    _load();
  }

  /// 詳細フィルタ(日時範囲)中に◀/▶が押されたとき。現在の範囲の外へ出て`day`選択に
  /// 切り替えつつ、日時範囲フィルタだけを解除する(リスナー名フィルタ`_listenerQuery`は維持)。
  void _shiftOutOfCustomRange(bool forward) {
    final customRange = _customRange;
    if (customRange == null) return;
    final anchor = AnalyticsPeriodSelection(
      period: AnalyticsPeriod.day,
      date: jstDateKeyOf(forward ? customRange.end : customRange.start),
    );
    setState(() {
      _selection = forward ? anchor.shiftNext() : anchor.shiftPrevious();
      _customRange = null;
    });
    _load();
  }

  String get _rangeLabel {
    final range = _result?.dateRange;
    if (range != null && range.start.isNotEmpty) {
      if (range.start.contains('T')) {
        return formatDateTimeRangeLabel(
          DateTimeRange(start: DateTime.parse(range.start), end: DateTime.parse(range.end)),
        );
      }
      return range.start == range.end ? range.start : '${range.start} 〜 ${range.end}';
    }
    final customRange = _customRange;
    if (customRange != null) return formatDateTimeRangeLabel(customRange);
    return _selection.date;
  }

  static String _formatTime(DateTime? utc) {
    if (utc == null) return '--:--';
    final jst = utc.toUtc().add(const Duration(hours: 9));
    return '${jst.hour.toString().padLeft(2, '0')}:${jst.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final events = result?.events ?? const [];

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          PeriodSelectorBar(
            selection: _selection,
            rangeLabel: _rangeLabel,
            onChanged: _onPeriodChanged,
            enabled: !_loading,
            customRangeActive: _customRange != null,
            filterActive: _customRange != null || (_listenerQuery?.isNotEmpty ?? false),
            onOpenCustomRangeFilter: _openCustomRangeFilter,
            onShiftCustomRange: _shiftOutOfCustomRange,
          ),
          if (result != null && !result.verified) const VerifiedLockNotice(),
          if (_error != null) AnalyticsErrorBanner(message: _error!, onRetry: _load),
          if (_loading && result == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (result != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Text(
                '合計 ${result.total.count}件 / ${result.total.diamonds}コイン'
                '${result.hasMore ? '(直近分のみ表示)' : ''}',
                style: TextStyle(color: Theme.of(context).disabledColor, fontSize: 12),
              ),
            ),
          if (!_loading && result != null && events.isEmpty)
            const EmptyListNotice(message: 'この期間はまだギフトを受け取っていません'),
          for (final event in events)
            ListTile(
              leading: GiftThumbnail(event.giftPictureUrl),
              title: Text('${event.nickname} → ${event.giftName}'),
              subtitle: Text(event.edited ? 'x${event.repeatCount} ・ 編集済み' : 'x${event.repeatCount}'),
              trailing: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('${event.totalDiamonds}コイン', style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text(
                    _formatTime(event.receivedAt),
                    style: TextStyle(fontSize: 11, color: Theme.of(context).disabledColor),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
