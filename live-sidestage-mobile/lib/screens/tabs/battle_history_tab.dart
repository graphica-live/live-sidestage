import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/analytics_period.dart';
import '../../core/api_client.dart';
import '../../core/api_retry.dart';
import '../../core/battle_activity.dart';
import '../../core/session_controller.dart';
import '../../models/battle_summary.dart';
import '../../models/gift_ranking_entry.dart';
import '../widgets/analytics_status.dart';
import '../widgets/period_selector.dart';
import '../widgets/ranking_list_tile.dart';

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
  BattleListResult? _result;
  String? _error;
  bool _loading = false;
  int _requestGeneration = 0;

  /// 見えていない間に届いた通知。次に見えたとき／前面へ戻ったときに1回だけ取り直す。
  bool _dirty = false;
  bool _resumed = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    context.read<BattleActivityNotifier>().addListener(_onBattleActivity);
    if (widget.active) _load();
  }

  @override
  void dispose() {
    context.read<BattleActivityNotifier>().removeListener(_onBattleActivity);
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
    final startedDateKey = context.read<BattleActivityNotifier>().lastStartedDateKey;
    switch (battleAutoReloadAction(
      active: widget.active,
      resumed: _resumed,
      // 「今日」ではなく**バトルの開始日**で判定する。深夜0時をまたぐバトルが
      // 「今日」判定だと自動更新の対象から漏れるため。
      containsStartedDate: startedDateKey != null && _selection.containsJstToday(today: startedDateKey),
    )) {
      case BattleAutoReloadAction.ignore:
        break;
      case BattleAutoReloadAction.defer:
        _dirty = true;
      case BattleAutoReloadAction.reload:
        _load(silent: true);
    }
  }

  void _flushDirty() {
    final startedDateKey = context.read<BattleActivityNotifier>().lastStartedDateKey;
    if (!_dirty || !widget.active) return;
    if (startedDateKey == null || !_selection.containsJstToday(today: startedDateKey)) return;
    _dirty = false;
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

    try {
      final result = await withTokenRefresh(
        call: (t) => _api.fetchBattles(
          token: t,
          period: _selection.period.apiValue,
          date: _selection.date,
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

  String get _rangeLabel {
    final range = _result?.dateRange;
    if (range == null || range.start.isEmpty) return _selection.date;
    return range.start == range.end ? range.start : '${range.start} 〜 ${range.end}';
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
          for (final battle in battles)
            ListTile(
              onTap: () => _showContributors(battle),
              title: Text('vs ${_opponentLabel(battle.opponent)}'),
              subtitle: Text('${_statusLabel(battle.status)} ・ ${_formatStartedAt(battle.startedAt)}'),
              trailing: Text(
                '${_formatScore(battle.selfScore)} - ${_formatScore(battle.opponentScore)}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          if (result?.hasMore ?? false)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Center(
                child: Text('直近分のみ表示', style: TextStyle(color: Theme.of(context).disabledColor, fontSize: 12)),
              ),
            ),
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
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: contributors.length,
                  itemBuilder: (context, i) => RankingListTile(rank: i + 1, entry: contributors[i]),
                ),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
