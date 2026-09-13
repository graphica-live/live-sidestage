import 'dart:async' show unawaited;
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
  static const _pageSize = 50;

  final LiveAnalyticsApi _api = LiveAnalyticsApi();

  AnalyticsPeriodSelection _selection = AnalyticsPeriodSelection.today();
  DateTimeRange? _customRange;
  String? _listenerQuery;
  GiftHistoryResult? _result;
  List<GiftHistoryEvent> _events = const [];
  String? _error;
  bool _loading = false;
  bool _loadingMore = false;

  final Map<String, _GiftHistoryCacheEntry> _historyCache = {};

  /// いま画面に載せている REST 窓のキャッシュキー。同じキーの silent 再取得では
  /// 先頭ページと既存窓を merge し、loadMore 済みの末尾を消さない。
  String? _loadedCacheKey;

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
    final existingIds = _events.map((e) => e.id).toSet();
    final incoming = parsed.where((e) => !existingIds.contains(e.id)).toList();
    if (incoming.isEmpty) return;
    setState(() => _events = [...incoming, ..._events]);
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

  String _cacheKeyFor({
    required AnalyticsPeriodSelection selection,
    DateTimeRange? customRange,
    String? listenerQuery,
  }) {
    final rangePart = customRange == null
        ? ''
        : '${customRange.start.toIso8601String()}_${customRange.end.toIso8601String()}';
    return '${selection.period.apiValue}|${selection.date}|${listenerQuery ?? ''}|$rangePart';
  }

  String _currentCacheKey() => _cacheKeyFor(
        selection: _selection,
        customRange: _customRange,
        listenerQuery: _listenerQuery,
      );

  void _storeFirstPageCache({
    required GiftHistoryResult result,
    required List<GiftHistoryEvent> events,
  }) {
    _historyCache[_currentCacheKey()] = _GiftHistoryCacheEntry(
      result: GiftHistoryResult(
        events: events,
        dateRange: result.dateRange,
        total: result.total,
        hasMore: result.hasMore,
        verified: result.verified,
        bootId: result.bootId,
        version: result.version,
      ),
      events: List<GiftHistoryEvent>.from(events),
    );
  }

  Future<void> _prefetchDayHistory({
    required AnalyticsPeriodSelection selection,
    required String token,
    required Future<String?> Function()? refreshToken,
  }) async {
    final key = _cacheKeyFor(selection: selection, customRange: null, listenerQuery: _listenerQuery);
    if (_historyCache.containsKey(key)) return;
    try {
      final result = await withTokenRefresh(
        call: (t) => _api.fetchGiftHistory(
          token: t,
          period: selection.period.apiValue,
          date: selection.date,
          limit: _pageSize,
          listenerQuery: _listenerQuery,
        ),
        token: token,
        refreshToken: refreshToken,
      );
      _historyCache[key] = _GiftHistoryCacheEntry(
        result: result,
        events: List<GiftHistoryEvent>.from(result.events),
      );
    } catch (e) {
      debugPrint('[gift-history] prefetch失敗 ($key): $e');
    }
  }

  void _prefetchAdjacentDays({required String token, required Future<String?> Function()? refreshToken}) {
    if (_customRange != null || _selection.period != AnalyticsPeriod.day) return;
    unawaited(_prefetchDayHistory(selection: _selection.shiftPrevious(), token: token, refreshToken: refreshToken));
    unawaited(_prefetchDayHistory(selection: _selection.shiftNext(), token: token, refreshToken: refreshToken));
  }

  Future<void> _loadMore() async {
    final result = _result;
    if (result == null || !result.hasMore || _loadingMore || _loading) return;
    if (_events.isEmpty) return;
    final last = _events.last;
    final cursorAt = last.receivedAt;
    if (cursorAt == null) return;

    final sessions = context.read<SessionController>();
    final token = sessions.session?.token;
    if (token == null) return;

    setState(() => _loadingMore = true);
    final generation = _requestGeneration;
    final customRange = _customRange;

    try {
      final page = await withTokenRefresh(
        call: (t) => _api.fetchGiftHistory(
          token: t,
          period: _selection.period.apiValue,
          date: _selection.date,
          limit: _pageSize,
          startDatetime: customRange?.start,
          endDatetime: customRange?.end,
          listenerQuery: _listenerQuery,
          cursorReceivedAt: cursorAt,
          cursorId: last.id,
        ),
        token: token,
        refreshToken: sessions.refreshToken,
      );
      if (!mounted || generation != _requestGeneration) return;

      final existingIds = _events.map((e) => e.id).toSet();
      final newEvents = page.events.where((e) => !existingIds.contains(e.id)).toList();
      setState(() {
        _events = [..._events, ...newEvents];
        _result = GiftHistoryResult(
          events: _events,
          dateRange: page.dateRange,
          total: result.total,
          hasMore: page.hasMore,
          verified: page.verified,
          bootId: page.bootId,
          version: page.version,
        );
      });

      if (newEvents.isNotEmpty && mounted) {
        context.read<GiftHistorySyncStore>().appendToHistory(newEvents.map((e) => e.toMap()).toList());
      }
    } on ApiException catch (e) {
      if (mounted && generation == _requestGeneration) {
        debugPrint('[gift-history] 追加ページの取得に失敗: ${e.message}');
      }
    } catch (e) {
      if (mounted && generation == _requestGeneration) {
        debugPrint('[gift-history] 追加ページの取得で予期せぬエラー: $e');
      }
    } finally {
      if (mounted && generation == _requestGeneration && _loadingMore) {
        setState(() => _loadingMore = false);
      }
    }
  }

  bool _onScrollNotification(ScrollNotification notification) {
    final metrics = notification.metrics;
    if (metrics.maxScrollExtent > 0 && metrics.pixels >= metrics.maxScrollExtent - 240) {
      _loadMore();
    }
    return false;
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
        _loadingMore = false;
        _error = null;
      });
    } else if (_result != null) {
      setState(() {
        _loading = true;
        _loadingMore = false;
      });
    }

    final customRange = _customRange;
    try {
      final result = await withTokenRefresh(
        call: (t) => _api.fetchGiftHistory(
          token: t,
          period: _selection.period.apiValue,
          date: _selection.date,
          limit: _pageSize,
          startDatetime: customRange?.start,
          endDatetime: customRange?.end,
          listenerQuery: _listenerQuery,
        ),
        token: token,
        refreshToken: sessions.refreshToken,
      );
      if (!mounted || generation != _requestGeneration) return;

      final currentKey = _currentCacheKey();
      final existing = List<GiftHistoryEvent>.from(_events);
      final sameWindow = silent && _loadedCacheKey == currentKey && existing.isNotEmpty;
      final head = result.events;
      final headIds = head.map((e) => e.id).toSet();
      final tail = sameWindow ? existing.where((e) => !headIds.contains(e.id)).toList() : const <GiftHistoryEvent>[];
      final merged = sameWindow ? [...head, ...tail] : head;
      final previousHasMore = _result?.hasMore;
      if (!sameWindow) {
        _loadedCacheKey = currentKey;
      }

      setState(() {
        _result = GiftHistoryResult(
          events: merged,
          dateRange: result.dateRange,
          total: result.total,
          hasMore: tail.isNotEmpty ? (previousHasMore ?? result.hasMore) : result.hasMore,
          verified: result.verified,
          bootId: result.bootId,
          version: result.version,
        );
        _events = merged;
        _loading = false;
        _dirty = false;
      });

      // Batch 06: REST取得成功時、GiftHistorySyncStore へ履歴全体とversionを反映。
      // silent かつ同一キーなら loadMore 末尾を含めた merge 結果を渡し、版だけ進める。
      if (mounted) {
        final store = context.read<GiftHistorySyncStore>();
        store.acknowledgeResync(
          history: merged.map((e) => e.toMap()).toList(),
          bootId: result.bootId,
          version: result.version,
        );
        _storeFirstPageCache(result: result, events: result.events);
        _prefetchAdjacentDays(token: token, refreshToken: sessions.refreshToken);
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

  Future<void> _changePeriod(void Function() applyChange) async {
    setState(applyChange);
    final cacheKey = _currentCacheKey();
    final cached = _historyCache[cacheKey];
    if (cached != null) {
      setState(() {
        _result = cached.result;
        _events = List<GiftHistoryEvent>.from(cached.events);
        _error = null;
        _loading = true;
      });
      await _load(silent: true);
      return;
    }
    await _load(silent: _result != null);
  }

  void _onPeriodChanged(AnalyticsPeriodSelection selection) {
    _changePeriod(() => _selection = selection);
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
    await _changePeriod(() {
      _customRange = result.cleared ? null : result.range;
      _listenerQuery = result.cleared ? null : result.listenerQuery;
    });
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
    _changePeriod(() {
      _selection = forward ? anchor.shiftNext() : anchor.shiftPrevious();
      _customRange = null;
    });
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

    return NotificationListener<ScrollNotification>(
      onNotification: _onScrollNotification,
      child: RefreshIndicator(
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
          if (_loadingMore)
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
              ),
            ),
        ],
      ),
    ),
    );
  }
}

class _GiftHistoryCacheEntry {
  const _GiftHistoryCacheEntry({required this.result, required this.events});

  final GiftHistoryResult result;
  final List<GiftHistoryEvent> events;
}
