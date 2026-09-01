import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/analytics_period.dart';
import '../../core/api_client.dart';
import '../../core/api_retry.dart';
import '../../core/battle_activity.dart';
import '../../core/gift_activity.dart';
import '../../core/session_controller.dart';
import '../../models/battle_summary.dart';
import '../../models/gift_ranking_entry.dart';
import '../widgets/analytics_status.dart';
import '../widgets/custom_range_filter_sheet.dart';
import '../widgets/list_panel.dart';
import '../widgets/period_selector.dart';
import '../widgets/ranking_list_tile.dart';
import '../widgets/user_avatar.dart';

/// バトル履歴タブ。行をタップするとそのバトル区間の貢献者一覧をボトムシートで開く。
///
/// バトル終了(またはEND後のスコア確定)を受け取ると[BattleActivityNotifier]経由で
/// 取り直す。**端末側でスコア等を積まない** — 正はサーバー(REST の queryBattles)
/// だけ(理由は battle_activity.dart / gift_activity.dart と同じ)。
class BattleHistoryTab extends StatefulWidget {
  const BattleHistoryTab({super.key, required this.active});

  final bool active;

  @override
  State<BattleHistoryTab> createState() => _BattleHistoryTabState();
}

class _BattleHistoryTabState extends State<BattleHistoryTab> with WidgetsBindingObserver {
  final LiveAnalyticsApi _api = LiveAnalyticsApi();

  AnalyticsPeriodSelection _selection = AnalyticsPeriodSelection.today();
  DateTimeRange? _customRange;
  String? _listenerQuery;
  BattleListResult? _result;
  String? _error;
  bool _loading = false;
  int _requestGeneration = 0;

  /// 見えていない間に届いた通知。次に見えたとき／前面へ戻ったときに1回だけ取り直す。
  bool _dirty = false;

  /// リスナー名フィルタ有効時、見えていない間に届いたギフト起点の分。[_dirty]とは
  /// トリガーの意味が違うので別フラグにするが、flushは[_flushDirty]の1箇所へ統合する
  /// (両方立った状態で個別にflushすると`_load`が2回走ってしまうため)。
  bool _giftDirty = false;

  bool _resumed = true;

  /// 直前の取得結果に進行中バトルが1件でも含まれるか。リスナー名フィルタ中のギフト到着を
  /// 再取得のトリガーにすべきか判定するのに使う(JST日付境界をまたぐ進行中バトルでも
  /// 正しく判定できるよう、日付ベースの判定は使わない — 詳細はplan §3)。
  bool get _hasOpenBattleInView => _result?.battles.any((b) => b.status == BattleStatus.live) ?? false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    context.read<BattleActivityNotifier>().addListener(_onBattleActivity);
    // _listenerQueryは常にnullで始まるため、GiftActivityNotifierへはここでは購読しない
    // (_openCustomRangeFilterで空⇄非空が切り替わったときにだけ購読/解除する)。
    if (widget.active) _load();
  }

  @override
  void dispose() {
    context.read<BattleActivityNotifier>().removeListener(_onBattleActivity);
    // 購読していなくてもremoveListenerは安全にno-opになるため、現在の購読有無を問わず呼べる。
    context.read<GiftActivityNotifier>().removeListener(_onListenerFilterGiftActivity);
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
  void didUpdateWidget(covariant BattleHistoryTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    // **一度きりにしない。** 見ていない間にバトルが進んでいるので、タブへ戻るたび取り直す。
    if (!oldWidget.active && widget.active) _load(silent: _result != null);
  }

  void _onBattleActivity() {
    final customRange = _customRange;
    final startedDateKey = context.read<BattleActivityNotifier>().lastStartedDateKey;
    // 「今日」ではなく**バトルの開始日**で判定する。深夜0時をまたぐバトルが
    // 「今日」判定だと自動更新の対象から漏れるため。
    // customRange指定時は「バトルの開始日」ではなく「選択した範囲が現在を含むか」で
    // 判定する(期間の切り口が期間種別ではなく開始・終了日時そのものになるため)。
    final containsStartedDate = customRange != null
        ? customRangeContainsNow(customRange)
        : startedDateKey != null && _selection.containsJstToday(today: startedDateKey);
    switch (battleAutoReloadAction(
      active: widget.active,
      resumed: _resumed,
      containsStartedDate: containsStartedDate,
    )) {
      case BattleAutoReloadAction.ignore:
        break;
      case BattleAutoReloadAction.defer:
        _dirty = true;
      case BattleAutoReloadAction.reload:
        _load(silent: true);
    }
  }

  /// ギフト到着起点。リスナー名フィルタが有効で、かつ直前の結果に進行中バトルが
  /// 含まれる場合のみ意味を持つ(それ以外はギフトが届いても一覧の中身は変わりようがない)。
  void _onListenerFilterGiftActivity() {
    if (!(_listenerQuery?.isNotEmpty ?? false)) return;
    if (!_hasOpenBattleInView) return;
    if (!widget.active || !_resumed) {
      _giftDirty = true;
      return;
    }
    _load(silent: true);
  }

  /// バトル起点([_dirty])とギフト起点([_giftDirty])を1箇所で統合してflushする。
  /// 両方を独立にflushすると同時に立った際`_load`が2回走ってしまうため、
  /// どちらか一方でも条件を満たせば両方まとめてクリアし`_load`は1回だけ呼ぶ。
  void _flushDirty() {
    if (!widget.active) return;
    final customRange = _customRange;
    final startedDateKey = context.read<BattleActivityNotifier>().lastStartedDateKey;
    final containsNow = customRange != null
        ? customRangeContainsNow(customRange)
        : startedDateKey != null && _selection.containsJstToday(today: startedDateKey);
    final battleShouldFlush = _dirty && containsNow;
    final giftShouldFlush = _giftDirty;
    if (!battleShouldFlush && !giftShouldFlush) return;
    _dirty = false;
    _giftDirty = false;
    _load(silent: true);
  }

  /// [silent] はバトル終了通知による自動更新。**読み込み中の表示を出さない。**
  /// 出すと期間セレクタが `enabled: !_loading` で点滅的に無効化され、操作を邪魔する。
  /// 失敗も黙って捨てる(既存の表示を残す) — 次の通知か手動更新で拾い直せる。
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
        call: (t) => _api.fetchBattles(
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
        debugPrint('[battle] 自動更新に失敗: ${e.message}');
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
    final previousQuery = _listenerQuery;
    final newQuery = result.cleared ? null : result.listenerQuery;
    setState(() {
      _customRange = result.cleared ? null : result.range;
      _listenerQuery = newQuery;
    });
    _updateGiftListenerSubscription(previousQuery, newQuery);
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

  /// [_listenerQuery]の空⇄非空が切り替わったときだけ[GiftActivityNotifier]への
  /// 購読/解除を行う(空→空、非空→非空の変化では何もしない)。
  void _updateGiftListenerSubscription(String? previousQuery, String? newQuery) {
    final wasActive = previousQuery?.isNotEmpty ?? false;
    final isActive = newQuery?.isNotEmpty ?? false;
    if (wasActive == isActive) return;
    final notifier = context.read<GiftActivityNotifier>();
    if (isActive) {
      notifier.addListener(_onListenerFilterGiftActivity);
    } else {
      notifier.removeListener(_onListenerFilterGiftActivity);
      _giftDirty = false;
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

  static String _statusLabel(BattleStatus status) => switch (status) {
        BattleStatus.live => '進行中',
        BattleStatus.finished => '終了',
        BattleStatus.cutShort => '中断',
        BattleStatus.unknown => '不明',
      };

  static String _opponentLabel(BattleOpponent? opponent) {
    if (opponent == null) return '対戦相手不明';
    if (opponent.count > 1) return '複数人バトル(${opponent.count + 1}人)';
    return opponent.tiktokId != null ? '@${opponent.tiktokId}' : '対戦相手不明';
  }

  static String _formatStartedAt(DateTime? utc) {
    if (utc == null) return '';
    final jst = utc.toUtc().add(const Duration(hours: 9));
    final mm = jst.month.toString().padLeft(2, '0');
    final dd = jst.day.toString().padLeft(2, '0');
    final hh = jst.hour.toString().padLeft(2, '0');
    final mi = jst.minute.toString().padLeft(2, '0');
    return '$mm/$dd $hh:$mi';
  }

  static String _formatScore(String? score) {
    if (score == null) return '-';
    final value = BigInt.tryParse(score);
    if (value == null) return score;
    final digits = value.toString();
    final buffer = StringBuffer();
    for (var i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 == 0) buffer.write(',');
      buffer.write(digits[i]);
    }
    return buffer.toString();
  }

  void _showContributors(BattleSummary battle) {
    final sessions = context.read<SessionController>();
    final token = sessions.session?.token;
    if (token == null) return;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => _BattleContributorsSheet(
        api: _api,
        battleId: battle.battleId,
        token: token,
        refreshToken: sessions.refreshToken,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    final battles = result?.battles ?? const [];

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
          if (!_loading && result != null && battles.isEmpty)
            const EmptyListNotice(message: 'この期間はバトルがありません'),
          if (battles.isNotEmpty)
            ListPanel(
              children: [
                for (final battle in battles)
                  InkWell(
                    onTap: () => _showContributors(battle),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      child: Row(
                        children: [
                          _BattleAvatarsRow(battle: battle),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('vs ${_opponentLabel(battle.opponent)}'),
                                Text(
                                  '${_statusLabel(battle.status)} ・ ${_formatStartedAt(battle.startedAt)}',
                                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Text(
                            '${_formatScore(battle.selfScore)} - ${_formatScore(battle.opponentScore)}',
                            style: Theme.of(
                              context,
                            ).textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          if (result?.hasMore ?? false)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Center(
                child: Text(
                  '直近分のみ表示',
                  style: Theme.of(
                    context,
                  ).textTheme.labelSmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// リスト行のleading。「自分アイコン(束) vs 相手アイコン(束)」を横並びにする。
/// チーム戦で複数人になる場合は[_BattleAvatarCluster]が重ねて表示する。
class _BattleAvatarsRow extends StatelessWidget {
  const _BattleAvatarsRow({required this.battle});

  final BattleSummary battle;

  @override
  Widget build(BuildContext context) {
    final selfUrls = battle.selfTeam?.map((p) => p.avatarUrl).toList() ?? const [null];
    final opponentUrls = battle.opponentTeam?.map((p) => p.avatarUrl).toList() ?? [battle.opponent?.avatarUrl];

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _BattleAvatarCluster(avatarUrls: selfUrls),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Text('vs', style: TextStyle(fontSize: 10, color: Theme.of(context).disabledColor)),
        ),
        _BattleAvatarCluster(avatarUrls: opponentUrls),
      ],
    );
  }
}

/// [avatarUrls]を円形アイコンで表示する。複数件なら少しずつ重ねて表示する
/// (先頭3件まで。それ以上は先頭3件のみ)。
class _BattleAvatarCluster extends StatelessWidget {
  const _BattleAvatarCluster({required this.avatarUrls});

  final List<String?> avatarUrls;

  static const double _size = 28;
  static const int _maxShown = 3;
  static const double _overlap = 0.55;

  @override
  Widget build(BuildContext context) {
    final urls = avatarUrls.isEmpty ? const [null] : avatarUrls.take(_maxShown).toList();
    if (urls.length == 1) return UserAvatar(urls.first, size: _size);

    final step = _size * _overlap;
    return SizedBox(
      width: _size + step * (urls.length - 1),
      height: _size,
      child: Stack(
        children: [
          for (var i = 0; i < urls.length; i++)
            Positioned(left: step * i, child: UserAvatar(urls[i], size: _size)),
        ],
      ),
    );
  }
}

class _BattleContributorsSheet extends StatefulWidget {
  const _BattleContributorsSheet({
    required this.api,
    required this.battleId,
    required this.token,
    required this.refreshToken,
  });

  final LiveAnalyticsApi api;
  final String battleId;
  final String token;
  final Future<String?> Function() refreshToken;

  @override
  State<_BattleContributorsSheet> createState() => _BattleContributorsSheetState();
}

class _BattleContributorsSheetState extends State<_BattleContributorsSheet> {
  List<GiftRankingEntry>? _contributors;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final contributors = await withTokenRefresh(
        call: (t) => widget.api.fetchBattleContributors(token: t, battleId: widget.battleId),
        token: widget.token,
        refreshToken: widget.refreshToken,
      );
      if (!mounted) return;
      setState(() {
        _contributors = contributors;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final contributors = _contributors;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: Text('このバトルの貢献者', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
            const SizedBox(height: 8),
            if (_loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: CircularProgressIndicator(),
              ),
            if (_error != null) AnalyticsErrorBanner(message: _error!, onRetry: _load),
            if (!_loading && _error == null && (contributors?.isEmpty ?? false))
              const EmptyListNotice(message: 'このバトルの貢献者はいません'),
            if (contributors != null && contributors.isNotEmpty)
              Flexible(
                child: SingleChildScrollView(
                  child: ListPanel(
                    children: [
                      for (var i = 0; i < contributors.length; i++)
                        RankingListTile(rank: i + 1, entry: contributors[i]),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
