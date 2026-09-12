import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/account_status_store.dart';
import '../../core/analytics_period.dart';
import '../../core/api_client.dart';
import '../../core/api_retry.dart';
import '../../core/comment_feed.dart';
import '../../core/gift_activity.dart';
import '../../core/plan_gate.dart';
import '../../core/realtime_sync.dart';
import '../../core/session_controller.dart';
import '../../core/tiktok_profile.dart';
import '../../models/gift_history_event.dart';
import '../widgets/analytics_status.dart';
import '../widgets/custom_range_filter_sheet.dart';
import '../widgets/diamond_format.dart';
import '../widgets/gradient_kit.dart';
import '../widgets/list_panel.dart';
import '../widgets/period_selector.dart';
import '../widgets/user_avatar.dart';

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
  List<GiftHistoryEvent> _events = const [];
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

    // Batch 05: GiftHistorySyncStore を初期化。
    // CommentFeed の gift-history append stream を購読。
    final store = context.read<GiftHistorySyncStore>();
    final commentFeed = context.read<CommentFeed>();
    // Storeはアプリ生存中は破棄されない(このタブはtiktokIdをkeyにして
    // 再生成される)ため、新しい配信者向けに使い始める前に前回のデータを
    // クリアする(配信者切替時に前配信者のデータが一瞬残るのを防ぐ)。
    store.resetForNewSession();
    store.initialize(
      giftHistoryAppendStream: commentFeed.onGiftHistoryAppend,
      onResyncRequired: () {
        if (widget.active && _resumed) {
          _load(silent: true);
        } else {
          _dirty = true;
        }
      },
    );
    store.addListener(_onGiftHistoryAppend);

    if (widget.active) _load();
  }

  @override
  void dispose() {
    context.read<GiftHistorySyncStore>().removeListener(_onGiftHistoryAppend);
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

  List<GiftHistoryEvent> _parseHistoryEvents(List<Map<String, dynamic>> history) {
    return history.map(GiftHistoryEvent.tryParse).whereType<GiftHistoryEvent>().toList();
  }

  void _applyStoreHistoryEvents(GiftHistorySyncStore store) {
    final history = store.getHistory();
    if (history.isEmpty) return;
    final parsed = _parseHistoryEvents(history);
    if (!mounted) return;
    setState(() => _events = parsed);
  }

  /// GiftHistorySyncStore から append イベント受信時のコールバック。
  /// append は既に REST 取得済みなら無視、resync 要求のみ処理。
  void _onGiftHistoryAppend() {
    final store = context.read<GiftHistorySyncStore>();
    final customRange = _customRange;
    final containsToday =
        customRange != null ? customRangeContainsNow(customRange) : _selection.containsJstToday();

    if (containsToday) {
      _applyStoreHistoryEvents(store);
    }

    // 期間が「今日」を含まない場合は無視。
    if (!containsToday) return;

    // resync 要求: 画面に応じて即座に取得 or 遅延。
    // (Batch 05: push受信で即座に反映ではなく、mismatch時のみREST再取得)
    if (store.needsResync) {
      switch (giftAutoReloadAction(
        active: widget.active,
        resumed: _resumed,
        containsToday: containsToday,
      )) {
        case GiftAutoReloadAction.ignore:
          break;
        case GiftAutoReloadAction.defer:
          _dirty = true;
        case GiftAutoReloadAction.reload:
          _load(silent: true);
      }
    }
  }

  void _flushDirty() {
    final customRange = _customRange;
    final containsNow =
        customRange != null ? customRangeContainsNow(customRange) : _selection.containsJstToday();
    if (!_dirty || !widget.active || !containsNow) return;
    _dirty = false;

    // Batch 05: resync 要求を反映。REST 再取得で最新状態を取得。
    _load(silent: true);
  }

  /// [silent] はpush受信による自動更新、resync 遅延後、または日付切替(既存表示あり)の更新。
  /// 初回以外は期間セレクタを無効化しない(`enabled`は常にtrue)。取得中は細いプログレスのみ。
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
    } else if (_result != null) {
      setState(() => _loading = true);
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
        _events = result.events;
        _loading = false;
        _dirty = false;
      });

      // Batch 06: REST取得成功時、GiftHistorySyncStore へ履歴全体とversionを反映。
      // (Batch 05時点では'id'フィールドしか渡さないバグと reset() による version欠損
      // 誤判定バグがあった)
      if (mounted) {
        final store = context.read<GiftHistorySyncStore>();
        final history = result.events.map((e) => e.toMap()).toList();
        store.acknowledgeResync(
          history: history,
          bootId: result.bootId,
          version: result.version,
        );
      }
    } on ApiException catch (e) {
      if (!mounted || generation != _requestGeneration) return;
      if (silent) {
        debugPrint('[gift-history] 自動更新に失敗: ${e.message}');
        setState(() => _loading = false);
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
    _load(silent: _result != null);
  }

  Future<void> _openCustomRangeFilter() async {
    final planGate = PlanGate(context.read<AccountStatusStore>().status);
    final result = await showCustomRangeFilterSheet(
      context,
      initial: _customRange,
      initialListenerQuery: _listenerQuery,
      extendedRangeAllowed: planGate.canUseExtendedHistoryRange,
      listenerFilterAllowed: planGate.canUseListenerFilter,
      // 明細(Gift)は受信後90日で削除される(gift-retention-window.tsのGIFT_RETENTION_DAYS)。
      // それより前を選ばせても常に0件になるため、選択自体をここで縮小する。
      maxRangeDays: 90,
    );
    if (result == null) return;
    setState(() {
      _customRange = result.cleared ? null : result.range;
      _listenerQuery = result.cleared ? null : result.listenerQuery;
    });
    _load(silent: _result != null);
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
    _load(silent: _result != null);
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

  Widget _buildGiftHistoryRow(GiftHistoryEvent event) {
    return InkWell(
      onTap: event.tiktokHandle == null ? null : () => openTiktokProfile(context, event.tiktokHandle!),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 13),
        child: Row(
          children: [
            GradientRing(child: UserAvatar(event.profileImageUrl)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    event.nickname,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    '${event.giftName} ×${event.repeatCount}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11.5,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatDiamonds(event.totalDiamonds),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: KosaiPalette.c2,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  _formatTime(event.receivedAt),
                  style: TextStyle(
                    fontSize: 10,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final events = _events;
    final planGate = PlanGate(context.watch<AccountStatusStore>().status);
    final refreshing = _loading && result != null;
    scheduleClampToDayOnlyHistoryPeriod(
      mounted: mounted,
      extendedRangeAllowed: planGate.canUseExtendedHistoryRange,
      hasCustomRange: _customRange != null,
      selection: _selection,
      onClamp: (clamped) {
        setState(() => _selection = clamped);
        _load();
      },
    );

    return RefreshIndicator(
      onRefresh: _load,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const KosaiSectionHeading(
                  'ギフト履歴',
                  top: 8,
                  subtitle: '受け取ったギフトの履歴',
                ),
                if (refreshing) const LinearProgressIndicator(minHeight: 2),
                PeriodSelectorBar(
                  selection: _selection,
                  rangeLabel: _rangeLabel,
                  onChanged: _onPeriodChanged,
                  extendedRangeAllowed: planGate.canUseExtendedHistoryRange,
                  enabled: true,
                  customRangeActive: _customRange != null,
                  filterActive: _customRange != null || (_listenerQuery?.isNotEmpty ?? false),
                  onOpenCustomRangeFilter: _openCustomRangeFilter,
                  onShiftCustomRange: _shiftOutOfCustomRange,
                  availablePeriods: const [AnalyticsPeriod.day, AnalyticsPeriod.week, AnalyticsPeriod.month],
                ),
                if (_error != null) AnalyticsErrorBanner(message: _error!, onRetry: _load),
                if (_loading && result == null)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 48),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                if (result != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                    child: Text(
                      '合計 ${result.total.count}件 / ${formatWithCommas(result.total.diamonds)}コイン'
                      '(LIVE Sidestage登録後データ)',
                      style: TextStyle(fontSize: 10, color: Theme.of(context).colorScheme.onSurfaceVariant),
                    ),
                  ),
                if (!_loading && result != null && events.isEmpty)
                  const EmptyListNotice(message: 'この期間はまだギフトを受け取っていません'),
              ],
            ),
          ),
          if (events.isNotEmpty)
            ListPanelSliver(
              itemCount: events.length,
              itemBuilder: (context, i) => _buildGiftHistoryRow(events[i]),
            ),
        ],
      ),
    );
  }
}
