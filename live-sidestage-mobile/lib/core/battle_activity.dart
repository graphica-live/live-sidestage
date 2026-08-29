import 'dart:async';

import 'package:flutter/foundation.dart';

/// バトル終了通知(`chat:battle`)を受けたタブが取るべき行動。
/// [GiftActivityNotifier]の判定([giftAutoReloadAction])と同じ形だが、「今日」の
/// 代わりに**バトルの開始日**を基準にする点が違う(バトル履歴タブの期間判定は
/// 開始日基準 — 深夜0時をまたぐバトルが「今日」判定だと漏れるため)。
enum BattleAutoReloadAction {
  /// 何もしない。
  ignore,

  /// 今は取りに行かず、次にタブが見えたとき／前面へ戻ったときに1回だけ取り直す。
  defer,

  /// すぐ取り直す。
  reload,
}

BattleAutoReloadAction battleAutoReloadAction({
  required bool active,
  required bool resumed,
  required bool containsStartedDate,
}) {
  if (!containsStartedDate) return BattleAutoReloadAction.ignore;
  if (!active || !resumed) return BattleAutoReloadAction.defer;
  return BattleAutoReloadAction.reload;
}

/// 「バトルが終了した(またはEND後にスコアが確定した)」ことだけを画面側へ伝える通知。
///
/// **スコア等の値は一切持たない。** バトル履歴の正はサーバー(REST の queryBattles)
/// だけで、端末は「取りに行き直すきっかけ」に徹する(理由は gift_activity.dart と同じ)。
/// Provider は型で解決するため、[GiftActivityNotifier] とは別クラスとして用意する。
class BattleActivityNotifier extends ChangeNotifier {
  BattleActivityNotifier({
    this.debounce = const Duration(seconds: 2),
    this.maxWait = const Duration(seconds: 6),
  });

  /// 最後の通知から、これだけ待ってから発火する。
  final Duration debounce;

  /// 通知が続いている間も、これを超えたら必ず1回発火する。
  final Duration maxWait;

  /// 通知した回数。購読側はこの値の変化を見る(値そのものに意味は無い)。
  int get revision => _revision;
  int _revision = 0;

  /// 直近に届いた通知のバトル開始日(JSTの"YYYY-MM-DD")。
  /// タブ側の期間判定([AnalyticsPeriodSelection.containsJstToday])にそのまま渡す。
  String? get lastStartedDateKey => _lastStartedDateKey;
  String? _lastStartedDateKey;

  Timer? _debounceTimer;
  Timer? _maxWaitTimer;
  bool _disposed = false;

  /// バトル終了通知が1件届いた。END直後とEND後のスコア確定で複数回呼ばれうる。
  void onBattleTick(String startedDateKey) {
    if (_disposed) return;

    _lastStartedDateKey = startedDateKey;
    _debounceTimer?.cancel();
    _debounceTimer = Timer(debounce, _fire);
    _maxWaitTimer ??= Timer(maxWait, _fire);
  }

  void _fire() {
    _debounceTimer?.cancel();
    _debounceTimer = null;
    _maxWaitTimer?.cancel();
    _maxWaitTimer = null;
    if (_disposed) return;
    _revision++;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _debounceTimer?.cancel();
    _debounceTimer = null;
    _maxWaitTimer?.cancel();
    _maxWaitTimer = null;
    super.dispose();
  }
}
