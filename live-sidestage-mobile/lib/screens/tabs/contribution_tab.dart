import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import '../../core/upgrade_notice.dart';
import '../../models/gift_breakdown.dart';
import '../../models/gift_ranking_entry.dart';
import '../widgets/analytics_status.dart';
import '../widgets/arrow_share_icon.dart';
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
  List<GiftRankingEntry> _users = const [];
  String? _error;
  bool _loading = false;
  bool _shareInProgress = false;

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

    // Batch 05: RankingSyncStore を初期化。
    // CommentFeed の ranking snapshot stream を購読し、
    // version 整合性チェック → snapshot 反映 または resync 要求。
    final store = context.read<RankingSyncStore>();
    final commentFeed = context.read<CommentFeed>();
    // Storeはアプリ生存中は破棄されない(このタブはtiktokIdをkeyにして
    // 再生成される)ため、新しい配信者向けに使い始める前に前回のデータを
    // クリアする(配信者切替時に前配信者のデータが一瞬残るのを防ぐ)。
    store.resetForNewSession();
    store.initialize(
      rankingSnapshotStream: commentFeed.onRankingSnapshot,
      onResyncRequired: () {
        if (widget.active && _resumed) {
          _load(silent: true);
        } else {
          _dirty = true;
        }
      },
    );
    store.addListener(_onRankingSnapshot);

    // 現在の期間を Store へ通知。異なる期間の snapshot は破棄される。
    final customRange = _customRange;
    final period = customRange != null ? null : _selection.period.apiValue;
    store.setCurrentPeriod(period);

    if (widget.active) _load();
  }

  @override
  void dispose() {
    context.read<RankingSyncStore>().removeListener(_onRankingSnapshot);
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

  List<GiftRankingEntry> _parseRankingEntities(Object? entities) {
    if (entities is! List) return const [];
    return entities.map(GiftRankingEntry.tryParse).whereType<GiftRankingEntry>().toList();
  }

  void _applyRankingSnapshotUsers(RankingSyncStore store) {
    final entities = store.getSnapshot()?['entities'];
    if (entities == null) return;
    final parsed = _parseRankingEntities(entities);
    if (!mounted) return;
    setState(() => _users = parsed);
  }

  /// RankingSyncStore から snapshot 受信時のコールバック。
  /// snapshot は既に REST 取得済みなら無視、resync 要求のみ処理。
  void _onRankingSnapshot() {
    final store = context.read<RankingSyncStore>();
    final customRange = _customRange;
    final containsToday =
        customRange != null ? customRangeContainsNow(customRange) : _selection.containsJstToday();

    if (containsToday && store.getSnapshot()?['entities'] != null) {
      _applyRankingSnapshotUsers(store);
    }

    // 期間が「今日」を含まない場合は無視(既存 giftAutoReloadAction と同じ原則)。
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
  ///
  /// [onResult]は期間ナビ操作時のロールバックを駆動するコールバック。成功時に true、
  /// 非silent失敗時に false を受け取る。silentな失敗、セッション切れ、リクエスト破棄、
  /// 未マウント時は呼ばれない。
  Future<void> _load({bool silent = false, void Function(bool success)? onResult}) async {
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
        _users = result.users;
        _loading = false;
        _dirty = false;
      });

      // Batch 06: REST取得成功時、RankingSyncStore へsnapshotとversionを反映。
      // (Batch 05時点では空Mapを渡すバグと reset() による version欠損誤判定バグがあった)
      if (!mounted) return;
      final store = context.read<RankingSyncStore>();
      store.acknowledgeResync(
        snapshot: {
          'entities': result.users.map((u) => u.toMap()).toList(),
          'order': result.users.map((u) => u.tiktokUid).toList(),
          'total': {
            'giftCount': result.total.giftCount,
            'totalDiamonds': result.total.totalDiamonds,
          },
        },
        period: _selection.period.apiValue,
        bootId: result.bootId,
        epoch: result.epoch,
        version: result.version,
      );
      onResult?.call(true);
    } on ApiException catch (e) {
      if (!mounted || generation != _requestGeneration) return;
      if (silent) {
        debugPrint('[contribution] 自動更新に失敗: ${e.message}');
        setState(() => _loading = false);
        return;
      }
      setState(() {
        _error = e.message;
        _loading = false;
      });
      onResult?.call(false);
    }
  }

  /// [RankingListTile]の`key`に使う、現在の期間指定の署名。
  String _rangeSignature() {
    final customRange = _customRange;
    if (customRange != null) {
      return 'custom_${customRange.start.toIso8601String()}_${customRange.end.toIso8601String()}';
    }
    return '${_selection.period.apiValue}_${_selection.date}';
  }

  /// 行展開時のギフト内訳取得。[RankingListTile]の`key`に期間を含めているため、
  /// 期間が変わった行は再マウントされ、ここは常にそのマウント時点の期間で呼ばれる。
  ///
  /// `ApiException` をキャッチして原因を分類してログ出力してから rethrow する。
  /// 呼び出し元は例外型は変わらずそのまま受け取る。
  Future<GiftBreakdownResult> _fetchBreakdown(String tiktokUid) async {
    final sessions = context.read<SessionController>();
    final token = sessions.session?.token;
    if (token == null) throw ApiException('ログインが必要です');
    final customRange = _customRange;
    try {
      return await withTokenRefresh(
        call: (t) => _api.fetchGiftBreakdown(
          token: t,
          tiktokUid: tiktokUid,
          period: _selection.period.apiValue,
          date: _selection.date,
          startDatetime: customRange?.start,
          endDatetime: customRange?.end,
        ),
        token: token,
        refreshToken: sessions.refreshToken,
      );
    } on ApiException catch (e) {
      // ApiException を検査して原因を分類してログ出力
      if (e.isRefreshTokenRejected) {
        debugPrint('[contribution] ギフト内訳取得: refresh token 失効 (${e.code}), statusCode=${e.statusCode}');
      } else if (e.isUnauthorized) {
        debugPrint('[contribution] ギフト内訳取得: 401 認可エラー (${e.code}), statusCode=${e.statusCode}');
      } else {
        debugPrint('[contribution] ギフト内訳取得: エラー (statusCode=${e.statusCode}), ${e.message}');
      }
      rethrow;
    }
  }

  /// 期間ナビ操作時のロールバック機構。指定の状態変更を試みた後、REST取得が失敗すれば
  /// 自動的に変更前の期間・フィルタに戻す。
  ///
  /// 期間切替(◀/▶・カスタム範囲フィルタ)の失敗時に、`_selection`/`_customRange`/`_listenerQuery`
  /// が「取得成功済みのデータの期間」のままになるという不変条件を復元する。
  /// 失敗時の画面表示(古いデータ+エラーバナー)と選択状態の食い違いを防ぎ、
  /// 行の詳細展開時にギフト内訳の期間が画面表示と一致することを保証する。
  Future<void> _changePeriod(void Function() applyChange) async {
    final previousSelection = _selection;
    final previousCustomRange = _customRange;
    final previousListenerQuery = _listenerQuery;
    setState(applyChange);
    var succeeded = true;
    await _load(onResult: (success) => succeeded = success);
    if (!succeeded && mounted) {
      setState(() {
        _selection = previousSelection;
        _customRange = previousCustomRange;
        _listenerQuery = previousListenerQuery;
      });
    }
  }

  void _onPeriodChanged(AnalyticsPeriodSelection selection) {
    _changePeriod(() => _selection = selection);
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
    await _changePeriod(() {
      _customRange = result.cleared ? null : result.range;
      _listenerQuery = result.cleared ? null : result.listenerQuery;
    });
  }

  /// ギフト貢献ランキング(現在の期間指定)のシェアURLを発行してクリップボードにコピーする。
  Future<void> _shareGiftRanking() async {
    final sessions = context.read<SessionController>();
    final token = sessions.session?.token;
    if (token == null || _shareInProgress) return;

    setState(() => _shareInProgress = true);
    final customRange = _customRange;

    try {
      final url = await withTokenRefresh(
        call: (t) => _api.fetchGiftRankingShareUrl(
          period: _selection.period.apiValue,
          date: _selection.date,
          startDatetime: customRange?.start,
          endDatetime: customRange?.end,
        ),
        token: token,
        refreshToken: sessions.refreshToken,
      );
      if (!mounted) return;
      await Clipboard.setData(ClipboardData(text: url));
      if (!mounted) return;
      showClipboardCopiedNotice(context);
    } catch (_) {
      if (!mounted) return;
      showClipboardCopyFailedNotice(context);
    } finally {
      if (mounted) setState(() => _shareInProgress = false);
    }
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
    // _users: REST success and _onRankingSnapshot (today only) update list; build() does not parse snapshot.
    final users = _users;
    final refreshing = _loading && result != null;
    final planGate = PlanGate(context.watch<AccountStatusStore>().status);

    return RefreshIndicator(
      onRefresh: _load,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
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
                if (refreshing)
                  const LinearProgressIndicator(minHeight: 2),
                PeriodSelectorBar(
                  selection: _selection,
                  rangeLabel: _rangeLabel,
                  onChanged: _onPeriodChanged,
                  enabled: true,
                  customRangeActive: _customRange != null,
                  filterActive: _customRange != null || (_listenerQuery?.isNotEmpty ?? false),
                  onOpenCustomRangeFilter: _openCustomRangeFilter,
                  onShiftCustomRange: _shiftOutOfCustomRange,
                  extendedRangeAllowed: planGate.canUseExtendedHistoryRange,
                  dateNavTrailing: IconButton(
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                    tooltip: '共有リンクをコピー',
                    onPressed: _shareInProgress ? null : _shareGiftRanking,
                    icon: _shareInProgress
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                          )
                        : const ArrowShareIcon(size: 16),
                  ),
                ),
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
              ],
            ),
          ),
          if (users.isNotEmpty)
            ListPanelSliver(
              itemCount: users.length,
              itemBuilder: (context, i) => RankingListTile(
                // 期間をkeyへ含め、期間切替で行が再マウントされるようにする
                // (前の期間で展開・取得済みのギフト内訳を残さないため)。
                key: ValueKey('${users[i].tiktokUid}_${_rangeSignature()}'),
                rank: i + 1,
                entry: users[i],
                fetchBreakdown: _fetchBreakdown,
              ),
            ),
        ],
      ),
    );
  }
}
