import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/account_status_store.dart';
import '../../core/analytics_period.dart';
import '../../core/api_client.dart';
import '../../core/api_retry.dart';
import '../../core/gift_activity.dart';
import '../../core/plan_gate.dart';
import '../../core/session_controller.dart';
import '../widgets/analytics_status.dart';
import '../widgets/custom_range_filter_sheet.dart';
import '../widgets/diamond_format.dart';
import '../widgets/gradient_kit.dart';
import '../widgets/list_panel.dart';
import '../widgets/period_selector.dart';
import '../widgets/ranking_list_tile.dart';

/// 貢献タブ(ユーザー別コイン数ランキング)。
///
/// `IndexedStack`で他タブと同時にマウントされるため、[active]になるまで読み込まない
/// (常駐3タブぶんの無駄なAPI呼び出しを避ける)。
///
/// ギフトを受け取ると[GiftActivityNotifier]経由で取り直す。**端末側で数字を積まない** —
/// 数字の正はサーバーの集計だけで、積むとDBと恒久的にズレる(理由はgift_activity.dart)。
class ContributionTab extends StatefulWidget {
  const ContributionTab({super.key, required this.active});

  final bool active;

  @override
  State<ContributionTab> createState() => _ContributionTabState();
}

class _ContributionTabState extends State<ContributionTab> with WidgetsBindingObserver {
  final LiveAnalyticsApi _api = LiveAnalyticsApi();

  AnalyticsPeriodSelection _selection = AnalyticsPeriodSelection.today();
  DateTimeRange? _customRange;
  String? _listenerQuery;
  GiftRankingResult? _result;
  String? _error;
  bool _loading = false;

  /// 見えていない間に届いたギフト。次に見えたとき／前面へ戻ったときに1回だけ取り直す。
  bool _dirty = false;
  bool _resumed = true;

  // 期間切替・◀/▶・pull-to-refreshが短時間に連続すると、先に投げたリクエストが
  // 後から完了して新しい選択結果を上書きしうる。世代が一致する応答だけ反映する。
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
  void didUpdateWidget(covariant ContributionTab oldWidget) {
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
        call: (t) => _api.fetchGiftRanking(
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
        debugPrint('[contribution] 自動更新に失敗: ${e.message}');
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

  Future<void> _openCustomRangeFilter() async {
    final planGate = PlanGate(context.read<AccountStatusStore>().status);
    final result = await showCustomRangeFilterSheet(
      context,
      initial: _customRange,
      initialListenerQuery: _listenerQuery,
      extendedRangeAllowed: planGate.canUseExtendedHistoryRange,
      listenerFilterAllowed: planGate.canUseListenerFilter,
    );
    if (result == null) return;
    setState(() {
      _customRange = result.cleared ? null : result.range;
      _listenerQuery = result.cleared ? null : result.listenerQuery;
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

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final users = result?.users ?? const [];
    final planGate = PlanGate(context.watch<AccountStatusStore>().status);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 2),
            child: GradientText(
              '貢献',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 22, fontWeight: FontWeight.w700) ??
                  const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
            child: Text(
              'ギフト貢献ランキング',
              style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ),
          PeriodSelectorBar(
            selection: _selection,
            rangeLabel: _rangeLabel,
            onChanged: _onPeriodChanged,
            enabled: !_loading,
            customRangeActive: _customRange != null,
            filterActive: _customRange != null || (_listenerQuery?.isNotEmpty ?? false),
            onOpenCustomRangeFilter: _openCustomRangeFilter,
            onShiftCustomRange: _shiftOutOfCustomRange,
            extendedRangeAllowed: planGate.canUseExtendedHistoryRange,
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
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: GradientBorderCard(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '表示中の合計 ${users.length}人',
                      style: Theme.of(
                        context,
                      ).textTheme.bodyMedium?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
                    ),
                    GradientText(
                      formatWithCommas(result.total.totalDiamonds),
                      style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w800, letterSpacing: -0.2),
                    ),
                  ],
                ),
              ),
            ),
          if (result != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Text(
                'LIVE Sidestage登録後データ',
                style: Theme.of(
                  context,
                ).textTheme.labelSmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ),
          if (!_loading && result != null && users.isEmpty)
            const EmptyListNotice(message: 'この期間はまだギフトを受け取っていません'),
          if (users.isNotEmpty)
            ListPanel(
              children: [for (var i = 0; i < users.length; i++) RankingListTile(rank: i + 1, entry: users[i])],
            ),
        ],
      ),
    );
  }
}
