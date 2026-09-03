import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/account_status_store.dart';
import '../../core/analytics_period.dart';
import '../../core/api_client.dart';
import '../../core/api_retry.dart';
import '../../core/battle_activity.dart';
import '../../core/battle_filter_store.dart';
import '../../core/gift_activity.dart';
import '../../core/plan_gate.dart';
import '../../core/session_controller.dart';
import '../../models/battle_summary.dart';
import '../../models/gift_ranking_entry.dart';
import '../widgets/analytics_status.dart';
import '../widgets/custom_range_filter_sheet.dart';
import '../widgets/gradient_kit.dart';
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
    final planGate = PlanGate(context.read<AccountStatusStore>().status);
    final result = await showCustomRangeFilterSheet(
      context,
      initial: _customRange,
      initialListenerQuery: _listenerQuery,
      extendedRangeAllowed: planGate.canUseExtendedHistoryRange,
      listenerFilterAllowed: planGate.canUseListenerFilter,
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
    final allBattles = result?.battles ?? const <BattleSummary>[];
    final planGate = PlanGate(context.watch<AccountStatusStore>().status);
    final filter = context.watch<BattleFilterStore>();
    final myTiktokId = context.watch<SessionController>().session?.streamer?.tiktokId;

    final battles = filter.hideSmall
        ? [
            for (final b in allBattles)
              if (!isSmallBattle(
                selfScore: b.selfScore,
                // 3陣営以上ではopponentScoreがnullなので、他陣営スコアの最大値で代用する
                // (代用しないと、自分の取り分が小さい大規模バトルまで隠れてしまう)。
                opponentScore: b.opponentScore ?? b.maxOtherTeamScore,
                threshold: filter.threshold,
              ))
                b,
          ]
        : allBattles;
    final hiddenCount = allBattles.length - battles.length;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          const KosaiSectionHeading('バトル履歴', top: 8),
          PeriodSelectorBar(
            selection: _selection,
            rangeLabel: _rangeLabel,
            onChanged: _onPeriodChanged,
            extendedRangeAllowed: planGate.canUseExtendedHistoryRange,
            enabled: !_loading,
            customRangeActive: _customRange != null,
            filterActive: _customRange != null || (_listenerQuery?.isNotEmpty ?? false),
            onOpenCustomRangeFilter: _openCustomRangeFilter,
            onShiftCustomRange: _shiftOutOfCustomRange,
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Text(
              'LIVE Sidestage登録後データ',
              style: TextStyle(fontSize: 10, color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ),
          // comp `.threshold-row`。しきい値そのものは設定タブで変えられる。
          Container(
            margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            padding: const EdgeInsets.fromLTRB(14, 2, 6, 2),
            decoration: BoxDecoration(
              color: kosaiCardColor(context),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${filter.threshold}コイン未満を非表示',
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
                  ),
                ),
                Transform.scale(
                  scale: 0.85,
                  child: Switch(value: filter.hideSmall, onChanged: filter.setHideSmall),
                ),
              ],
            ),
          ),
          if (_error != null) AnalyticsErrorBanner(message: _error!, onRetry: _load),
          if (_loading && result == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (!_loading && result != null && battles.isEmpty)
            EmptyListNotice(
              message: hiddenCount > 0
                  ? 'しきい値未満のバトルのみです($hiddenCount件を非表示中)'
                  : 'この期間はバトルがありません',
            ),
          for (final battle in battles)
            _BattleCard(
              battle: battle,
              myTiktokId: myTiktokId,
              onTap: () => _showContributors(battle),
            ),
          if (battles.isNotEmpty && hiddenCount > 0)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Center(
                child: Text(
                  '$hiddenCount件をしきい値で非表示中',
                  style: TextStyle(fontSize: 10, color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ),
            ),
          if (result?.hasMore ?? false)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Center(
                child: Text(
                  '直近分のみ表示',
                  style: TextStyle(fontSize: 10, color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ),
            ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}

/// バトル1件のカード(comp `.card.flat.battle-card`)。
/// 見出し行 / スコア行 / フッター行の3段構造で、**カードの高さを揃える**。
class _BattleCard extends StatelessWidget {
  const _BattleCard({required this.battle, required this.myTiktokId, required this.onTap});

  final BattleSummary battle;
  final String? myTiktokId;
  final VoidCallback onTap;

  /// comp `.battle-card` の `min-height:118px` 相当。
  static const double _minHeight = 142;

  /// 陣営ラベル。自陣は自分のハンドル、相手陣は先頭メンバーのハンドル(無ければ表示名)。
  String _teamLabel(BattleTeam team) {
    final count = team.participants.isEmpty ? 1 : team.participants.length;
    final String base;
    if (team.isSelf) {
      base = '@${myTiktokId ?? ''}';
    } else {
      final head = team.participants.isEmpty ? null : team.participants.first;
      final tiktokId = head?.tiktokId;
      base = tiktokId != null ? '@$tiktokId' : (head?.nickName ?? '対戦相手不明');
    }
    return count > 1 ? '$base 他${count - 1}名' : base;
  }

  @override
  Widget build(BuildContext context) {
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;
    final teams = battle.teams;
    // **3陣営以上のときだけ**陣営ごとの表示へ切り替える。2陣営までは従来どおり
    // selfTeam/opponentTeam + selfScore/opponentScore の経路をそのまま使う
    // (1vs1・2vs2の見た目を変えないため)。
    final multiTeam = teams != null && teams.length > 2;

    final BigInt? self;
    final BigInt? opponent;
    final String countLabel;
    final Widget scoreRow;

    if (multiTeam) {
      final selfTeamData = teams.firstWhere((t) => t.isSelf, orElse: () => teams.first);
      self = BigInt.tryParse(selfTeamData.score ?? '');
      // 勝敗バッジは「自分 vs 他陣営の最高スコア」で判定する。
      opponent = BigInt.tryParse(battle.maxOtherTeamScore ?? '');
      countLabel = teams.map((t) => t.participants.isEmpty ? 1 : t.participants.length).join(' vs ');

      final scores = [for (final t in teams) BigInt.tryParse(t.score ?? '')];
      // 首位が1陣営だけのときのみグラデーション表示にする(同点なら誰も強調しない)。
      BigInt? top;
      var topCount = 0;
      for (final s in scores) {
        if (s == null) continue;
        if (top == null || s > top) {
          top = s;
          topCount = 1;
        } else if (s == top) {
          topCount++;
        }
      }

      final segments = <Widget>[];
      for (var i = 0; i < teams.length; i++) {
        if (i > 0) {
          segments.add(
            Container(
              height: 19,
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text('–', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: sub)),
            ),
          );
        }
        final team = teams[i];
        segments.add(
          Flexible(
            child: _ScoreSegment(
              own: team.isSelf,
              many: true,
              name: _teamLabel(team),
              score: _BattleHistoryTabState._formatScore(team.score),
              winning: topCount == 1 && scores[i] != null && scores[i] == top,
              avatars: [
                for (final p in team.participants) p.avatarUrl,
                if (team.participants.isEmpty) null,
              ],
            ),
          ),
        );
      }
      scoreRow = Row(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: segments,
      );
    } else {
      final selfTeam = battle.selfTeam;
      final opponentTeam = battle.opponentTeam;
      final selfCount = selfTeam?.length ?? 1;
      final opponentCount = opponentTeam?.length ?? battle.opponent?.count ?? 1;
      // 3陣営以上は comp `.score-line.many` の縮小サイズで横に並べる。
      final many = selfCount + opponentCount > 2;

      self = BigInt.tryParse(battle.selfScore ?? '');
      opponent = BigInt.tryParse(battle.opponentScore ?? '');

      final selfLabel = selfCount > 1
          ? '@${myTiktokId ?? ''} 他${selfCount - 1}名'
          : '@${myTiktokId ?? ''}';
      final opponentBase = _BattleHistoryTabState._opponentLabel(battle.opponent);
      final opponentLabel = opponentCount > 1 ? '$opponentBase 他${opponentCount - 1}名' : opponentBase;
      countLabel = '$selfCount vs $opponentCount';

      scoreRow = Row(
        mainAxisAlignment: MainAxisAlignment.center,
        // セグメントはスコア行の下に名前を持つので、既定の中央揃えだと
        // 区切りの「–」がスコアより下へずれる。上端で揃えて、区切り自体を
        // スコア行(=アバターの高さ)の中で中央に置く。
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Flexible(
            child: _ScoreSegment(
              own: true,
              many: many,
              name: selfLabel,
              score: _BattleHistoryTabState._formatScore(battle.selfScore),
              winning: self != null && opponent != null && self > opponent,
              avatars: [
                for (final p in selfTeam ?? const <BattleParticipant>[]) p.avatarUrl,
                if (selfTeam == null) null,
              ],
            ),
          ),
          Container(
            height: many ? 19 : 26,
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text(
              '–',
              style: TextStyle(
                fontSize: many ? 11 : 13,
                fontWeight: FontWeight.w700,
                color: sub,
              ),
            ),
          ),
          Flexible(
            child: _ScoreSegment(
              own: false,
              many: many,
              name: opponentLabel,
              score: _BattleHistoryTabState._formatScore(battle.opponentScore),
              winning: self != null && opponent != null && opponent > self,
              avatars: [
                for (final p in opponentTeam ?? const <BattleParticipant>[]) p.avatarUrl,
                if (opponentTeam == null) battle.opponent?.avatarUrl,
              ],
            ),
          ),
        ],
      );
    }

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      constraints: const BoxConstraints(minHeight: _minHeight),
      decoration: BoxDecoration(
        color: kosaiCardColor(context),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              // カードの高さを揃えるため、余った縦の空きはフッターとの間に逃がす
              // (comp `.battle-foot { margin-top:auto }`)。
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(countLabel, style: TextStyle(fontSize: 11, color: sub)),
                        ),
                        _OutcomeBadge(status: battle.status, self: self, opponent: opponent),
                      ],
                    ),
                    const SizedBox(height: 10),
                    scoreRow,
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    '${_BattleHistoryTabState._formatStartedAt(battle.startedAt)} '
                    '${_BattleHistoryTabState._statusLabel(battle.status)}',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 10, color: sub),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 片方の陣営(comp `.score-seg`)。自陣は左(アイコン→スコア)、相手陣は右(スコア→アイコン)。
class _ScoreSegment extends StatelessWidget {
  const _ScoreSegment({
    required this.own,
    required this.many,
    required this.name,
    required this.score,
    required this.winning,
    required this.avatars,
  });

  final bool own;

  /// 3陣営以上のときの縮小表示(comp `.score-line.many`)。
  final bool many;
  final String name;
  final String score;
  final bool winning;
  final List<String?> avatars;

  @override
  Widget build(BuildContext context) {
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;
    final avatarSize = many ? 19.0 : 26.0;
    final scoreSize = many ? 13.0 : 20.0;
    final nameSize = many ? 8.0 : 10.0;
    final maxWidth = many ? 50.0 : 104.0;

    final stack = KosaiAvatarStack(
      size: avatarSize,
      borderColor: own ? KosaiPalette.c2 : null,
      children: [for (final url in avatars) UserAvatar(url, size: avatarSize)],
    );

    // 勝っている側だけスコアをグラデーション文字にする(comp `.team-score.grad`)。
    final scoreStyle = TextStyle(fontSize: scoreSize, fontWeight: FontWeight.w800);
    final scoreWidget = winning
        ? GradientText(score, style: scoreStyle, gradient: KosaiPalette.score)
        : Text(score, style: scoreStyle);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: own
              ? [stack, SizedBox(width: many ? 3 : 6), scoreWidget]
              : [scoreWidget, SizedBox(width: many ? 3 : 6), stack],
        ),
        const SizedBox(height: 3),
        ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth),
          child: Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: nameSize,
              color: own ? KosaiPalette.c2 : sub,
              fontWeight: own ? FontWeight.w700 : FontWeight.w400,
            ),
          ),
        ),
      ],
    );
  }
}

/// 勝敗バッジ(comp `.win-badge`)。スコアが取れていない場合は何も出さない。
class _OutcomeBadge extends StatelessWidget {
  const _OutcomeBadge({required this.status, required this.self, required this.opponent});

  final BattleStatus status;
  final BigInt? self;
  final BigInt? opponent;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    const textStyle = TextStyle(fontSize: 11, fontWeight: FontWeight.w800);
    const padding = EdgeInsets.symmetric(horizontal: 12, vertical: 4);

    Widget outlined(String label, Color color) => Container(
          padding: padding,
          decoration: BoxDecoration(
            color: kosaiCardColor(context),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: color),
          ),
          child: Text(label, style: textStyle.copyWith(color: color)),
        );

    if (status == BattleStatus.live) return outlined('進行中', KosaiPalette.c2);
    if (self == null || opponent == null) {
      return status == BattleStatus.cutShort ? outlined('中断', scheme.onSurfaceVariant) : const SizedBox.shrink();
    }
    if (self! > opponent!) {
      return Container(
        padding: padding,
        decoration: const BoxDecoration(
          gradient: KosaiPalette.win,
          borderRadius: BorderRadius.all(Radius.circular(999)),
        ),
        child: Text('WIN', style: textStyle.copyWith(color: Colors.white)),
      );
    }
    if (self! < opponent!) return outlined('LOSE', scheme.error);
    return outlined('DRAW', scheme.onSurfaceVariant);
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
